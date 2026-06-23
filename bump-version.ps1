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
$pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding UTF8
Write-Host "  package.json -> $NewVersion" -ForegroundColor Green

# 2. src-tauri/tauri.conf.json
$confPath = Join-Path $root "src-tauri" "tauri.conf.json"
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$conf.version = $NewVersion
$conf | ConvertTo-Json -Depth 10 | Set-Content $confPath -Encoding UTF8
Write-Host "  tauri.conf.json -> $NewVersion" -ForegroundColor Green

# 3. src-tauri/Cargo.toml (simple replace)
$cargoPath = Join-Path $root "src-tauri" "Cargo.toml"
$cargo = Get-Content $cargoPath -Raw
$cargo = $cargo -replace 'version = "\d+\.\d+\.\d+"', "version = `"$NewVersion`""
Set-Content $cargoPath -Value $cargo -Encoding UTF8
Write-Host "  Cargo.toml -> $NewVersion" -ForegroundColor Green

Write-Host "Done. Run: git add -A && git commit -m 'chore: bump to v$NewVersion' && git tag v$NewVersion-kuro" -ForegroundColor Yellow
