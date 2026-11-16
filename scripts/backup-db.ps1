$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $workspace
$backupDirectory = Join-Path $workspace 'output/backups'
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$filename = "nthub-$stamp.dump"
$container = (docker compose ps -q postgres).Trim()
if (!$container) { throw 'PostgreSQL não está ativo.' }
docker exec $container pg_dump -U nthub -d nthub -Fc -f "/tmp/$filename"
if ($LASTEXITCODE) { throw 'Falha no backup.' }
docker cp "${container}:/tmp/$filename" (Join-Path $backupDirectory $filename)
if ($LASTEXITCODE) { throw 'Falha ao copiar o backup.' }
$verificationDatabase = 'nthub_restore_' + [guid]::NewGuid().ToString('N')
if ($verificationDatabase -notmatch '^nthub_restore_[a-f0-9]{32}$') { throw 'Nome de verificação inválido.' }
docker exec $container createdb -U nthub $verificationDatabase
if ($LASTEXITCODE) { throw 'Falha ao criar banco de verificação.' }
try {
  docker exec $container pg_restore -U nthub -d $verificationDatabase --exit-on-error "/tmp/$filename"
  if ($LASTEXITCODE) { throw 'Falha na restauração de verificação.' }
  docker exec $container psql -U nthub -d $verificationDatabase -c 'SELECT count(*) AS empresas FROM companies; SELECT count(*) AS usuarios FROM users;'
  if ($LASTEXITCODE) { throw 'Falha ao verificar restauração.' }
} finally {
  docker exec $container dropdb -U nthub $verificationDatabase
}
Write-Output "Backup PostgreSQL e restauração temporária verificados: $backupDirectory/$filename. Inclua também um snapshot consistente do bucket S3."
