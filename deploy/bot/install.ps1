<#
.SYNOPSIS
    One-command installer for the TOPTIER bot service on a Windows VPS.

.DESCRIPTION
    Installs pip dependencies, writes the service .env, and (optionally)
    registers + starts the service as a Windows service via NSSM.

    Run from deploy/bot as Administrator:
      Set-ExecutionPolicy -Scope Process Bypass
      .\install.ps1 -ServiceKey "the-same-long-secret-as-the-app" -InstallService

    NOTE: this file is executed on the server, not from the app repo root.
    It expects ./../../mt5_trading_bot and ./../../mini-services/bot relative
    to this script, or the packaged layout used by build-bot-deploy.ps1
    (root/bot-engine + root/bot-service).
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ServiceKey = $env:BOT_SERVICE_KEY,

    [int]$Port = 8765,

    [switch]$InstallService,

    [switch]$NoService,

    [string]$PythonPath = "python",

    [string]$Host = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

# --- Locate engine + service dirs (packaged layout OR repo layout) ----------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EngineDir = Join-Path $ScriptDir "mt5_trading_bot"
$ServiceDir = Join-Path $ScriptDir "mini-services\bot"
if (-not (Test-Path $EngineDir)) { $EngineDir = Join-Path (Split-Path $ScriptDir -Parent) "mt5_trading_bot" }
if (-not (Test-Path $ServiceDir)) { $ServiceDir = Join-Path (Split-Path $ScriptDir -Parent) "mini-services\bot" }

if (-not (Test-Path $EngineDir)) { throw "Engine directory not found: $EngineDir" }
if (-not (Test-Path $ServiceDir)) { throw "Service directory not found: $ServiceDir" }

Write-Host "Engine : $EngineDir"
Write-Host "Service: $ServiceDir"

# --- Checks ----------------------------------------------------------------
& $PythonPath --version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Python not found. Install Python 3.9+ and put it on PATH (or pass -PythonPath)."
}

if ([string]::IsNullOrWhiteSpace($ServiceKey)) {
    throw "BOT_SERVICE_KEY is required. Pass -ServiceKey '...' (must match the app's BOT_SERVICE_KEY)."
}

# --- Install dependencies --------------------------------------------------
Write-Host "`n[1/3] Installing pip dependencies..."
& $PythonPath -m pip install -r (Join-Path $EngineDir "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { throw "Engine dependency install failed." }
& $PythonPath -m pip install -r (Join-Path $ServiceDir "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { throw "Service dependency install failed." }

# --- Write service .env -----------------------------------------------------
Write-Host "`n[2/3] Writing service .env..."
$EnvFile = Join-Path $ServiceDir ".env"
$envText = @"
# Written by deploy/bot/install.ps1
BOT_SERVICE_KEY=$ServiceKey
BOT_SERVICE_HOST=$Host
BOT_SERVICE_PORT=$Port
BOT_ENGINE_DIR=$EngineDir
BOT_DATA_DIR=$(Join-Path $ServiceDir "data")
BOT_PYTHON=$PythonPath
"@
Set-Content -LiteralPath $EnvFile -Value $envText -Encoding ASCII

# --- Register / start --------------------------------------------------------
if (-not $InstallService -or $NoService) {
    Write-Host "`n[3/3] Not installing a service. Run manually from $ServiceDir :"
    Write-Host ""
    Write-Host "    set BOT_SERVICE_KEY=$ServiceKey"
    Write-Host "    & '$PythonPath' -m uvicorn server:app --host $Host --port $Port"
    Write-Host ""
    Write-Host "Done."
    exit 0
}

Write-Host "`n[3/3] Registering Windows service 'ToptierBot' via NSSM..."

$ToolsDir = "C:\ToptierTools"
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
$Nssm = Join-Path $ToolsDir "nssm.exe"
if (-not (Test-Path $Nssm)) {
    Write-Host "Downloading NSSM..."
    $NssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $Zip = Join-Path $ToolsDir "nssm.zip"
    Invoke-WebRequest -Uri $NssmUrl -OutFile $Zip
    Expand-Archive -LiteralPath $Zip -DestinationPath $ToolsDir -Force
    $Found = Get-ChildItem $ToolsDir -Recurse -Filter nssm.exe | Select-Object -First 1
    if (-not $Found) { throw "Could not locate nssm.exe after extraction." }
    Move-Item -Force $Found.FullName $Nssm
    Remove-Item -LiteralPath $Zip -Force
}

$PyReal = (Get-Command $PythonPath -ErrorAction SilentlyContinue).Source
if (-not $PyReal) { $PyReal = $PythonPath }

& $Nssm stop ToptierBot 2>$null | Out-Null
& $Nssm remove ToptierBot confirm 2>$null | Out-Null
& $Nssm install ToptierBot $PyReal "-m uvicorn server:app --host $Host --port $Port"
if ($LASTEXITCODE -ne 0) { throw "NSSM install failed." }
& $Nssm set ToptierBot AppDirectory $ServiceDir
& $Nssm set ToptierBot AppEnvironmentExtra BOT_SERVICE_KEY=$ServiceKey
& $Nssm set ToptierBot AppEnvironmentExtra BOT_SERVICE_HOST=$Host
& $Nssm set ToptierBot AppEnvironmentExtra BOT_SERVICE_PORT=$Port
& $Nssm set ToptierBot AppEnvironmentExtra BOT_ENGINE_DIR=$EngineDir
& $Nssm set ToptierBot AppEnvironmentExtra BOT_DATA_DIR=$(Join-Path $ServiceDir "data")
& $Nssm set ToptierBot AppEnvironmentExtra BOT_PYTHON=$PythonPath
& $Nssm set ToptierBot AppStdout (Join-Path $ServiceDir "service.log")
& $Nssm set ToptierBot AppStderr (Join-Path $ServiceDir "service.log")
& $Nssm set ToptierBot Start SERVICE_AUTO_START
& $Nssm start ToptierBot
if ($LASTEXITCODE -ne 0) { throw "Failed to start the ToptierBot service." }

Write-Host ""
Write-Host "Service 'ToptierBot' installed and running on port $Port."
Write-Host "Verify: curl.exe http://127.0.0.1:$Port/api/health"
