# bump-version.ps1 — Synchronize version across all manifests
# Usage: .\bump-version.ps1 <new-version>
# Example: .\bump-version.ps1 0.2.0

param(
    [Parameter(Mandatory=$true)]
    [string]$NewVersion
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Bumping version to $NewVersion..." -ForegroundColor Cyan

# 1. package.json
$pkgPath = Join-Path $root "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.version = $NewVersion
$pkgJson = $pkg | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($pkgPath, $pkgJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "  package.json -> $NewVersion" -ForegroundColor Green

# 2. src-tauri/tauri.conf.json
$confPath = Join-Path $root "src-tauri" "tauri.conf.json"
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$conf.version = $NewVersion
$confJson = $conf | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($confPath, $confJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "  tauri.conf.json -> $NewVersion" -ForegroundColor Green

# 3. src-tauri/Cargo.toml (simple replace)
$cargoPath = Join-Path $root "src-tauri" "Cargo.toml"
$cargo = Get-Content $cargoPath -Raw
$cargo = $cargo -replace 'version = "\d+\.\d+\.\d+"', "version = `"$NewVersion`""
[System.IO.File]::WriteAllText($cargoPath, $cargo, [System.Text.UTF8Encoding]::new($false))
Write-Host "  Cargo.toml -> $NewVersion" -ForegroundColor Green

Write-Host "Done. Run: git add -A && git commit -m 'chore: bump to v$NewVersion' && git tag v$NewVersion-kuro" -ForegroundColor Yellow
