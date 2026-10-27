# Staged X904 SDK group executor. Not installed or scheduled on VMSC.
# Reads one trusted command as JSON from stdin. Never prints personal data or credentials.
param([switch]$ExecuteClaimed)
$ErrorActionPreference='Stop'
$mutex=$null;$owned=$false;$zk=$null;$connected=$false
function Require([bool]$ok,[string]$code){if(!$ok){throw $code}}
try {
  $raw=[Console]::In.ReadToEnd()
  Require ($raw.Length -gt 0 -and $raw.Length -lt 16384) 'INVALID_INPUT'
  $cfg=$raw|ConvertFrom-Json -ErrorAction Stop
  $cmd=$cfg.command
  Require ($cfg.deviceIp -ceq '192.168.100.185' -and $cfg.deviceSerial -ceq 'TDBD234200545' -and $cfg.sendEnabled -ceq 'false' -and $cfg.userWriteEnabled -ceq 'true') 'LOCAL_GUARD_FAILED'
  Require ($cfg.manualAccessEnabled -ceq 'true') 'MANUAL_ACCESS_DISABLED'
  Require ($cmd.deviceSerial -ceq 'TDBD234200545' -and [string]$cmd.commandId -match '^[a-fA-F0-9-]{36}$' -and [string]$cmd.leaseToken -match '^[a-fA-F0-9-]{36}$') 'NO_TRUSTED_LEASE'
  Require (@('SUSPEND_USER','ACTIVATE_USER') -ccontains [string]$cmd.commandType) 'COMMAND_DENIED'
  Require ([string]$cmd.userPin -cmatch '^[0-9]{1,8}$' -and [int]$cmd.userPin -gt 0) 'INVALID_PIN'
  Require ([int]$cmd.payload.expectedUid -gt 0 -and [int]$cmd.payload.expectedUid -lt 65535 -and [string]$cmd.payload.expectedName -cmatch '^[A-Za-z0-9 ._-]{1,24}$') 'EXPECTED_IDENTITY_REQUIRED'
  Require ([string]$cfg.commKey -match '^[0-9]{1,10}
  if(-not $ExecuteClaimed){[Console]::WriteLine('{"dryRun":true,"readBackConfirmed":false,"errorCode":null}');exit 0}
  $mutex=New-Object System.Threading.Mutex($false,'Global\X904_VMSC_PRIMARY_SYNC')
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true}
  Require $owned 'DEVICE_BUSY'
  $zk=New-Object -ComObject zkemkeeper.ZKEM.1
  $zk.PullMode=1
  $key=[uint32]::Parse([string]$cfg.commKey)
  $zk.SetCommPassword([BitConverter]::ToInt32([BitConverter]::GetBytes($key),0))|Out-Null
  $connected=[bool]$zk.Connect_Net([string]$cfg.deviceIp,4370)
  Require $connected 'CONNECT_FAILED'
  Require ([bool]$zk.ReadAllUserID(1)) 'READ_USERS_FAILED'
  $pin='';$name='';$pw='';$priv=0;$enabled=$false
  $matches=0;$count=0
  while($zk.SSR_GetAllUserInfo(1,[ref]$pin,[ref]$name,[ref]$pw,[ref]$priv,[ref]$enabled)){
    $count++
    if($pin -ceq [string]$cmd.userPin){
      $matches++
      Require ($name -ceq [string]$cmd.payload.expectedName -and $priv -eq 0) 'TARGET_CHANGED_REVIEW_REQUIRED'
    }
  }
  Require ($count -gt 0 -and $count -le 10000 -and $matches -eq 1) 'PIN_MISSING_OR_AMBIGUOUS'
  # Fail closed until an authenticated UID-to-PIN snapshot is independently
  # checked by the queue worker, not supplied by the browser or job payload.
  Require $false 'WORKER_UID_ATTESTATION_NOT_IMPLEMENTED'
} catch {
  $code=[string]$_.Exception.Message
  if($code -cnotmatch '^[A-Z0-9_]{1,64}$'){$code='EXECUTION_FAILED'}
  [Console]::WriteLine(('{0}' -f (@{readBackConfirmed=$false;errorCode=$code}|ConvertTo-Json -Compress)))
  exit 1
} finally {
  if($connected){try{$zk.Disconnect()|Out-Null}catch{}}
  if($null -ne $zk){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($zk)}catch{}}
  if($owned){$mutex.ReleaseMutex()}
  if($null -ne $mutex){$mutex.Dispose()}
}
) 'AUTH_CONFIGURATION_MISSING'
  Require ([int]$cmd.payload.expectedUid -eq [int]$cfg.verifiedUid -and [string]$cfg.verifiedPin -ceq [string]$cmd.userPin -and [string]$cfg.verifiedName -ceq [string]$cmd.payload.expectedName) 'UID_VERIFICATION_REQUIRED'
  if(-not $ExecuteClaimed){[Console]::WriteLine('{"dryRun":true,"readBackConfirmed":false,"errorCode":null}');exit 0}
  $mutex=New-Object System.Threading.Mutex($false,'Global\X904_VMSC_PRIMARY_SYNC')
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true}
  Require $owned 'DEVICE_BUSY'
  $zk=New-Object -ComObject zkemkeeper.ZKEM.1
  $zk.PullMode=1
  $key=[uint32]::Parse([string]$cfg.commKey)
  $zk.SetCommPassword([BitConverter]::ToInt32([BitConverter]::GetBytes($key),0))|Out-Null
  $connected=[bool]$zk.Connect_Net([string]$cfg.deviceIp,4370)
  Require $connected 'CONNECT_FAILED'
  Require ([bool]$zk.ReadAllUserID(1)) 'READ_USERS_FAILED'
  $pin='';$name='';$pw='';$priv=0;$enabled=$false
  $matches=0;$count=0
  while($zk.SSR_GetAllUserInfo(1,[ref]$pin,[ref]$name,[ref]$pw,[ref]$priv,[ref]$enabled)){
    $count++
    if($pin -ceq [string]$cmd.userPin){
      $matches++
      Require ($name -ceq [string]$cmd.payload.expectedName -and $priv -eq 0) 'TARGET_CHANGED_REVIEW_REQUIRED'
    }
  }
  Require ($count -gt 0 -and $count -le 10000 -and $matches -eq 1) 'PIN_MISSING_OR_AMBIGUOUS'
  # SDK GetUserGroup takes user PIN, not UID. UID must be cross-checked by
  # authenticated CUD snapshot before this helper is eligible for production.
  Require $false 'UID_VERIFICATION_NOT_IMPLEMENTED'
} catch {
  $code=[string]$_.Exception.Message
  if($code -cnotmatch '^[A-Z0-9_]{1,64}$'){$code='EXECUTION_FAILED'}
  [Console]::WriteLine(('{0}' -f (@{readBackConfirmed=$false;errorCode=$code}|ConvertTo-Json -Compress)))
  exit 1
} finally {
  if($connected){try{$zk.Disconnect()|Out-Null}catch{}}
  if($null -ne $zk){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($zk)}catch{}}
  if($owned){$mutex.ReleaseMutex()}
  if($null -ne $mutex){$mutex.Dispose()}
}
