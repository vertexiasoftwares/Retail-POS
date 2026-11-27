$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot
$resolvedRoot = (Resolve-Path $appRoot).Path
$electronExe = Join-Path $resolvedRoot 'node_modules\electron\dist\electron.exe'
$iconPath = Join-Path $resolvedRoot 'public\retail-pos-icon.ico'

if (-not (Test-Path $electronExe)) {
  throw "Electron executable not found at $electronExe. Run npm install first."
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$startMenuPrograms = Join-Path ([Environment]::GetFolderPath('Programs')) 'Vertexia Retail POS'
if (-not (Test-Path $startMenuPrograms)) {
  New-Item -ItemType Directory -Path $startMenuPrograms -Force | Out-Null
}

$wsh = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path $desktopPath 'Vertexia Retail POS.lnk'),
  (Join-Path $startMenuPrograms 'Vertexia Retail POS.lnk')
)

foreach ($lnkPath in $targets) {
  $shortcut = $wsh.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $electronExe
  $shortcut.Arguments = "`"$resolvedRoot`""
  $shortcut.WorkingDirectory = $resolvedRoot
  $shortcut.Description = 'Vertexia Retail POS Desktop & LAN Server (Port 8080)'
  if (Test-Path $iconPath) {
    $shortcut.IconLocation = $iconPath
  }
  $shortcut.Save()
  Write-Output "Installed shortcut: $lnkPath"
}

# Ensure Windows Firewall allows inbound LAN access on TCP port 8080
try {
  $ruleName = 'Vertexia Retail POS LAN (Port 8080)'
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any | Out-Null
    Write-Output "Added Windows Firewall allow rule for TCP Port 8080."
  } else {
    Write-Output "Windows Firewall rule for TCP Port 8080 already exists."
  }
} catch {
  Write-Warning "Could not configure Windows Firewall automatically (may require Administrator rights): $($_.Exception.Message)"
}
