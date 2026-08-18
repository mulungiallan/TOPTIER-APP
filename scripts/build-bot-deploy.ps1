# scripts/build-bot-deploy.ps1
# Builds the self-contained deploy kit for the Windows VPS:
#   bot-service-deploy.zip
#     ├── install.ps1
#     ├── README.md
#     ├── .env.example
#     ├── mt5_trading_bot/          (trading engine)
#     └── mini-services/bot/        (FastAPI control plane)
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\build-bot-deploy.ps1

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $Root "out"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Zip = Join-Path $OutDir "bot-service-deploy.zip"
$Staging = Join-Path $env:TEMP "toptier-bot-deploy"

# Fresh staging
if (Test-Path $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

$Checks = @(
    @{ Src = Join-Path $Root "deploy\bot\install.ps1";    Dst = "install.ps1" },
    @{ Src = Join-Path $Root "deploy\bot\README.md";      Dst = "README.md" },
    @{ Src = Join-Path $Root "deploy\bot\.env.example";   Dst = ".env.example" },
    @{ Src = Join-Path $Root "mt5_trading_bot";           Dst = "mt5_trading_bot" },
    @{ Src = Join-Path $Root "mini-services\bot";         Dst = "mini-services\bot" }
)

foreach ($c in $Checks) {
    if (-not (Test-Path $c.Src)) { throw "Missing: $($c.Src)" }
    $dest = Join-Path $Staging $c.Dst
    if (Test-Path $c.Src -PathType Container) {
        New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
        Copy-Item -LiteralPath $c.Src -Destination $dest -Recurse -Force
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
        Copy-Item -LiteralPath $c.Src -Destination $dest -Force
    }
}

# Never ship runtime instance data / credentials / repo noise
$Skip = @("data\instances", "data", ".gitignore", "*.log", ".env", "__pycache__", "*.pyc", "*.pyo")
foreach ($item in (Get-ChildItem $Staging -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) {
    if ($item.Name -in $Skip) {
        Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path $Zip) { Remove-Item -LiteralPath $Zip -Force }
$Items = Get-ChildItem -LiteralPath $Staging -Force | ForEach-Object { $_.FullName }
Compress-Archive -Path $Items -DestinationPath $Zip -CompressionLevel Optimal

$Size = [Math]::Round((Get-Item $Zip).Length / 1KB, 1)
Write-Host "Created $Zip ($Size KB). Transfer this to the Windows VPS and run install.ps1 as Administrator."
