# Staged X904 durable-delete worker. NEVER schedule until E2E + security approval.
# One leased command per invocation; fail closed, no automatic replay.
param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$base = 'C:\SportCenter-X904-Gateway'
$log = Join-Path $base 'logs\x904-durable-delete-worker.log'
$node = 'C:\Program Files\nodejs\node.exe'
$executor = Join-Path $base 'migration\x904-vmsc-user-command-executor.mjs'
function Report([string]$code) {
  Add-Content -LiteralPath $log -Value ('{0} {1}' -f (Get-Date -Format o),$code)
}
if ($SelfTest) {
  Push-Location $base
  try {
    '{}' | & $node $executor
    exit $LASTEXITCODE
  } finally { Pop-Location }
}
$mutex = [System.Threading.Mutex]::new($false,'Global\SportCenterX904UserCommandWorker')
$locked = $false
try {
  $locked = $mutex.WaitOne(0)
  if (-not $locked) { Report 'SKIP_RUNNING'; exit 0 }
  $envFile = Join-Path $base '.env'
  $e = @{}
  Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^[A-Z0-9_]+=' } |
    ForEach-Object { $parts=$_.Split('=',2); $e[$parts[0]]=$parts[1] }
  if ($e['X904_DEVICE_IP'] -ne '192.168.100.185' -or
      $e['X904_DEVICE_SERIAL'] -ne 'TDBD234200545' -or
      $e['X904_SEND_ENABLED'] -ne 'false') { throw 'LOCAL_GUARD_FAILED' }
  if ($e['X904_USER_WRITE_ENABLED'] -ne 'true' -or
      $e['X904_BULK_DELETE_ENABLED'] -ne 'true') {
    Report 'BULK_DELETE_DISABLED'
    exit 0
  }
  $credentialFile = Join-Path $base 'secrets\x904-evidence-machine.dpapi'
  if (-not (Test-Path -LiteralPath $credentialFile)) { throw 'CREDENTIAL_NOT_CONFIGURED' }
  Add-Type -AssemblyName System.Security
  $cipher = [Convert]::FromBase64String((Get-Content -LiteralPath $credentialFile -Raw).Trim())
  $clear = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,$null,[System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  try { $env:PGPASSWORD = [Text.Encoding]::UTF8.GetString($clear) }
  finally { [Array]::Clear($clear,0,$clear.Length) }
  $psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
  $conn = 'host=aws-1-ap-southeast-2.pooler.supabase.com port=5432 dbname=postgres user=x904_vmsc_evidence_login.nzdweipzckfszczzqtuw sslmode=verify-full sslrootcert=C:/Users/Admin/Downloads/prod-ca-2021.crt connect_timeout=15'
  $who = & $psql $conn -X -w -t -A -v ON_ERROR_STOP=1 -c 'SELECT current_user;' 2>&1
  if ($LASTEXITCODE -ne 0 -or ($who | Out-String).Trim() -ne 'x904_vmsc_evidence_login') {
    throw 'DB_ROLE_GUARD_FAILED'
  }
  $claim = & $psql $conn -X -w -t -A -v ON_ERROR_STOP=1 -c "SELECT coalesce(sport_center.x904_claim_batch_delete_command()::text,'null');" 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'DB_CLAIM_UNAVAILABLE' }
  $claimText = ($claim | Out-String).Trim()
  if ($claimText -eq 'null' -or $claimText -eq '') { Report 'IDLE'; exit 0 }
  $job = $claimText | ConvertFrom-Json -ErrorAction Stop
  if ([string]$job.commandType -ne 'DELETE_USER' -or
      [string]$job.userPin -notmatch '^[0-9]{1,8}$' -or
      [string]$job.payload.expectedName -notmatch '^[A-Za-z0-9 ._-]{2,24}$' -or
      [int]$job.payload.expectedUid -lt 1 -or [int]$job.payload.expectedUid -gt 65534) {
    throw 'BATCH_TARGET_NOT_ALLOWED'
  }
  $id = [string]$job.commandId
  $lease = [string]$job.leaseToken
  if ($id -notmatch '^[0-9a-fA-F-]{36}$' -or
      $lease -notmatch '^[0-9a-fA-F-]{36}$' -or
      [string]$job.deviceSerial -ne 'TDBD234200545') { throw 'CLAIM_SHAPE_INVALID' }
  $cfg = @{
    deviceIp=$e['X904_DEVICE_IP'];deviceSerial=$e['X904_DEVICE_SERIAL']
    sendEnabled=$e['X904_SEND_ENABLED'];userWriteEnabled=$e['X904_USER_WRITE_ENABLED']
    commKey=$e['X904_DEVICE_COMM_KEY'];command=$job
  } | ConvertTo-Json -Depth 9 -Compress
  Push-Location $base
  try {
    $output = $cfg | & $node $executor --execute-claimed 2>&1
    $nodeExit = $LASTEXITCODE
  } finally { Pop-Location }
  $result = $null
  try { $result = [string]($output | Select-Object -Last 1) | ConvertFrom-Json -ErrorAction Stop } catch {}
  $ok = ($nodeExit -eq 0 -and $null -ne $result -and $result.readBackConfirmed -eq $true)
  $uid='NULL'; $before='NULL'; $after='NULL'
  if ($null -ne $result) {
    if ([string]$result.deviceUid -match '^[0-9]{1,5}$' -and [long]$result.deviceUid -gt 0 -and [long]$result.deviceUid -lt 65535) {
      $uid=[string]$result.deviceUid
    }
    if ([string]$result.beforeCount -match '^[0-9]{1,5}$' -and [long]$result.beforeCount -ge 1 -and [long]$result.beforeCount -le 10000) {
      $before=[string]$result.beforeCount
    }
    if ([string]$result.afterCount -match '^[0-9]{1,5}$' -and [long]$result.afterCount -ge 0 -and [long]$result.afterCount -le 10000) {
      $after=[string]$result.afterCount
    }
  }
  $errorCode='EXECUTOR_UNAVAILABLE'
  if ($null -ne $result -and [string]$result.errorCode -match '^[A-Z0-9_]{1,64}$') {
    $errorCode=[string]$result.errorCode
  }
  $success=if($ok){'true'}else{'false'}
  $err=if($ok){'NULL'}else{"'$errorCode'"}
  $ackSql="SELECT sport_center.x904_complete_batch_delete_command('$id'::uuid,'$lease'::uuid,$success,$uid,$before,$after,$err);"
  $ack = & $psql $conn -X -w -t -A -v ON_ERROR_STOP=1 -c $ackSql 2>&1
  if ($LASTEXITCODE -eq 0 -and ($ack | Out-String).Trim() -eq 't') {
    Report ('COMMAND_ACK command='+$id+' readback='+$success)
  } else {
    Report ('COMMAND_ACK_FAILED command='+$id)
    exit 2
  }
} catch {
  Report 'WORKER_FAILED_REVIEW_REQUIRED'
  exit 1
} finally {
  $env:PGPASSWORD=$null
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
