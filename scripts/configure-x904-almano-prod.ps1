$ErrorActionPreference='Stop'
$base=Join-Path $env:LOCALAPPDATA 'GymCST\X904'
$keyFile=Join-Path $base 'lan-ingest-prod.dpapi'
$cfgFile=Join-Path $base 'lan-prod.json'
if (!(Test-Path $base)) { throw 'X904_DIR_NOT_FOUND' }
if ((Test-Path $keyFile) -or (Test-Path $cfgFile)) { throw 'PROD_ALREADY_CONFIGURED_NO_OVERWRITE' }
$bytes=New-Object byte[] 48
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$secure=ConvertTo-SecureString -AsPlainText -Force -String $token
try {
  $encrypted=ConvertFrom-SecureString -SecureString $secure
  [IO.File]::WriteAllText($keyFile,$encrypted,[Text.Encoding]::ASCII)
  $cfg=@{ target='PROD'; endpoint='https://nzdweipzckfszczzqtuw.supabase.co/functions/v1/x904-lan-prod/api'; serial='TDBD234200545' }
  [IO.File]::WriteAllText($cfgFile,($cfg|ConvertTo-Json -Compress),[Text.Encoding]::UTF8)
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $hash=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($token))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  Write-Output 'PROD_DPAPI_CONFIGURED=True'
  Write-Output ('PROD_TOKEN_SHA256='+$hash)
  Write-Output 'RAW_TOKEN_NEVER_OUTPUT'
} finally {
  $secure.Dispose()
  $token=$null
  [Array]::Clear($bytes,0,$bytes.Length)
}
