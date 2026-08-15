# ============================================================================
# LifeTrack -> Serveur Linux : Backup centralise (SSH/scp)
# ----------------------------------------------------------------------------
# Envoie les backups JSON horodates de LifeTrack vers ton serveur Linux via
# SSH. A executer manuellement, ou automatiquement toutes les heures via la
# tache planifiee installee par install-backup-task.ps1.
#
# PREREQUIS (une seule fois, sur le serveur Linux) :
#   1. Ouvrir un terminal sur le serveur et lancer :
#        sudo apt install openssh-server    (Debian/Ubuntu)   ou
#        sudo dnf install openssh-server    (Fedora)
#        sudo systemctl enable --now ssh
#   2. Trouver l'IP du serveur :  ip addr | grep inet
#   3. (Recommande) Creer une cle SSH sur ce PC et l'ajouter au serveur :
#        ssh-keygen -t ed25519
#        type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh user@IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
#      Puis tester :  ssh user@IP
#
# ============================================================================

param(
  [switch]$DryRun   # -DryRun : affiche ce qui serait envoye sans rien transferer
)

# ============================ CONFIG ======================================
$ServerHost = 'CHANGEME'              # IP ou hostname du serveur Linux
$ServerUser = 'CHANGEME'              # user SSH sur le serveur
$RemoteDir  = 'lifetrack-backups'     # dossier relatif au home du serveur
$SshPort    = 22                      # port SSH (defaut 22)
$SshKey     = ''                      # chemin cle privee ('' = agent ou mot de passe)
$KeepDays   = 30                      # anciennete max des backups sur le serveur
# ==========================================================================

$BackupSrc = Join-Path $env:APPDATA 'com.lemniscate.lifetrack\backups'

# --- Verification locale ---
if (!(Test-Path $BackupSrc)) {
  Write-Error "Dossier de backups introuvable : $BackupSrc"
  exit 1
}
$files = Get-ChildItem $BackupSrc -Filter 'lifetrack-backup-*.json' -File | Sort-Object LastWriteTime
if ($files.Count -eq 0) {
  Write-Error "Aucun backup a envoyer dans $BackupSrc"
  exit 1
}

Write-Output "LifeTrack backup centralise - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Output "  Fichiers locaux  : $($files.Count)  ($($BackupSrc))"
Write-Output "  Destination      : $ServerUser@$($ServerHost):$RemoteDir"

if ($DryRun) {
  Write-Output ""
  Write-Output "=== DRY RUN : fichiers qui seraient transferes ==="
  $files | ForEach-Object { Write-Output "  $($_.Name)  ($([math]::Round($_.Length/1KB)) KB)" }
  Write-Output "=== DRY RUN : aucun transfert effectue ==="
  exit 0
}

if ($ServerHost -eq 'CHANGEME' -or $ServerUser -eq 'CHANGEME') {
  Write-Error "Configure d'abord ServerHost / ServerUser en tete de $($MyInvocation.MyCommand.Name)"
  exit 1
}

# --- Options SSH ---
$sshOpts = @("-p", "$SshPort", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10")
$scpOpts = @("-P", "$SshPort", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10")
if ($SshKey) {
  $sshOpts += @("-i", $SshKey)
  $scpOpts += @("-i", $SshKey)
}
$target = "${ServerUser}@${ServerHost}"

# --- 1. Cree le dossier distant ---
Write-Output "  [1/3] Creation du dossier distant $RemoteDir ..."
& ssh @sshOpts $target "mkdir -p $RemoteDir" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "SSH impossible vers $target : verifie l'IP, le user, et que le serveur ecoute sur le port $SshPort"
  Write-Error "Tester manuellement :  ssh $target"
  exit 1
}

# --- 2. Transfere tous les backups ---
Write-Output "  [2/3] Transfert de $($files.Count) backup(s) ..."
& scp @scpOpts $files.FullName "${target}:${RemoteDir}/" 2>&1 | ForEach-Object { Write-Output "       $_" }
if ($LASTEXITCODE -ne 0) {
  Write-Error "Echec du transfert scp"
  exit 1
}

# --- 3. Purge les backups trop anciens sur le serveur ---
Write-Output "  [3/3] Purge des backups de plus de $KeepDays jours sur le serveur ..."
& ssh @sshOpts $target "find $RemoteDir -name 'lifetrack-backup-*.json' -mtime +$KeepDays -delete 2>/dev/null; ls -1 $RemoteDir | wc -l" 2>$null | ForEach-Object { Write-Output "       Backups restants sur le serveur : $_" }

Write-Output "  OK - synchronisation terminee."
exit 0
