#!/usr/bin/env bash

set -Eeuo pipefail

backup_root="${LAB_SRE_BACKUP_ROOT:-/home/dns/backups/vps-k8s-infra-lab}"
report_dir="${backup_root}/reports"
mkdir -p "$report_dir"

test_id="$(date -u +%Y%m%d%H%M%S)"
test_namespace="sre-alert-test-${test_id}"
report_file="${report_dir}/alert-test-${test_id}.json"

start_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start_epoch="$(date -u +%s)"

echo "=== STARTING SRE ALERT PIPELINE CONTROLLED TEST (${test_namespace}) ==="

grafana_user="$(
  kubectl -n monitoring get secret grafana-admin \
    -o jsonpath='{.data.admin-user}' | base64 -d
)"

grafana_password="$(
  kubectl -n monitoring get secret grafana-admin \
    -o jsonpath='{.data.admin-password}' | base64 -d
)"

cleanup() {
  echo "=== CLEANING UP TEST NAMESPACE ${test_namespace} ==="
  kubectl delete namespace "$test_namespace" --ignore-not-found=true --wait=true 2>/dev/null || true
  unset grafana_user grafana_password
}

trap cleanup EXIT INT TERM

# Step 1: Create ephemeral namespace
kubectl create namespace "$test_namespace"
kubectl label namespace "$test_namespace" \
  purpose=alert-pipeline-test \
  managed-by=sre-runbook

# Step 2: Test Critical Route (SRETargetDown)
echo "=== STEP 2: PROVISIONING UNAVAILABLE METRICS PROBE (CRITICAL ROUTE) ==="
critical_fault_injected_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
critical_fault_epoch="$(date -u +%s)"

kubectl -n "$test_namespace" apply \
  -f ops/observability/fixtures/unavailable-metrics-probe.yaml

kubectl -n "$test_namespace" wait \
  --for=condition=Ready \
  pod/unavailable-metrics-probe \
  --timeout=60s

probe_ip="$(
  kubectl -n "$test_namespace" get pod unavailable-metrics-probe \
    -o jsonpath='{.status.podIP}'
)"
probe_target="${probe_ip}:65535"

echo "Probe target: $probe_target"
echo "Fault injected at: $critical_fault_injected_at"

echo "=== WAITING FOR SRETARGETDOWN ALERTING STATE ==="
critical_alerting_epoch=""
until [ -n "$critical_alerting_epoch" ]; do
  state="$(
    curl -fsS \
      -u "$grafana_user:$grafana_password" \
      --resolve grafana.local:8080:127.0.0.1 \
      http://grafana.local:8080/api/prometheus/grafana/api/v1/alerts |
    jq -r --arg target "$probe_target" '
      .data.alerts[]? |
      select(.labels.alertname == "SRETargetDown" and (.labels.instance // "" | contains($target))) |
      .state
    ' || true
  )"

  if [[ "$state" =~ "Alerting" ]] || [[ "$state" =~ "firing" ]]; then
    critical_alerting_epoch="$(date -u +%s)"
    echo "SRETargetDown reached Alerting state at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    break
  fi
  sleep 5
done

mttd_critical_sec=$(( critical_alerting_epoch - critical_fault_epoch ))
echo "MTTD Critical: ${mttd_critical_sec}s"

# Step 3: Test Warning Route (PodRestartLoop)
echo "=== STEP 3: PROVISIONING RESTART LOOP PROBE (WARNING ROUTE) ==="
warning_fault_injected_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
warning_fault_epoch="$(date -u +%s)"

kubectl -n "$test_namespace" apply \
  -f ops/observability/fixtures/restart-loop-probe.yaml

echo "=== WAITING FOR POD RESTARTS >= 3 ==="
until [ "$(kubectl -n "$test_namespace" get pod restart-loop-probe -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo 0)" -ge 3 ]; do
  sleep 3
done

echo "Pod restart loop count >= 3 reached"

warning_alerting_epoch=""
until [ -n "$warning_alerting_epoch" ]; do
  state="$(
    curl -fsS \
      -u "$grafana_user:$grafana_password" \
      --resolve grafana.local:8080:127.0.0.1 \
      http://grafana.local:8080/api/prometheus/grafana/api/v1/alerts |
    jq -r --arg ns "$test_namespace" '
      .data.alerts[]? |
      select(.labels.alertname == "PodRestartLoop" and .labels.pod == "restart-loop-probe" and .labels.namespace == $ns) |
      .state
    ' || true
  )"

  if [[ "$state" =~ "Alerting" ]] || [[ "$state" =~ "firing" ]]; then
    warning_alerting_epoch="$(date -u +%s)"
    echo "PodRestartLoop reached Alerting state at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    break
  fi
  sleep 5
done

mttd_warning_sec=$(( warning_alerting_epoch - warning_fault_epoch ))
echo "MTTD Warning: ${mttd_warning_sec}s"

# Step 4: Cleanup & Recovery (RESOLVED)
echo "=== STEP 4: RECOVERY & RESOLUTION TEST ==="
recovery_start_epoch="$(date -u +%s)"

kubectl delete namespace "$test_namespace" --wait=true

recovery_finished_epoch="$(date -u +%s)"

echo "=== WAITING FOR ALL TEST ALERTS TO RESOLVE ==="
until ! curl -fsS \
  -u "$grafana_user:$grafana_password" \
  --resolve grafana.local:8080:127.0.0.1 \
  http://grafana.local:8080/api/prometheus/grafana/api/v1/alerts |
  jq -e --arg ns "$test_namespace" '
    any(
      .data.alerts[]?;
      ((.labels.namespace // "") == $ns or (.labels.instance // "" | contains($ns))) and .state == "Alerting"
    )
  ' >/dev/null 2>&1; do
  sleep 5
done

resolved_epoch="$(date -u +%s)"
resolution_time_sec=$(( resolved_epoch - recovery_start_epoch ))

end_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
end_epoch="$(date -u +%s)"
total_duration_sec=$(( end_epoch - start_epoch ))

# Step 5: Save Sanitized JSON Report
cat <<EOF > "$report_file"
{
  "test_id": "${test_id}",
  "test_namespace": "${test_namespace}",
  "started_at": "${start_time}",
  "finished_at": "${end_time}",
  "total_duration_seconds": ${total_duration_sec},
  "metrics": {
    "mttd_critical_seconds": ${mttd_critical_sec},
    "mttd_warning_seconds": ${mttd_warning_sec},
    "resolution_time_seconds": ${resolution_time_sec}
  },
  "status": "PASSED"
}
EOF

echo "=== TEST COMPLETED SUCCESSFULLY ==="
echo "Report saved to: ${report_file}"
cat "$report_file"
