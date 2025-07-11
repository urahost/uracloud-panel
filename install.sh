#!/bin/bash

# --- Prérequis pour Debian 12 ---
apt_update_if_needed() {
  if [ ! -f /var/lib/apt/periodic/update-success-stamp ] || \
     [ $(( $(date +%s) - $(stat -c %Y /var/lib/apt/periodic/update-success-stamp) )) -gt 86400 ]; then
    apt-get update
  fi
}

if ! command -v curl >/dev/null 2>&1; then
  echo "curl non trouvé, installation..."
  apt_update_if_needed
  apt-get install -y curl ca-certificates
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker non trouvé, installation..."
  apt_update_if_needed
  curl -fsSL https://get.docker.com | sh
fi

# =====================
# Dokploy Install/Update Script
# =====================
# Ce script installe ou met à jour le service dokploy avec le dernier tag GHCR.
# Usage :
#   ./install.sh                # installation (dernier tag)
#   ./install.sh update         # update vers le dernier tag stable
#   ./install.sh update <image:tag> # update vers une image précise
#   ./install.sh rollback       # rollback du service dokploy

# --- Configuration par défaut ---
GITHUB_ORG="urahost"
GITHUB_REPO="uracloud-panel"
DOKPLOY_COMPONENT="dokploy"
ENV_FILE="/etc/dokploy/.env"

# --- Fonctions utilitaires ---
get_latest_docker_tag() {
  curl -s "https://ghcr.io/v2/${GITHUB_ORG}/${GITHUB_REPO}/${DOKPLOY_COMPONENT}/tags/list" \
    | grep -oP '"tags":\[\K[^\]]+' \
    | tr -d '"' | tr ',' '\n' \
    | grep -v -E 'canary|sha256' \
    | grep 'amd64' \
    | sed 's/-amd64$//' \
    | sort -t. -k1,1n -k2,2n -k3,3n -r \
    | head -n1 \
    | awk '{print $1 "-amd64"}'
}

get_current_image() {
  docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null
}

# --- Installation ---
install_dokploy() {
    if [ "$(id -u)" != "0" ]; then
        echo "This script must be run as root" >&2
        exit 1
    fi
    if [ "$(uname)" = "Darwin" ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi
    if [ -f /.dockerenv ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi
    if ss -tulnp | grep ':80 ' >/dev/null; then
        echo "Error: something is already running on port 80" >&2
        exit 1
    fi
    if ss -tulnp | grep ':443 ' >/dev/null; then
        echo "Error: something is already running on port 443" >&2
        exit 1
    fi
    command_exists() {
      command -v "$@" > /dev/null 2>&1
    }
    if command_exists docker; then
      echo "Docker already installed"
    else
      curl -sSL https://get.docker.com | sh
    fi
    docker swarm leave --force 2>/dev/null
    get_private_ip() {
        ip addr show | grep -E "inet (192\\.168\\.|10\\.|172\\.1[6-9]\\.|172\\.2[0-9]\\.|172\\.3[0-1]\\.)" | head -n1 | awk '{print $2}' | cut -d/ -f1
    }
    advertise_addr="${ADVERTISE_ADDR:-$(get_private_ip)}"
    if [ -z "$advertise_addr" ]; then
        echo "ERROR: We couldn't find a private IP address."
        echo "Please set the ADVERTISE_ADDR environment variable manually."
        echo "Example: export ADVERTISE_ADDR=192.168.1.100"
        exit 1
    fi
    echo "Using advertise address: $advertise_addr"
    docker swarm init --advertise-addr $advertise_addr
    if [ $? -ne 0 ]; then
        echo "Error: Failed to initialize Docker Swarm" >&2
        exit 1
    fi
    echo "Swarm initialized"
    docker network rm -f dokploy-network 2>/dev/null
    docker network create --driver overlay --attachable dokploy-network
    echo "Network created"
    mkdir -p /etc/dokploy
    chmod 777 /etc/dokploy
    docker service create \
    --name dokploy-postgres \
    --constraint 'node.role==manager' \
    --network dokploy-network \
    --env POSTGRES_USER=dokploy \
    --env POSTGRES_DB=dokploy \
    --env POSTGRES_PASSWORD=amukds4wi9001583845717ad2 \
    --mount type=volume,source=dokploy-postgres-database,target=/var/lib/postgresql/data \
    postgres:16
    docker service create \
    --name dokploy-redis \
    --constraint 'node.role==manager' \
    --network dokploy-network \
    --mount type=volume,source=redis-data-volume,target=/data \
    redis:7
    # Récupère le dernier tag Docker
    latest_tag=$(get_latest_docker_tag)
    if [ -z "$latest_tag" ]; then
      echo "Impossible de récupérer le dernier tag Docker, fallback sur latest-amd64."
      latest_tag="latest-amd64"
    fi
    DOKPLOY_IMAGE="ghcr.io/$GITHUB_ORG/$GITHUB_REPO/$DOKPLOY_COMPONENT:$latest_tag"
    echo "Dernier tag Docker trouvé: $latest_tag"
    echo "Installation avec l'image: $DOKPLOY_IMAGE"
    echo "Pulling custom Dokploy image: $DOKPLOY_IMAGE"
    docker pull "$DOKPLOY_IMAGE"
    if [ $? -ne 0 ]; then
        echo "Error: Failed to pull image $DOKPLOY_IMAGE" >&2
        echo "Please check that the image exists and is publicly accessible" >&2
        exit 1
    fi
    docker service create \
      --name dokploy \
      --replicas 1 \
      --network dokploy-network \
      --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
      --mount type=bind,source=/etc/dokploy,target=/etc/dokploy \
      --mount type=volume,source=dokploy-docker-config,target=/root/.docker \
      --publish published=3000,target=3000,mode=host \
      --update-parallelism 1 \
      --update-order stop-first \
      --constraint 'node.role == manager' \
      -e ADVERTISE_ADDR=$advertise_addr \
      $(grep -v '^#' "$ENV_FILE" | sed 's/^/-e /') \
      "$DOKPLOY_IMAGE"
    sleep 4
    docker run -d \
        --name dokploy-traefik \
        --restart always \
        -v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
        -v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -p 80:80/tcp \
        -p 443:443/tcp \
        -p 443:443/udp \
        traefik:v3.1.2
    docker network connect dokploy-network dokploy-traefik
    GREEN="\033[0;32m"
    YELLOW="\033[1;33m"
    BLUE="\033[0;34m"
    NC="\033[0m" # No Color
    format_ip_for_url() {
        local ip="$1"
        if echo "$ip" | grep -q ':'; then
            echo "[${ip}]"
        else
            echo "${ip}"
        fi
    }
    public_ip="${ADVERTISE_ADDR:-$(get_private_ip)}"
    formatted_addr=$(format_ip_for_url "$public_ip")
    echo ""
    printf "${GREEN}Congratulations, your custom Dokploy is installed!${NC}\n"
    printf "${BLUE}Using image: ${DOKPLOY_IMAGE}${NC}\n"
    printf "${BLUE}Wait 15 seconds for the server to start${NC}\n"
    printf "${YELLOW}Please go to http://${formatted_addr}:3000${NC}\n\n"
}

# --- Update ---
update_dokploy() {
    echo "Updating custom Dokploy..."
    current_image=$(get_current_image)
    if [ -n "$current_image" ]; then
      echo "Current deployed image: $current_image"
    else
      echo "No running dokploy service found, running install instead."
      install_dokploy
      return
    fi
    # Si l'utilisateur a explicitement passé une image:tag, on l'utilise tel quel
    if [[ "$1" == "update" && -n "$2" ]]; then
      DOKPLOY_IMAGE="$2"
      echo "Mise à jour vers l'image explicitement fournie: $DOKPLOY_IMAGE"
    else
      # Sinon, on tente de récupérer le dernier tag Docker
      latest_tag=$(get_latest_docker_tag)
      if [ -z "$latest_tag" ]; then
        echo "Impossible de récupérer le dernier tag Docker, fallback sur latest-amd64."
        latest_tag="latest-amd64"
      fi
      DOKPLOY_IMAGE="ghcr.io/$GITHUB_ORG/$GITHUB_REPO/$DOKPLOY_COMPONENT:$latest_tag"
      echo "Dernier tag Docker trouvé: $latest_tag"
      echo "Mise à jour vers l'image: $DOKPLOY_IMAGE"
    fi
    docker pull "$DOKPLOY_IMAGE" || { echo "Erreur pull image"; exit 1; }
    docker service update \
      $(grep -v '^#' "$ENV_FILE" | sed 's/^/--env-add /') \
      --image "$DOKPLOY_IMAGE" dokploy
    echo "Custom Dokploy a été mis à jour vers: $DOKPLOY_IMAGE"
}

# --- Rollback ---
rollback_dokploy() {
    echo "Rolling back dokploy service to previous image..."
    docker service rollback dokploy
    echo "Rollback done."
}

# --- Main ---
case "$1" in
  update)
    update_dokploy "$@"
    ;;
  rollback)
    rollback_dokploy
    ;;
  *)
    install_dokploy "$@"
    ;;
esac 