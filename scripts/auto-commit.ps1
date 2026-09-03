# Auto-commit & push watcher for TOPTIER.
# Monitors the repo and pushes any changes to git immediately.
# - Debounces: waits for a quiet period after the last change before committing.
# - Ignores build-log.txt (scratch) so it never gets committed.
# - Commits with an automatic message describing staged/untracked files.
#
# Usage (run in background):
#   Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy','Bypass','-File',$PWD\scripts\auto-commit.ps1

$ErrorActionPreference = 'Continue'
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

# Files/dirs to never auto-commit
$IGNORED = @('build-log.txt')

$quietWindowMs = 3000        # wait this long after the last change before committing
$pollMs        = 1000        # how often to scan

function Get-Changes {
  $all = git status --porcelain 2>$null
  if (-not $all) { return @() }
  $out = New-Object System.Collections.ArrayList
  foreach ($line in $all) {
    if (-not $line) { continue }
    $status = $line.Substring(0,2).Trim()
    $path = $line.Substring(3).Trim()
    # strip quotes git adds around paths with spaces
    $path = $path -replace '^"(.*)"$','$1'
    $skip = $false
    foreach ($ig in $IGNORED) { if ($path -eq $ig) { $skip = $true; break } }
    if (-not $skip) { [void]$out.Add(($path -replace '\\','/')) }
  }
  return $out
}

function NowMs { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

$lastChange = [long]0
$logLine = -join ('[auto-commit ' + (Get-Date -Format 'HH:mm:ss') + '] ')
Write-Output ($logLine + 'watcher started on ' + $ROOT)

while ($true) {
  Start-Sleep -Milliseconds $pollMs
  $changes = @(Get-Changes)
  if ($changes.Count -gt 0) {
    $lastChange = NowMs
  } else {
    if ($lastChange -ne 0 -and (NowMs - $lastChange) -ge $quietWindowMs) {
      $lastChange = 0
      $dirty = @(Get-Changes)
      if ($dirty.Count -eq 0) { continue }
      # build a short summary for the commit message
      $summary = ($dirty | Select-Object -First 3) -join ', '
      if ($dirty.Count -gt 3) { $summary += ', ...' }
      $msg = "auto-commit: $summary"
      git add -A -- . ':!build-log.txt' 2>$null
      $staged = git diff --cached --name-only 2>$null | Where-Object { $_.Trim() }
      if (-not $staged) { continue }
      git commit -m $msg 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Output ((-join ('[auto-commit ' + (Get-Date -Format 'HH:mm:ss') + '] ')) + "committed: $msg")
        $push = git push origin main 2>&1
        Write-Output ((-join ('[auto-commit ' + (Get-Date -Format 'HH:mm:ss') + '] ')) + "push result: $LASTEXITCODE")
      }
    }
  }
}
