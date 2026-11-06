$ErrorActionPreference = 'Stop'

function New-RandomText([int]$Length) {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_'
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function New-Base64Secret([int]$Length) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

$recipient = 'age1t32sy2fqrnypka7na6qt7qw8l6g9j8aepvfqsmvnf3a8xjugvdhqjqhfs0'
$databaseFile = 'apps/02-storage/secrets/identity-db-auth.sops.yaml'
$identityFile = 'apps/03-business/identity-platform/secrets/identity-runtime.sops.yaml'
$portalFile = 'apps/03-business/portal-platform/secrets/portal-runtime.sops.yaml'
$tempDatabase = 'apps/02-storage/secrets/.identity-db-auth.enc.tmp.yaml'
$tempEncrypted = 'apps/03-business/identity-platform/secrets/.identity-runtime.enc.tmp.yaml'
$tempPortal = 'apps/03-business/portal-platform/secrets/.portal-runtime.enc.tmp.yaml'

foreach ($file in @($databaseFile, $identityFile, $portalFile)) {
  if (Select-String -LiteralPath $file -Pattern '^sops:' -Quiet) {
    throw "Secret already initialized; refusing to rotate automatically: $file"
  }
}

$databasePassword = New-RandomText 48
$adminPassword = New-RandomText 56
$clientSecret = New-RandomText 56
$initialPassword = New-RandomText 24
$cookieSecret = New-Base64Secret 32

try {
  $databaseContent = [System.IO.File]::ReadAllText((Resolve-Path $databaseFile))
  $databaseContent = $databaseContent.Replace('REPLACE_WITH_GENERATED_DB_PASSWORD', $databasePassword)
  [System.IO.File]::WriteAllText((Resolve-Path $databaseFile), $databaseContent, [System.Text.UTF8Encoding]::new($false))
  & sops --config NUL --encrypt --age $recipient --encrypted-regex '^(data|stringData)$' --output $tempDatabase $databaseFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not encrypt identity database runtime' }
  Move-Item -Force -LiteralPath $tempDatabase -Destination $databaseFile

  $identityContent = [System.IO.File]::ReadAllText((Resolve-Path $identityFile))
  $identityContent = $identityContent.Replace('REPLACE_WITH_GENERATED_DB_PASSWORD', $databasePassword)
  $identityContent = $identityContent.Replace('REPLACE_WITH_GENERATED_ADMIN_PASSWORD', $adminPassword)
  $identityContent = $identityContent.Replace('REPLACE_WITH_GENERATED_CLIENT_SECRET', $clientSecret)
  $identityContent = $identityContent.Replace('REPLACE_WITH_GENERATED_INITIAL_PASSWORD', $initialPassword)
  [System.IO.File]::WriteAllText((Resolve-Path $identityFile), $identityContent, [System.Text.UTF8Encoding]::new($false))
  & sops --config NUL --encrypt --age $recipient --encrypted-regex '^(data|stringData)$' --output $tempEncrypted $identityFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not re-encrypt identity runtime' }
  Move-Item -Force -LiteralPath $tempEncrypted -Destination $identityFile

  $portalContent = [System.IO.File]::ReadAllText((Resolve-Path $portalFile))
  $portalContent = $portalContent.Replace('REPLACE_WITH_GENERATED_CLIENT_SECRET', $clientSecret)
  $portalContent = $portalContent.Replace('REPLACE_WITH_GENERATED_COOKIE_SECRET', $cookieSecret)
  [System.IO.File]::WriteAllText((Resolve-Path $portalFile), $portalContent, [System.Text.UTF8Encoding]::new($false))

  & sops --config NUL --encrypt --age $recipient --encrypted-regex '^(data|stringData)$' --output $tempPortal $portalFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not encrypt portal runtime' }
  Move-Item -Force -LiteralPath $tempPortal -Destination $portalFile
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $tempDatabase, $tempEncrypted, $tempPortal
}

foreach ($file in @($databaseFile, $identityFile, $portalFile)) {
  if (-not (Select-String -LiteralPath $file -Pattern '^sops:' -Quiet)) {
    throw "Missing SOPS metadata: $file"
  }
  if (Select-String -LiteralPath $file -Pattern 'REPLACE_WITH' -Quiet) {
    throw "Secret placeholder remains: $file"
  }
}

Write-Output 'Identity and portal secrets generated, matched and encrypted.'

