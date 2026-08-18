# Production startup for the standalone Next.js build.
# Loads configuration from .env (so secrets live in one place) then starts
# the standalone server. Override anything by setting it before running this.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# Load .env values (simple KEY=VALUE parser; ignores comments/empty lines)
if (Test-Path (Join-Path $Root ".env")) {
  Get-Content (Join-Path $Root ".env") | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line -split "=", 2
      $name = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }
}

$env:NODE_ENV = "production"
if (-not $env:PORT) { $env:PORT = "3000" }
$env:HOSTNAME = $env:HOSTNAME ?? "0.0.0.0"

$server = Join-Path $Root ".next\standalone\server.js"
if (-not (Test-Path $server)) {
  throw "Standalone server not found at $server — run `npm run build` first."
}

Write-Host "[start-prod] Starting TOPTIER on 0.0.0.0:$env:PORT (from $Root)"
node $server
