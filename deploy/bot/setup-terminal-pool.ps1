<#
.SYNOPSIS
    Provision the MT5 terminal pool that lets one Windows host serve many
    accounts concurrently.

.DESCRIPTION
    MetaTrader5 is Windows-only and one terminal is exactly one session, so a
    multi-tenant host needs one terminal install per concurrent account. This
    script clones an existing MT5 install into N slots (term01, term02, ...)
    under a pool directory. The bot service then hands each instance its own
    slot and launches it in portable mode (see mini-services/bot/terminal_pool.py).

    Install MetaTrader 5 once (https://www.metatrader5.com/en/download), launch
    it, and accept the licence/open the trade dialog so its profile exists. Then
    run this script from an elevated PowerShell:

        Set-ExecutionPolicy -Scope Process Bypass
        .\setup-terminal-pool.ps1 -Count 5
        # or, also wire the pool into the running service:
        .\setup-terminal-pool.ps1 -Count 5 -InstallService

    Then set BOT_TERMINAL_POOL_DIR (below) in the service environment so the
    service starts assigning slots.

.NOTES
    Each slot is a full copy (~600 MB-1 GB), so plan disk accordingly. Slots are
    portable: their MT5 data lives inside the slot folder, so instances never
    share a profile.
#>

param(
    [int]$Count = 5,

    [string]$Source = "C:\Program Files\MetaTrader 5",

    [string]$PoolDir = "C:\MT5",

    [switch]$Force,

    [switch]$LaunchEach,

    [switch]$InstallService
)

$ErrorActionPreference = "Stop"

function Test-Terminal($dir) {
    return (Test-Path (Join-Path $dir "terminal64.exe")) -or (Test-Path (Join-Path $dir "terminal.exe"))
}

if (-not (Test-Path $Source)) {
    throw "Source MT5 install not found: $Source. Install MetaTrader 5 first (or pass -Source)."
}
if (-not (Test-Terminal $Source)) {
    throw "No terminal64.exe / terminal.exe in $Source. Pass -Source pointing at the MT5 install directory."
}
if ($Count -lt 1) { throw "-Count must be at least 1." }

New-Item -ItemType Directory -Force -Path $PoolDir | Out-Null
Write-Host "Source : $Source"
Write-Host "Pool   : $PoolDir"
Write-Host "Slots  : $Count"
Write-Host ""

$created = @()
for ($i = 1; $i -le $Count; $i++) {
    $name = "term{0:D2}" -f $i
    $slot = Join-Path $PoolDir $name

    if ((Test-Path $slot) -and -not $Force) {
        Write-Host "[$name] exists - skipping (use -Force to refresh)."
        $created += $slot
        continue
    }

    Write-Host "[$name] copying..."
    # robocopy is faster and retries on locked files; /MIR makes -Force a refresh.
    $rcArgs = @($Source, $slot, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:2")
    if ($Force) { $rcArgs += "/MIR" } else { $rcArgs += "/XO" }
    & robocopy @rcArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $name (exit $LASTEXITCODE)." }

    if (-not (Test-Terminal $slot)) {
        throw "Copy for $name did not produce a terminal executable."
    }
    $created += $slot
}

# Keep each slot's MT5 data next to its install (portable). A marker file is
# harmless but documents intent for a human who finds the folder later.
$readme = @"
TOPTIER MT5 terminal pool
=========================
Slots: $($created.Count)  (term01 .. term$('{0:D2}' -f $Count))

Each folder is a self-contained, portable MT5 install. The TOPTIER bot service
assigns one slot per account (BOT_TERMINAL_POOL_DIR=$PoolDir) and launches it in
portable mode, so no two accounts share a terminal session.

Do not delete or rename these folders while accounts are linked.
"@
Set-Content -LiteralPath (Join-Path $PoolDir "README.txt") -Value $readme -Encoding ASCII

# Optionally launch each slot once so MT5 creates its portable profile and the
# EULA is accepted interactively (only needed if the bot's headless login is
# refused on a fresh copy).
if ($LaunchEach) {
    foreach ($slot in $created) {
        $exe = Join-Path $slot "terminal64.exe"
        if (-not (Test-Path $exe)) { $exe = Join-Path $slot "terminal.exe" }
        Write-Host "[launch] $exe /portable"
        Start-Process -FilePath $exe -ArgumentList "/portable" | Out-Null
        Start-Sleep -Seconds 3
    }
    Write-Host "Launched $($created.Count) terminals. Log in / accept the agreement, then close them."
}

# Wire the pool into the NSSM service so it takes effect without a reboot.
if ($InstallService) {
    $Nssm = "C:\ToptierTools\nssm.exe"
    if (-not (Test-Path $Nssm)) {
        Write-Warning "NSSM not found at $Nssm - set BOT_TERMINAL_POOL_DIR=$PoolDir yourself."
    } else {
        & $Nssm set ToptierBot AppEnvironmentExtra BOT_TERMINAL_POOL_DIR=$PoolDir
        Write-Host "Set BOT_TERMINAL_POOL_DIR=$PoolDir on service 'ToptierBot'."
        Write-Host "Restarting the service to apply..."
        & $Nssm restart ToptierBot | Out-Null
    }
} else {
    Write-Host ""
    Write-Host "Next: add this to the bot service environment and restart it:"
    Write-Host "    BOT_TERMINAL_POOL_DIR=$PoolDir"
}

Write-Host ""
Write-Host "Done. $($created.Count) slot(s) ready under $PoolDir."
Write-Host "Verify: curl.exe http://127.0.0.1:8765/api/health   # look at terminalPool"
