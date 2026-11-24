param([int]$OldPid,[string]$Target,[string]$Prepared,[string]$Backup,[string]$Log,[string]$Executable,[string]$Ready)
$ErrorActionPreference = 'Stop'
function Write-UpdateLog([string]$Message) { Add-Content -LiteralPath $Log -Value $Message }
$Moved = $false
try {
  Write-UpdateLog 'Waiting for app to exit'
  Set-Content -LiteralPath $Ready -Value 'ready'
  $Process = Get-Process -Id $OldPid -ErrorAction SilentlyContinue
  if ($Process) { if (-not $Process.WaitForExit(120000)) { throw 'App did not exit; not replacing' } }
  if (-not (Test-Path -LiteralPath $Target) -or -not (Test-Path -LiteralPath $Prepared) -or (Test-Path -LiteralPath $Backup)) { throw 'Invalid install paths' }
  # Antivirus/child process handles can briefly keep app files locked after exit.
  for ($Attempt = 0; $Attempt -lt 15; $Attempt++) {
    try { Move-Item -LiteralPath $Target -Destination $Backup; $Moved = $true; break }
    catch { if ($Attempt -eq 14) { throw }; Start-Sleep -Seconds 1 }
  }
  Move-Item -LiteralPath $Prepared -Destination $Target
  Start-Process -FilePath (Join-Path $Target $Executable) -WorkingDirectory $Target
  Write-UpdateLog 'Launch requested; awaiting version confirmation on next app startup'
} catch {
  Write-UpdateLog ('ERROR: ' + $_.Exception.Message)
  if ($Moved) {
    if (Test-Path -LiteralPath $Target) { Move-Item -LiteralPath $Target -Destination ($Target + '.failed-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) }
    Move-Item -LiteralPath $Backup -Destination $Target
    Start-Process -FilePath (Join-Path $Target $Executable) -WorkingDirectory $Target
  }
  exit 1
}
