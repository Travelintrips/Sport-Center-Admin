param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]{4,100}$')][string]$Serial
)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'GymCST\X904'
$keyFile = Join-Path $base 'lan-ingest.dpapi'
$configFile = Join-Path $base 'lan-dev.json'
if (!(Test-Path $base)) { throw 'X904 base directory not found.' }
if ((Test-Path $keyFile) -or (Test-Path $configFile)) {
  throw 'DEV connector already configured. Never regenerate credentials without rotation.'
}
$randomBytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
$token = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$protected = ConvertFrom-SecureString -SecureString (ConvertTo-SecureString -AsPlainText -Force -String $token)
[IO.File]::WriteAllText($keyFile, $protected, [Text.Encoding]::ASCII)
$cfg = @{
  target = 'DEV'
  endpoint = 'https://xssrfshdrtdfupgqwfdw.supabase.co/functions/v1/x904-lan-dev/api'
  serial = $Serial
}
[IO.File]::WriteAllText($configFile, ($cfg | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($token))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$token = $null
$randomBytes = $null
Write-Output 'DEV_CONNECTOR_CONFIGURED=True'
Write-Output ('DEV_TOKEN_SHA256=' + $hash)
Write-Output 'The token itself was not displayed.'
