# Avaliação real de contexto

Este avaliador chama os provedores configurados no bot `dev`, o Jev e dois servidores MCP reais. Usa o MCP Oinko somente para consulta e modifica apenas um projeto Git descartável de avaliação. Há consumo real de API. Não envia mensagens pelo Telegram.

Requisitos: Node 22, pacotes compilados, Dev cadastrado com modelo principal, modelo fast, chave do provedor, chave TypeSafe e MCP `oinko` local.

Na raiz do repositório:

```sh
node packages/oinko/scripts/context-evaluation/run.mjs minha-base
OINKO_EVAL_CONTEXT='{"enabled":true}' node packages/oinko/scripts/context-evaluation/run.mjs minha-avaliacao
```

Cada nome deve ser novo. O avaliador se recusa a sobrescrever uma rodada. Cada diretório em `.harness/context-evaluation/` contém `results.json`, cenários, bancos SQLite e projeto inicial. `results.json` guarda respostas, critérios, ferramentas, chamadas e uso dos provedores, inclusive resumos e Jev. Confira `passed` de todos os cenários: uma rodada concluída pode conter falhas funcionais.

Compare apenas rodadas com os mesmos cenários, prompts, modelos e condições iniciais. Some tokens do LLM e do Jev; custo monetário ausente não significa zero. Dados brutos ficam fora do Git porque as consultas ao Oinko podem conter informações locais.

Os resultados de entrega e as limitações estão em [CONTEXT-EVALUATION.md](../../../../docs/dashboard/CONTEXT-EVALUATION.md). As fontes congeladas das medições originais foram guardadas junto às evidências; a formatação posterior não altera os cenários nem seus critérios.
