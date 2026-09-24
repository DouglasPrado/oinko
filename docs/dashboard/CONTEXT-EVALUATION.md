# Avaliação real de contexto e ferramentas

Comparação: `baseline-v2` → `after-confirmation`. Mesmos 16 cenários, mensagens, critérios, projeto inicial, modelos e avaliador. Hashes conferidos automaticamente.

| Medida | Antes | Depois | Variação |
| --- | ---: | ---: | ---: |
| Tokens de entrada do LLM (inclui resumos) | 732.570 | 215.344 | -70.6% |
| Tokens de saída do LLM (inclui resumos/raciocínio) | 2.243 | 7.346 | +227.5% |
| Tokens de entrada do Jev (todas as decisões) | 21.281 | 99.249 | +366.4% |
| Tokens de saída do Jev | 524 | 9.857 | +1781.1% |
| Tokens totais LLM + Jev | 756.618 | 331.796 | -56.1% |
| Acertos | 15/16 | 16/16 | |
| Custo LLM confirmado pelo OpenRouter | US$ 0.062455 | US$ 0.040478 | -35.2% |
| Tempo somado dos cenários | 129.0 s | 254.1 s | +97.0% |
| Mediana por cenário | 7.2 s | 8.2 s | |
| Chamadas LLM / Jev | 30 / 22 | 35 / 33 | |

O custo monetário do Jev não foi fornecido pela API. Portanto, a linha de custo é do LLM, **não do sistema inteiro**. Os tokens do Jev estão incluídos no total. O OpenRouter pode aplicar cache; os valores de custo acima são os retornados nas respostas, não estimativas por tabela de preços. A latência é uma observação dessas rodadas e varia com os provedores.

## Casos

| Cenário | Acerto antes → depois | Entrada LLM antes → depois | Total LLM + Jev antes → depois | Tempo antes → depois |
| --- | --- | ---: | ---: | ---: |
| `agreement` | 0 → 1 | 21.252 → 3.497 | 24.351 → 8.558 | 19.9s → 3.7s |
| `oinko-read` | 1 → 1 | 28.837 → 12.241 | 32.154 → 21.088 | 9.5s → 6.2s |
| `inspect` | 1 → 1 | 33.292 → 11.560 | 34.788 → 18.486 | 13.0s → 11.8s |
| `report-1` | 1 → 1 | 36.856 → 15.616 | 38.879 → 23.101 | 9.7s → 7.9s |
| `report-2` | 1 → 1 | 42.788 → 17.588 | 44.706 → 24.987 | 3.6s → 7.1s |
| `report-3` | 1 → 1 | 48.510 → 19.402 | 50.428 → 28.019 | 4.8s → 43.0s |
| `report-4` | 1 → 1 | 54.232 → 18.166 | 56.150 → 27.080 | 9.7s → 65.3s |
| `report-5` | 1 → 1 | 59.954 → 17.598 | 61.872 → 26.543 | 2.5s → 15.7s |
| `report-6` | 1 → 1 | 65.676 → 17.167 | 67.594 → 26.178 | 3.3s → 30.7s |
| `restart-recall` | 1 → 1 | 34.318 → 7.598 | 34.359 → 14.828 | 2.0s → 8.4s |
| `old-detail` | 1 → 1 | 34.400 → 6.953 | 34.449 → 13.190 | 2.2s → 3.8s |
| `continue` | 1 → 1 | 138.618 → 36.443 | 140.637 → 44.576 | 8.7s → 16.6s |
| `switch-tools` | 1 → 1 | 70.274 → 13.656 | 70.760 → 20.355 | 5.7s → 6.6s |
| `isolation` | 1 → 1 | 18.061 → 7.135 | 19.170 → 12.715 | 9.3s → 23.0s |
| `fast-greeting` | 1 → 1 | 10.263 → 3.790 | 10.684 → 8.849 | 21.1s → 2.1s |
| `fast-context` | 1 → 1 | 35.239 → 6.934 | 35.637 → 13.243 | 3.8s → 2.3s |

## Rodadas preservadas

| Rodada | Acertos | Tokens totais | Custo LLM | Tempo |
| --- | ---: | ---: | ---: | ---: |
| `baseline-v2` | 15/16 | 756.618 | US$ 0.062455 | 129.0s |
| `after-stage1` | 15/16 | 375.240 | US$ 0.056622 | 220.4s |
| `after-stage2` | 14/16 | 352.388 | US$ 0.043996 | 134.4s |
| `after-stage3` | 16/16 | 337.138 | US$ 0.048315 | 156.8s |
| `after-final` | 15/16 | 325.458 | US$ 0.041827 | 139.2s |
| `after-retrieval-fix` | 15/16 | 336.988 | US$ 0.042156 | 148.9s |
| `after-grounded-recall` | 16/16 | 339.676 | US$ 0.046426 | 282.9s |
| `after-confirmation` | 16/16 | 331.796 | US$ 0.040478 | 254.1s |

A primeira tentativa `baseline-v1` foi invalidada por um erro no coletor de nomes das ferramentas; foi preservada e não entra no comparativo. O coletor foi corrigido antes da medição válida. Nenhum cenário ou critério foi afrouxado depois dela.

Na base, o agente chamou ferramentas desnecessariamente ao apenas confirmar instruções. As etapas intermediárias detectaram falhas de continuidade, resumo truncado e recuperação de detalhe antigo. A recuperação foi corrigida com busca por palavras no ToolResult, orientação sobre referências e recuperação local limitada de campos/literais. `after-final` e `after-retrieval-fix` são nomes de tentativas preservadas, não declarações de aprovação.

## Método e limites

- Modelo principal: `minimax/minimax-m3`; fast: `nvidia/nemotron-3-ultra-550b-a55b:free`.
- Provedores reais, Jev real, MCP Oinko real (consultas), servidor MCP de avaliação por stdio, SQLite, Git, leitura/escrita de arquivos, busca e execução real de três testes Node.
- Os 16 cenários cobrem seis relatórios extensos, resumo, reinício do agente, lembrança de restrições, recuperação de campo antigo, correção de código, teste/Git, calculadora, isolamento de conversas, saudação fast e contexto fast.
- As alterações de arquivos ocorreram somente em projeto descartável. A memória de longo prazo foi desabilitada igualmente nas duas medições para isolar o histórico da conversa. Higgsfield e Telegram não foram usados para publicar ou enviar mensagens.
- Acerto significa passar nas verificações fixadas de conteúdo, ferramentas, isolamento e testes reais. É evidência dessa bateria finita, não garantia de qualidade universal ou benchmark independente.
- Ferramentas distintas na rodada final: 10: `ConversationSearch`, `mcp__evaluation__fixture_calculate`, `mcp__evaluation__fixture_git`, `mcp__evaluation__fixture_log`, `mcp__evaluation__fixture_read`, `mcp__evaluation__fixture_search`, `mcp__evaluation__fixture_test`, `mcp__evaluation__fixture_write`, `mcp__oinko__oinko_bots`, `mcp__oinko__oinko_status`.
- Hash SHA-256 dos cenários: `3c693444743d462715c4f957a8576c3d4a5e391e37ef2d1233720c0e92a52eb5`.
- Hash SHA-256 do avaliador e servidor fixture usados nas rodadas: `64d98d703ce06518f71d5dfd08e0c2d831efe6f44e8183590f6ad8ca67c36c75`.
- Os resultados brutos, respostas, chamadas, uso dos provedores, bancos e snapshots de fonte ficam em `.harness/context-evaluation/`, ignorados pelo Git por conter dados locais. O relatório versionado contém agregados.
- Reproduzir a bateria exige Node 22, pacotes compilados e credenciais de Dev configuradas. Cada execução exige um nome novo e preserva os dados anteriores.

```sh
node packages/oinko/scripts/context-evaluation/run.mjs novo-baseline
OINKO_EVAL_CONTEXT='{"enabled":true}' node packages/oinko/scripts/context-evaluation/run.mjs nova-avaliacao
```

## Validação do repositório

- Núcleo: **1.635 testes passaram**, 1 ignorado; cobertura de linhas **94,42%**. Inclui persistência SQLite após reinício, isolamento, falha do Jev, descoberta durante o loop, arquivo completo antes do corte, recuperação de campos antigos, orçamento e contabilização de resumo vazio/falho.
- Demais pacotes e dashboard: **164 testes passaram**, 52 ignorados nos cenários opcionais de infraestrutura, na preparação final do PR, incluindo os testes de espera do Telegram. O agregado `test:coverage` passou; a cobertura do núcleo foi repetida depois das últimas regressões.
- Dashboard E2E: **25 testes passaram**, 3 cenários Docker opcionais ignorados na preparação do PR. A configuração de contexto salvou limites, recarregou e confirmou persistência; alterou a seleção de ferramentas e confirmou pela API. Esse cenário também passou duas vezes durante a avaliação inicial.
- `build`, `typecheck`, `lint`, `lint:dup`, `size`, `docs:api:check` e `validate:publish` passaram. Auditoria de segredos das alterações: nenhum vazamento encontrado. `git diff --check` passou.
- O tamanho total do SDK passou de aproximadamente 611 KB para 665,21 KB, sem adicionar dependências diretas. O orçamento total foi ajustado para 670 KB; os limites de 5 KB para a entrada e 50 KB para a classe Agent foram mantidos e passaram.
- Na avaliação inicial, dois checks globais apontavam material preexistente da reformulação visual: `format:check` sinalizava `vercel-DESIGN.md`; `lint:deadcode` apontava 9 exports sem uso na dashboard. A preparação do PR preservou esse trabalho no checkout original e integrou os controles de contexto sobre a interface já versionada. No checkout isolado do PR, ambos os checks passaram.
- A auditoria de dependências de produção não encontrou vulnerabilidades. Os commits novos passaram no commitlint. Os checks locais acima validam o conteúdo preparado para o PR; o CI remoto tem execução própria.

Depois das medições, os scripts do avaliador receberam somente formatação. Os arquivos originais e seus hashes estão nos snapshots privados `confirmation-source` e anteriores. Os critérios e dados dos cenários permanecem iguais. A versão original do núcleo usada na base era `1bdfba8`; rodar agora com a política desabilitada mede o núcleo atual, não reconstitui automaticamente aquele checkout.

## Dev em execução

A política foi aplicada pelo MCP Oinko ao Dev, revisão **7 → 8**, seguida de reinício. Um backup consistente do cadastro e de sua chave local foi guardado antes da alteração. Os demais campos e credenciais foram comparados e permaneceram iguais. A dashboard em `http://localhost:3111/bots` confirmou os valores salvos; CLI, Telegram, Oinko e Higgsfield ficaram conectados.

A conferência local no próprio Dev fez uma consulta real `oinko_bots`, confirmou a política habilitada e depois pediu uma etiqueta combinada na mesma conversa:

| Turno real | Modelo | Ferramentas expostas | Chamadas de ferramenta | Entrada LLM | Resultado |
| --- | --- | ---: | ---: | ---: | --- |
| Consultar cadastro | MiniMax M3 | 7 | 1 (`oinko_bots`) | 11.011 (duas chamadas) | Política habilitada, revisão 8 |
| Lembrar etiqueta | Nemotron free | 3 (consulta/descoberta) | 0 | 5.884 | Etiqueta correta |

A telemetria registrou seleção e roteamento juntos pelo Jev, com 4.626/600 tokens de entrada/saída na primeira decisão e 4.835/599 na segunda. O inspetor foi conferido no navegador com os tokens separados dos do LLM. A rota free funcionou, mas demorou **65 segundos** nessa verificação; menor contexto não garante baixa latência do provedor gratuito. A consulta pelo modelo principal levou cerca de 4 segundos, além da seleção inicial.

Os dois últimos ensaios completos passaram **16/16 cada**, após corrigir a regressão de detalhe antigo. As falhas intermediárias permanecem no relatório e nos dados brutos.

### Verificação no Telegram

A primeira saudação na conversa existente levou 77,9 segundos: três chamadas de resumo consumiram aproximadamente 75 segundos, seguidas pela resposta da rota fast em aproximadamente 2 segundos. O resumo foi persistido cobrindo 76 mensagens. Esse custo inicial confirma que ativar a política em uma conversa longa pode aumentar a espera mesmo para uma saudação.

O canal passou a renovar a indicação “digitando” enquanto processa a mensagem, encerrando-a antes da resposta ou no cancelamento. Falhas e demora na indicação não bloqueiam a resposta. Os 19 testes do adaptador passaram; o Dev foi reiniciado preservando configuração e resumo. O usuário confirmou que a nova mensagem funcionou no Telegram. Essa confirmação é separada da bateria de 16 cenários e não altera seus resultados.
