#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ! -f .env || ! -f backup/database.dump || ! -f backup/objects.json ]]; then
  echo 'Pacote incompleto: faltam .env ou arquivos de backup.' >&2; exit 1
fi
chmod 600 .env
chmod -R go-rwx backup
docker compose version >/dev/null
docker info >/dev/null
# Read only the two non-secret bind settings; never execute the .env file.
port=$(sed -n 's/^HTTP_PORT=//p' .env | tr -d '\r\042\047')
bind=$(sed -n 's/^BIND_IP=//p' .env | tr -d '\r\042\047')
if [[ ! "$port" =~ ^[0-9]+$ || ! "$bind" =~ ^[0-9.]+$ ]]; then echo 'Porta ou IP inválido.' >&2; exit 1; fi
dc=(docker compose --env-file .env -p nthub_licitacoes_teste -f deploy/ubuntu/compose.yaml)
if ss -H -ltn "sport = :$port" | grep -q .; then
  if ! "${dc[@]}" ps --status running --services | grep -qx web; then
    echo "A porta $port está ocupada. Escolha outra HTTP_PORT no .env; nenhuma aplicação foi alterada." >&2; exit 1
  fi
fi
echo "Instalando somente o projeto nthub_licitacoes_teste em $bind:$port."
"${dc[@]}" up -d --build --wait --wait-timeout 240
"${dc[@]}" ps
echo "Acesse http://$bind:$port"
