param([switch]$Sync)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'GymCST\X904'
$probe = Join-Path $base 'probe'
$commKeyFile = Join-Path $base 'commkey.dpapi'
$script = Join-Path $probe 'x904-almano-sync.mjs'
if (!(Test-Path $commKeyFile) -or !(Test-Path $script)) {
  throw 'Missing protected X904 Comm Key or connector script.'
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
  target = 'DEV'
  deviceIp = '192.168.100.185'
  commKey = (Open-ProtectedString $commKeyFile)
}
if ($Sync) {
  $configuration = Join-Path $base 'lan-dev.json'
  $lanKey = Join-Path $base 'lan-ingest.dpapi'
  if (!(Test-Path $configuration) -or !(Test-Path $lanKey)) {
    throw 'DEV sync configuration and protected ingest key are not ready.'
  }
  $cfg = Get-Content -Raw -LiteralPath $configuration | ConvertFrom-Json
  if ($cfg.target -ne 'DEV') { throw 'Only DEV sync is enabled.' }
  $settings.endpoint = $cfg.endpoint
  $settings.serial = $cfg.serial
  $settings.ingestKey = Open-ProtectedString $lanKey
}
try {
  $json = ConvertTo-Json -InputObject $settings -Depth 4 -Compress
  $mode = if ($Sync) { '--sync' } else { '--dry-run' }
  Write-Host ('X904 authenticated LAN read: ' + $mode)
  $json | & node $script $mode
  if ($LASTEXITCODE -ne 0) { throw 'X904 LAN read/sync failed; check stage above.' }
  Write-Host 'X904 test completed without device mutation.'
} finally {
  $settings.commKey = $null
  if ($settings.ContainsKey('ingestKey')) { $settings.ingestKey = $null }
}
