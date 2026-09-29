# Chatwoot no K3s

Preparação para `chatwoot.ideiasmkt.com.br` no nó `srv910054`. O chart oficial Chatwoot 2.0.25 instala a aplicação v4.16.2; seus subcharts PostgreSQL e Redis estão desativados. A instância usa os serviços compartilhados no namespace `storage`, com banco, usuário e bucket exclusivos.

## Pré-requisitos para ativar

1. O CNAME `chatwoot.ideiasmkt.com.br` → `manager01.ideiasmkt.com.br` já existe na Cloudflare em modo DNS-only e resolve para `103.199.187.141` (verificado em 2026-09-28). O script `ops/dns/ensure-chatwoot-record.py` serve para conferir ou reparar esse registro no futuro; para executá-lo, exige `CLOUDFLARE_API_TOKEN` com Zone Read e DNS Write. Sem `--apply`, apenas mostra a alteração.
2. Instalar cert-manager v1.21.2 e o `ClusterIssuer` Let’s Encrypt preparado em `bootstrap/01-*`. Os Ingresses do Chatwoot e do MinIO solicitam automaticamente os Secrets TLS `business/chatwoot-tls` e `storage/s3-tls`. Atualmente `s3.ideiasmkt.com.br` mostra o certificado padrão, não confiável, do Traefik.
3. SMTP Gmail está preparado em `values.yaml` (porta 587 com STARTTLS). `SMTP_USERNAME`, `SMTP_PASSWORD` (senha de app) e `MAILER_SENDER_EMAIL` estão no Secret SOPS `chatwoot-runtime-auth`; não usar a senha normal da conta Google. Após implantar, enviar e receber um e-mail de teste.

O usuário decidiu operar sem backup do banco `chatwoot_production` e do bucket `chatwoot-media`. Esses dados podem ser perdidos permanentemente se o armazenamento ou a VPS falhar. Os scripts em `ops/disaster-recovery/` são exclusivos do laboratório `k3d-lab-sre` e não protegem esta implantação.

## Sequência de implantação

1. Publicar as mudanças deste repositório na branch `main` após revisão.
2. Aplicar `bootstrap/01-cert-manager-application.yaml` e esperar controller/webhook prontos. Depois aplicar `bootstrap/01-cert-issuer-application.yaml` e esperar `ClusterIssuer/letsencrypt-prod` pronto.
3. Confirmar que o CNAME existente continua resolvendo para `103.199.187.141` e está em modo DNS-only. Só usar o script e o token Cloudflare se for necessário corrigir o registro.
4. Sincronizar a Application `storage` já existente. Ela cria os Secrets SOPS, o banco PostgreSQL, as extensões e o bucket MinIO com usuário dedicado, além de solicitar o certificado `s3-tls`. Verificar os Jobs `chatwoot-database-bootstrap` e `chatwoot-minio-bootstrap` e confirmar `https://s3.ideiasmkt.com.br` com certificado válido.
5. Aplicar `bootstrap/03-chatwoot-runtime-application.yaml` no Argo CD e aguardar o Secret `business/chatwoot-runtime-auth`.
6. Aplicar `bootstrap/03-chatwoot-application.yaml`. A Application lê `values.yaml` pelo recurso multi-source do Argo CD e executa o Job de migração como PreSync, antes de iniciar web/worker. Confirmar o certificado `chatwoot-tls`.
7. Confirmar pods web/worker, Job `chatwoot-migrate` e `https://chatwoot.ideiasmkt.com.br/health`. Criar a primeira conta e depois trocar `env.ENABLE_ACCOUNT_SIGNUP` para `false`.

## Validação local

```sh
helm repo add chatwoot https://chatwoot.github.io/charts
helm repo update chatwoot
helm template chatwoot chatwoot/chatwoot --version 2.0.25 --namespace business -f apps/03-business/chatwoot/values.yaml >/tmp/chatwoot-rendered.yaml
```

Os valores em `values.yaml` contêm marcadores para senhas. O Secret `chatwoot-runtime-auth`, criptografado com SOPS/age, os sobrescreve em web, worker e migração. Não inserir credenciais em valores Helm ou no histórico do shell.

Se o DNS precisar de reparo, o token pode ficar no `.env` local do checkout Chatwoot, fora do Git. O script lê apenas a chave `CLOUDFLARE_API_TOKEN` desse arquivo, sem executá-lo:

```sh
python3 ops/dns/ensure-chatwoot-record.py --env-file ../Chatwoot/.env
```

Após revisar a prévia, acrescentar `--apply` para gravar a alteração. O token continua desnecessário enquanto o CNAME atual estiver correto.
