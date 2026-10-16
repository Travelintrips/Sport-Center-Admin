$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'GymCST\X904'
$reader = Join-Path $base 'probe\x904-almano-prod-runner.ps1'
$folder = Join-Path $base 'tunnel'
$log = Join-Path $folder 'x904-prod-autosync.log'
$stateFile = Join-Path $folder 'x904-prod-autosync-state.json'
$mutex = New-Object System.Threading.Mutex($false,'Local\GymCST_X904_ProdAutoSync')
$owned = $false
function Write-StateLog([string]$msg) {
  Add-Content -LiteralPath $log -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')+' '+$msg)
  if((Get-Item -LiteralPath $log).Length -gt 65536) {
    $last = Get-Content -LiteralPath $log -Tail 100
    [IO.File]::WriteAllLines($log,[string[]]$last,[Text.UTF8Encoding]::new($false))
  }
}
function Device-Counts([string]$response) {
  $u=[regex]::Match($response,'device_user_count=(\d+)')
  $l=[regex]::Match($response,'device_log_count=(\d+)')
  if(!$u.Success -or !$l.Success) { throw 'DEVICE_COUNT_MISSING' }
  return @{users=[int]$u.Groups[1].Value;logs=[int]$l.Groups[1].Value}
}
function Invoke-PhysicalSnapshot([bool]$fullSync) {
  for($attempt=1;$attempt -le 3;$attempt++) {
    $result=''
    $originalAction=$ErrorActionPreference
    try {
      $ErrorActionPreference='Continue'
      if($fullSync) {
        $result=@(& $reader -Sync 2>&1 | ForEach-Object { "$_" }) -join [Environment]::NewLine
      } else {
        $result=@(& $reader 2>&1 | ForEach-Object { "$_" }) -join [Environment]::NewLine
      }
    } catch {
      Write-StateLog ('DEVICE_EXCEPTION attempt='+$attempt+' kind='+$_.Exception.GetType().Name)
    } finally {
      $ErrorActionPreference=$originalAction
    }
    $authenticated=($result -match 'read_authenticated=true')
    $verified=if($fullSync) { $result -match 'durable_database_ack=true' } else {
      $result -match 'mode=dry-run; no network upload; machine unchanged'
    }
    if($authenticated -and $verified) { return $result }
    $cause='NO_VALID_RESULT'
    if($result -match 'FAILED_STAGE=([A-Za-z_-]+)') { $cause='DEVICE_'+$Matches[1] }
    Write-StateLog ('DEVICE_RETRY attempt='+$attempt+' code='+$cause)
    if($attempt -lt 3) { Start-Sleep -Seconds 15 }
  }
  throw 'PHYSICAL_X904_RETRIES_EXHAUSTED'
}
try {
  try { $owned=$mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $owned=$true }
  if(!$owned) { return }
  Write-StateLog 'AUTO_SYNC_SERVICE_STARTED'
  while($true) {
    $step='read'
    try {
      $read=Invoke-PhysicalSnapshot $false
      $counts=Device-Counts $read
      $step='state'
      $saved=$null
      if(Test-Path -LiteralPath $stateFile) {
        try { $saved=Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json }
        catch { $saved=$null }
      }
      if($saved -and $counts.logs -lt $saved.logs) { throw 'DEVICE_LOG_COUNT_DECREASED' }
      $fresh=$false
      if($saved -and $saved.target -eq 'PROD' -and $saved.users -eq $counts.users -and
         $saved.logs -eq $counts.logs) {
        $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($saved.last_ack_utc)).TotalHours
        $fresh=($age -ge 0 -and $age -lt 24)
      }
      if($fresh) {
        Write-StateLog ('UP_TO_DATE users='+$counts.users+' logs='+$counts.logs)
      } else {
        $step='sync'
        Write-StateLog ('SYNC_STARTED users='+$counts.users+' logs='+$counts.logs)
        $reply=Invoke-PhysicalSnapshot $true
        $receipt=Device-Counts $reply
        if($reply -notmatch ('stored_users='+$receipt.users) -or
           $reply -notmatch ('stored_logs='+$receipt.logs)) { throw 'DURABLE_ACK_COUNT_MISMATCH' }
        $state=@{target='PROD';users=$receipt.users;logs=$receipt.logs;
                 last_ack_utc=[DateTimeOffset]::UtcNow.ToString('o')}
        $tempFile=$stateFile+'.tmp'
        [IO.File]::WriteAllText($tempFile,($state | ConvertTo-Json -Compress),
          [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $tempFile -Destination $stateFile -Force
        Write-StateLog ('DURABLE_ACK_PASS users='+$receipt.users+' logs='+$receipt.logs)
      }
    } catch {
      $code='RETRY_LATER'
      if($_.Exception.Message -match 'PHYSICAL_X904_RETRIES_EXHAUSTED') { $code='DEVICE_READ_EXHAUSTED' }
      elseif($_.Exception.Message -match 'DEVICE_LOG_COUNT_DECREASED') { $code='LOG_COUNT_DECREASED' }
      elseif($_.Exception.Message -match 'DURABLE_ACK_COUNT_MISMATCH') { $code='ACK_COUNT_MISMATCH' }
      Write-StateLog ('SYNC_RETRY_NEXT_CYCLE stage='+$step+' code='+$code)
    }
    Start-Sleep -Seconds 1800
  }
} finally {
  if($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
