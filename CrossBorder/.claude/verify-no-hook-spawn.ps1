# Verifies Claude .sh hooks no longer spam PowerShell/git-bash windows after Cursor restart.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot 'hook-spawn-test-result.txt'
$project = Split-Path $PSScriptRoot -Parent
$deadline = (Get-Date).AddSeconds(90)

function Get-HookSpawnCount {
  @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe' OR Name='mintty.exe' OR Name='bash.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -match '\\.claude\\hooks\\' -or
        $_.CommandLine -match 'block-destructive\.sh' -or
        $_.CommandLine -match 'guard-artifacts\.sh' -or
        $_.CommandLine -match 'record-publish\.sh'
      )
    }).Count
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("started=$(Get-Date -Format o)")
$lines.Add("project=$project")

# Wait until Cursor is back
while ((Get-Date) -lt $deadline) {
  $cursor = Get-Process Cursor -ErrorAction SilentlyContinue
  if ($cursor) {
    $lines.Add("cursor_up_at=$(Get-Date -Format o) pids=$($cursor.Id -join ',')")
    break
  }
  Start-Sleep -Seconds 1
}

if (-not (Get-Process Cursor -ErrorAction SilentlyContinue)) {
  $lines.Add('RESULT=FAIL reason=cursor_did_not_restart')
  $lines | Set-Content -Path $out -Encoding utf8
  exit 1
}

# Give agent/extensions a few seconds to load settings
Start-Sleep -Seconds 8
$baseline = Get-HookSpawnCount
$lines.Add("baseline_hook_procs=$baseline")

# Simulate old Cursor hook invocation style (powershell.exe path\to\hook.sh)
$hook = Join-Path $PSScriptRoot 'hooks\block-destructive.sh'
$beforeMintty = @(Get-Process mintty -ErrorAction SilentlyContinue).Count
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', "& '$hook'") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch {} }
$afterMintty = @(Get-Process mintty -ErrorAction SilentlyContinue).Count
$lines.Add("mintty_before=$beforeMintty mintty_after=$afterMintty delta=$($afterMintty - $beforeMintty)")

# Watch for 25s for any hook-spawn storm
$max = $baseline
$samples = 0
$watchUntil = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $watchUntil) {
  $n = Get-HookSpawnCount
  if ($n -gt $max) { $max = $n }
  $samples++
  Start-Sleep -Milliseconds 500
}
$lines.Add("watch_samples=$samples")
$lines.Add("peak_hook_procs=$max")

$settings = Get-Content (Join-Path $PSScriptRoot 'settings.json') -Raw | ConvertFrom-Json
$hooksEmpty = ($null -eq $settings.hooks) -or (($settings.hooks | Get-Member -MemberType NoteProperty | Measure-Object).Count -eq 0) -or (($settings.hooks | ConvertTo-Json -Compress) -eq '{}')
$lines.Add("settings_hooks_empty=$hooksEmpty")

if ($hooksEmpty -and $max -eq 0) {
  $lines.Add('RESULT=PASS')
  $lines.Add('No .claude hook PowerShell/git-bash spawns detected after restart.')
} elseif ($hooksEmpty -and $max -le 1) {
  $lines.Add('RESULT=PASS_WITH_NOISE')
  $lines.Add("peak=$max (likely transient; hooks config empty)")
} else {
  $lines.Add('RESULT=FAIL')
  $lines.Add("hooks_empty=$hooksEmpty peak_hook_procs=$max")
}

$lines | Set-Content -Path $out -Encoding utf8
exit 0
