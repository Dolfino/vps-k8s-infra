#!/usr/bin/env bash

set -Eeuo pipefail

repo_dir="/home/dns/.gemini/antigravity-ide/scratch/vps-k8s-infra"
backup_root="${LAB_SRE_BACKUP_ROOT:-/home/dns/backups/vps-k8s-infra-lab}"
age_key_file="/home/dns/.config/sops/age/keys.txt"
expected_context="k3d-lab-sre"
minio_forward_port="19000"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

backup_work_dir="${backup_root}/work/lab-sre-${timestamp}"
archive_dir="${backup_root}/archives"
archive_file="${archive_dir}/lab-sre-${timestamp}.tar.gz.age"

port_forward_pid=""
mc_config_dir=""

cleanup() {
  if [[ -n "${port_forward_pid:-}" ]] &&
     kill -0 "$port_forward_pid" >/dev/null 2>&1; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
    wait "$port_forward_pid" 2>/dev/null || true
  fi

  if [[ -n "${mc_config_dir:-}" ]] &&
     [[ "$mc_config_dir" == "$backup_work_dir"/.mc-config.* ]] &&
     [[ -d "$mc_config_dir" ]]; then
    rm -rf -- "$mc_config_dir"
  fi

  unset pg_user pg_password redis_password
  unset minio_root_user minio_root_password
}

trap cleanup EXIT

required_commands=(
  kubectl
  git
  jq
  age
  age-keygen
  mc
  tar
  sha256sum
  base64
  find
  xargs
)

for required_command in "${required_commands[@]}"; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Dependência ausente: %s\n' "$required_command" >&2
    exit 1
  fi
done

if [[ ! -f "$age_key_file" ]]; then
  printf 'Chave age não encontrada: %s\n' "$age_key_file" >&2
  exit 1
fi

current_context="$(kubectl config current-context)"

if [[ "$current_context" != "$expected_context" ]]; then
  printf 'Contexto incorreto: %s. Esperado: %s\n' \
    "$current_context" \
    "$expected_context" >&2
  exit 1
fi

if [[ -n "$(git -C "$repo_dir" status --porcelain)" ]]; then
  printf 'O repositório possui alterações não commitadas.\n' >&2
  printf 'Faça commit ou preserve as alterações antes do backup.\n' >&2
  exit 1
fi

mkdir -p \
  "$backup_work_dir/postgres" \
  "$backup_work_dir/redis" \
  "$backup_work_dir/minio/evolution-media" \
  "$backup_work_dir/minio/lab-persistence" \
  "$backup_work_dir/evolution" \
  "$backup_work_dir/git" \
  "$backup_work_dir/cluster" \
  "$archive_dir"

chmod 700 \
  "$backup_root" \
  "${backup_root}/work" \
  "$backup_work_dir" \
  "$archive_dir"

printf 'Validando workloads...\n'

kubectl -n storage wait \
  --for=condition=Ready \
  pod/postgres-0 \
  --timeout=180s

kubectl -n storage wait \
  --for=condition=Ready \
  pod/redis-0 \
  --timeout=180s

kubectl -n storage wait \
  --for=condition=Ready \
  pod/minio-0 \
  --timeout=180s

kubectl -n business rollout status \
  deployment/evolution-api \
  --timeout=180s

printf 'Registrando inventário do cluster...\n'

kubectl version -o yaml \
  > "$backup_work_dir/cluster/kubernetes-version.yaml"

kubectl get nodes -o wide \
  > "$backup_work_dir/cluster/nodes.txt"

kubectl get pv -o wide \
  > "$backup_work_dir/cluster/persistent-volumes.txt"

kubectl get pvc -A -o wide \
  > "$backup_work_dir/cluster/persistent-volume-claims.txt"

kubectl get applications.argoproj.io -n argocd -o yaml \
  > "$backup_work_dir/cluster/argocd-applications.yaml"

git_commit="$(git -C "$repo_dir" rev-parse HEAD)"

git -C "$repo_dir" bundle create \
  "$backup_work_dir/git/vps-k8s-infra.bundle" \
  --all

git bundle verify \
  "$backup_work_dir/git/vps-k8s-infra.bundle" \
  > "$backup_work_dir/git/bundle-verification.txt" 2>&1

printf 'Exportando PostgreSQL...\n'

pg_user="$(
  kubectl -n storage get secret postgres-auth \
    -o jsonpath='{.data.POSTGRES_USER}' |
  base64 -d
)"

pg_password="$(
  kubectl -n storage get secret postgres-auth \
    -o jsonpath='{.data.POSTGRES_PASSWORD}' |
  base64 -d
)"

kubectl -n storage exec postgres-0 -- \
  env PGPASSWORD="$pg_password" \
  pg_dumpall \
    -U "$pg_user" \
    --globals-only \
    --no-role-passwords \
    -f /tmp/globals.sql

kubectl -n storage exec postgres-0 -- \
  env PGPASSWORD="$pg_password" \
  pg_dump \
    -U "$pg_user" \
    -d platform \
    -Fc \
    -f /tmp/platform.dump

kubectl -n storage exec postgres-0 -- \
  env PGPASSWORD="$pg_password" \
  pg_dump \
    -U "$pg_user" \
    -d evolution_db \
    -Fc \
    -f /tmp/evolution_db.dump

kubectl -n storage exec postgres-0 -- \
  pg_restore --list /tmp/platform.dump \
  > "$backup_work_dir/postgres/platform.toc"

kubectl -n storage exec postgres-0 -- \
  pg_restore --list /tmp/evolution_db.dump \
  > "$backup_work_dir/postgres/evolution_db.toc"

kubectl -n storage cp postgres-0:/tmp/globals.sql "$backup_work_dir/postgres/globals.sql"
kubectl -n storage cp postgres-0:/tmp/platform.dump "$backup_work_dir/postgres/platform.dump"
kubectl -n storage cp postgres-0:/tmp/evolution_db.dump "$backup_work_dir/postgres/evolution_db.dump"

kubectl -n storage exec postgres-0 -- rm -f /tmp/globals.sql /tmp/platform.dump /tmp/evolution_db.dump

test -s "$backup_work_dir/postgres/globals.sql"
test -s "$backup_work_dir/postgres/platform.dump"
test -s "$backup_work_dir/postgres/evolution_db.dump"
test -s "$backup_work_dir/postgres/platform.toc"
test -s "$backup_work_dir/postgres/evolution_db.toc"

printf 'Exportando Redis em RDB...\n'

redis_password="$(
  kubectl -n storage get secret redis-auth \
    -o jsonpath='{.data.REDIS_PASSWORD}' |
  base64 -d
)"

kubectl -n storage exec redis-0 -- \
  env REDISCLI_AUTH="$redis_password" \
  redis-cli INFO keyspace \
  > "$backup_work_dir/redis/keyspace.txt"

kubectl -n storage exec redis-0 -- \
  env REDISCLI_AUTH="$redis_password" \
  redis-cli --rdb - \
  > "$backup_work_dir/redis/dump.rdb"

test -s "$backup_work_dir/redis/dump.rdb"

if [[ "$(head -c 5 "$backup_work_dir/redis/dump.rdb")" != "REDIS" ]]; then
  printf 'Arquivo Redis RDB inválido.\n' >&2
  exit 1
fi

printf 'Espelhando MinIO para o host...\n'

minio_root_user="$(
  kubectl -n storage get secret minio-auth \
    -o jsonpath='{.data.MINIO_ROOT_USER}' |
  base64 -d
)"

minio_root_password="$(
  kubectl -n storage get secret minio-auth \
    -o jsonpath='{.data.MINIO_ROOT_PASSWORD}' |
  base64 -d
)"

kubectl -n storage port-forward \
  pod/minio-0 \
  "${minio_forward_port}:9000" \
  > "$backup_work_dir/cluster/minio-port-forward.log" 2>&1 &

port_forward_pid="$!"

mc_config_dir="$(
  mktemp -d "${backup_work_dir}/.mc-config.XXXXXX"
)"

minio_ready="false"

for attempt in $(seq 1 30); do
  MC_CONFIG_DIR="$mc_config_dir" \
    mc alias set \
      labminio \
      "http://127.0.0.1:${minio_forward_port}" \
      "$minio_root_user" \
      "$minio_root_password" \
      --api S3v4 >/dev/null 2>&1 || true

  if MC_CONFIG_DIR="$mc_config_dir" mc ready labminio >/dev/null 2>&1; then
    minio_ready="true"
    break
  fi

  sleep 1
done

if [[ "$minio_ready" != "true" ]]; then
  printf 'Não foi possível acessar o MinIO pelo port-forward.\n' >&2
  exit 1
fi

MC_CONFIG_DIR="$mc_config_dir" \
mc mirror --overwrite \
  labminio/evolution-media \
  "$backup_work_dir/minio/evolution-media"

MC_CONFIG_DIR="$mc_config_dir" \
mc mirror --overwrite \
  labminio/lab-persistence \
  "$backup_work_dir/minio/lab-persistence"

if [[ "$mc_config_dir" == "$backup_work_dir"/.mc-config.* ]]; then
  rm -rf -- "$mc_config_dir"
  mc_config_dir=""
fi

printf 'Arquivando o PVC da Evolution...\n'

kubectl -n business exec deployment/evolution-api -- \
  tar -C /evolution -czf - instances \
  > "$backup_work_dir/evolution/evolution-instances.tar.gz"

test -s \
  "$backup_work_dir/evolution/evolution-instances.tar.gz"

tar -tzf \
  "$backup_work_dir/evolution/evolution-instances.tar.gz" \
  > "$backup_work_dir/evolution/archive-contents.txt"

printf 'Gerando manifesto e checksums...\n'

minio_object_count="$(
  find "$backup_work_dir/minio" -type f |
  wc -l |
  tr -d ' '
)"

evolution_archive_entries="$(
  tar -tzf \
    "$backup_work_dir/evolution/evolution-instances.tar.gz" |
  wc -l |
  tr -d ' '
)"

backup_finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
age_recipient="$(age-keygen -y "$age_key_file")"

jq -n \
  --arg backup_id "lab-sre-${timestamp}" \
  --arg cluster_context "$current_context" \
  --arg started_at "$backup_started" \
  --arg finished_at "$backup_finished" \
  --arg git_commit "$git_commit" \
  --arg age_recipient "$age_recipient" \
  --argjson minio_objects "$minio_object_count" \
  --argjson evolution_archive_entries "$evolution_archive_entries" \
  '{
    backupId: $backup_id,
    clusterContext: $cluster_context,
    startedAt: $started_at,
    finishedAt: $finished_at,
    gitCommit: $git_commit,
    encryption: {
      type: "age",
      recipient: $age_recipient,
      privateKeyIncluded: false
    },
    contents: {
      postgres: [
        "globals",
        "platform",
        "evolution_db"
      ],
      redis: "full-rdb",
      minioObjectCount: $minio_objects,
      evolutionArchiveEntries: $evolution_archive_entries,
      gitBundle: true,
      kubernetesInventory: true
    }
  }' > "$backup_work_dir/manifest.json"

(
  cd "$backup_work_dir"

  find . \
    -type f \
    ! -name SHA256SUMS \
    -print0 |
  sort -z |
  xargs -0 -r sha256sum
) > "$backup_work_dir/SHA256SUMS"

(
  cd "$backup_work_dir"
  sha256sum --check SHA256SUMS
)

printf 'Criptografando o backup...\n'

tar \
  -C "$(dirname "$backup_work_dir")" \
  -czf - \
  "$(basename "$backup_work_dir")" |
age \
  --recipient "$age_recipient" \
  --output "$archive_file"

chmod 600 "$archive_file"

printf 'Validando descriptografia e estrutura...\n'

age \
  --decrypt \
  --identity "$age_key_file" \
  "$archive_file" |
tar -tzf - >/dev/null

sha256sum "$archive_file" \
  > "${archive_file}.sha256"

chmod 600 "${archive_file}.sha256"

if [[ "$backup_work_dir" != "$backup_root"/work/lab-sre-* ]]; then
  printf 'Proteção de caminho acionada; plaintext não removido.\n' >&2
  exit 1
fi

printf 'Removendo cópia plaintext validada...\n'

rm -rf -- "$backup_work_dir"

printf '\nBackup concluído.\n'
printf 'Arquivo: %s\n' "$archive_file"
printf 'Checksum: %s\n' "${archive_file}.sha256"
printf 'Chave privada incluída: NÃO\n'
