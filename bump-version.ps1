# bump-version.ps1 — Synchronize version across all manifests
# Usage: .\bump-version.ps1 <new-version>
# Example: .\bump-version.ps1 0.2.0
# Compatible with Windows PowerShell 5.1 and PowerShell 7.

param(
    [Parameter(Mandatory=$true)]
    [string]$NewVersion
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcTauri = Join-Path $root "src-tauri"

Write-Host "Bumping version to $NewVersion..." -ForegroundColor Cyan

# Regex that matches a semver literal in each manifest.
$jsonPattern = '"version"\s*:\s*"\d+\.\d+\.\d+"'
$cargoPattern = 'version\s*=\s*"\d+\.\d+\.\d+"'

# 1. package.json (formatting-preserving replace)
$pkgPath = Join-Path $root "package.json"
$pkg = Get-Content $pkgPath -Raw
$pkg = [regex]::Replace($pkg, $jsonPattern, "`"version`": `"$NewVersion`"", 1)
[System.IO.File]::WriteAllText($pkgPath, $pkg, [System.Text.UTF8Encoding]::new($false))
Write-Host "  package.json -> $NewVersion" -ForegroundColor Green

# 2. src-tauri/tauri.conf.json
$confPath = Join-Path $srcTauri "tauri.conf.json"
$conf = Get-Content $confPath -Raw
$conf = [regex]::Replace($conf, $jsonPattern, "`"version`": `"$NewVersion`"", 1)
[System.IO.File]::WriteAllText($confPath, $conf, [System.Text.UTF8Encoding]::new($false))
Write-Host "  tauri.conf.json -> $NewVersion" -ForegroundColor Green

# 3. src-tauri/Cargo.toml
$cargoPath = Join-Path $srcTauri "Cargo.toml"
$cargo = Get-Content $cargoPath -Raw
$cargo = [regex]::Replace($cargo, $cargoPattern, "version = `"$NewVersion`"", 1)
[System.IO.File]::WriteAllText($cargoPath, $cargo, [System.Text.UTF8Encoding]::new($false))
Write-Host "  Cargo.toml -> $NewVersion" -ForegroundColor Green

Write-Host "Done. Run: git add -A && git commit -m 'chore: bump to v$NewVersion' && git tag v$NewVersion-kuro" -ForegroundColor Yellow
