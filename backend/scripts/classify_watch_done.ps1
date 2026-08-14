# Watches the evidence-classification backfill and pops a message box when
# ALL shard loops have exited. Runs detached — safe to close every window.
#   powershell -ExecutionPolicy Bypass -File backend\scripts\classify_watch_done.ps1
$backend = Split-Path -Parent $PSScriptRoot
while ($true) {
    Start-Sleep -Seconds 120
    $loops = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'classify_all_evidence' }
    if (-not $loops) { break }
}
$lines = foreach ($s in 0, 1, 2) {
    $log = Join-Path $backend "classify_backfill_shard$s.log"
    if (Test-Path $log) { "--- shard $s ---"; Get-Content $log -Tail 2 }
}
$msg = "Evidence classification backfill has STOPPED (finished or exited).`n$(Get-Date)`n`n" + ($lines -join "`n")
$msg | Out-File (Join-Path $backend "classify_backfill_DONE.txt") -Encoding utf8
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show($msg, "LMS: Evidence classification DONE", 0, 64) | Out-Null
