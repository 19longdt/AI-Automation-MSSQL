#
# build.ps1 - Build and push Docker images with per-layer patch version increment.
#
# Usage:
#   .\build.ps1
#   .\build.ps1 -Layer layer1
#   .\build.ps1 -Layer layer2
#   .\build.ps1 -Layer layer3
#   .\build.ps1 -SetVersion layer3 -SetVersionValue 0.3.0 -Layer layer3
#

param(
    [ValidateSet("", "layer1", "layer2", "layer3")]
    [string]$Layer = "",
    [ValidateSet("", "layer1", "layer2", "layer3")]
    [string]$SetVersion = "",
    [string]$SetVersionValue = ""
)

$ErrorActionPreference = "Stop"

$REGISTRY = "19longdt"
$REPO_NAME = "ai-automation-mssql"

$LAYER_CONFIG = @{
    layer1 = @{
        VersionFile = ".version.layer1"
        Dockerfile = "Dockerfile"
        Context = "."
    }
    layer2 = @{
        VersionFile = ".version.layer2"
        Dockerfile = "Dockerfile.layer2"
        Context = "."
    }
    layer3 = @{
        VersionFile = ".version.layer3"
        Dockerfile = "layer3/Dockerfile"
        Context = "layer3"
    }
}

function Increment-Version {
    param([string]$Version)

    $parts = $Version -split "\."
    if ($parts.Count -ne 3) {
        throw "Invalid version '$Version'. Expected MAJOR.MINOR.PATCH."
    }

    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2] + 1
    return "$major.$minor.$patch"
}

function Build-And-Push-Layer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LayerName
    )

    $cfg = $LAYER_CONFIG[$LayerName]
    if (-not $cfg) {
        throw "Unknown layer: $LayerName"
    }

    $versionFile = $cfg.VersionFile
    $dockerfile = $cfg.Dockerfile
    $context = $cfg.Context
    $imageBase = "$REGISTRY/$REPO_NAME-$LayerName"

    if ($SetVersion -eq $LayerName) {
        if (-not $SetVersionValue) {
            throw "-SetVersionValue is required when -SetVersion is used."
        }
        $currentVersion = $SetVersionValue
        Write-Host "Set $LayerName version to: $currentVersion" -ForegroundColor Cyan
    } elseif (Test-Path $versionFile) {
        $currentVersion = (Get-Content $versionFile).Trim()
    } else {
        $currentVersion = "0.0.0"
    }

    $nextVersion = Increment-Version -Version $currentVersion
    $imageTag = "v$nextVersion"
    $imageName = "${imageBase}:$imageTag"

    Write-Host ""
    Write-Host "Building ${LayerName}: $imageName" -ForegroundColor Green
    Write-Host "Dockerfile: $dockerfile" -ForegroundColor DarkGray
    Write-Host "Context: $context" -ForegroundColor DarkGray

    docker build -f $dockerfile -t $imageName $context
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed for $LayerName"
    }

    docker push $imageName
    if ($LASTEXITCODE -ne 0) {
        throw "Push failed for $LayerName"
    }

    Set-Content -Path $versionFile -Value $nextVersion
    Write-Host "Saved version $nextVersion to $versionFile" -ForegroundColor Cyan
}

if ($Layer) {
    $buildLayers = @($Layer)
} else {
    $buildLayers = @("layer1", "layer2", "layer3")
}

foreach ($layerName in $buildLayers) {
    Build-And-Push-Layer -LayerName $layerName
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
foreach ($layerName in @("layer1", "layer2", "layer3")) {
    $versionFile = $LAYER_CONFIG[$layerName].VersionFile
    $version = if (Test-Path $versionFile) { (Get-Content $versionFile).Trim() } else { "0.0.0" }
    Write-Host "  ${layerName}: $version" -ForegroundColor Cyan
}
