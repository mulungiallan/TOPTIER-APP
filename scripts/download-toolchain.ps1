$ErrorActionPreference = 'Continue'
$dir = 'C:\Android\downloads'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'download.log'
function Log($m) { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

$jobs = @(
  @{ name = 'jdk17';        url = 'https://cdn.azul.com/zulu/bin/zulu17.52.17-ca-jdk17.0.12-win_x64.zip'; out = Join-Path $dir 'jdk17.zip' },
  @{ name = 'cmdline-tools'; url = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'; out = Join-Path $dir 'cmdline-tools.zip' },
  @{ name = 'gradle-bin';   url = 'https://services.gradle.org/distributions/gradle-8.14.3-bin.zip'; out = Join-Path $dir 'gradle-8.14.3-bin.zip' }
)

foreach ($j in $jobs) {
  $target = $j.out
  $exists = Test-Path $target
  $size = if ($exists) { (Get-Item $target).Length } else { 0 }
  $finalSize = switch ($j.name) {
    'jdk17'        { 203176844 }   # expected bytes (approx)
    'cmdline-tools'{ 139207341 }
    'gradle-bin'   { 101155843 }
  }
  Log "START $($j.name) existing=$size target=$finalSize"
  if ($exists -and $size -ge $finalSize) { Log "SKIP $($j.name) already complete"; continue }
  $argList = @('-L', '-sS', '--retry', '8', '--retry-delay', '15',
               '-C', '-', '-o', $target, $j.url)
  & curl.exe @argList 2>&1 | Out-Null
  Log "DONE $($j.name) size=$((Get-Item $target -ErrorAction SilentlyContinue).Length)"
}
Log "ALL DOWNLOADS FINISHED"
