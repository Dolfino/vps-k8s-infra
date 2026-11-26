# n8n

The n8n workload is reconciled by the `n8n` Argo CD application. Workflow
definitions that are maintained as code live under `ops/n8n/`.

## Runtime dependencies

The namespace must contain these runtime secrets before a fresh deployment:

- `n8n-runner-token`
- `n8n-chatwoot-runtime`, with the key `CHATWOOT_BOT_TOKEN`

Secret values are intentionally not committed to Git. Back up and restore them
through the cluster's secret-management procedure.

The commercial routing workflow is generated from
`ops/n8n/commercial-routing-workflow.mjs` and published in n8n with the stable
workflow ID `cfCommercialRouting001`.

The workflow contains Portuguese accents and WhatsApp emoji. When publishing
from Windows, do not pipe the generated JSON through PowerShell into SSH: that
text pipeline can replace UTF-8 characters with `?`. Transfer the `.mjs` file
without text conversion, render the JSON inside the Linux n8n container, import
that file, and then publish the current workflow version.

## Commercial WhatsApp routing

Inbox 10 uses a two-level service tree:

- new business first asks for the desired space type; only after that answer
  does it receive the `enviar-kanban` label, avoiding incomplete Kanban cards;
- `Quiosque` and `Espaco para acao ou exposicao` are assigned exclusively to
  Thalyta Carolyne Bernardo da Silva Marques (agent 20); store, box and an
  undefined space remain in the five-broker rotation; her Chatwoot account is
  excluded from native automatic distribution and receives these leads by
  explicit workflow assignment;
- after the handoff, a new greeting receives one confirmation that a broker
  will continue the conversation; subsequent messages remain with the human;
- `menu`, `novo assunto`, `outro assunto`, or `0` restarts the service tree
  while preserving conversation history and any existing Kanban card;
- current tenant requests receive subject labels and are initially assigned to
  the commercial support analyst for manual sector handoff;
- tenant option 7 (`CEOP e autorizações operacionais`) is assigned to the
  `ceop - central de operações` team (team 5), whose members are David
  Nascimento da Silva and David Silva;
- incoming conversations from `WhatsApp - CEOP` (inbox 11) are labeled
  `setor-ceop` and assigned to the same CEOP team, without displaying the
  commercial menu;
- store and product searches are assigned to commercial support;
- marketing requests are assigned to the `marketing` team;
- marketing option 6 (`Relacionamento com lojistas`) is assigned directly to
  Emily Viana Cunha (agent 7); incoming conversations from `WhatsApp - CF
  Empreendedor` (inbox 6) are also labeled `assunto-relacionamento-lojistas`
  and assigned to Emily, without displaying the commercial menu;
- hotel requests are assigned to the `hotel` team;
- resolving a conversation removes routing labels so a future message starts a
  new service tree.

Leads marked as `recuperacao-ativa` are handled before the service tree. On the
first customer reply, the workflow removes the active recovery and owner
labels, adds `recuperacao-respondida`, assigns the conversation back to the
original broker encoded in `recuperacao-corretor-{id}`, and moves the contact
to `Em contato`. No bot menu or automatic message is sent in this path.

Run the offline routing tests with:

```sh
node ops/n8n/commercial-routing-workflow.test.mjs
```
