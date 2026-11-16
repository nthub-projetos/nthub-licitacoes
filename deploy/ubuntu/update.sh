#!/usr/bin/env bash
# Manual publishing only. No cron, webhook, runner or automatic GitHub action.
set -Eeuo pipefail
umask 077

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
docker_cmd=(docker)
dc=()
paused=0
migration_started=0
backup_dir=''

on_error() {
  local code=$1
  trap - ERR
  set +e
  echo "Atualização interrompida (código $code)." >&2
  if [[ "$paused" == 1 && "$migration_started" == 0 && -f "$backup_dir/compose-resolved.yaml" ]]; then
    echo 'Banco ainda não migrado; retomando as imagens anteriores.' >&2
    "${docker_cmd[@]}" compose -p nthub_licitacoes_teste -f "$backup_dir/compose-resolved.yaml" -f "$backup_dir/previous-images.yaml" up -d --no-deps --no-build --wait --wait-timeout 120 api worker web
  elif [[ "$paused" == 1 ]]; then
    "${dc[@]}" stop -t 60 web api worker
    echo 'Migração já iniciada: NTHUB mantido pausado para conferir o banco antes de recuperar.' >&2
    echo 'Não execute o instalador nem restaure o snapshot inicial para tentar recuperar.' >&2
  else
    echo 'Os containers em execução não foram substituídos.' >&2
  fi
  [[ -z "$backup_dir" ]] || echo "Backup e instruções: $backup_dir" >&2
  exit "$code"
}

main() {
  command -v git >/dev/null
  command -v flock >/dev/null
  [[ -f .env ]] || { echo 'Falta o .env desta instalação.' >&2; exit 1; }
  [[ -d .git ]] || { echo 'Esta pasta precisa ser um clone do GitHub. Consulte ATUALIZACAO-MANUAL.md.' >&2; exit 1; }
  [[ $(git branch --show-current) == main ]] || { echo 'Use a branch main.' >&2; exit 1; }
  [[ -z $(git status --porcelain) ]] || { echo 'Há alterações locais de código. Preserve-as antes de publicar; nenhum reset será feito.' >&2; exit 1; }
  mkdir -p .runtime backups/manual-update
  exec 9>.runtime/manual-update.lock
  flock -n 9 || { echo 'Já existe uma atualização em execução.' >&2; exit 1; }
  chmod 600 .env
  if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null
    docker_cmd=(sudo docker)
    "${docker_cmd[@]}" info >/dev/null
  fi
  dc=("${docker_cmd[@]}" compose --env-file "$root/.env" -p nthub_licitacoes_teste -f "$root/deploy/ubuntu/compose.yaml")
  "${dc[@]}" config --quiet
  "${dc[@]}" exec -T database pg_isready -U nthub -d nthub >/dev/null
  for service in api worker web; do
    [[ -n $("${dc[@]}" ps -q "$service") ]] || { echo "O serviço $service não está rodando. Confira a instalação inicial antes de atualizar." >&2; exit 1; }
  done

  echo 'Buscando a main aprovada no GitHub...'
  git fetch origin main
  local target previous deployed stamp api_image worker_image web_image
  target=$(git rev-parse 'FETCH_HEAD^{commit}')
  previous=$(git rev-parse HEAD)
  git merge-base --is-ancestor "$previous" "$target" || { echo 'Histórico divergente. Atualização recusada; nenhum reset será feito.' >&2; exit 1; }
  deployed=$(cat .runtime/deployed-commit 2>/dev/null || true)
  if [[ "$deployed" == "$target" && "$previous" == "$target" ]]; then
    echo "A versão $target já está publicada."; return
  fi

  stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
  backup_dir="$root/backups/manual-update/$stamp"
  mkdir -m 700 "$backup_dir"
  cp .env "$backup_dir/.env"
  "${dc[@]}" config >"$backup_dir/compose-resolved.yaml"
  printf '%s\n' "$previous" >"$backup_dir/checkout-before.txt"
  printf '%s\n' "$target" >"$backup_dir/target-commit.txt"
  printf '%s\n' "${deployed:-instalação-inicial-sem-revisão-registrada}" >"$backup_dir/deployed-before.txt"
  api_image=$("${docker_cmd[@]}" inspect --format '{{.Image}}' "$("${dc[@]}" ps -q api)")
  worker_image=$("${docker_cmd[@]}" inspect --format '{{.Image}}' "$("${dc[@]}" ps -q worker)")
  web_image=$("${docker_cmd[@]}" inspect --format '{{.Image}}' "$("${dc[@]}" ps -q web)")
  "${docker_cmd[@]}" image tag "$api_image" "nthub-licitacoes-teste-api:previous-$stamp"
  "${docker_cmd[@]}" image tag "$worker_image" "nthub-licitacoes-teste-api:previous-worker-$stamp"
  "${docker_cmd[@]}" image tag "$web_image" "nthub-licitacoes-teste-web:previous-$stamp"
  cat >"$backup_dir/previous-images.yaml" <<EOF
services:
  api:
    image: nthub-licitacoes-teste-api:previous-$stamp
  worker:
    image: nthub-licitacoes-teste-api:previous-worker-$stamp
  web:
    image: nthub-licitacoes-teste-web:previous-$stamp
EOF
  cp deploy/ubuntu/RECUPERACAO.md "$backup_dir/LEIA-ME.md"

  # main is already parsed into memory before these tracked files are updated.
  git merge --ff-only "$target"
  echo 'Compilando as imagens novas; o sistema continua disponível.'
  "${dc[@]}" build api web
  echo 'Pausando somente o NTHUB para o backup e a migração...'
  paused=1
  "${dc[@]}" stop -t 90 web api worker
  local external
  external=$("${dc[@]}" exec -T database psql -U nthub -d nthub -Atc "SELECT (SELECT count(*) FROM documents WHERE storage_key IS NOT NULL AND content IS NULL)+(SELECT count(*) FROM private_files WHERE storage_key IS NOT NULL AND content IS NULL)")
  [[ "$external" == 0 ]] || { echo 'Há documentos externos ao banco. É necessário incluir o armazenamento no backup antes de continuar.' >&2; return 1; }
  "${dc[@]}" exec -T database pg_dump -U nthub -d nthub -Fc --no-owner --no-acl >"$backup_dir/database.dump"
  [[ -s "$backup_dir/database.dump" ]]
  "${dc[@]}" exec -T database pg_restore --list <"$backup_dir/database.dump" >/dev/null
  sha256sum "$backup_dir/database.dump" >"$backup_dir/database.dump.sha256"
  printf 'Backup concluído em %s\n' "$(date -u +%FT%TZ)" >"$backup_dir/BACKUP-CONCLUIDO.txt"

  echo 'Aplicando somente migrações; o snapshot e os usuários iniciais não serão reimportados.'
  migration_started=1
  "${dc[@]}" run --rm --no-deps init pnpm --filter @nthub/api exec tsx src/migrate.ts
  "${dc[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 api
  "${dc[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 worker web
  "${dc[@]}" exec -T web wget -q -O /dev/null http://127.0.0.1/api/v1/health
  printf '%s\n' "$target" >.runtime/deployed-commit
  paused=0
  "${dc[@]}" ps
  echo "Versão publicada: $target"
  echo "Backup privado: $backup_dir"
  echo 'O banco, os documentos e o sistema do escritório foram preservados.'
}

trap 'on_error "$?"' ERR
main "$@"
