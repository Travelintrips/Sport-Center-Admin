param([switch]$Sync)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'GymCST\X904'
$probe = Join-Path $base 'probe'
$commKeyFile = Join-Path $base 'commkey.dpapi'
$sender = Join-Path $probe 'x904-almano-prod-sync.mjs'
if (!(Test-Path $commKeyFile) -or !(Test-Path $sender)) {
  throw 'Missing protected X904 Comm Key or PROD connector.'
}
function Open-ProtectedString([string] $file) {
  $secured = ConvertTo-SecureString -String ([IO.File]::ReadAllText($file).Trim())
  $ptr = [IntPtr]::Zero
  try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secured)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $secured.Dispose()
  }
}
$settings = @{
  target = 'PROD'
  deviceIp = '192.168.100.185'
  commKey = (Open-ProtectedString $commKeyFile)
}
if ($Sync) {
  $configuration = Join-Path $base 'lan-prod.json'
  $keyFile = Join-Path $base 'lan-ingest-prod.dpapi'
  if (!(Test-Path $configuration) -or !(Test-Path $keyFile)) {
    throw 'PROD connector not configured.'
  }
  $cfg = Get-Content -Raw -LiteralPath $configuration | ConvertFrom-Json
  if ($cfg.target -ne 'PROD' -or
      $cfg.endpoint -ne 'https://nzdweipzckfszczzqtuw.supabase.co/functions/v1/x904-lan-prod/api' -or
      $cfg.serial -ne 'TDBD234200545') {
    throw 'Only the pinned PROD endpoint and physical serial are allowed.'
  }
  $settings.endpoint = $cfg.endpoint
  $settings.serial = $cfg.serial
  $settings.ingestKey = Open-ProtectedString $keyFile
}
try {
  $json = ConvertTo-Json -InputObject $settings -Depth 4 -Compress
  $mode = if ($Sync) { '--sync' } else { '--dry-run' }
  Write-Host ('X904 authenticated PROD LAN read: ' + $mode)
  $json | & node $sender $mode
  if ($LASTEXITCODE -ne 0) { throw 'X904 PROD sync failed.' }
  Write-Host 'X904 read completed with no device mutation.'
} finally {
  $settings.commKey = $null
  if ($settings.ContainsKey('ingestKey')) { $settings.ingestKey = $null }
}
