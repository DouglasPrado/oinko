# Suíte live

Testes que falam com os provedores de verdade — LLM e decisor — para responder
uma pergunta que mock nenhum responde: **isto funciona de ponta a ponta?**

```bash
export LLM_API_KEY=...          # obrigatório; sem ele a suíte inteira se pula
export TYPESAFE_API_KEY=...     # opcional; sem ele, só os grupos com decisor se pulam
export LLM_BASE_URL=...         # opcional
export AGENT_MODEL=...          # opcional (default gpt-5.5)

pnpm test:live
```

Fora do `pnpm test` de propósito: gasta tokens, exige rede e credenciais, e leva
~2 minutos. A suíte normal continua offline, determinística e gratuita.

## O que cada grupo cobre

| Arquivo                         | Casos de uso                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-conversation`               | Resposta direta, streaming em pedaços, histórico por thread, isolamento entre threads, tool calling, consumo por thread                                                          |
| `02-memory`                     | Escrita e leitura explícita, escopo por thread, acervo global, memória usada na conversa, extração decidida pelo Jev (com e sem fato durável), avaliação dos dois lados do turno |
| `03-knowledge`                  | Ingestão e resposta com base no documento, isolamento entre conversas, acervo compartilhado, recusa de escopo vazio, gate e rerank                                               |
| `04-decisions`                  | Jailbreak bloqueado sem gastar LLM, pedido legítimo passando, triagem de injeção, roteamento de modelo, erro de tool não retentado                                               |
| `05-skills-and-instrumentation` | Ativação e não-ativação de skill, log de decisões em disco sem conteúdo do usuário, nenhum ponto `unknown`, persistência entre instâncias                                        |

## Como escrever um caso aqui

Três coisas que já custaram teste vermelho sem bug nenhum:

**Não afirme sobre a forma da resposta.** O modelo escolhe entre "1847",
"1.847" e "1,847", entre "Tóquio" e "toquio". Use `digitsOf` e `plain`.

**Não dependa de o modelo decidir chamar uma tool** para testar o que acontece
depois da chamada. Isso mede a disposição dele, não a funcionalidade — e falha
de forma intermitente. Exercite o executor direto.

**Espere o trabalho de fundo.** Extração de memória e o gate que a decide rodam
depois que `chat()` retornou. Use `waitForMemory` (que faz polling) ou `settle`.
