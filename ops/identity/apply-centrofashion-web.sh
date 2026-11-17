#!/bin/sh
set -eu

kcadm=/opt/keycloak/bin/kcadm.sh
config=/tmp/kcadm-centrofashion-web.config
partial=/tmp/centrofashion-web.partial-import.json

cleanup() {
  rm -f "$config" "$partial"
}
trap cleanup EXIT

"$kcadm" config credentials \
  --config "$config" \
  --server http://127.0.0.1:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

cat > "$partial" <<'JSON'
{
  "ifResourceExists": "SKIP",
  "roles": {
    "realm": [
      {
        "name": "merchant",
        "description": "Lojista autenticado com vinculo de loja"
      }
    ]
  },
  "clients": [
    {
      "clientId": "centrofashion-web",
      "name": "Site Centro Fashion - Lojistas",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": true,
      "bearerOnly": false,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": false,
      "rootUrl": "https://qez.com.br",
      "baseUrl": "https://qez.com.br/",
      "redirectUris": [
        "https://qez.com.br/*",
        "https://www.qez.com.br/*",
        "http://localhost:3000/*",
        "http://127.0.0.1:3000/*"
      ],
      "webOrigins": [
        "https://qez.com.br",
        "https://www.qez.com.br",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
      ],
      "attributes": {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": "https://qez.com.br/*##https://www.qez.com.br/*"
      },
      "protocolMappers": [
        {
          "name": "store-id",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-attribute-mapper",
          "consentRequired": false,
          "config": {
            "user.attribute": "store_id",
            "claim.name": "store_id",
            "jsonType.label": "String",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true",
            "multivalued": "false"
          }
        }
      ],
      "defaultClientScopes": ["web-origins", "acr", "roles", "profile"]
    }
  ]
}
JSON

"$kcadm" create partialImport -r qez --config "$config" -f "$partial" >/dev/null
"$kcadm" get roles/merchant -r qez --config "$config" >/dev/null

client_json=$("$kcadm" get clients -r qez --config "$config" -q clientId=centrofashion-web --fields id)
client_id=$(printf '%s' "$client_json" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | cut -d '"' -f 4)
if [ -z "$client_id" ]; then
  echo 'centrofashion-web was not created' >&2
  exit 1
fi

"$kcadm" get "clients/$client_id/protocol-mappers/models" -r qez --config "$config" | grep -q '"name" : "store-id"'
echo 'centrofashion-web, merchant role and store-id mapper are ready.'
