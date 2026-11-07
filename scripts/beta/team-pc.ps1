# This fixed PC as the team computer of one beta team (archived doc BETA (old repository) §Ordinateur d'équipe): the headless brain
# (`npm run brain:headless`) of the beta checkout enrols with the beta Cloud and keeps its outbound relay, so the apps of the
# team (Mac, PC, web) reach it through /v1/team/brain/*, without an open port. The Cloud records it as the team's demo
# machine (no Hetzner server is created; paidCalls stay off).
# The brain runs under its keeper (src/main/headless/keeper.ts: started again when it dies) and backs itself up every
# night (docs/BRAIN-HEADLESS.md §10). `install-task` (administrator PowerShell, once) starts it at boot, nobody logged in.
#   pwsh scripts/beta/team-pc.ps1 enrol -Team <TEAM_ID> [-Plan starter] | start | stop | restart | status | logs
#                                 install-task [-DryRun] | uninstall-task
#                                 backup | backups | restore [-From latest|bkp_…|<file.atb>]
param(
  [Parameter(Position = 0)][ValidateSet('enrol', 'start', 'stop', 'restart', 'status', 'install-task', 'uninstall-task', 'run', 'logs', 'backup', 'backups', 'restore')][string]$Command = 'status',
  [string]$Team,
  [string]$Plan = 'starter',
  [string]$From = 'latest',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

# Everything lives under $env:ATELIER_TEAMPC_BASE (default: <home>\atelier-team); the beta checkout can be set with ATELIER_BETA_DIR
$Base = if ($env:ATELIER_TEAMPC_BASE) { $env:ATELIER_TEAMPC_BASE } else { Join-Path $HOME 'atelier-team' }
$Beta = if ($env:ATELIER_BETA_DIR) { $env:ATELIER_BETA_DIR } else { Join-Path $Base 'beta' }
$CloudData = Join-Path $Base 'cloud-beta'
$CloudKey = Join-Path $Base 'secrets\cloud-beta.key'
$Root = Join-Path $Base 'team-pc'
$Data = Join-Path $Root 'data'
$Logs = Join-Path $Root 'logs'
$EnrolFile = Join-Path $Root 'enrol'
$MachineKey = Join-Path $Base 'secrets\team-pc.key'
$Pids = Join-Path $Root 'pid.json'
# 8790 is the beta Cloud's port
$BrainPort = 8795
$TaskName = 'Atelier team PC'
$Node = (Get-Command node).Source
$NodeFlags = @('--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/ts-transpile.mjs')
$KeeperArgs = $NodeFlags + @('src/main/headless/keeper-main.ts', '--keeper-log', $Logs, '--keeper-pid', $Pids,
  '--data', $Data, '--key-file', $MachineKey, '--port', "$BrainPort", '--cloud-enrol', '--enrol-file', $EnrolFile)
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'

function Invoke-CloudCli([string[]]$CliArgs) {
  Push-Location $Beta
  $env:ATELIER_CLOUD_DATA = $CloudData
  $env:ATELIER_CLOUD_MASTER_KEY_FILE = $CloudKey
  try {
    $out = & $Node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning cloud/src/cli.ts @CliArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cloud $($CliArgs -join ' ') failed: $out" }
    return $out
  } finally {
    Remove-Item Env:ATELIER_CLOUD_DATA, Env:ATELIER_CLOUD_MASTER_KEY_FILE -ErrorAction SilentlyContinue
    Pop-Location
  }
}

function Invoke-Enrol {
  if (-not $Team) { throw 'give -Team <TEAM_ID> (npm run cloud -- admin team list)' }
  New-Item -ItemType Directory -Force $Root, $Data, $Logs | Out-Null
  $machines = Invoke-CloudCli @('machines', 'provision', '--team', $Team, '--plan', $Plan)
  $id = ($machines | Where-Object { $_ -match '^\S+\t' } | Select-Object -First 1) -split "`t" | Select-Object -First 1
  if (-not $id) { throw "no machine for team $Team" }
  # the token is written straight into the file (never shown); a new token replaces a stored credential
  $token = (Invoke-CloudCli @('machines', 'enrol-token', $id) | Where-Object { $_ -match '^ATELIER_ENROL_TOKEN=' } | Select-Object -First 1)
  if (-not $token) { throw 'no enrolment token' }
  $h = (& $Tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
  Set-Content -Encoding utf8NoBOM -Path $EnrolFile -Value @("ATELIER_CLOUD_URL=https://${h}:8443", $token)
  & icacls $EnrolFile /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
  # a previous link of this brain would win over the new token
  Remove-Item (Join-Path $Data 'cloud-machine.json') -ErrorAction SilentlyContinue
  Write-Host "machine $id of team ${Team}: enrolment file ready ($EnrolFile)"
}

function Get-Running {
  if (-not (Test-Path $Pids)) { return $null }
  $id = (Get-Content $Pids -Raw | ConvertFrom-Json).brain
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { return $id }
  return $null
}

function Start-Brain {
  if (Get-Running) { Write-Host 'already running'; return }
  if (-not (Test-Path $EnrolFile) -and -not (Test-Path (Join-Path $Data 'cloud-machine.json'))) { throw 'run `enrol -Team <TEAM_ID>` first' }
  New-Item -ItemType Directory -Force $Data, $Logs | Out-Null
  # the keeper (node), which runs the brain and starts it again when it dies. It writes its own log and its pid
  # (pid.json), so the scheduled task runs the same command; `stop` kills its whole tree (keeper, brain, agents' CLIs)
  $p = Start-Process -FilePath $Node -WorkingDirectory $Beta -WindowStyle Hidden -PassThru -ArgumentList $KeeperArgs
  Write-Host "brain started under its keeper (pid $($p.Id)), logs in $Logs"
}

# One of the brain's offline commands (--backup-now, --list-backups, --restore): they never start the service.
function Invoke-Brain([string[]]$Extra) {
  Push-Location $Beta
  try {
    & $Node @NodeFlags 'src/main/headless/main.ts' --data $Data --key-file $MachineKey --enrol-file $EnrolFile @Extra
    if ($LASTEXITCODE -ne 0) { throw "brain $($Extra -join ' ') failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

function Invoke-Restore {
  Stop-Brain
  # never over a database: the current folder is kept aside, the machine's credential copied into the new one
  if (Test-Path (Join-Path $Data 'atelier.db')) {
    $aside = Join-Path $Root "data-before-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Move-Item $Data $aside
    New-Item -ItemType Directory -Force $Data | Out-Null
    $cred = Join-Path $aside 'cloud-machine.json'
    if (Test-Path $cred) { Copy-Item $cred $Data }
    Write-Host "current data kept in $aside"
  }
  Invoke-Brain @('--restore', $From)
  Write-Host "restored; start the brain: pwsh $Beta\scripts\beta\team-pc.ps1 start"
}

function Stop-Brain {
  $id = Get-Running
  if (-not $id -and (Test-Path $Pids)) { $id = (Get-Content $Pids -Raw | ConvertFrom-Json).brain }
  # npm, then node, then the agents' CLI processes: the whole tree
  if ($id) { & "$env:SystemRoot\System32\taskkill.exe" /PID $id /T /F 2>$null | Out-Null; Write-Host 'stopped' }
  Remove-Item $Pids -ErrorAction SilentlyContinue
}

function Show-Status {
  $id = Get-Running
  Write-Host "brain: $(if ($id) { "running under its keeper (pid $id)" } else { 'stopped' })"
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $boot = $task -and ($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })
  Write-Host "autostart: $(if (-not $task) { 'none (install-task, administrator PowerShell)' } elseif ($boot) { 'at boot' } else { 'at logon only (run install-task again)' })"
  $state = Join-Path $Data 'backup-state.json'
  if (Test-Path $state) {
    $b = Get-Content $state -Raw | ConvertFrom-Json
    Write-Host "last backup: $($b.at) $(if ($b.ok) { "ok, cloud $($b.cloud)" } else { 'FAILED' })$(if ($b.error) { " - $($b.error)" })"
  } else { Write-Host 'last backup: none yet' }
  Write-Host "linked: $(if (Test-Path (Join-Path $Data 'cloud-machine.json')) { 'yes (credential stored)' } elseif (Test-Path $EnrolFile) { 'not yet (enrolment file waiting)' } else { 'no' })"
  Invoke-CloudCli @('machines', 'list') | ForEach-Object { Write-Host "cloud: $_" }
}

function Install-Task {
  # node itself runs the keeper (no PowerShell in the task: the Store's pwsh alias may not start without a session); the
  # task lives as long as the keeper. A second start (a logon after the boot) is ignored while it runs, and a keeper
  # started by hand makes the task's brain find its port taken (exit 3, no retry)
  $quoted = ($KeeperArgs | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
  $action = New-ScheduledTaskAction -Execute $Node -Argument $quoted -WorkingDirectory $Beta
  # at boot, without a session (the PC came back after a power cut or an update), and at logon as a second chance; one
  # minute later, so the network and the Cloud's own task come first
  $boot = New-ScheduledTaskTrigger -AtStartup
  $boot.Delay = 'PT1M'
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $logon.Delay = 'PT1M'
  # S4U: runs as this account whether or not it is logged on, and stores no password
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $task = New-ScheduledTask -Action $action -Trigger @($boot, $logon) -Principal $principal -Settings $settings -Description 'Atelier headless brain (under its keeper) linked to the beta Cloud'
  if ($DryRun) {
    Write-Host "dry run, nothing registered: `"$TaskName`" would run as $($principal.UserId) ($($principal.LogonType)) at startup and at logon (1 min later), in $($action.WorkingDirectory):"
    Write-Host "  $Node $($action.Arguments)"
    return
  }
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw 'a task that starts at boot needs an administrator PowerShell: right-click PowerShell > Run as administrator, then run this command again' }
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
  Write-Host "scheduled task `"$TaskName`" starts the brain (under its keeper) one minute after each boot, even with nobody logged in"
}

switch ($Command) {
  'enrol' { Invoke-Enrol }
  'start' { Start-Brain }
  'stop' { Stop-Brain }
  'restart' { Stop-Brain; Start-Brain }
  'status' { Show-Status }
  'install-task' { Install-Task }
  'uninstall-task' { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Host "scheduled task `"$TaskName`" removed" }
  'backup' { Invoke-Brain @('--backup-now') }
  'backups' { Invoke-Brain @('--list-backups') }
  'restore' { Invoke-Restore }
  'logs' { Get-ChildItem $Logs | Sort-Object LastWriteTime -Descending | Select-Object -First 2 | ForEach-Object { Write-Host "== $($_.Name)"; Get-Content $_.FullName -Tail 40 } }
}
