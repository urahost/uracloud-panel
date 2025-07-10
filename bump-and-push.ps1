# Usage: .\bump-and-push.ps1 -Type patch|minor|major

param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Type = "patch"
)

# 1. Bump version dans package.json (nécessite npm >= 7)
Write-Host "Bumping $Type version in apps/dokploy/package.json..."
cd apps/dokploy
pnpm version $Type --no-git-tag-version
$version = (Get-Content package.json | ConvertFrom-Json).version
cd ../..

# 2. Commit & push
git add apps/dokploy/package.json
git commit -m "chore: bump dokploy version to $version"
git push

Write-Host "✅ Version bumped to $version and pushed! GitHub Actions will now build & push the Docker image."

# 3. (Optionnel) Affiche le tag qui sera utilisé sur GHCR
Write-Host "Docker image tag to be built: v$version"