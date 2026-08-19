# Classify ALL learner evidence from content, batch by batch, until done.
# Independent of Claude Code / VS Code — run from any PowerShell window:
#   powershell -ExecutionPolicy Bypass -File backend\scripts\classify_all_evidence.ps1
# Parallel run (3 disjoint shards, ~3x throughput — separate processes dodge
# the single-process thread ceiling):
#   ... -File classify_all_evidence.ps1 -Shard 0 -Shards 3
#   ... -File classify_all_evidence.ps1 -Shard 1 -Shards 3
#   ... -File classify_all_evidence.ps1 -Shard 2 -Shards 3
# Progress log: backend\classify_backfill[_shardN].log  (idempotent — safe to re-run)
param([int]$Shard = 0, [int]$Shards = 1, [int]$Workers = 10, [int]$Limit = 500)
$backend = Split-Path -Parent $PSScriptRoot
Set-Location $backend
$suffix = if ($Shards -gt 1) { "_shard$Shard" } else { "" }
$log = Join-Path $backend "classify_backfill$suffix.log"
"=== backfill started $(Get-Date) (shard $Shard/$Shards, workers $Workers, limit $Limit) ===" | Out-File $log -Append -Encoding utf8
$allFailStreak = 0
while ($true) {
    # 10 workers per process: measured sweet spot — more threads in ONE python
    # just time out (GIL + fitz rendering), hence shards for real parallelism.
    $out = & .\.venv\Scripts\python.exe -X utf8 manage.py classify_evidence --limit $Limit --workers $Workers --shard $Shard --shards $Shards 2>&1 | Out-String
    "$(Get-Date -Format HH:mm:ss) " + ($out -split "`n" | Where-Object { $_ -match "processed=" } | Select-Object -First 1) | Out-File $log -Append -Encoding utf8
    $out | Out-File ($log -replace "\.log$", ".detail.log") -Append -Encoding utf8
    if ($out -match "batch of 0") { break }
    # Only permanently-failing items left (bad blobs): stop instead of
    # retrying them forever. They stay unclassified and visible in the log.
    if ($out -match "processed=0 failed=[1-9]") { $allFailStreak++ } else { $allFailStreak = 0 }
    if ($allFailStreak -ge 5) {
        "=== giving up: only permanently-failing items remain ===" | Out-File $log -Append -Encoding utf8
        break
    }
    # Network hiccup or rate limit: brief pause, failed items retry next loop.
    if ($out -match "failed=[1-9]") { Start-Sleep -Seconds 20 } else { Start-Sleep -Seconds 2 }
}
"=== backfill FINISHED $(Get-Date) (shard $Shard/$Shards) ===" | Out-File $log -Append -Encoding utf8
