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

## Commercial WhatsApp routing

Inbox 10 uses a two-level service tree:

- new business first asks for the desired space type; only after that answer is
  it assigned to the five-broker rotation and receives the `enviar-kanban`
  label, avoiding incomplete Kanban cards;
- after the handoff, a new greeting receives one confirmation that a broker
  will continue the conversation; subsequent messages remain with the human;
- current tenant requests receive subject labels and are initially assigned to
  the commercial support analyst for manual sector handoff;
- store and product searches are assigned to commercial support;
- marketing requests are assigned to the `marketing` team;
- hotel requests are assigned to the `hotel` team;
- resolving a conversation removes routing labels so a future message starts a
  new service tree.

Run the offline routing tests with:

```sh
node ops/n8n/commercial-routing-workflow.test.mjs
```
