#!/bin/bash
#
# build.sh — Build và push Docker images với auto version increment (riêng per layer)
#
# Usage:
#   ./build.sh                    # Build cả layer1 + layer2, increment version của từng layer
#   ./build.sh layer1             # Build chỉ layer1
#   ./build.sh layer2             # Build chỉ layer2
#   ./build.sh --set-version layer1 0.1.5  # Set layer1 version = 0.1.5
#   ./build.sh --set-version layer2 0.2.0  # Set layer2 version = 0.2.0
#

set -e

REGISTRY="19longdt"
REPO_NAME="ai-automation-mssql"
VERSION_FILE_LAYER1=".version.layer1"
VERSION_FILE_LAYER2=".version.layer2"

# ─────────────────────────────────────────────────────────────────────────────
# Hàm: Tăng version
# ─────────────────────────────────────────────────────────────────────────────
increment_version() {
    local version=$1
    local major=$(echo $version | cut -d. -f1)
    local minor=$(echo $version | cut -d. -f2)
    local patch=$(echo $version | cut -d. -f3)

    patch=$((patch + 1))
    echo "$major.$minor.$patch"
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────
BUILD_LAYERS=()
SET_VERSION_LAYER=""
SET_VERSION_VALUE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --set-version)
            SET_VERSION_LAYER="$2"
            SET_VERSION_VALUE="$3"
            shift 3
            ;;
        layer1|layer2)
            BUILD_LAYERS+=("$1")
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Default: build cả 2 layer nếu không chỉ định
if [ ${#BUILD_LAYERS[@]} -eq 0 ]; then
    BUILD_LAYERS=("layer1" "layer2")
fi

# ─────────────────────────────────────────────────────────────────────────────
# Hàm: Build + Push layer
# ─────────────────────────────────────────────────────────────────────────────
build_and_push_layer() {
    local layer=$1
    local version_file=""
    local dockerfile=""
    local image_name_base=""

    if [ "$layer" = "layer1" ]; then
        version_file="$VERSION_FILE_LAYER1"
        dockerfile="Dockerfile"
        image_name_base="$REGISTRY/$REPO_NAME-layer1"
    else
        version_file="$VERSION_FILE_LAYER2"
        dockerfile="Dockerfile.layer2"
        image_name_base="$REGISTRY/$REPO_NAME-layer2"
    fi

    # Load/set version
    if [ ! -z "$SET_VERSION_LAYER" ] && [ "$SET_VERSION_LAYER" = "$layer" ]; then
        CURRENT_VERSION="$SET_VERSION_VALUE"
        echo "📌 Set $layer version to: $CURRENT_VERSION"
    else
        if [ -f "$version_file" ]; then
            CURRENT_VERSION=$(cat "$version_file")
        else
            CURRENT_VERSION="0.0.0"
        fi
    fi

    echo "$layer current version: $CURRENT_VERSION"

    # Increment
    NEXT_VERSION=$(increment_version "$CURRENT_VERSION")
    IMAGE_TAG="v$NEXT_VERSION"
    IMAGE_NAME="$image_name_base:$IMAGE_TAG"

    echo ""
    echo "════════════════════════════════════════════════════════════════════"
    echo "📦 Building $layer: $IMAGE_NAME"
    echo "════════════════════════════════════════════════════════════════════"

    # Build
    docker build -f "$dockerfile" -t "$IMAGE_NAME" . || {
        echo "❌ Build failed for $layer"
        exit 1
    }

    echo "✅ Build succeeded: $IMAGE_NAME"

    # Push
    echo "📤 Pushing $IMAGE_NAME..."
    docker push "$IMAGE_NAME" || {
        echo "❌ Push failed for $layer"
        exit 1
    }

    echo "✅ Push succeeded: $IMAGE_NAME"

    # Save version
    echo "$NEXT_VERSION" > "$version_file"
    echo "💾 Saved version: $NEXT_VERSION → $version_file"
}

# ─────────────────────────────────────────────────────────────────────────────
# Build + Push selected layers
# ─────────────────────────────────────────────────────────────────────────────
for layer in "${BUILD_LAYERS[@]}"; do
    build_and_push_layer "$layer"
done

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "✅ All done!"
echo "   Layer1 version: $(cat $VERSION_FILE_LAYER1 2>/dev/null || echo '0.0.0')"
echo "   Layer2 version: $(cat $VERSION_FILE_LAYER2 2>/dev/null || echo '0.0.0')"
echo "════════════════════════════════════════════════════════════════════"
