param(
  [Parameter(Mandatory=$true)][string]$Binary,
  [Parameter(Mandatory=$true)][string]$Config
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer in an elevated PowerShell window.'
}
$destination = Join-Path $env:ProgramData 'CFMonitor'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$existingTask = Get-ScheduledTask -TaskName 'CFMonitor' -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName 'CFMonitor'
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-ScheduledTask -TaskName 'CFMonitor').State -eq 'Running') {
    if ((Get-Date) -gt $deadline) { throw 'Existing agent did not stop. Retry after the task has stopped.' }
    Start-Sleep -Milliseconds 250
  }
}
Copy-Item -LiteralPath $Binary -Destination (Join-Path $destination 'cf-monitor-agent.exe') -Force
Copy-Item -LiteralPath $Config -Destination (Join-Path $destination 'config.json') -Force
# The task uses LocalService, which has no administrator privileges.
& icacls.exe $destination /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict configuration permissions.' }
$action = New-ScheduledTaskAction -Execute (Join-Path $destination 'cf-monitor-agent.exe') -Argument ('-config "' + (Join-Path $destination 'config.json') + '"')
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'CFMonitor' -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'CFMonitor'
Write-Host 'Installed. Check status: Get-ScheduledTaskInfo CFMonitor'
