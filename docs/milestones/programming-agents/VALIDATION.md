# Matriz de validação e critérios de entrega

**Status:** gates fixados em M00; resultados registrados por story. [Voltar ao plano](README.md).

## Gates comuns (toda story)

1. Testes da story escritos antes da implementação e executados: comando, revisão Git, resultado.
2. Checks agregados da raiz ao fechar o milestone: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
3. Negativa de permissão pertinente testada (bot sem acesso, ID adivinhado, projeto errado) e nenhuma condicional por nome/ID de bot (`grep` de IDs de piloto no código de domínio).
4. Eventos obrigatórios consultados no SQLite persistido, não apenas callbacks chamados.
5. Segredos plantados ausentes de SQLite, logs, respostas MCP e HTML da dashboard.
6. Limitações e partes não executadas (Docker, provedor, GitHub, Telegram reais) listadas como pendentes, nunca como aprovadas.

## Matriz

| Área | Casos determinísticos | Real |
| --- | --- | --- |
| Arquivos | busca Unicode/binário/ignore/milhares de ocorrências; range CRLF/sem newline/>200 KB; replace stale/ambíguo; patch multifile inválido; traversal e symlink | Sandbox Docker com monorepo |
| Concorrência | dois bots, mesma worktree, CAS de revisão, dois recuperadores, fila de três pedidos | Worker real + runner real |
| Restart | crash antes/depois do efeito, durante flush, entre escrita e recibo, após push/PR | Kill do runner e do worker |
| Controles | pause durante LLM/teste/patch/publicação; cancel repetido; resume inválido; processo resistente | Telegram/CLI/dashboard |
| Browser | redirects, IPv4/IPv6 privados, metadata, rebinding, subrequests, credenciais por projeto, elemento stale, console/rede redigidos | Container Chromium/Playwright |
| GitHub | JWT/token, instalação revogada, token expirado, hook/helper malicioso, conflito remoto, timeout antes/depois de push/PR, 429, SHA trocado | App real + repo de teste (operador) |
| Modelos | 15 s sem saída, heartbeat, 503, texto parcial, tool parcial, resposta tardia, dois modelos indisponíveis | Provedor real |
| Telemetria | envelope de todo o catálogo, dedupe, reordenação, captura full/hashed/none, retenção, expiração | — |

## Comandos

```bash
pnpm validate:programming                                        # tudo abaixo + relatório em validation-reports/
pnpm build && pnpm typecheck && pnpm lint && pnpm test          # gates agregados
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/environments test        # Docker real (runner, browser)
pnpm --filter @oinko/dashboard test:e2e                           # UI
pnpm --filter @oinko/agent-runtime test                           # runs, telemetria, avaliação
OINKO_DOCKER_TEST=1 pnpm --filter @oinko/bots exec vitest run tests/programming.e2e.test.ts tests/evaluation.e2e.test.ts  # worker + runner + harness
pnpm --filter @oinko/bots evaluate --bot <id> --dataset packages/bots/evaluation/programming-baseline.v1.json [--environment real]
```

## Relatório

Cada execução de suíte grava `validation_suite_started/finished` com SHA, ambiente e lista de skipped. Relatórios separam: teste automatizado, Docker real, provedor real e aceite humano. Um skipped impede afirmar cobertura do cenário. Relatórios gerados ficam em [`validation-reports/`](validation-reports/), um por revisão, inclusive os que registraram falhas.
