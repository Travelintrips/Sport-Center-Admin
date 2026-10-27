param([switch]$SelfTest)
$ErrorActionPreference='Stop'
$base='C:\SportCenter-X904-Gateway'
$log=Join-Path $base 'logs\x904-user-command-worker.log'
function Report([string]$s) { Add-Content $log ('{0} {1}' -f (Get-Date -Format o),$s) }
$node='C:\Program Files\nodejs\node.exe'
$executor=Join-Path $base 'migration\x904-vmsc-user-command-executor.mjs'
if($SelfTest) {
  Push-Location $base
  try { '{}' | & $node $executor; exit $LASTEXITCODE }
  finally { Pop-Location }
}
$mutex=New-Object System.Threading.Mutex($false,'Global\SportCenterX904UserCommandWorker')
if(-not $mutex.WaitOne(0)) { Report 'SKIP_RUNNING';exit 0 }
try {
  $e=@{}
  Get-Content (Join-Path $base '.env') | Where-Object {$_ -match '^[A-Z0-9_]+='} | ForEach-Object {$a=$_.Split('=',2);$e[$a[0]]=$a[1]}
  if($e['X904_SEND_ENABLED'] -ne 'false' -or $e['X904_DEVICE_IP'] -ne '192.168.100.185' -or $e['X904_DEVICE_SERIAL'] -ne 'TDBD234200545') {throw 'LOCAL_GUARD_FAILED'}
  if($e['X904_USER_WRITE_ENABLED'] -ne 'true') {Report 'USER_WRITE_DISABLED';exit 0}
  $credentialFile=Join-Path $base 'secrets\x904-evidence-machine.dpapi'
  if(-not(Test-Path $credentialFile)) {throw 'CREDENTIAL_NOT_CONFIGURED'}
  Add-Type -AssemblyName System.Security
  $cipher=[Convert]::FromBase64String((Get-Content $credentialFile -Raw).Trim())
  $clear=[System.Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,$null,[System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  $env:PGPASSWORD=[Text.Encoding]::UTF8.GetString($clear)
  [Array]::Clear($clear,0,$clear.Length)
  $psql='C:\Program Files\PostgreSQL\17\bin\psql.exe'
  $conn='host=aws-1-ap-southeast-2.pooler.supabase.com port=5432 dbname=postgres user=x904_vmsc_evidence_login.nzdweipzckfszczzqtuw sslmode=verify-full sslrootcert=C:/Users/Admin/Downloads/prod-ca-2021.crt connect_timeout=15'
  $who=& $psql $conn -X -w -t -A -v ON_ERROR_STOP=1 -c 'SELECT current_user;' 2>&1
  if($LASTEXITCODE -ne 0 -or (($who|Out-String).Trim() -ne 'x904_vmsc_evidence_login')) {throw 'DB_ROLE_GUARD_FAILED'}
  $claim=& $psql $conn -X -w -t -A -v ON_ERROR_STOP=1 -c "SELECT coalesce(sport_center.x904_claim_user_command()::text,'null');" 2>&1
  if($LASTEXITCODE -ne 0) {throw 'DB_CLAIM_UNAVAILABLE'}
  $text=($claim|Out-String).Trim()
  if($text -eq 'null' -or $text -eq '') {Report 'IDLE';exit 0}
  $job=$text|ConvertFrom-Json -ErrorAction Stop
  $id=[string]$job.commandId; $lease=[string]$job.leaseToken
  if($id -notmatch '^[a-fA-F0-9-]{36}$' -or $lease -notmatch '^[a-fA-F0-9-]{36}$' -or $job.deviceSerial -ne 'TDBD234200545') {throw 'CLAIM_SHAPE_INVALID'}
  $isGroup=@('SUSPEND_USER','ACTIVATE_USER') -ccontains [string]$job.commandType
  if($isGroup -and $e['X904_MANUAL_ACCESS_ENABLED'] -ne 'true') {
    throw 'MANUAL_ACCESS_DISABLED'
  }
  $cfg=@{deviceIp=$e['X904_DEVICE_IP'];deviceSerial=$e['X904_DEVICE_SERIAL'];
    sendEnabled=$e['X904_SEND_ENABLED'];userWriteEnabled=$e['X904_USER_WRITE_ENABLED'];
    manualAccessEnabled=$e['X904_MANUAL_ACCESS_ENABLED'];
    commKey=$e['X904_DEVICE_COMM_KEY'];command=$job}|ConvertTo-Json -Depth 9 -Compress
  Push-Location $base
  try {
    if($isGroup) {
      $groupExecutor=Join-Path $base 'migration\x904-vmsc-group-executor-stage.ps1'
      if(-not(Test-Path $groupExecutor)){throw 'GROUP_EXECUTOR_UNAVAILABLE'}
      $output=$cfg | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $groupExecutor -ExecuteClaimed 2>&1
      $nodeExit=$LASTEXITCODE
    } else {
      $output=$cfg | & $node $executor --execute-claimed 2>&1
      $nodeExit=$LASTEXITCODE
    }
  } finally {Pop-Location}
  $result=$null
  try {$result=([string]($output|Select-Object -Last 1))|ConvertFrom-Json -ErrorAction Stop}catch{}
  $ok=($nodeExit -eq 0 -and $null -ne $result -and $result.readBackConfirmed -eq $true)
  $uid='NULL';$before='NULL';$after='NULL'
  if($null -ne $result){
    if($result.deviceUid -is [int] -and $result.deviceUid -gt 0 -and $result.deviceUid -lt 65535){$uid=[string]$result.deviceUid}
    if($result.beforeCount -is [int] -and $result.beforeCount -ge 0 -and $result.beforeCount -le 10000){$before=[string]$result.beforeCount}
    if($result.afterCount -is [int] -and $result.afterCount -ge 0 -and $result.afterCount -le 10000){$after=[string]$result.afterCount}
  }
  $errorCode='EXECUTOR_UNAVAILABLE'
  if($null -ne $result -and [string]$result.errorCode -match '^[A-Z0-9_]{1,64}$'){$errorCode=[string]$result.errorCode}
  $success=if($ok){'true'}else{'false'}
  $err=if($ok){'NULL'}else{"'$errorCode'"}
  if($isGroup) {
    $gBefore='NULL';$gAfter='NULL'
    if($null -ne $result) {
      if($result.beforeGroup -is [int] -and $result.beforeGroup -in @(1,2)){$gBefore=[string]$result.beforeGroup}
      if($result.afterGroup -is [int] -and $result.afterGroup -in @(1,2)){$gAfter=[string]$result.afterGroup}
    }
    $ackSql="SELECT sport_center.x904_complete_group_command('$id'::uuid,'$lease'::uuid,$success,$uid,$before,$after,$gBefore,$gAfter,$err);"
  } else {
    $ackSql="SELECT sport_center.x904_complete_user_command('$id'::uuid,'$lease'::uuid,$success,$uid,$before,$after,$err);"
  }
  $ack=& $psql $conn -X -w -t -A -v ON_ERROR_STOP=1 -c $ackSql 2>&1
  if($LASTEXITCODE -eq 0 -and (($ack|Out-String).Trim() -eq 't')){
    Report ('COMMAND_ACK command='+$id+' readback='+$success)
  }else{Report ('COMMAND_ACK_FAILED command='+$id);exit 2}
} catch {
  Report ('WORKER_FAILED reason='+($_.Exception.Message -replace '[^A-Z0-9_]',''))
  exit 1
} finally {
  $env:PGPASSWORD=$null
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
