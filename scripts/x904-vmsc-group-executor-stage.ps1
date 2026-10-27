# X904 group access executor. Stage only: no scheduling or PROD activation.
param([switch]$ExecuteClaimed)
$ErrorActionPreference='Stop'
$mutex=$null;$owned=$false;$zk=$null;$connected=$false
function Require([bool]$ok,[string]$code){if(-not $ok){throw $code}}
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
  Require ([string]$cfg.commKey -match '^[0-9]{1,10}$') 'AUTH_CONFIGURATION_MISSING'
  if(-not $ExecuteClaimed){
    [Console]::WriteLine('{"dryRun":true,"readBackConfirmed":false,"errorCode":null}')
    exit 0
  }
  $mutex=New-Object System.Threading.Mutex($false,'Global\X904_VMSC_PRIMARY_SYNC')
  try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true}
  Require $owned 'DEVICE_BUSY'
  # UID proof is obtained locally, inside the same machine mutex, immediately
  # before opening the SDK session. No browser-supplied attestation is accepted.
  $node='C:\Program Files\nodejs\node.exe'
  $attestor=Join-Path $PSScriptRoot 'x904-vmsc-group-uid-attestor.mjs'
  Require ((Test-Path $node) -and (Test-Path $attestor)) 'ATTESTOR_UNAVAILABLE'
  $proofInput=$cfg|ConvertTo-Json -Depth 12 -Compress
  $proofOutput=$proofInput | & $node $attestor 2>&1
  $proofExit=$LASTEXITCODE
  $proof=$null
  try {$proof=([string]($proofOutput|Select-Object -Last 1))|ConvertFrom-Json -ErrorAction Stop}catch{}
  Require ($proofExit -eq 0 -and $null -ne $proof -and $proof.uidAttestedByWorker -eq $true) 'UID_ATTESTATION_FAILED'
  Require ([int]$proof.verifiedUid -eq [int]$cmd.payload.expectedUid -and
    [string]$proof.verifiedPin -ceq [string]$cmd.userPin -and
    [string]$proof.verifiedName -ceq [string]$cmd.payload.expectedName) 'UID_ATTESTATION_REQUIRED'
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
  Require ($count -gt 0 -and $count -le 10000 -and $matches -eq 1 -and $count -eq [int]$proof.userCount) 'USER_SNAPSHOT_CHANGED'
  $before=0
  Require ([bool]$zk.GetUserGroup(1,[int]$cmd.userPin,[ref]$before)) 'GROUP_READ_FAILED'
  Require (@(1,2) -contains $before) 'UNEXPECTED_ACCESS_GROUP'
  $desired=if($cmd.commandType -ceq 'SUSPEND_USER'){2}else{1}
  # Group 2 must never be included in any door unlock combination.
  if($desired -eq 2){
    for($i=1;$i -le 10;$i++){
      $a=0;$b=0;$c=0;$d=0;$e=0
      Require ([bool]$zk.SSR_GetUnLockGroup(1,$i,[ref]$a,[ref]$b,[ref]$c,[ref]$d,[ref]$e)) 'UNLOCK_COMBINATION_READ_FAILED'
      Require (-not (@($a,$b,$c,$d,$e) -contains 2)) 'SUSPEND_GROUP_CAN_UNLOCK'
    }
  }
  if($before -ne $desired){
    Require ([bool]$zk.SetUserGroup(1,[int]$cmd.userPin,$desired)) 'SET_GROUP_FAILED'
  }
  $after=0
  Require ([bool]$zk.GetUserGroup(1,[int]$cmd.userPin,[ref]$after) -and $after -eq $desired) 'GROUP_READBACK_MISMATCH'
  [Console]::WriteLine((@{readBackConfirmed=$true;deviceUid=[int]$cmd.payload.expectedUid;beforeCount=$count;afterCount=$count;beforeGroup=$before;afterGroup=$after;errorCode=$null}|ConvertTo-Json -Compress))
} catch {
  $code=[string]$_.Exception.Message
  if($code -cnotmatch '^[A-Z0-9_]{1,64}$'){$code='EXECUTION_FAILED'}
  [Console]::WriteLine((@{readBackConfirmed=$false;errorCode=$code}|ConvertTo-Json -Compress))
  exit 1
} finally {
  if($connected){try{$zk.Disconnect()|Out-Null}catch{}}
  if($null -ne $zk){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($zk)}catch{}}
  if($owned){$mutex.ReleaseMutex()}
  if($null -ne $mutex){$mutex.Dispose()}
}
