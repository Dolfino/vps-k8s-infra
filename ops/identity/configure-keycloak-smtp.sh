#!/bin/sh
set -eu

namespace=business
identity_secret=identity-runtime
smtp_secret=chatwoot-runtime-auth

pod=$(kubectl -n "$namespace" get pod \
  -l app.kubernetes.io/name=identity-platform \
  -o jsonpath='{.items[0].metadata.name}')

admin_user_b64=$(kubectl -n "$namespace" get secret "$identity_secret" -o jsonpath='{.data.KC_BOOTSTRAP_ADMIN_USERNAME}')
admin_password_b64=$(kubectl -n "$namespace" get secret "$identity_secret" -o jsonpath='{.data.KC_BOOTSTRAP_ADMIN_PASSWORD}')
smtp_user_b64=$(kubectl -n "$namespace" get secret "$smtp_secret" -o jsonpath='{.data.SMTP_USERNAME}')
smtp_password_b64=$(kubectl -n "$namespace" get secret "$smtp_secret" -o jsonpath='{.data.SMTP_PASSWORD}')

for value in "$admin_user_b64" "$admin_password_b64" "$smtp_user_b64" "$smtp_password_b64"; do
  if [ -z "$value" ]; then
    echo 'Required Keycloak or SMTP Secret value is missing.' >&2
    exit 1
  fi
done

{
  printf 'ADMIN_USER_B64=%s\n' "$admin_user_b64"
  printf 'ADMIN_PASSWORD_B64=%s\n' "$admin_password_b64"
  printf 'SMTP_USER_B64=%s\n' "$smtp_user_b64"
  printf 'SMTP_PASSWORD_B64=%s\n' "$smtp_password_b64"
  cat <<'POD_SCRIPT'
set -eu
kcadm=/opt/keycloak/bin/kcadm.sh
config=/tmp/kcadm-smtp.config

cleanup() {
  rm -f "$config"
}
trap cleanup EXIT

decode() {
  printf '%s' "$1" | base64 -d
}

admin_user=$(decode "$ADMIN_USER_B64")
admin_password=$(decode "$ADMIN_PASSWORD_B64")
smtp_user=$(decode "$SMTP_USER_B64")
smtp_password=$(decode "$SMTP_PASSWORD_B64")

"$kcadm" config credentials \
  --config "$config" \
  --server http://127.0.0.1:8080 \
  --realm master \
  --user "$admin_user" \
  --password "$admin_password" >/dev/null

"$kcadm" update realms/qez --config "$config" \
  -s resetPasswordAllowed=true \
  -s smtpServer.host=smtp.gmail.com \
  -s smtpServer.port=587 \
  -s "smtpServer.from=$smtp_user" \
  -s 'smtpServer.fromDisplayName=Centro Fashion' \
  -s smtpServer.auth=true \
  -s smtpServer.starttls=true \
  -s smtpServer.ssl=false \
  -s "smtpServer.user=$smtp_user" \
  -s "smtpServer.password=$smtp_password" >/dev/null
realm=$("$kcadm" get realms/qez --config "$config")
case "$realm" in *'"resetPasswordAllowed" : true'*) :;; *) exit 1;; esac
case "$realm" in *'"host" : "smtp.gmail.com"'*) :;; *) exit 1;; esac
case "$realm" in *'"auth" : "true"'*) :;; *) exit 1;; esac
case "$realm" in *'"starttls" : "true"'*) :;; *) exit 1;; esac
echo 'Keycloak password reset and SMTP are configured.'
POD_SCRIPT
} | kubectl -n "$namespace" exec -i "$pod" -- sh
