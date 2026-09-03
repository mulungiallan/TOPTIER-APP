# Auto-commit & push watcher for TOPTIER.
# Monitors the repo and pushes any changes to git immediately.
# - Debounces: commits after the working tree has been stable for a short window.
# - Ignores build-log.txt (scratch) so it never gets committed.
#
# Usage (run in background):
#   Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy','Bypass','-File',$PWD\scripts\auto-commit.ps1

$ErrorActionPreference = 'Continue'
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

# Files/dirs to never auto-commit (paths relative to repo root, forward slashes)
$IGNORED = @('build-log.txt')

$quietWindowMs = 3000   # working tree must be stable this long before committing
$pollMs        = 1000   # how often to scan

function Get-Porcelain {
  $raw = git status --porcelain 2>$null
  if (-not $raw) { return ,'' }
  # normalize: strip status codes, keep normalized path, filter ignored
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($line in $raw) {
    if (-not $line) { continue }
    $path = $line.Substring(3).Trim().Trim('"').Replace('\','/')
    $skip = $false
    foreach ($ig in $IGNORED) { if ($path -eq $ig) { $skip = $true; break } }
    if (-not $skip) { $lines.Add($path) }
  }
  return $lines.ToArray()
}

$lastState = @(Get-Porcelain)
$lastChange = [DateTime]::UtcNow
$logLine = -join ('[auto-commit ' + (Get-Date -Format 'HH:mm:ss') + '] ')
Write-Output ($logLine + 'watcher started on ' + $ROOT)

while ($true) {
  Start-Sleep -Milliseconds $pollMs
  $current = @(Get-Porcelain)
  $changed = $false
  if ($current.Count -ne $lastState.Count) { $changed = $true }
  else {
    for ($i = 0; $i -lt $current.Count; $i++) {
      if ($current[$i] -ne $lastState[$i]) { $changed = $true; break }
    }
  }
  if ($changed) { $lastChange = [DateTime]::UtcNow }
  $lastState = $current

  $hasChanges = $current.Count -gt 0
  if ($hasChanges) {
    $elapsed = ([DateTime]::UtcNow - $lastChange).TotalMilliseconds
    if ($elapsed -ge $quietWindowMs) {
      # recompute to avoid racing with a concurrent edit
      $dirty = @(Get-Porcelain)
      if ($dirty.Count -eq 0) { continue }
      $summary = ($dirty | Select-Object -First 3) -join ', '
      if ($dirty.Count -gt 3) { $summary += ', ...' }
      $msg = "auto-commit: $summary"
      git add -A -- . ':!build-log.txt' 2>$null
      $staged = @(git diff --cached --name-only 2>$null | Where-Object { $_.Trim() })
      if ($staged.Count -eq 0) { continue }
      git commit -m $msg 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Output ((-join ('[auto-commit ' + (Get-Date -Format 'HH:mm:ss') + '] ')) + "committed: $msg")
        git push origin main 2>$null
        Write-Output ((-join ('[auto-commit ' + (Get-Date -Format 'HH:mm:ss') + '] ')) + "push exit: $LASTEXITCODE")
      }
      # reset timer so we don't immediately re-commit
      $lastChange = [DateTime]::UtcNow
      $lastState = @(Get-Porcelain)
    }
  }
}
