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

O `secret-example.yaml` e estes manifestos não contêm credenciais reais.
