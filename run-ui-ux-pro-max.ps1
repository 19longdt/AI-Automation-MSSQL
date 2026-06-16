$skillDir = 'C:\Users\Admin\.codex\skills\ui-ux-pro-max'
$candidates = @(
    "$env:LocalAppData\Programs\Python\Python312\python.exe",
    "$env:LocalAppData\Python\bin\python3.exe",
    "$env:LocalAppData\Python\bin\python.exe",
    'python'
)

if (-not (Test-Path "$skillDir\scripts\search.py")) {
    Write-Error "Skill script not found: $skillDir\scripts\search.py"
    exit 1
}

$python = $null
foreach ($candidate in $candidates) {
    if ($candidate -eq 'python') {
        $python = $candidate
        break
    }

    if (Test-Path $candidate) {
        $python = $candidate
        break
    }
}

if (-not $python) {
    Write-Error 'No Python runtime found.'
    exit 1
}

& $python "$skillDir\scripts\search.py" @args
exit $LASTEXITCODE
