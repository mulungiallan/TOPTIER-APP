# Builds a signed TOPTIER release .aab for Google Play.
# Idempotent: safe to re-run. On any fast-internet machine this fully bootstraps
# JDK 17 + Android SDK + Gradle, then produces android/release/toptier-release.aab.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build-aab.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

$ANDROID_ROOT = $env:ANDROID_ROOT_PATH
if (-not $ANDROID_ROOT) { $ANDROID_ROOT = 'C:\Android' }
$env:ANDROID_ROOT = $ANDROID_ROOT
$DL      = Join-Path $ANDROID_ROOT 'downloads'
$JDK_DIR = Join-Path $ANDROID_ROOT 'jdk-17'
$SDK_DIR = Join-Path $ANDROID_ROOT 'sdk'

function Log($m) { Write-Host "[build-aab] $m" }

# Run a native command, redirecting stderr to a temp file so PS 5.1 does not
# turn normal stderr output into (terminating) error records.
function Run-Native {
  param([scriptblock]$Command)
  $err = Join-Path $env:TEMP ("native-" + [guid]::NewGuid().ToString('N') + '.log')
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command 2> $err } finally { $ErrorActionPreference = $prevEap }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    $msg = (Get-Content $err -Raw -ErrorAction SilentlyContinue) -replace '\s+$',''
    Remove-Item $err -Force -ErrorAction SilentlyContinue
    throw "Command failed (exit $code): $msg"
  }
  Remove-Item $err -Force -ErrorAction SilentlyContinue
}

# --- helper: download with resume ---
function Get-FileResume([string]$Url, [string]$Out) {
  if (Test-Path $Out) {
    Log "Resuming $Out ($((Get-Item $Out).Length) bytes)"
  }
  & curl.exe -L -sS --retry 8 --retry-delay 15 -C - -o $Out $Url
  if ($LASTEXITCODE -ne 0) { throw "curl failed for $Url" }
  Log "Downloaded $Out ($((Get-Item $Out).Length) bytes)"
}

# --- 1. JDK 21 ---
New-Item -ItemType Directory -Force -Path $DL | Out-Null
$jdkZip = Join-Path $DL 'jdk21.zip'
if (-not (Test-Path (Join-Path $JDK_DIR 'bin\java.exe'))) {
  Log "Downloading JDK 21..."
  Get-FileResume 'https://cdn.azul.com/zulu/bin/zulu21.38.21-ca-jdk21.0.4-win_x64.zip' $jdkZip
  Run-Native { tar.exe -xf $jdkZip -C $env:ANDROID_ROOT }
  if (-not (Test-Path (Join-Path $JDK_DIR 'bin\java.exe'))) {
    $extracted = Get-ChildItem (Split-Path -Parent $JDK_DIR) -Directory | Where-Object { $_.Name -like 'zulu21*' } | Select-Object -First 1
    if ($extracted) { Move-Item $extracted.FullName $JDK_DIR -Force }
  }
}
$env:JAVA_HOME = $JDK_DIR
Log "JAVA_HOME=$env:JAVA_HOME"

# --- 2. Android SDK cmdline-tools ---
$cmdZip = Join-Path $DL 'cmdline-tools.zip'
if (-not (Test-Path (Join-Path $SDK_DIR 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
  Log "Downloading Android cmdline-tools..."
  Get-FileResume 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip' $cmdZip
  New-Item -ItemType Directory -Force -Path $SDK_DIR | Out-Null
  $tmpCmds = Join-Path $DL 'cmdline-tools-extract'
  if (Test-Path $tmpCmds) { Remove-Item $tmpCmds -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $tmpCmds | Out-Null
  Run-Native { tar.exe -xf $cmdZip -C $tmpCmds }
  New-Item -ItemType Directory -Force -Path (Join-Path $SDK_DIR 'cmdline-tools') | Out-Null
  Move-Item (Join-Path $tmpCmds 'cmdline-tools') (Join-Path $SDK_DIR 'cmdline-tools\latest') -Force
}
$sdkmanager = Join-Path $SDK_DIR 'cmdline-tools\latest\bin\sdkmanager.bat'
$env:ANDROID_HOME = $SDK_DIR
$env:ANDROID_SDK_ROOT = $SDK_DIR
$env:PATH = "$JDK_DIR\bin;$SDK_DIR\platform-tools;$env:PATH"
Log "ANDROID_HOME=$env:ANDROID_HOME"

# --- 3. Accept licenses + install packages ---
Log "Accepting Android SDK licenses..."
$errFile = Join-Path $env:TEMP ("native-" + [guid]::NewGuid().ToString('N') + '.log')
$("y`n" * 25) | & $sdkmanager --sdk_root=$SDK_DIR --licenses 2> $errFile
if ($LASTEXITCODE -ne 0) { Remove-Item $errFile -Force -ErrorAction SilentlyContinue; throw "sdkmanager --licenses failed" }
Remove-Item $errFile -Force -ErrorAction SilentlyContinue
Log "Installing SDK packages..."
Run-Native { & $sdkmanager --sdk_root=$env:ANDROID_HOME 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' }
Log "Android SDK packages installed"

# --- 4. Release keystore (generated once, never committed) ---
$ksProps = Join-Path $ROOT 'android\keystore.properties'
if (-not (Test-Path $ksProps)) {
  Log "Generating release keystore..."
  $ksDir = Join-Path $ROOT 'android\keystore'
  New-Item -ItemType Directory -Force -Path $ksDir | Out-Null
  $ksFile = Join-Path $ksDir 'toptier-release.jks'
  $storePass = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})
  Run-Native { & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -v -keystore $ksFile -storepass $storePass -keypass $storePass -alias toptier -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=TOPTIER, OU=Mobile, O=TOPTIER, L=Nairobi, ST=Nairobi, C=KE" }
  "storeFile=keystore/toptier-release.jks`nstorePassword=$storePass`nkeyAlias=toptier`nkeyPassword=$storePass" | Set-Content $ksProps
  Log "Keystore created. IMPORTANT: back up android\keystore\toptier-release.jks and $ksProps - losing them means you cannot update the app."
}

# --- 5. Cap sync (push web assets + config into Android project) ---
Log "Running capacitor sync..."
$npmBin = Join-Path $ROOT 'node_modules\.bin\npx.cmd'
if (-not (Test-Path $npmBin)) { $npmBin = 'npx' }
Run-Native { & $npmBin cap sync android }

# --- 6. Gradle 8.14.3 ---
$gradleZip = Join-Path $DL 'gradle-8.14.3-bin.zip'
if (-not (Test-Path $gradleZip)) {
  Log "Downloading Gradle 8.14.3..."
  Get-FileResume 'https://services.gradle.org/distributions/gradle-8.14.3-bin.zip' $gradleZip
}
$wrapperFile = Join-Path $ROOT 'android\gradle\wrapper\gradle-wrapper.properties'
$origDist = Get-Content $wrapperFile
$localDistUrl = 'distributionUrl=file:///' + ($gradleZip -replace '\\','/')
try {
  Log "Building release AAB with Gradle (first run downloads dependencies)..."
  (Get-Content $wrapperFile) -replace '^distributionUrl=.*', $localDistUrl | Set-Content $wrapperFile
  Run-Native { & (Join-Path $ROOT 'android\gradlew.bat') -p (Join-Path $ROOT 'android') :app:bundleRelease }
} finally {
  $origDist | Set-Content $wrapperFile
}

# --- 7. Locate + copy AAB ---
$aab = Get-ChildItem -Recurse (Join-Path $ROOT 'android\app\build\outputs\bundle') -Filter *.aab | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $aab) { throw "AAB not found in android/app/build/outputs/bundle" }
$releaseDir = Join-Path $ROOT 'android\release'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Item $aab.FullName (Join-Path $releaseDir 'toptier-release.aab') -Force
Log "SUCCESS: $(Join-Path $releaseDir 'toptier-release.aab')"
