# Evolution API - Service Level Objectives (SLO)

| Indicador | Objetivo Inicial |
| :--- | ---: |
| Disponibilidade mensal | ≥ 99,5% |
| Erros HTTP 5xx | < 1% |
| Latência HTTP p95 | < 2 segundos |
| RPO de dados | ≤ 15 minutos |
| RTO de restauração | ≤ 60 minutos |
| Instância WhatsApp conectada | Estado `open` |

## Contexto e Premissas de Arquitetura

O ambiente VPS/K3s opera em arquitetura Slim single-replica. Os testes empíricos de disaster recovery demonstraram:
- **RPO Registrado**: 465 segundos (~7,75 minutos)
- **RTO Registrado**: 23 segundos (restauração lógica em cluster pré-existente)
