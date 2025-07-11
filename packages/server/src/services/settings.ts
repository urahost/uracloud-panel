import { readdirSync } from "node:fs";
import { join } from "node:path";
import { docker } from "@dokploy/server/constants";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { existsSync, readFileSync } from "node:fs";

export interface IUpdateData {
	latestVersion: string | null;
	updateAvailable: boolean;
}

export const DEFAULT_UPDATE_DATA: IUpdateData = {
	latestVersion: null,
	updateAvailable: false,
};

// Récupère dynamiquement le dernier tag de version depuis GHCR
export const getLatestRemoteTag = async (): Promise<string> => {
  const res = await fetch(
    'https://ghcr.io/v2/urahost/uracloud-panel/dokploy/tags/list',
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) return 'latest-amd64';
  const data = await res.json();
  const tags: string[] = data.tags || [];
  // Filtre les tags versionnés de type X.Y.Z-amd64
  const versionedTags = tags.filter(t => /^\d+\.\d+\.\d+-amd64$/.test(t));
  if (versionedTags.length > 0) {
    // Trie par version décroissante
    versionedTags.sort((a, b) => {
      const vAparts = a.split('-');
      const vBparts = b.split('-');
      const vA = (vAparts[0] || '').split('.').map(Number);
      const vB = (vBparts[0] || '').split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((vA[i] || 0) !== (vB[i] || 0)) return (vB[i] || 0) - (vA[i] || 0);
      }
      return 0;
    });
    return versionedTags[0] || 'latest-amd64';
  }
  // Fallback sur latest-amd64 si aucun tag versionné trouvé
  if (tags.includes('latest-amd64')) return 'latest-amd64';
  if (tags.includes('canary-amd64')) return 'canary-amd64';
  return tags[0] || 'latest-amd64';
};

export const getDokployImageTag = async () => {
  return await getLatestRemoteTag();
};

export const getDokployImage = async () => {
  const tag = await getDokployImageTag();
  return `ghcr.io/urahost/uracloud-panel/dokploy:${tag}`;
};

export const pullLatestRelease = async () => {
  const image = await getDokployImage();
  console.log("Pulling image:", image);
  const stream = await docker.pull(image);
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err, res) =>
      err ? reject(err) : resolve(res),
    );
  });
  console.log("Updating service dokploy to image:", image);
  const { stdout, stderr } = await execAsync(
    `docker service update --image ${image} dokploy`
  );
  console.log("Service update stdout:", stdout);
  console.log("Service update stderr:", stderr);
};

/** Returns Dokploy docker service image digest */
export const getServiceImageDigest = async () => {
	const { stdout } = await execAsync(
		"docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'",
	);

	const currentDigest = stdout.trim().split("@")[1];

	if (!currentDigest) {
		throw new Error("Could not get current service image digest");
	}

	return currentDigest;
};

/** Returns Dokploy docker service image tag (not digest) */
export const getServiceImageTag = async () => {
  const { stdout } = await execAsync(
    "docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'",
  );
  // Extrait le tag de l'image (après le dernier ':')
  const image = stdout.trim();
  const tag = image.split(':').pop()?.split('@')[0];
  if (!tag) throw new Error('Could not get current service image tag');
  return tag;
};

/**
 * Pour un digest donné, retourne le tag versionné correspondant (ex: 0.24.7-amd64) sur GHCR
 */
export const getVersionedTagForDigest = async (digest: string): Promise<string | null> => {
  const res = await fetch(
    'https://ghcr.io/v2/urahost/uracloud-panel/dokploy/tags/list',
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const tags: string[] = data.tags || [];
  for (const tag of tags) {
    if (/^\d+\.\d+\.\d+-amd64$/.test(tag)) {
      const manifestRes = await fetch(
        `https://ghcr.io/v2/urahost/uracloud-panel/dokploy/manifests/${tag}`,
        { headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' } }
      );
      if (!manifestRes.ok) continue;
      const manifest = await manifestRes.json();
      if (manifest.config && manifest.config.digest === digest) {
        return tag;
      }
    }
  }
  return null;
};

/** Returns latest version number and information whether server update is available by comparing current image's tag against the latest tag from GHCR. */
export const getUpdateData = async (): Promise<IUpdateData> => {
  let currentTag: string;
  try {
    currentTag = await getServiceImageTag();
  } catch {
    return DEFAULT_UPDATE_DATA;
  }
  const latestTag = await getDokployImageTag();
  let latestVersion = latestTag;
  // Si le dernier tag est latest-amd64, essaye de trouver le tag versionné correspondant
  if (latestTag === 'latest-amd64') {
    // Récupère le digest de latest-amd64
    const manifestRes = await fetch(
      `https://ghcr.io/v2/urahost/uracloud-panel/dokploy/manifests/latest-amd64`,
      { headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' } }
    );
    if (manifestRes.ok) {
      const manifest = await manifestRes.json();
      if (manifest.config && manifest.config.digest) {
        const versionedTag = await getVersionedTagForDigest(manifest.config.digest);
        if (versionedTag) {
          latestVersion = versionedTag;
        }
      }
    }
  }
  const updateAvailable = currentTag !== latestTag && currentTag !== latestVersion;
  return { latestVersion, updateAvailable };
};

interface TreeDataItem {
	id: string;
	name: string;
	type: "file" | "directory";
	children?: TreeDataItem[];
}

export const readDirectory = async (
	dirPath: string,
	serverId?: string,
): Promise<TreeDataItem[]> => {
	if (serverId) {
		const { stdout } = await execAsyncRemote(
			serverId,
			`
process_items() {
    local parent_dir="$1"
    local __resultvar=$2

    local items_json=""
    local first=true
    for item in "$parent_dir"/*; do
        [ -e "$item" ] || continue
        process_item "$item" item_json
        if [ "$first" = true ]; then
            first=false
            items_json="$item_json"
        else
            items_json="$items_json,$item_json"
        fi
    done

    eval $__resultvar="'[$items_json]'"
}

process_item() {
    local item_path="$1"
    local __resultvar=$2

    local item_name=$(basename "$item_path")
    local escaped_name=$(echo "$item_name" | sed 's/"/\\"/g')
    local escaped_path=$(echo "$item_path" | sed 's/"/\\"/g')

    if [ -d "$item_path" ]; then
        # Is directory
        process_items "$item_path" children_json
        local json='{"id":"'"$escaped_path"'","name":"'"$escaped_name"'","type":"directory","children":'"$children_json"'}'
    else
        # Is file
        local json='{"id":"'"$escaped_path"'","name":"'"$escaped_name"'","type":"file"}'
    fi

    eval $__resultvar="'$json'"
}

root_dir=${dirPath}

process_items "$root_dir" json_output

echo "$json_output"
			`,
		);
		const result = JSON.parse(stdout);
		return result;
	}

	const stack = [dirPath];
	const result: TreeDataItem[] = [];
	const parentMap: Record<string, TreeDataItem[]> = {};

	while (stack.length > 0) {
		const currentPath = stack.pop();
		if (!currentPath) continue;

		const items = readdirSync(currentPath, { withFileTypes: true });
		const currentDirectoryResult: TreeDataItem[] = [];

		for (const item of items) {
			const fullPath = join(currentPath, item.name);
			if (item.isDirectory()) {
				stack.push(fullPath);
				const directoryItem: TreeDataItem = {
					id: fullPath,
					name: item.name,
					type: "directory",
					children: [],
				};
				currentDirectoryResult.push(directoryItem);
				parentMap[fullPath] = directoryItem.children as TreeDataItem[];
			} else {
				const fileItem: TreeDataItem = {
					id: fullPath,
					name: item.name,
					type: "file",
				};
				currentDirectoryResult.push(fileItem);
			}
		}

		if (parentMap[currentPath]) {
			parentMap[currentPath].push(...currentDirectoryResult);
		} else {
			result.push(...currentDirectoryResult);
		}
	}
	return result;
};

export const cleanupFullDocker = async (serverId?: string | null) => {
	const cleanupImages = "docker image prune --force";
	const cleanupVolumes = "docker volume prune --force";
	const cleanupContainers = "docker container prune --force";
	const cleanupSystem = "docker system prune  --force --volumes";
	const cleanupBuilder = "docker builder prune  --force";

	try {
		if (serverId) {
			await execAsyncRemote(
				serverId,
				`
	${cleanupImages}
	${cleanupVolumes}
	${cleanupContainers}
	${cleanupSystem}
	${cleanupBuilder}
			`,
			);
		}
		await execAsync(`
			${cleanupImages}
			${cleanupVolumes}
			${cleanupContainers}
			${cleanupSystem}
			${cleanupBuilder}
					`);
	} catch (error) {
		console.log(error);
	}
};

/** Charge les variables d'un fichier .env dans process.env si elles ne sont pas déjà présentes */
export function loadEnvFromFile(envPath = "/etc/dokploy/.env") {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim();
    if (key && !(key in process.env)) {
      process.env[key.trim()] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}
// Appel automatique si on détecte qu'on n'est pas en prod Docker
if (process.env.NODE_ENV !== "production" && existsSync("/etc/dokploy/.env")) {
  loadEnvFromFile();
}
