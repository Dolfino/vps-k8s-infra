# Chatwoot no K3s

Preparação para `chatwoot.ideiasmkt.com.br` no nó `srv910054`. O chart oficial Chatwoot 2.0.25 instala a aplicação v4.16.2; seus subcharts PostgreSQL e Redis estão desativados. A instância usa os serviços compartilhados no namespace `storage`, com banco, usuário e bucket exclusivos.

## Pré-requisitos para ativar

1. O script `ops/dns/ensure-chatwoot-record.py` prepara um A `chatwoot.ideiasmkt.com.br` → `103.199.187.141` na Cloudflare em modo DNS-only. Ele exige `CLOUDFLARE_API_TOKEN` com Zone Read e DNS Write; sem `--apply`, apenas mostra a alteração.
2. Instalar cert-manager v1.21.2 e o `ClusterIssuer` Let’s Encrypt preparado em `bootstrap/01-*`. Os Ingresses do Chatwoot e do MinIO solicitam automaticamente os Secrets TLS `business/chatwoot-tls` e `storage/s3-tls`. Atualmente `s3.ideiasmkt.com.br` mostra o certificado padrão, não confiável, do Traefik.
3. Configurar SMTP para convites e notificações por e-mail. Os valores atuais deixam o SMTP desativado.
4. Verificar que o backup da plataforma inclui o novo banco `chatwoot_production` e o bucket `chatwoot-media`. O script `ops/disaster-recovery/backup-lab.sh` atual enumera bancos e buckets específicos; ele precisa ser estendido antes do uso em produção.

## Sequência de implantação

1. Publicar as mudanças deste repositório na branch `main` após revisão.
2. Aplicar `bootstrap/01-cert-manager-application.yaml` e esperar controller/webhook prontos. Depois aplicar `bootstrap/01-cert-issuer-application.yaml` e esperar `ClusterIssuer/letsencrypt-prod` pronto.
3. Executar o script DNS primeiro sem `--apply` para revisão e depois com `--apply` usando token Cloudflare. Confirmar que o A record resolve para `103.199.187.141`.
4. Sincronizar a Application `storage` já existente. Ela cria os Secrets SOPS, o banco PostgreSQL, as extensões e o bucket MinIO com usuário dedicado, além de solicitar o certificado `s3-tls`. Verificar os Jobs `chatwoot-database-bootstrap` e `chatwoot-minio-bootstrap` e confirmar `https://s3.ideiasmkt.com.br` com certificado válido.
5. Aplicar `bootstrap/03-chatwoot-runtime-application.yaml` no Argo CD e aguardar o Secret `business/chatwoot-runtime-auth`.
6. Aplicar `bootstrap/03-chatwoot-application.yaml`. A Application lê `values.yaml` pelo recurso multi-source do Argo CD e executa o Job de migração do chart. Confirmar o certificado `chatwoot-tls`.
7. Confirmar pods web/worker, Job `chatwoot-migrate` e `https://chatwoot.ideiasmkt.com.br/health`. Criar a primeira conta e depois trocar `env.ENABLE_ACCOUNT_SIGNUP` para `false`.

## Validação local

```sh
helm repo add chatwoot https://chatwoot.github.io/charts
helm repo update chatwoot
helm template chatwoot chatwoot/chatwoot --version 2.0.25 --namespace business -f apps/03-business/chatwoot/values.yaml >/tmp/chatwoot-rendered.yaml
```

Os valores em `values.yaml` contêm marcadores para senhas. O Secret `chatwoot-runtime-auth`, criptografado com SOPS/age, os sobrescreve em web, worker e migração. Não inserir credenciais em valores Helm ou no histórico do shell.
