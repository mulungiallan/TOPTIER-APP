$token = $env:GITHUB_TOKEN
$headers = @{Authorization = "token $token"; Accept = "application/vnd.github.v3+json"}
$repo = "mulungiallan/TOPTIER-APP"
$sourceDir = "C:\Users\Admin\Desktop\app"

$excludeDirs = @("node_modules", ".next", ".next-build", ".next-prod", "android", "mt5_trading_bot", ".venv", "out", "upload", "examples", "docs")
$excludeFiles = @("bun.lock", "package-lock.json", "tsconfig.tsbuildinfo", "tokens.txt", "*.zip")

Write-Host "Collecting files..."
$allFiles = Get-ChildItem -Path $sourceDir -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($sourceDir.Length + 1)
    $excluded = $false
    foreach ($d in $excludeDirs) {
        if ($rel -like "$d\*" -or $rel -like "$d") { $excluded = $true; break }
    }
    if (-not $excluded) {
        foreach ($f in $excludeFiles) {
            if ($_.Name -like $f) { $excluded = $true; break }
        }
    }
    -not $excluded -and $_.Length -lt 10000000
}
Write-Host "Found $($allFiles.Count) files to upload"

$treeItems = @()
$uploaded = 0
$failed = 0

foreach ($file in $allFiles) {
    $relPath = $file.FullName.Substring($sourceDir.Length + 1).Replace('\', '/')
    
    try {
        $content = [System.IO.File]::ReadAllBytes($file.FullName)
        $base64 = [Convert]::ToBase64String($content)
        
        $blobBody = @{encoding = "base64"; content = $base64} | ConvertTo-Json -Depth 3
        $blob = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/blobs" -Method Post -Headers $headers -Body $blobBody -ContentType "application/json; charset=utf-8"
        
        $treeItems += @{path = $relPath; mode = "100644"; type = "blob"; sha = $blob.sha}
        $uploaded++
        
        if ($uploaded % 10 -eq 0) {
            Write-Host "Uploaded $uploaded / $($allFiles.Count) files..."
        }
    } catch {
        Write-Host "FAILED: $relPath - $($_.Exception.Message)"
        $failed++
    }
}

Write-Host "Uploaded: $uploaded, Failed: $failed"
Write-Host "Creating tree and commit..."

$mainBranch = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/heads/main" -Headers $headers
$baseTreeSha = $mainBranch.object.sha

$treeBody = @{base_tree = $baseTreeSha; tree = $treeItems} | ConvertTo-Json -Depth 5 -Compress
$tree = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/trees" -Method Post -Headers $headers -Body $treeBody -ContentType "application/json; charset=utf-8"

$commitBody = @{message = "Initial commit - TOPTIER app"; tree = $tree.sha; parents = @($mainBranch.object.sha)} | ConvertTo-Json -Depth 3
$commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/commits" -Method Post -Headers $headers -Body $commitBody -ContentType "application/json; charset=utf-8"

$updateRefBody = @{sha = $commit.sha} | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/heads/main" -Method Patch -Headers $headers -Body $updateRefBody -ContentType "application/json"

Write-Host "DONE! https://github.com/mulungiallan/TOPTIER-APP"
