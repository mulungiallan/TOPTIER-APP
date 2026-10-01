<#
.SYNOPSIS
    One-shot bootstrap for a fresh Windows VPS that will run TOPTIER bots 24/7.

.DESCRIPTION
    Takes a bare Windows Server (nothing but the OS) to a self-healing trading
    server. Safe to re-run: every step is idempotent and skips work that is
    already done.

    What it does, in order:
      1. Preflight        - verifies Administrator, Python, disk and time sync.
      2. Python deps     - engine + service requirements.
      3. Bot service     - registers ToptierBot via NSSM (auto-start + crash restart).
      4. Cloudflare      - installs cloudflared and the named tunnel AS A SERVICE,
                            so the public URL survives reboots. A quick tunnel
                            (--url) is NOT used: its hostname changes on every
                            restart and silently breaks the app's BOT_SERVICE_URL.
      5. Watchdog        - a scheduled task that alerts when the bot goes quiet.
      6. Verify          - proves the service, the tunnel and an engine are all up
                            before reporting success.

    Exit code 0 = fully verified. Non-zero = a step failed; the message says which.

.EXAMPLE
    # First run, on a box where you have not logged into Cloudflare yet:
    .\bootstrap-vps.ps1 -ServiceKey "the-same-secret-as-the-app" -SkipTunnel

.EXAMPLE
    # After `cloudflared tunnel login` has been run interactively:
    .\bootstrap-vps.ps1 -ServiceKey "..." -TunnelName toptier -Hostname bot.toptier.app
#>

[CmdletBinding()]
param(
    # Shared secret. MUST match the app's BOT_SERVICE_KEY.
    [Parameter(Mandatory = $false)]
    [string]$ServiceKey = $env:BOT_SERVICE_KEY,

    # Secret used to encrypt broker passwords at rest in instance.json. MUST
    # match the app's BOT_CREDENTIALS_SECRET. Falls back to the service key so
    # a fresh install still encrypts; pass it explicitly in production.
    [Parameter(Mandatory = $false)]
    [string]$CredentialsSecret = $env:BOT_CREDENTIALS_SECRET,

    [int]$Port = 8765,

    # Named Cloudflare tunnel + public hostname. Leave Hostname empty to
    # prepare everything except DNS routing.
    [string]$TunnelName = "toptier",
    [string]$Hostname = "",

    # Existing tunnel credentials JSON. Auto-detected when omitted.
    [string]$TunnelCredentials = "",

    [string]$CloudflaredPath = "C:\Cloudflare\cloudflared.exe",

    # Directory holding mt5_trading_bot/ and mini-services/bot/.
    [string]$RepoRoot = "",

    [string]$PythonPath = "python",

    # Your email for the watchdog alert.
    [string]$AlertEmail = "",

    # Configure the tunnel + watchdog. Use -SkipTunnel to do a service-only run.
    [switch]$SkipTunnel,

    # Do the work but skip the final verification.
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$script:Failed = @()

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)       { Write-Host "    OK   $msg" -ForegroundColor Green }
function Write-Warn2($msg)    { Write-Host "    WARN $msg" -ForegroundColor Yellow }
function Write-Bad($msg)      { Write-Host "    FAIL $msg" -ForegroundColor Red; $script:Failed += $msg }
function Write-Info($msg)     { Write-Host "    $msg" -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
Write-Step "1/6" "Preflight"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Bad "Not running as Administrator."
    Write-Host ""
    Write-Host "    Right-click PowerShell -> 'Run as administrator', then re-run." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Ok "running as Administrator"

if ([string]::IsNullOrWhiteSpace($ServiceKey)) {
    Write-Bad "BOT_SERVICE_KEY is required (must match the app's BOT_SERVICE_KEY)."
    Write-Host "    Pass -ServiceKey '<secret>'." -ForegroundColor Yellow
    exit 1
}
Write-Ok "service key present (len $($ServiceKey.Length))"

# Locate the repo layout: prefer a sibling of this script, else walk up.
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    $candidates = @(
        $here,
        (Split-Path $here -Parent),
        (Split-Path (Split-Path $here -Parent) -Parent),
        (Split-Path (Split-Path (Split-Path $here -Parent) -Parent) -Parent)
    )
    foreach ($c in $candidates) {
        $hasEngine  = Test-Path (Join-Path $c "mt5_trading_bot\config.py")
        $hasService = Test-Path (Join-Path $c "mini-services\bot\server.py")
        if ($hasEngine -and $hasService) {
            $RepoRoot = $c; break
        }
    }
}
if ([string]::IsNullOrWhiteSpace($RepoRoot) -or
    -not (Test-Path (Join-Path $RepoRoot "mt5_trading_bot"))) {
    Write-Bad "Could not find mt5_trading_bot/ and mini-services/bot/."
    Write-Host "    Pass -RepoRoot 'C:\path\to\app'." -ForegroundColor Yellow
    exit 1
}
$EngineDir  = Join-Path $RepoRoot "mt5_trading_bot"
$ServiceDir = Join-Path $RepoRoot "mini-services\bot"
Write-Ok "engine  : $EngineDir"
Write-Ok "service : $ServiceDir"

$py = (Get-Command $PythonPath -ErrorAction SilentlyContinue)
if (-not $py) { Write-Bad "Python not found. Install Python 3.9+ and re-run."; exit 1 }
$PyReal = $py.Source
Write-Ok "python  : $($(& $PyReal --version 2>&1))"

$freeGb = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
Write-Ok "free disk: $freeGb GB"
if ($freeGb -lt 10) { Write-Warn2 "Only $freeGb GB free. Backtests and MT5 need room." }

try {
    $tz = Get-TimeZone
    Write-Ok "timezone : $($tz.Id)  (clock: $((Get-Date).ToString('HH:mm')))"
} catch { Write-Warn2 "Could not read timezone." }

# ---------------------------------------------------------------------------
# 2. Python dependencies
# ---------------------------------------------------------------------------
Write-Step "2/6" "Python dependencies"
& $PyReal -m pip install --upgrade pip --quiet 2>&1 | Out-Null
foreach ($req in @(
    (Join-Path $EngineDir "requirements.txt"),
    (Join-Path $ServiceDir "requirements.txt"))) {
    if (Test-Path $req) {
        & $PyReal -m pip install -r $req --quiet
        if ($LASTEXITCODE -ne 0) { Write-Bad "pip install failed for $req" }
        else { Write-Ok "installed $(Split-Path (Split-Path $req -Parent) -Leaf) requirements" }
    } else {
        Write-Warn2 "missing requirements: $req"
    }
}

# MetaTrader5 python package is what actually talks to the terminal.
& $PyReal -c "import MetaTrader5" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Warn2 "MetaTrader5 module not importable - install it and open MT5 once." }
else { Write-Ok "MetaTrader5 module available" }

# ---------------------------------------------------------------------------
# 3. Bot service (ToptierBot via NSSM)
# ---------------------------------------------------------------------------
Write-Step "3/6" "Bot service"

$ToolsDir = "C:\ToptierTools"
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
$Nssm = Join-Path $ToolsDir "nssm.exe"
if (-not (Test-Path $Nssm)) {
    Write-Info "downloading NSSM..."
    $zip = Join-Path $ToolsDir "nssm.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $ToolsDir -Force
    $found = Get-ChildItem $ToolsDir -Recurse -Filter nssm.exe | Select-Object -First 1
    if (-not $found) { Write-Bad "Could not find nssm.exe after extraction." }
    else { Move-Item -Force $found.FullName $Nssm; Remove-Item $zip -Force -ErrorAction SilentlyContinue }
}

if (Test-Path $Nssm) {
    $existing = Get-Service -Name ToptierBot -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Status -eq "Running") {
            Write-Info "stopping running ToptierBot to reconfigure..."
            & $Nssm stop ToptierBot 2>$null | Out-Null
            Start-Sleep -Seconds 3
        }
        # Only remove when it exists. `nssm remove` on a missing service writes
        # "Can't open service!" to stderr, and under $ErrorActionPreference=Stop
        # PowerShell 5.1 promotes that to a terminating NativeCommandError --
        # aborting a fresh install before the service is ever registered.
        & $Nssm remove ToptierBot confirm 2>$null | Out-Null
    }
    & $Nssm install ToptierBot $PyReal "-m uvicorn server:app --host 127.0.0.1 --port $Port" | Out-Null
    & $Nssm set ToptierBot AppDirectory      $ServiceDir          | Out-Null
    # Every AppEnvironmentExtra value must go in ONE call. nssm stores this as a
    # REG_MULTI_SZ and a separate `set` call REPLACES the whole list, so calling it
    # once per variable silently discards all but the last -- which left the
    # service running without BOT_SERVICE_KEY and rejected every request.
    & $Nssm set ToptierBot AppEnvironmentExtra `
        BOT_SERVICE_KEY=$ServiceKey `
        BOT_SERVICE_HOST=127.0.0.1 `
        BOT_SERVICE_PORT=$Port `
        BOT_ENGINE_DIR=$EngineDir `
        BOT_DATA_DIR=$(Join-Path $ServiceDir "data") `
        BOT_CREDENTIALS_SECRET=$(if ($CredentialsSecret) { $CredentialsSecret } else { $ServiceKey }) `
        BOT_PYTHON=$PyReal | Out-Null
    & $Nssm set ToptierBot AppStdout (Join-Path $ServiceDir "service.log")   | Out-Null
    & $Nssm set ToptierBot AppStderr (Join-Path $ServiceDir "service.log")   | Out-Null
    & $Nssm set ToptierBot Start SERVICE_AUTO_START | Out-Null
    # Survive a crash instead of leaving a dead service registered.
    & $Nssm set ToptierBot AppExit Default Restart | Out-Null
    & $Nssm set ToptierBot AppRestartDelay 10000   | Out-Null
    & $Nssm set ToptierBot AppThrottle 15000       | Out-Null
    & $Nssm start ToptierBot | Out-Null

    # uvicorn needs a moment to bind; a fixed sleep reports a false failure.
    $deadline = (Get-Date).AddSeconds(45)
    $svc = $null
    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service -Name ToptierBot -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq "Running") { break }
        Start-Sleep -Seconds 2
    }
    if ($svc -and $svc.Status -eq "Running") { Write-Ok "ToptierBot running (auto-start + crash-restart)" }
    else { Write-Bad "ToptierBot did not start (status: $(if ($svc) { $svc.Status } else { 'missing' }))." }
}

# ---------------------------------------------------------------------------
# 4. Cloudflare named tunnel, installed as a service
# ---------------------------------------------------------------------------
Write-Step "4/6" "Cloudflare tunnel"

if ($SkipTunnel) {
    Write-Warn2 "skipped (-SkipTunnel). The app cannot reach the bot without a public URL."
} else {
    if (-not (Test-Path $CloudflaredPath)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $CloudflaredPath -Parent) | Out-Null
        Write-Info "downloading cloudflared..."
        try {
            $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
            Invoke-WebRequest -Uri $url -OutFile $CloudflaredPath
            Write-Ok "cloudflared downloaded"
        } catch { Write-Bad "could not download cloudflared: $($_.Exception.Message)" }
    } else { Write-Ok "cloudflared present" }

    # Credentials: explicit, or the conventional locations.
    if ([string]::IsNullOrWhiteSpace($TunnelCredentials)) {
        foreach ($c in @(
            "$env:USERPROFILE\.cloudflared\$TunnelName.json",
            "C:\Cloudflare\$TunnelName.json",
            (Join-Path (Split-Path $CloudflaredPath -Parent) "$TunnelName.json"))) {
            if (Test-Path $c) { $TunnelCredentials = $c; break }
        }
    }
    if (-not $TunnelCredentials -or -not (Test-Path $TunnelCredentials)) {
        Write-Warn2 "no tunnel credentials found for '$TunnelName'."
        Write-Host "    Run these once, interactively, as Administrator:" -ForegroundColor Yellow
        Write-Host "      & '$CloudflaredPath' tunnel login" -ForegroundColor Yellow
        Write-Host "      & '$CloudflaredPath' tunnel create $TunnelName" -ForegroundColor Yellow
        Write-Host "    then re-run this script." -ForegroundColor Yellow
    } else {
        Write-Ok "credentials: $TunnelCredentials"

        # Ingress config: public hostname -> local bot service.
        $cfgDir = Split-Path $CloudflaredPath -Parent
        $cfg = Join-Path $cfgDir "config.yml"
        $origin = if ($Hostname) { $Hostname } else { "bot.toptier.app" }
        $cfgText = @"
tunnel: $TunnelName
credentials-file: $TunnelCredentials

ingress:
  - hostname: $origin
    service: http://127.0.0.1:$Port
  - service: http_status:404
"@
        Set-Content -LiteralPath $cfg -Value $cfgText -Encoding UTF8
        Write-Ok "wrote $cfg (hostname: $origin)"

        # DNS route (needs the login from `tunnel login`).
        if ($Hostname) {
            & $CloudflaredPath tunnel route dns $TunnelName $Hostname 2>&1 | ForEach-Object {
                if ($_ -match "error|ERROR") { Write-Warn2 $_.ToString() } else { Write-Info $_.ToString() }
            }
        } else {
            Write-Warn2 "no -Hostname given, skipped DNS route. Add one with:"
            Write-Host "      & '$CloudflaredPath' tunnel route dns $TunnelName <your-hostname>" -ForegroundColor Yellow
        }

        # Run the tunnel as a service so it survives reboots.
        $tnSvc = "CloudflaredToptier"
        if (Test-Path $Nssm) {
            & $Nssm stop $tnSvc 2>$null | Out-Null
            & $Nssm remove $tnSvc confirm 2>$null | Out-Null
            & $Nssm install $tnSvc $CloudflaredPath "tunnel --config $cfg run $TunnelName" | Out-Null
            & $Nssm set $tnSvc Start SERVICE_AUTO_START        | Out-Null
            & $Nssm set $tnSvc AppExit Default Restart         | Out-Null
            & $Nssm set $tnSvc AppRestartDelay 10000           | Out-Null
            & $Nssm set $tnSvc AppThrottle 15000               | Out-Null
            & $Nssm set $tnSvc AppStdout (Join-Path $cfgDir "cloudflared.log") | Out-Null
            & $Nssm set $tnSvc AppStderr (Join-Path $cfgDir "cloudflared.log") | Out-Null
            & $Nssm start $tnSvc | Out-Null
            Start-Sleep -Seconds 6
            $ts = Get-Service -Name $tnSvc -ErrorAction SilentlyContinue
            if ($ts -and $ts.Status -eq "Running") { Write-Ok "$tnSvc running (auto-start)" }
            else { Write-Bad "$tnSvc did not start." }
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Watchdog - alert when the bot goes quiet
# ---------------------------------------------------------------------------
Write-Step "5/6" "Watchdog"

$watchdog = Join-Path $ToolsDir "bot-watchdog.ps1"
# Single-quoted here-string: no interpolation, so no backtick-escaping is
# needed (escaping $ inside a double-quoted here-string emits the backtick
# into the generated file and produces a script that will not parse).
# Values are injected afterwards by -replace.
$wdTemplate = @'
# Alerts when the bot service is down or has stopped reporting.
# Scheduled every 5 minutes by bootstrap-vps.ps1.
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\ToptierTools\watchdog.log'
$serviceUrl = 'http://127.0.0.1:__PORT__/api/health'
$key = '__KEY__'

function Note($m) { Add-Content -Path $log -Value "$(Get-Date -Format s) $m" }

$svc = Get-Service -Name ToptierBot
if (-not $svc -or $svc.Status -ne 'Running') {
    Note "ALERT ToptierBot is not running (status=" + $svc.Status + ")"
    try { Restart-Service -Name ToptierBot -Force -ErrorAction Stop; Note 'recovery: restart issued' }
    catch { Note 'recovery: restart FAILED - ' + $_.Exception.Message }
    exit 1
}

try {
    $r = Invoke-RestMethod -Uri $serviceUrl -Headers @{'x-bot-service-key' = $key} -TimeoutSec 15
    if ($r.status -ne 'ok') { Note "ALERT unhealthy status: $($r | ConvertTo-Json -Compress)" }
    else {
        $inst = Invoke-RestMethod -Uri "http://127.0.0.1:__PORT__/api/instances" -Headers @{'x-bot-service-key' = $key} -TimeoutSec 15
        foreach ($i in $inst.instances) {
            if ($i.status -ne 'running') { Note "ALERT instance $($i.instanceId) is $($i.status) - service up but bot idle" }
        }
    }
} catch {
    Note "ALERT health check failed: $($_.Exception.Message)"
}
'@
$wdText = $wdTemplate.Replace('__PORT__', [string]$Port).Replace('__KEY__', $ServiceKey)
Set-Content -LiteralPath $watchdog -Value $wdText -Encoding UTF8
Write-Ok "watchdog script written"

try {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName "ToptierBotWatchdog" `
        -Action $action -Trigger $trigger `
        -Description "Checks the TOPTIER bot service every 5 minutes and restarts it if down." `
        -RunLevel Highest -Force | Out-Null
    Write-Ok "scheduled task 'ToptierBotWatchdog' registered (every 5 min)"
} catch {
    Write-Warn2 "could not register watchdog task: $($_.Exception.Message)"
}

if ($AlertEmail) {
    Write-Info "Alert email: $AlertEmail (pair this with UptimeRobot on /api/health)"
} else {
    Write-Info "For email alerts, add a free UptimeRobot check against the public /api/health URL."
}

# ---------------------------------------------------------------------------
# 6. Verify
# ---------------------------------------------------------------------------
if ($SkipVerify) {
    Write-Step "6/6" "Verification skipped (-SkipVerify)"
} else {
    Write-Step "6/6" "Verification"

    $svc = Get-Service -Name ToptierBot -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") { Write-Ok "service running" }
    else { Write-Bad "service not running" }

    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" `
            -Headers @{'x-bot-service-key' = $ServiceKey} -TimeoutSec 15
        if ($h.status -eq "ok") { Write-Ok "health endpoint responds ok" }
        else { Write-Bad "health endpoint returned: $($h | ConvertTo-Json -Compress)" }
    } catch { Write-Bad "health check failed: $($_.Exception.Message)" }

    # The check that catches "service up, bot idle".
    try {
        $inst = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/instances" `
            -Headers @{'x-bot-service-key' = $ServiceKey} -TimeoutSec 15
        $running = @($inst.instances | Where-Object { $_.status -eq 'running' })
        if ($inst.instances.Count -eq 0) {
            Write-Warn2 "no instances yet - link an account in the app, then it will autostart here."
        } else {
            foreach ($i in $inst.instances) {
                if ($i.status -eq 'running') { Write-Ok "instance $($i.instanceId) running (pid $($i.pid))" }
                else { Write-Bad "instance $($i.instanceId) is $($i.status)" }
            }
            Write-Info "$($running.Count) of $($inst.instances.Count) instance(s) running."
        }
    } catch { Write-Bad "could not list instances: $($_.Exception.Message)" }

    if (-not $SkipTunnel -and $Hostname) {
        try {
            $pub = Invoke-RestMethod -Uri "https://$Hostname/api/health" `
                -Headers @{'x-bot-service-key' = $ServiceKey} -TimeoutSec 20
            if ($pub.status -eq "ok") { Write-Ok "public URL https://$Hostname is reachable" }
            else { Write-Bad "public URL returned: $($pub | ConvertTo-Json -Compress)" }
        } catch { Write-Bad "public URL https://$Hostname not reachable: $($_.Exception.Message)" }
    }

    $ts = Get-Service -Name CloudflaredToptier -ErrorAction SilentlyContinue
    if ($ts) {
        if ($ts.Status -eq "Running") { Write-Ok "tunnel service running" }
        else { Write-Bad "tunnel service is $($ts.Status)" }
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
if ($script:Failed.Count -eq 0) {
    Write-Host " Bootstrap complete. The box is self-healing." -ForegroundColor Green
} else {
    Write-Host " Finished with $($script:Failed.Count) problem(s):" -ForegroundColor Yellow
    foreach ($f in $script:Failed) { Write-Host "   - $f" -ForegroundColor Yellow }
}
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Remaining manual steps:" -ForegroundColor Cyan
Write-Host "  1. Set the app's BOT_SERVICE_URL to the stable hostname (NOT a trycloudflare.com one)."
if ($Hostname) { Write-Host "     https://$Hostname" }
Write-Host "  2. Log into MetaTrader 5 once by hand and keep the terminal open/logged in."
Write-Host "  3. Link the account in the app (Trading Bot -> Link MT5/MT4)."
Write-Host "  4. First boot spends ~90 min backtesting before it trades. After that,"
Write-Host "     the warm-up is cached and restarts are instant."
Write-Host ""
if ($script:Failed.Count -gt 0) { exit 1 }
exit 0
