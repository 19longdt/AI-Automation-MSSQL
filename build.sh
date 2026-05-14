#!/bin/bash
#
# build.sh - Build and push Docker images with per-layer patch version increment.
#
# Usage:
#   ./build.sh
#   ./build.sh layer1
#   ./build.sh layer2
#   ./build.sh layer3
#   ./build.sh --set-version layer3 0.3.0 layer3
#

set -euo pipefail

REGISTRY="19longdt"
REPO_NAME="ai-automation-mssql"

declare -A VERSION_FILES=(
  [layer1]=".version.layer1"
  [layer2]=".version.layer2"
  [layer3]=".version.layer3"
)

declare -A DOCKERFILES=(
  [layer1]="Dockerfile"
  [layer2]="Dockerfile.layer2"
  [layer3]="layer3/Dockerfile"
)

declare -A CONTEXTS=(
  [layer1]="."
  [layer2]="."
  [layer3]="layer3"
)

increment_version() {
  local version="$1"
  IFS='.' read -r major minor patch <<< "$version"

  if [[ -z "${major:-}" || -z "${minor:-}" || -z "${patch:-}" ]]; then
    echo "Invalid version '$version'. Expected MAJOR.MINOR.PATCH." >&2
    exit 1
  fi

  patch=$((patch + 1))
  echo "$major.$minor.$patch"
}

SET_VERSION_LAYER=""
SET_VERSION_VALUE=""
BUILD_LAYERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --set-version)
      SET_VERSION_LAYER="$2"
      SET_VERSION_VALUE="$3"
      shift 3
      ;;
    layer1|layer2|layer3)
      BUILD_LAYERS+=("$1")
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ${#BUILD_LAYERS[@]} -eq 0 ]]; then
  BUILD_LAYERS=(layer1 layer2 layer3)
fi

build_and_push_layer() {
  local layer="$1"
  local version_file="${VERSION_FILES[$layer]}"
  local dockerfile="${DOCKERFILES[$layer]}"
  local context="${CONTEXTS[$layer]}"
  local image_base="$REGISTRY/$REPO_NAME-$layer"
  local current_version

  if [[ "$SET_VERSION_LAYER" == "$layer" ]]; then
    if [[ -z "$SET_VERSION_VALUE" ]]; then
      echo "--set-version requires a version value." >&2
      exit 1
    fi
    current_version="$SET_VERSION_VALUE"
    echo "Set $layer version to: $current_version"
  elif [[ -f "$version_file" ]]; then
    current_version="$(cat "$version_file")"
  else
    current_version="0.0.0"
  fi

  local next_version
  next_version="$(increment_version "$current_version")"
  local image_name="$image_base:v$next_version"

  echo
  echo "Building $layer: $image_name"
  echo "Dockerfile: $dockerfile"
  echo "Context: $context"

  docker build -f "$dockerfile" -t "$image_name" "$context"
  docker push "$image_name"

  echo "$next_version" > "$version_file"
  echo "Saved version $next_version to $version_file"
}

for layer in "${BUILD_LAYERS[@]}"; do
  build_and_push_layer "$layer"
done

echo
echo "Done."
for layer in layer1 layer2 layer3; do
  version_file="${VERSION_FILES[$layer]}"
  version="$(cat "$version_file" 2>/dev/null || echo "0.0.0")"
  echo "  $layer: $version"
done
