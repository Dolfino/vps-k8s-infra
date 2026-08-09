#!/usr/bin/env bash

set -Eeuo pipefail

backup_root="${LAB_SRE_BACKUP_ROOT:-/home/dns/backups/vps-k8s-infra-lab}"
age_key_file="/home/dns/.config/sops/age/keys.txt"
expected_context="k3d-lab-sre"

dr_timestamp="$(date -u +%Y%m%d%H%M%S)"
dr_namespace="dr-test-${dr_timestamp}"
restore_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_start_epoch="$(date -u +%s)"

restore_work_dir="${backup_root}/restore-work/${dr_namespace}"
report_dir="${backup_root}/reports"
report_file="${report_dir}/${dr_namespace}.json"

minio_forward_port="29000"
port_forward_pid=""
mc_config_dir=""

kctl=(kubectl --context "$expected_context")

cleanup() {
  if [[ -n "${port_forward_pid:-}" ]] &&
     kill -0 "$port_forward_pid" >/dev/null 2>&1; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
    wait "$port_forward_pid" 2>/dev/null || true
  fi

  if [[ "$dr_namespace" == dr-test-* ]] &&
     "${kctl[@]}" get namespace "$dr_namespace" >/dev/null 2>&1; then
    "${kctl[@]}" delete namespace "$dr_namespace" \
      --wait=true \
      --timeout=180s >/dev/null 2>&1 || true
  fi

  if [[ -n "${mc_config_dir:-}" ]] &&
     [[ "$mc_config_dir" == "$restore_work_dir"/.mc-config.* ]] &&
     [[ -d "$mc_config_dir" ]]; then
    rm -rf -- "$mc_config_dir"
  fi

  if [[ "$restore_work_dir" == "$backup_root"/restore-work/dr-test-* ]] &&
     [[ -d "$restore_work_dir" ]]; then
    rm -rf -- "$restore_work_dir"
  fi

  unset dr_pg_password dr_minio_user dr_minio_password
}

trap cleanup EXIT

required_commands=(
  kubectl
  jq
  age
  tar
  sha256sum
  git
  mc
  openssl
  diff
  base64
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
  printf 'Contexto incorreto: %s\n' "$current_context" >&2
  exit 1
fi

archive_file="$(
  find "${backup_root}/archives" \
    -maxdepth 1 \
    -type f \
    -name '*.tar.gz.age' \
    -printf '%T@ %p\n' |
  sort -nr |
  head -n 1 |
  cut -d' ' -f2-
)"

if [[ -z "$archive_file" ]] || [[ ! -f "$archive_file" ]]; then
  printf 'Nenhum backup criptografado encontrado.\n' >&2
  exit 1
fi

printf 'Backup selecionado: %s\n' "$archive_file"

sha256sum --check "${archive_file}.sha256"

mkdir -p "$restore_work_dir" "$report_dir"
chmod 700 "$restore_work_dir" "$report_dir"

printf 'Descriptografando em diretório temporário protegido...\n'

age \
  --decrypt \
  --identity "$age_key_file" \
  "$archive_file" |
tar -xzf - -C "$restore_work_dir"

mapfile -t extracted_dirs < <(
  find "$restore_work_dir" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d
)

if [[ "${#extracted_dirs[@]}" -ne 1 ]]; then
  printf 'Estrutura inesperada no backup.\n' >&2
  exit 1
fi

backup_content_dir="${extracted_dirs[0]}"

(
  cd "$backup_content_dir"
  sha256sum --check SHA256SUMS
)

backup_id="$(jq -r '.backupId' "$backup_content_dir/manifest.json")"
backup_finished="$(jq -r '.finishedAt' "$backup_content_dir/manifest.json")"
expected_git_commit="$(jq -r '.gitCommit' "$backup_content_dir/manifest.json")"

backup_finish_epoch="$(date -u -d "$backup_finished" +%s)"
rpo_seconds="$((restore_start_epoch - backup_finish_epoch))"

printf 'Backup ID: %s\n' "$backup_id"
printf 'RPO observado no início do teste: %s segundos\n' "$rpo_seconds"

printf 'Criando namespace isolado %s...\n' "$dr_namespace"

"${kctl[@]}" create namespace "$dr_namespace"

"${kctl[@]}" label namespace "$dr_namespace" \
  purpose=disaster-recovery-test \
  managed-by=restore-lab

dr_pg_password="$(openssl rand -hex 24)"
dr_minio_user="dr-admin"
dr_minio_password="$(openssl rand -hex 24)"

"${kctl[@]}" -n "$dr_namespace" apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: dr-postgres-auth
type: Opaque
stringData:
  POSTGRES_USER: dr_admin
  POSTGRES_PASSWORD: ${dr_pg_password}
  POSTGRES_DB: postgres
---
apiVersion: v1
kind: Pod
metadata:
  name: dr-postgres
  labels:
    app: dr-postgres
spec:
  automountServiceAccountToken: false
  containers:
    - name: postgres
      image: pgvector/pgvector:0.8.6-pg16-trixie
      imagePullPolicy: IfNotPresent
      envFrom:
        - secretRef:
            name: dr-postgres-auth
      ports:
        - containerPort: 5432
      readinessProbe:
        exec:
          command:
            - sh
            - -ec
            - pg_isready -U "\$POSTGRES_USER" -d "\$POSTGRES_DB"
        periodSeconds: 3
        failureThreshold: 30
      resources:
        requests:
          cpu: 100m
          memory: 256Mi
        limits:
          cpu: "1"
          memory: 1Gi
      volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
  volumes:
    - name: data
      emptyDir: {}
---
apiVersion: v1
kind: Pod
metadata:
  name: dr-redis
  labels:
    app: dr-redis
spec:
  automountServiceAccountToken: false
  containers:
    - name: redis
      image: redis:7.4.10-alpine
      imagePullPolicy: IfNotPresent
      command:
        - sh
        - -ec
        - sleep infinity
      resources:
        requests:
          cpu: 25m
          memory: 32Mi
        limits:
          cpu: 250m
          memory: 256Mi
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      emptyDir: {}
---
apiVersion: v1
kind: Secret
metadata:
  name: dr-minio-auth
type: Opaque
stringData:
  MINIO_ROOT_USER: ${dr_minio_user}
  MINIO_ROOT_PASSWORD: ${dr_minio_password}
---
apiVersion: v1
kind: Pod
metadata:
  name: dr-minio
  labels:
    app: dr-minio
spec:
  automountServiceAccountToken: false
  containers:
    - name: minio
      image: minio/minio:RELEASE.2025-09-07T16-13-09Z
      imagePullPolicy: IfNotPresent
      args:
        - server
        - /data
        - --console-address
        - :9001
      envFrom:
        - secretRef:
            name: dr-minio-auth
      ports:
        - name: api
          containerPort: 9000
        - name: console
          containerPort: 9001
      readinessProbe:
        httpGet:
          path: /minio/health/ready
          port: api
        periodSeconds: 3
        failureThreshold: 30
      resources:
        requests:
          cpu: 50m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: dr-minio
spec:
  selector:
    app: dr-minio
  ports:
    - name: api
      port: 9000
      targetPort: api
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: dr-evolution-restore
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: dr-pvc
  labels:
    app: dr-pvc
spec:
  automountServiceAccountToken: false
  containers:
    - name: restore
      image: alpine:3.22
      imagePullPolicy: IfNotPresent
      command:
        - sh
        - -ec
        - sleep infinity
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 100m
          memory: 128Mi
      volumeMounts:
        - name: restore
          mountPath: /restore
  volumes:
    - name: restore
      persistentVolumeClaim:
        claimName: dr-evolution-restore
EOF

printf 'Aguardando recursos temporários...\n'

for pod_name in dr-postgres dr-redis dr-minio dr-pvc; do
  "${kctl[@]}" -n "$dr_namespace" wait \
    --for=condition=Ready \
    "pod/${pod_name}" \
    --timeout=300s
done

printf 'Restaurando PostgreSQL...\n'

"${kctl[@]}" -n "$dr_namespace" exec -i dr-postgres -- \
  env PGPASSWORD="$dr_pg_password" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U dr_admin \
    -d postgres \
  < "$backup_content_dir/postgres/globals.sql"

"${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- \
  env PGPASSWORD="$dr_pg_password" \
  createdb \
    -U dr_admin \
    -O platform_admin \
    platform

"${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- \
  env PGPASSWORD="$dr_pg_password" \
  createdb \
    -U dr_admin \
    -O evolution_app \
    evolution_db

"${kctl[@]}" -n "$dr_namespace" cp \
  "$backup_content_dir/postgres/platform.dump" \
  dr-postgres:/tmp/platform.dump

"${kctl[@]}" -n "$dr_namespace" cp \
  "$backup_content_dir/postgres/evolution_db.dump" \
  dr-postgres:/tmp/evolution_db.dump

"${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- \
  env PGPASSWORD="$dr_pg_password" \
  pg_restore \
    --exit-on-error \
    -U dr_admin \
    -d platform \
    /tmp/platform.dump

"${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- \
  env PGPASSWORD="$dr_pg_password" \
  pg_restore \
    --exit-on-error \
    -U dr_admin \
    -d evolution_db \
    /tmp/evolution_db.dump

"${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- rm -f /tmp/platform.dump /tmp/evolution_db.dump

vector_version="$(
  "${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- \
    env PGPASSWORD="$dr_pg_password" \
    psql \
      -X \
      -At \
      -U dr_admin \
      -d platform \
      -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
)"

evolution_instance_count="$(
  "${kctl[@]}" -n "$dr_namespace" exec dr-postgres -- \
    env PGPASSWORD="$dr_pg_password" \
    psql \
      -X \
      -At \
      -U dr_admin \
      -d evolution_db \
      -c 'SELECT count(*) FROM evolution_api."Instance";'
)"

if [[ -z "$vector_version" ]]; then
  printf 'Extensão vector não restaurada.\n' >&2
  exit 1
fi

if [[ "$evolution_instance_count" -lt 1 ]]; then
  printf 'Nenhuma instância Evolution restaurada.\n' >&2
  exit 1
fi

printf 'PostgreSQL restaurado: vector=%s, instâncias=%s\n' \
  "$vector_version" \
  "$evolution_instance_count"

printf 'Restaurando Redis...\n'

"${kctl[@]}" -n "$dr_namespace" cp \
  "$backup_content_dir/redis/dump.rdb" \
  dr-redis:/data/dump.rdb

"${kctl[@]}" -n "$dr_namespace" exec dr-redis -- \
  redis-server \
    --dir /data \
    --dbfilename dump.rdb \
    --appendonly no \
    --daemonize yes \
    --bind 127.0.0.1 \
    --protected-mode no

redis_ready="false"

for attempt in $(seq 1 30); do
  if "${kctl[@]}" -n "$dr_namespace" exec dr-redis -- \
    redis-cli ping 2>/dev/null |
    grep -q PONG; then
    redis_ready="true"
    break
  fi

  sleep 1
done

if [[ "$redis_ready" != "true" ]]; then
  printf 'Redis restaurado não ficou disponível.\n' >&2
  exit 1
fi

"${kctl[@]}" -n "$dr_namespace" exec dr-redis -- \
  redis-cli INFO keyspace \
  > "$restore_work_dir/redis-restored-keyspace.txt"

redis_db6_keys="$(
  "${kctl[@]}" -n "$dr_namespace" exec dr-redis -- \
    redis-cli -n 6 DBSIZE |
  tr -d '\r'
)"

printf 'Redis restaurado: DB 6 possui %s chaves.\n' "$redis_db6_keys"

printf 'Restaurando MinIO...\n'

"${kctl[@]}" -n "$dr_namespace" port-forward \
  pod/dr-minio \
  "${minio_forward_port}:9000" \
  > "$restore_work_dir/minio-port-forward.log" 2>&1 &

port_forward_pid="$!"

mc_config_dir="$(
  mktemp -d "${restore_work_dir}/.mc-config.XXXXXX"
)"

minio_ready="false"

for attempt in $(seq 1 30); do
  MC_CONFIG_DIR="$mc_config_dir" \
    mc alias set \
      drminio \
      "http://127.0.0.1:${minio_forward_port}" \
      "$dr_minio_user" \
      "$dr_minio_password" \
      --api S3v4 >/dev/null 2>&1 || true

  if MC_CONFIG_DIR="$mc_config_dir" mc ready drminio >/dev/null 2>&1; then
    minio_ready="true"
    break
  fi

  sleep 1
done

if [[ "$minio_ready" != "true" ]]; then
  printf 'MinIO do sandbox não ficou disponível.\n' >&2
  exit 1
fi

MC_CONFIG_DIR="$mc_config_dir" \
mc mb --ignore-existing drminio/evolution-media

MC_CONFIG_DIR="$mc_config_dir" \
mc mb --ignore-existing drminio/lab-persistence

MC_CONFIG_DIR="$mc_config_dir" \
mc anonymous set none drminio/evolution-media

MC_CONFIG_DIR="$mc_config_dir" \
mc anonymous set none drminio/lab-persistence

MC_CONFIG_DIR="$mc_config_dir" \
mc mirror --overwrite \
  "$backup_content_dir/minio/evolution-media" \
  drminio/evolution-media

MC_CONFIG_DIR="$mc_config_dir" \
mc mirror --overwrite \
  "$backup_content_dir/minio/lab-persistence" \
  drminio/lab-persistence

mkdir -p \
  "$restore_work_dir/minio-validation/evolution-media" \
  "$restore_work_dir/minio-validation/lab-persistence"

MC_CONFIG_DIR="$mc_config_dir" \
mc mirror --overwrite \
  drminio/evolution-media \
  "$restore_work_dir/minio-validation/evolution-media"

MC_CONFIG_DIR="$mc_config_dir" \
mc mirror --overwrite \
  drminio/lab-persistence \
  "$restore_work_dir/minio-validation/lab-persistence"

diff -qr \
  "$backup_content_dir/minio/evolution-media" \
  "$restore_work_dir/minio-validation/evolution-media"

diff -qr \
  "$backup_content_dir/minio/lab-persistence" \
  "$restore_work_dir/minio-validation/lab-persistence"

minio_object_count="$(
  find "$restore_work_dir/minio-validation" -type f |
  wc -l |
  tr -d ' '
)"

printf 'MinIO restaurado: %s objetos validados.\n' \
  "$minio_object_count"

printf 'Restaurando conteúdo do PVC em volume isolado...\n'

"${kctl[@]}" -n "$dr_namespace" cp \
  "$backup_content_dir/evolution/evolution-instances.tar.gz" \
  dr-pvc:/tmp/evolution-instances.tar.gz

"${kctl[@]}" -n "$dr_namespace" exec dr-pvc -- \
  tar \
    -xzf /tmp/evolution-instances.tar.gz \
    -C /restore

pvc_entry_count="$(
  "${kctl[@]}" -n "$dr_namespace" exec dr-pvc -- \
    sh -ec \
    'find /restore/instances -mindepth 1 -print | wc -l' |
  tr -d '\r'
)"

if [[ "$pvc_entry_count" -lt 1 ]]; then
  printf 'PVC restaurado sem conteúdo.\n' >&2
  exit 1
fi

printf 'PVC restaurado: %s entradas.\n' "$pvc_entry_count"

printf 'Validando Git bundle...\n'

git clone --quiet \
  "$backup_content_dir/git/vps-k8s-infra.bundle" \
  "$restore_work_dir/git-restored"

restored_git_commit="$(
  git -C "$restore_work_dir/git-restored" rev-parse HEAD
)"

if [[ "$restored_git_commit" != "$expected_git_commit" ]]; then
  printf 'Commit restaurado não corresponde ao manifesto.\n' >&2
  exit 1
fi

restore_finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_finish_epoch="$(date -u +%s)"
rto_seconds="$((restore_finish_epoch - restore_start_epoch))"

jq -n \
  --arg status "SUCCESS" \
  --arg backup_id "$backup_id" \
  --arg namespace "$dr_namespace" \
  --arg started_at "$restore_started" \
  --arg finished_at "$restore_finished" \
  --arg vector_version "$vector_version" \
  --arg git_commit "$restored_git_commit" \
  --argjson rpo_seconds "$rpo_seconds" \
  --argjson rto_seconds "$rto_seconds" \
  --argjson evolution_instances "$evolution_instance_count" \
  --argjson redis_db6_keys "$redis_db6_keys" \
  --argjson minio_objects "$minio_object_count" \
  --argjson pvc_entries "$pvc_entry_count" \
  '{
    status: $status,
    backupId: $backup_id,
    sandboxNamespace: $namespace,
    restoreStartedAt: $started_at,
    restoreFinishedAt: $finished_at,
    objectives: {
      observedRPOSeconds: $rpo_seconds,
      observedRTOSeconds: $rto_seconds
    },
    validations: {
      postgres: {
        vectorVersion: $vector_version,
        evolutionInstances: $evolution_instances
      },
      redis: {
        db6Keys: $redis_db6_keys
      },
      minio: {
        objects: $minio_objects,
        contentComparison: "MATCH"
      },
      evolutionPVC: {
        entries: $pvc_entries,
        applicationStarted: false
      },
      git: {
        commit: $git_commit,
        match: true
      }
    }
  }' > "$report_file"

chmod 600 "$report_file"

printf '\nRestore lógico concluído com sucesso.\n'
printf 'RPO observado: %s segundos\n' "$rpo_seconds"
printf 'RTO observado: %s segundos\n' "$rto_seconds"
printf 'Relatório: %s\n' "$report_file"
printf 'A Evolution API NÃO foi iniciada no sandbox.\n'
printf 'O namespace temporário será removido agora.\n'
