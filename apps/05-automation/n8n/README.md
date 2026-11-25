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
