$token = $env:GITHUB_TOKEN
$headers = @{Authorization = "token $token"; Accept = "application/vnd.github.v3+json"}
$repo = "mulungiallan/TOPTIER-APP"
$sourceDir = "C:\Users\Admin\Desktop\app"

$excludeDirs = @("node_modules", ".next", ".next-build", ".next-prod", "android", "mt5_trading_bot", ".venv", "out", "upload", "examples", "docs", "toptier-additions", "mini-services", "deploy", ".zscripts")
$excludeFiles = @("bun.lock", "package-lock.json", "tsconfig.tsbuildinfo", "tokens.txt", "*.zip", "*.bat", "*.ps1", "*.pid")

Write-Host "Collecting files..."
$allFiles = Get-ChildItem -Path $sourceDir -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($sourceDir.Length + 1)
    $excluded = $false
    foreach ($d in $excludeDirs) { if ($rel -like "$d\*") { $excluded = $true; break } }
    if (-not $excluded) { foreach ($f in $excludeFiles) { if ($_.Name -like $f) { $excluded = $true; break } } }
    -not $excluded -and $_.Length -lt 10000000
}
Write-Host "Found $($allFiles.Count) files"

# Step 1: Upload blobs and collect tree items
Write-Host "`n=== Step 1: Uploading blobs ==="
$treeItems = @()
$uploaded = 0
foreach ($file in $allFiles) {
    $relPath = $file.FullName.Substring($sourceDir.Length + 1).Replace('\', '/')
    try {
        $content = [System.IO.File]::ReadAllBytes($file.FullName)
        $base64 = [Convert]::ToBase64String($content)
        $blobBody = @{encoding = "base64"; content = $base64} | ConvertTo-Json -Depth 3
        $blob = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/blobs" -Method Post -Headers $headers -Body $blobBody -ContentType "application/json; charset=utf-8"
        $treeItems += @{path = $relPath; mode = "100644"; type = "blob"; sha = $blob.sha}
        $uploaded++
        if ($uploaded % 50 -eq 0) { Write-Host "$uploaded/$($allFiles.Count)" }
    } catch {
        Write-Host "FAIL: $relPath"
    }
}
Write-Host "Uploaded $uploaded blobs"

# Step 2: Build tree in batches of 100
Write-Host "`n=== Step 2: Building tree in batches ==="
$mainRef = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/heads/main" -Headers $headers
$baseTreeSha = $mainRef.object.sha
$currentTreeSha = $baseTreeSha

$batchSize = 100
for ($i = 0; $i -lt $treeItems.Count; $i += $batchSize) {
    $batch = $treeItems[$i..([Math]::Min($i + $batchSize - 1, $treeItems.Count - 1))]
    $batchNum = [Math]::Floor($i / $batchSize) + 1
    Write-Host "Tree batch $batchNum ($($batch.Count) items)..."
    
    $treeBody = @{base_tree = $currentTreeSha; tree = $batch} | ConvertTo-Json -Depth 5 -Compress
    $tree = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/trees" -Method Post -Headers $headers -Body $treeBody -ContentType "application/json; charset=utf-8"
    $currentTreeSha = $tree.sha
    Write-Host "  -> tree sha: $($currentTreeSha.Substring(0,7))"
}

# Step 3: Create commit
Write-Host "`n=== Step 3: Creating commit ==="
$commitBody = @{message = "TOPTIER app - full upload"; tree = $currentTreeSha; parents = @($mainRef.object.sha)} | ConvertTo-Json -Depth 3
$commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/commits" -Method Post -Headers $headers -Body $commitBody -ContentType "application/json; charset=utf-8"

# Step 4: Update ref
$updateBody = @{sha = $commit.sha} | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/heads/main" -Method Patch -Headers $headers -Body $updateBody -ContentType "application/json"

Write-Host "`nDONE! https://github.com/mulungiallan/TOPTIER-APP"
