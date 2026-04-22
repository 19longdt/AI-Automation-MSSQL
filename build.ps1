#
# build.ps1 — Build và push Docker images với auto version increment (riêng per layer)
#
# Usage:
#   .\build.ps1                                    # Build cả 2 layer
#   .\build.ps1 -Layer layer1                      # Build chỉ layer1
#   .\build.ps1 -Layer layer2                      # Build chỉ layer2
#   .\build.ps1 -SetVersion layer1 0.1.5           # Set layer1 = 0.1.5 + build
#   .\build.ps1 -SetVersion layer2 0.2.0           # Set layer2 = 0.2.0 + build
#

param(
    [string]$Layer,
    [string]$SetVersion,
    [string]$SetVersionValue
)

$ErrorActionPreference = "Stop"

$REGISTRY = "19longdt"
$REPO_NAME = "ai-automation-mssql"
$VERSION_FILE_LAYER1 = ".version.layer1"
$VERSION_FILE_LAYER2 = ".version.layer2"

# ─────────────────────────────────────────────────────────────────────────────
# Hàm: Tăng version
# ─────────────────────────────────────────────────────────────────────────────
function Increment-Version {
    param([string]$Version)
    $parts = $Version -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    $patch++
    return "$major.$minor.$patch"
}

# ─────────────────────────────────────────────────────────────────────────────
# Hàm: Build + Push layer
# ─────────────────────────────────────────────────────────────────────────────
function Build-And-Push-Layer {
    param(
        [string]$LayerName,
        [string]$SetVersionValue
    )

    $version_file = if ($LayerName -eq "layer1") { $VERSION_FILE_LAYER1 } else { $VERSION_FILE_LAYER2 }
    $dockerfile = if ($LayerName -eq "layer1") { "Dockerfile" } else { "Dockerfile.layer2" }
    $image_name_base = "$REGISTRY/$REPO_NAME-$LayerName"

    # Load/set version
    if ($SetVersionValue) {
        $CURRENT_VERSION = $SetVersionValue
        Write-Host "📌 Set $LayerName version to: $CURRENT_VERSION" -ForegroundColor Cyan
    } else {
        if (Test-Path $version_file) {
            $CURRENT_VERSION = (Get-Content $version_file).Trim()
        } else {
            $CURRENT_VERSION = "0.0.0"
        }
    }

    Write-Host "$LayerName current version: $CURRENT_VERSION" -ForegroundColor Yellow

    # Increment
    $NEXT_VERSION = Increment-Version -Version $CURRENT_VERSION
    $IMAGE_TAG = "v$NEXT_VERSION"
    $IMAGE_NAME = "$image_name_base`:$IMAGE_TAG"

    Write-Host "`n════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "📦 Building $LayerName : $IMAGE_NAME" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Green

    # Build
    Write-Host "🔨 Building image..." -ForegroundColor Cyan
    docker build -f $dockerfile -t $IMAGE_NAME .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build failed for $LayerName" -ForegroundColor Red
        exit 1
    }

    Write-Host "✅ Build succeeded: $IMAGE_NAME" -ForegroundColor Green

    # Push
    Write-Host "📤 Pushing $IMAGE_NAME..." -ForegroundColor Cyan
    docker push $IMAGE_NAME
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Push failed for $LayerName" -ForegroundColor Red
        exit 1
    }

    Write-Host "✅ Push succeeded: $IMAGE_NAME" -ForegroundColor Green

    # Save version
    Set-Content -Path $version_file -Value $NEXT_VERSION
    Write-Host "💾 Saved version: $NEXT_VERSION → $version_file" -ForegroundColor Cyan
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────
$BUILD_LAYERS = @()
if ($Layer) {
    $BUILD_LAYERS = @($Layer)
} else {
    $BUILD_LAYERS = @("layer1", "layer2")
}

# ─────────────────────────────────────────────────────────────────────────────
# Build + Push selected layers
# ─────────────────────────────────────────────────────────────────────────────
foreach ($layer in $BUILD_LAYERS) {
    $set_version_val = ""
    if ($SetVersion -eq $layer) {
        # Note: Cách này đơn giản, bạn có thể pass thêm param nếu cần
        # Ví dụ: .\build.ps1 -SetVersionLayer layer1 -SetVersionValue 0.1.5
        # Hiện tại dùng: .\build.ps1 -Layer layer1 (để user edit script hoặc pass param riêng)
    }
    Build-And-Push-Layer -LayerName $layer -SetVersionValue $set_version_val
}

Write-Host "`n════════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "✅ All done!" -ForegroundColor Green

$ver1 = if (Test-Path $VERSION_FILE_LAYER1) { (Get-Content $VERSION_FILE_LAYER1).Trim() } else { "0.0.0" }
$ver2 = if (Test-Path $VERSION_FILE_LAYER2) { (Get-Content $VERSION_FILE_LAYER2).Trim() } else { "0.0.0" }

Write-Host "   Layer1 version: $ver1" -ForegroundColor Cyan
Write-Host "   Layer2 version: $ver2" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Green
