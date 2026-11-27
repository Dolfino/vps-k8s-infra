# Chatwoot Kanban — candidato de implantação

Estes manifestos preparam um serviço Kanban separado para o Chatwoot v4.17.0.
Eles **não estão ligados a uma Application do Argo CD**, portanto não são
implantados automaticamente. A imagem está fixada pelo digest imutável gerado
pela pipeline e o deployment referencia o `ghcr-secret` já utilizado no
namespace `business` para imagens privadas da conta `Dolfino`.

## Origem e licença

O protótipo avaliado está em `../../../../lab-kanban/chatwoot-kanban-fastapi` e
deriva de `CrisAlva1414/Chatwoot-Kanban`, sob MIT. As alterações locais incluem
autenticação do painel e correção da verificação de webhooks.

## Condições antes de habilitar

1. O `ghcr-secret` existente foi validado com um Pod efêmero e baixou o digest
   privado com sucesso em 2026-11-12. Não gravar o token neste repositório.
2. Manter a imagem fixada pelo digest em `deployment.yaml`; as tags publicadas
   são `latest` e `sha-0e9a3a2`, ambas apontando para o mesmo manifesto.
3. O banco e usuário PostgreSQL exclusivos são provisionados pelo Job
   `chatwoot-kanban-database-bootstrap` no app `storage`.
4. `chatwoot-kanban-runtime-auth` e `chatwoot-kanban-db-auth` são cifrados com
   SOPS/AGE e renderizados via KSOPS. O arquivo `secret-example.yaml` nunca deve
   ser incluído pelo Kustomize.
5. O agente `kanban-bot@ideiasmkt.com.br` foi criado como `agent` na conta 1.
6. Foram criados no Chatwoot os atributos de contato:
   `pipeline_01_etapas`, `kanban_view_mensaje` e
   `kanban_view_fecha_termino`.
   As etapas iniciais são: Novo, Em contato, Proposta, Negociação, Ganho e
   Perdido.
7. Foram criados webhooks separados para `contact_updated` e
   `conversation_updated`, usando o mesmo `CHATWOOT_WEBHOOK_SECRET` cifrado.
8. O Dashboard App `Kanban de Vendas` foi configurado com
   `https://kanban.ideiasmkt.com.br/kanban?access_token=<KANBAN_APP_TOKEN>`.
   O token é removido da URL e convertido em cookie `HttpOnly`.
9. Antes da mudança foi criado e validado o backup PostgreSQL
   `/root/backups/chatwoot/chatwoot-pre-kanban-20261112T140551Z.dump`, com
   SHA-256 `a44d5b2315090c17602234f4e83fb992ba44d722ee8335fad575436b03e66b55`.
10. Confirmar Application Argo CD, DNS, certificado TLS e smoke tests antes de
    liberar o painel aos agentes.

## Validação local

```sh
kubectl kustomize apps/03-business/chatwoot-kanban
```

## Canais automaticos em producao

Desde 2026-11-24, `KANBAN_AUTO_INBOX_IDS=9,10` limita a entrada automatica ao
formulario do site e ao WhatsApp Comercial. Os inboxes antigos de WhatsApp
continuam ativos no Chatwoot para atendimento e historico, mas nao alimentam
automaticamente o pipeline. A entrada manual por etiqueta esta desabilitada
para manter o quadro exclusivo desses dois canais.

`KANBAN_IDENTITY_SECRET` tem o mesmo valor nos secrets SOPS do Chatwoot e do
Kanban. Ele assina a identidade do usuário logado para manter os cards ativos
visíveis ao corretor responsável e compartilhar a etapa `Perdido` com o time
comercial.

O `secret-example.yaml` e estes manifestos não contêm credenciais reais.

## Quadros por time e cadastro manual

O Chatwoot usa os times Comercial (2), Hotel (3) e Financeiro (4). Os quadros
setoriais exigem vínculo com o time e com o canal da conversa. O quadro
Comercial preserva as etapas do atributo de contato existente.

O botão **Novo lead** no Kanban web usa o canal API **Cadastro manual de
leads** (12), sem distribuição automática ou webhook de saída. A
configuração efetiva dos canais automáticos foi conferida antes do deploy:
`KANBAN_AUTO_INBOX_IDS=9`. A release mantém esse valor.

Para reverter a ativação, reverta a revisão GitOps que adiciona as configurações
e fixa o novo digest no Deployment e no CronJob. Preserve os contatos,
conversas, etapas e reservas criados durante o uso.
