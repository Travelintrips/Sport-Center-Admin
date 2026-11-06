param([switch]$ExecuteClaimed, [switch]$SelfTest)
# Staged deny-first enrollment executor; NOT installed on VMSC until gated test.
$ErrorActionPreference='Stop'
if($SelfTest -or -not $ExecuteClaimed){
  [Console]::WriteLine('{"dryRun":true,"readBackConfirmed":false,"test":"GYM_DENY_FIRST_STAGE_ONLY"}')
  exit 0
}
$mutex=$null;$held=$false;$zk=$null;$connected=$false
$beforeCount=$null;$afterCount=$null
function Require([bool]$ok,[string]$code){if(-not $ok){throw $code}}
function Normalize([string]$s){return ($s.Trim() -replace '\s+',' ').ToUpperInvariant()}
try{
  $raw=[Console]::In.ReadToEnd()
  Require ($raw.Length -gt 0 -and $raw.Length -lt 16384) 'INVALID_INPUT'
  $cfg=$raw | ConvertFrom-Json -ErrorAction Stop
  $cmd=$cfg.command
  $payload=$cmd.payload
  Require ($cfg.gymDenyFirstEnabled -eq $true -and $cfg.userWriteEnabled -eq 'true' -and
    $cfg.sendEnabled -eq 'false' -and $cfg.deviceSerial -ceq 'TDBD234200545' -and
    $cfg.deviceIp -ceq '192.168.100.185') 'LOCAL_DENY_FIRST_FLAG_DISABLED'
  Require ($cmd.commandType -ceq 'CREATE_USER' -and
    [string]$payload.source -ceq 'gym_admin_new_member' -and
    [string]$cmd.deviceSerial -ceq 'TDBD234200545' -and
    [string]$cmd.commandId -match '^[a-fA-F0-9-]{36}$' -and
    [string]$cmd.leaseToken -match '^[a-fA-F0-9-]{36}$') 'COMMAND_DENIED'
  $pin=[string]$cmd.userPin
  $name=[string]$payload.name
  Require ($pin -cmatch '^[1-9][0-9]{2}$' -and $pin -cne '200' -and $pin -cne '500' -and
    $name -cmatch '^[A-Za-z0-9 ._-]{2,24}$') 'INVALID_ENROLLMENT_IDENTITY'
  Require ([string]$cfg.commKey -match '^[0-9]{1,10}$') 'COMM_KEY_INVALID'
  $mutex=New-Object System.Threading.Mutex($false,'Global\X904_VMSC_PRIMARY_SYNC')
  try{$held=$mutex.WaitOne(30000)}catch [System.Threading.AbandonedMutexException]{$held=$true}
  Require $held 'DEVICE_BUSY'
  $zk=New-Object -ComObject zkemkeeper.ZKEM.1
  $zk.PullMode=1
  $key=[uint32]::Parse([string]$cfg.commKey)
  $zk.SetCommPassword([BitConverter]::ToInt32([BitConverter]::GetBytes($key),0)) | Out-Null
  $connected=[bool]$zk.Connect_Net([string]$cfg.deviceIp,4370)
  Require $connected 'CONNECT_FAILED'
  $serial=''
  Require ([bool]$zk.GetSerialNumber(1,[ref]$serial) -and $serial -ceq 'TDBD234200545') 'SERIAL_MISMATCH'
  Require ([bool]$zk.ReadAllUserID(1)) 'USER_ROSTER_UNAVAILABLE'
  $nameRead='';$userName='';$pw='';$role=0;$enabled=$false;$n=0;$matches=0
  while($zk.SSR_GetAllUserInfo(1,[ref]$nameRead,[ref]$userName,[ref]$pw,[ref]$role,[ref]$enabled)){
    $n++
    if($nameRead -ceq $pin){$matches++}
  }
  Require ($n -ge 1 -and $n -le 10000 -and $matches -eq 0) 'PIN_ALREADY_PRESENT'
  $beforeCount=$n
  # Group 2 must be absent from EVERY unlock combination before any write.
  for($i=1;$i -le 10;$i++){
    $readOk=$false
    for($attempt=1;$attempt -le 3;$attempt++){
      $a=0;$b=0;$c=0;$d=0;$e=0
      $readOk=[bool]$zk.SSR_GetUnLockGroup(1,$i,[ref]$a,[ref]$b,[ref]$c,[ref]$d,[ref]$e)
      if($readOk){break}
      if($attempt -lt 3){Start-Sleep -Milliseconds 200}
    }
    Require $readOk 'UNLOCK_COMBINATION_READ_FAILED'
    Require (-not (@($a,$b,$c,$d,$e) -contains 2)) 'GROUP2_CAN_UNLOCK'
  }
  # FIRST device mutation creates a disabled user. Never create enabled first.
  Require ([bool]$zk.SSR_SetUserInfo(1,$pin,$name,'',0,$false)) 'DISABLED_CREATE_FAILED'
  $actualName='';$actualPw='';$actualRole=0;$actualEnabled=$true
  Require ([bool]$zk.SSR_GetUserInfo(1,$pin,[ref]$actualName,[ref]$actualPw,
     [ref]$actualRole,[ref]$actualEnabled) -and
     (Normalize $actualName) -ceq (Normalize $name) -and
     $actualRole -eq 0 -and $actualEnabled -eq $false) 'DISABLED_READBACK_FAILED'
  Require ([bool]$zk.SetUserGroup(1,[int]$pin,2)) 'SET_GROUP2_FAILED'
  $group=0
  Require ([bool]$zk.GetUserGroup(1,[int]$pin,[ref]$group) -and $group -eq 2) 'GROUP2_READBACK_FAILED'
  $actualName='';$actualPw='';$actualRole=0;$actualEnabled=$true
  Require ([bool]$zk.SSR_GetUserInfo(1,$pin,[ref]$actualName,[ref]$actualPw,
    [ref]$actualRole,[ref]$actualEnabled) -and
    (Normalize $actualName) -ceq (Normalize $name) -and
    $actualRole -eq 0 -and $actualEnabled -eq $false) 'POST_GROUP_DISABLED_READBACK_FAILED'
  Require ([bool]$zk.ReadAllUserID(1)) 'POST_CREATE_ROSTER_UNAVAILABLE'
  $entryPin='';$entryName='';$pw='';$role=0;$enabled=$false;$n=0;$matches=0
  while($zk.SSR_GetAllUserInfo(1,[ref]$entryPin,[ref]$entryName,[ref]$pw,[ref]$role,[ref]$enabled)){
    $n++
    if($entryPin -ceq $pin){$matches++}
  }
  Require ($n -eq ($beforeCount+1) -and $matches -eq 1) 'CREATE_COUNT_MISMATCH'
  $afterCount=$n
  # Close SDK first, then independently read UID with authenticated read-only TCP
  # while keeping the common mutex held.
  $zk.Disconnect() | Out-Null;$connected=$false
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($zk);$zk=$null
  $node='C:\Program Files\nodejs\node.exe'
  $verifier=Join-Path $PSScriptRoot 'x904-vmsc-gym-create-uid-readback.mjs'
  Require ((Test-Path $node) -and (Test-Path $verifier)) 'READBACK_VERIFIER_MISSING'
  $verify=@{deviceIp=$cfg.deviceIp;deviceSerial=$cfg.deviceSerial;
    sendEnabled=$cfg.sendEnabled;commKey=$cfg.commKey;
    userPin=$pin;expectedName=$name;expectedCount=$afterCount}|ConvertTo-Json -Compress
  $output=$verify | & $node $verifier 2>&1
  Require ($LASTEXITCODE -eq 0) 'UID_READBACK_FAILED'
  $data=([string]($output|Select-Object -Last 1))|ConvertFrom-Json -ErrorAction Stop
  Require ($data.uidVerified -eq $true -and [int]$data.deviceUid -gt 0 -and
    [int]$data.deviceUid -lt 65535) 'UID_READBACK_MISMATCH'
  [Console]::WriteLine((@{readBackConfirmed=$true;deviceUid=[int]$data.deviceUid;
    beforeCount=$beforeCount;afterCount=$afterCount;accessBlockedByGroup=$true;
    accountEnabled=$false;afterGroup=2;errorCode=$null}|ConvertTo-Json -Compress))
}catch{
  $code=[string]$_.Exception.Message
  if($code -cnotmatch '^[A-Z0-9_]{1,64}$'){$code='STAGED_ENROLLMENT_FAILED'}
  [Console]::WriteLine((@{readBackConfirmed=$false;beforeCount=$beforeCount;
    afterCount=$afterCount;errorCode=$code}|ConvertTo-Json -Compress))
  exit 1
}finally{
  if($connected){try{$zk.Disconnect()|Out-Null}catch{}}
  if($null -ne $zk){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($zk)}catch{}}
  if($held){$mutex.ReleaseMutex()}
  if($null -ne $mutex){$mutex.Dispose()}
}
