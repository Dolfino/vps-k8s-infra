# Chatwoot no K3s

Instalação em `chatwoot.ideiasmkt.com.br` no nó `srv910054`. O chart oficial Chatwoot 2.0.25 instala a aplicação v4.16.2; seus subcharts PostgreSQL e Redis estão desativados. A instância usa os serviços compartilhados no namespace `storage`, com banco, usuário e bucket exclusivos.

## Estado da implantação

Implantado em 2026-09-29. Argo CD mostra `cert-manager`, `cert-issuer`, `storage`, `chatwoot-runtime`, `chatwoot-routing` e `chatwoot` como `Synced/Healthy`. Web e worker estão `1/1`. `https://chatwoot.ideiasmkt.com.br/health` responde 200 com certificado Let's Encrypt; HTTP redireciona para HTTPS. O primeiro administrador concluiu o onboarding, e `ENABLE_ACCOUNT_SIGNUP=false` foi confirmado no banco. O acesso ao bucket `chatwoot-media` foi testado com as credenciais dedicadas por listagem, gravação, leitura e remoção de um objeto temporário. A autenticação SMTP Gmail foi testada sem enviar mensagem.

## Configuração e manutenção

1. O CNAME `chatwoot.ideiasmkt.com.br` → `manager01.ideiasmkt.com.br` já existe na Cloudflare em modo DNS-only e resolve para `103.199.187.141` (verificado em 2026-09-28). O script `ops/dns/ensure-chatwoot-record.py` serve para conferir ou reparar esse registro no futuro; para executá-lo, exige `CLOUDFLARE_API_TOKEN` com Zone Read e DNS Write. Sem `--apply`, apenas mostra a alteração.
2. cert-manager v1.21.2 e o `ClusterIssuer` Let’s Encrypt estão declarados em `bootstrap/01-*`. Os Ingresses do Chatwoot e do MinIO renovam automaticamente os certificados `business/chatwoot-tls` e `storage/s3-tls`.
3. SMTP Gmail está preparado em `values.yaml` (porta 587 com STARTTLS). `SMTP_USERNAME`, `SMTP_PASSWORD` (senha de app) e `MAILER_SENDER_EMAIL` estão no Secret SOPS `chatwoot-runtime-auth`; não usar a senha normal da conta Google. Após implantar, enviar e receber um e-mail de teste.

### Facebook Messenger e Instagram

`FB_APP_ID`, `FB_APP_SECRET` e `FB_VERIFY_TOKEN` ficam no Secret SOPS `chatwoot-runtime-auth`. O callback Messenger na Meta é `https://chatwoot.ideiasmkt.com.br/bot`; o token informado lá precisa ser exatamente o `FB_VERIFY_TOKEN` configurado aqui. Depois de sincronizar o Secret, reinicie web e worker para carregar as variáveis e crie a caixa de entrada Facebook no painel. A autorização da página ocorre pelo login da Meta no Chatwoot; não armazene um token de acesso pessoal no Secret.

Em 2026-09-28, o Secret foi sincronizado, as três chaves foram gravadas também em `InstallationConfig` (a versão instalada conserva entradas vazias no banco e não as substitui automaticamente pelo ambiente), e web/worker foram reiniciados. A Meta confirmou a assinatura do objeto `page` com callback `/bot` e os campos `messages`, `message_deliveries`, `message_echoes`, `message_reads` e `messaging_postbacks`. O App ID aparece no HTML do Chatwoot; falta autorizar uma página pelo painel.

Limitação observada na imagem Chatwoot v4.16.2: `ChatwootFbProvider#valid_verify_token?` retorna a string configurada sem compará-la à recebida. Assim, o GET de verificação do `/bot` aceita até token incorreto. Um POST com assinatura HMAC inválida foi rejeitado com HTTP 400. Corrigir esse método em atualização ou imagem customizada antes de depender do verify token como controle de acesso; a assinatura dos eventos continua sendo verificada.

O Instagram Business Login ainda exige `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`, obtidos na configuração do produto Instagram na Meta. `INSTAGRAM_VERIFY_TOKEN` foi gerado no `.env` local, aplicado ao Secret SOPS e a `InstallationConfig`, e o GET público de verificação do webhook foi testado: token correto devolveu o desafio com HTTP 200; token incorreto recebeu HTTP 401. Seus URLs são `https://chatwoot.ideiasmkt.com.br/webhooks/instagram` para o webhook e `https://chatwoot.ideiasmkt.com.br/instagram/callback` para o redirecionamento do login. Não reutilize as credenciais do Facebook como se fossem as do produto Instagram. O `IG_VERIFY_TOKEN` pertence ao fluxo antigo via Facebook Login.

Consulta de leitura à Graph API com token de usuário Meta em 2026-09-29 confirmou acesso à página `Centro Fashion Fortaleza`, mas não retornou `instagram_business_account` nem `connected_instagram_account` para ela. O token tem permissões de páginas e Messenger, sem permissões de Instagram. O site oficial do Centro Fashion menciona `@centrofashionfor` como perfil Instagram; confirmar com o proprietário antes de vincular esse perfil. O token de usuário não revela a chave secreta do produto Instagram.

O usuário decidiu operar sem backup do banco `chatwoot_production` e do bucket `chatwoot-media`. Esses dados podem ser perdidos permanentemente se o armazenamento ou a VPS falhar. Os scripts em `ops/disaster-recovery/` são exclusivos do laboratório `k3d-lab-sre` e não protegem esta implantação.

## Sequência de implantação

1. Publicar as mudanças deste repositório na branch `main` após revisão.
2. Aplicar `bootstrap/01-cert-manager-application.yaml` e esperar controller/webhook prontos. Depois aplicar `bootstrap/01-cert-issuer-application.yaml` e esperar `ClusterIssuer/letsencrypt-prod` pronto.
3. Confirmar que o CNAME existente continua resolvendo para `103.199.187.141` e está em modo DNS-only. Só usar o script e o token Cloudflare se for necessário corrigir o registro.
4. Sincronizar a Application `storage` já existente. Ela cria os Secrets SOPS, o banco PostgreSQL, as extensões e o bucket MinIO com usuário dedicado, além de solicitar o certificado `s3-tls`. Verificar os Jobs `chatwoot-database-bootstrap` e `chatwoot-minio-bootstrap` e confirmar `https://s3.ideiasmkt.com.br` com certificado válido.
5. Aplicar `bootstrap/03-chatwoot-runtime-application.yaml` no Argo CD e aguardar o Secret `business/chatwoot-runtime-auth`.
6. Aplicar `bootstrap/03-chatwoot-routing-application.yaml` e depois `bootstrap/03-chatwoot-application.yaml`. A primeira Application configura o redirecionamento HTTP→HTTPS no Traefik. A segunda lê `values.yaml` pelo recurso multi-source do Argo CD e executa o Job de migração como PreSync, antes de iniciar web/worker. `FORCE_SSL=false` permite que as sondagens internas usem HTTP; o ingresso público redireciona para HTTPS. Confirmar o certificado `chatwoot-tls`.
7. Confirmar pods web/worker, Job `chatwoot-migrate` e `https://chatwoot.ideiasmkt.com.br/health`. O cadastro público está desativado (`env.ENABLE_ACCOUNT_SIGNUP=false`); o primeiro superadministrador é criado pela página `/installation/onboarding`, cujo fluxo é independente dessa variável. Concluir o onboarding imediatamente para fechar a página inicial pública.

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
