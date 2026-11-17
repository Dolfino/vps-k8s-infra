$ErrorActionPreference = 'Stop'

$recipient = 'age1t32sy2fqrnypka7na6qt7qw8l6g9j8aepvfqsmvnf3a8xjugvdhqjqhfs0'
$secretFile = 'apps/03-business/martech-platform-runtime/secrets/push-runtime.sops.yaml'
$encryptedTemp = 'apps/03-business/martech-platform-runtime/secrets/.push-runtime.enc.tmp.yaml'
$backendPath = Resolve-Path '..\martech-platform'
$plainTemp = Join-Path ([IO.Path]::GetTempPath()) ('.martech-push-' + [guid]::NewGuid().ToString('N') + '.yaml')

if (Select-String -LiteralPath $secretFile -Pattern '^sops:' -Quiet) {
  throw "Push secret already initialized; refusing to rotate VAPID automatically: $secretFile"
}

try {
  Push-Location $backendPath
  try {
    $keyJson = & node --input-type=module -e "import * as webpush from 'web-push'; process.stdout.write(JSON.stringify(webpush.generateVAPIDKeys()));"
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate VAPID keys' }
  } finally {
    Pop-Location
  }

  $keys = $keyJson | ConvertFrom-Json
  if (-not $keys.publicKey -or -not $keys.privateKey) {
    throw 'VAPID generator returned an incomplete key pair'
  }

  $content = [IO.File]::ReadAllText((Resolve-Path $secretFile))
  $content = $content.Replace('REPLACE_WITH_GENERATED_VAPID_PUBLIC_KEY', $keys.publicKey)
  $content = $content.Replace('REPLACE_WITH_GENERATED_VAPID_PRIVATE_KEY', $keys.privateKey)
  [IO.File]::WriteAllText($plainTemp, $content, [Text.UTF8Encoding]::new($false))

  & sops --config NUL --encrypt --age $recipient --encrypted-regex '^(data|stringData)$' --output $encryptedTemp $plainTemp
  if ($LASTEXITCODE -ne 0) { throw 'Could not encrypt the VAPID runtime Secret' }

  $encrypted = [IO.File]::ReadAllText((Resolve-Path $encryptedTemp))
  if ($encrypted.Contains($keys.privateKey) -or $encrypted -match 'REPLACE_WITH') {
    throw 'Encrypted Secret validation failed'
  }
  if ($encrypted -notmatch '(?m)^sops:') {
    throw 'SOPS metadata is missing from the encrypted Secret'
  }

  Move-Item -Force -LiteralPath $encryptedTemp -Destination $secretFile
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $plainTemp, $encryptedTemp
  $keyJson = $null
  $keys = $null
  $content = $null
  $encrypted = $null
}

Write-Output 'VAPID key pair generated and stored only in the SOPS-encrypted Secret.'
