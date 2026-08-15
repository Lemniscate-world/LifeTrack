# ============================================================================
# Installe une tache planifiee Windows : LifeTrack Backup Central
# -> execute scripts\backup-to-server.ps1 toutes les heures.
#
# Usage :  powershell -ExecutionPolicy Bypass -File install-backup-task.ps1
#          powershell -ExecutionPolicy Bypass -File install-backup-task.ps1 -Remove
# ============================================================================

param(
  [switch]$Remove   # desinstalle la tache
)

$TaskName = 'LifeTrack Backup Central'
$ScriptPath = Join-Path $PSScriptRoot 'backup-to-server.ps1'

if ($Remove) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Output "Tache '$TaskName' supprimee."
  exit 0
}

if (!(Test-Path $ScriptPath)) {
  Write-Error "Script introuvable : $ScriptPath"
  exit 1
}

# schtasks : /sc HOURLY /mo 1 = toutes les heures ; /f force ; /ru utilisateur courant
$cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
schtasks /Create /TN $TaskName /TR $cmd /SC HOURLY /MO 1 /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Echec de la creation de la tache"
  exit 1
}

Write-Output "Tache '$TaskName' installee : execution toutes les heures."
Write-Output "Lancer un test manuel :  powershell -ExecutionPolicy Bypass -File `"$ScriptPath`""
exit 0