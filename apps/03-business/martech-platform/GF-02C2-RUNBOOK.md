# GF-02C.2 — Publicação controlada

## Escopo da fase A

A fase A publica a infraestrutura operacional de split sem permitir sua execução.

- imagem: `ghcr.io/dolfino/martech-platform@sha256:03d3166d4bee3bc02cc25bb668b429b2dfcf8b61cc68026b92e2fb350db120bd`
- commit da aplicação: `e1a238bb532e537d338a137e3ae5766126f4050a`
- `IDENTITY_SPLIT_ENABLED=false`
- rollout `Recreate`, sem coexistência entre versões da aplicação
- nenhuma operação real de split faz parte desta fase

## Evidência de proteção de dados

Backup consistente criado antes da publicação:

- arquivo no VPS: `/root/backups/martech-gf02c2/martech-platform-20261110T135017Z.dump`
- tamanho: `190705` bytes
- SHA-256: `bd432970111038cbe119dc6d1c3b10b9990d0d25c706c19e8a78191ac2f82b17`
- restauração isolada: aprovada
- contagens comparadas: `customer_profiles`, `identity_merge_operations`,
  `identity_merge_provenance`, `integration_outbox`, `lead_submissions` e
  `schema_migrations`

O banco temporário usado para o ensaio de restauração foi removido. O dump deve
ser preservado até o encerramento da GF-02C.2.

## Validação da fase A

1. Confirmar Argo CD `Synced/Healthy`.
2. Confirmar Deployment e pod `1/1`, sem reinícios.
3. Confirmar o digest efetivo da imagem.
4. Confirmar `IDENTITY_SPLIT_ENABLED=false` no Deployment e no processo.
5. Confirmar `GET /health` com HTTP 200.
6. Confirmar acesso de leitura à auditoria de identidade.
7. Com sessão `platform-superadmin`, confirmar que `POST .../split-plan` retorna
   `409 identity_split_disabled` e não cria plano nem operação.
8. Confirmar que a outbox não contém dead-letter inesperada e que não surgiu
   operação de split durante o smoke.
9. Conferir logs por falhas de migração, reconciliação ou autenticação.

## Rollback da fase A

Rollback da aplicação:

1. Restaurar a imagem anterior:
   `ghcr.io/dolfino/martech-platform@sha256:5ab23ec8c472cfc3bf4c3dc03bc5813e74190918799de2f1726ebccd6a3e2096`.
2. Manter `IDENTITY_SPLIT_ENABLED=false`.
3. Sincronizar o Argo CD e aguardar `Synced/Healthy`.
4. Repetir health check e smoke de leitura.

As migrações da fase A são expansivas: adicionam coluna, tabelas, índices e
estados aceitos pela outbox. A versão anterior ignora essas estruturas. Não se
deve remover fatos ou estruturas durante o rollback da aplicação.

Recuperação de dados é uma ação separada e excepcional. Somente restaurar o dump
se houver corrupção confirmada e após decisão operacional explícita, pois isso
substitui fatos gravados depois do backup.

## Segundo Go/No-Go — fase B

A publicação passiva não autoriza splits. A fase B exige:

- fase A estável e sem dead-letter inesperada;
- autorização `identity:split` atribuída explicitamente;
- operador, merge e justificativa previamente aprovados;
- dry-run revisado imediatamente antes da execução;
- acompanhamento da outbox até estado `completed`;
- confirmação da reconciliação do Chatwoot e dos invariantes locais;
- plano de interrupção imediata pela feature flag.
