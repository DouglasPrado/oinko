# ADR-007: Decisor plugável para decisões dentro do loop

**Data:** 2026-09-21

**Status:** Aceita

---

## Contexto

Várias decisões internas do harness não são sobre gerar texto — são classificações binárias ou de múltipla escolha. Hoje cada uma delas resolve o problema de um de dois jeitos ruins:

1. **Heurística cega.** A decisão de extrair memória de um turno é literalmente um sorteio (`Math.random() < samplingRate`, em `src/memory/memory-extractor.ts`). O `samplingRate` padrão de `0.3` existe porque a extração chama o LLM e rodar em todo turno sairia caro. O preço é perder a maior parte dos fatos que o usuário informa de passagem: fora das 8 substrings de `EXPLICIT_TRIGGERS`, um fato só é considerado se a moeda cair do lado certo.
2. **Chamada de LLM completa.** A relevância de memória usa `memory.relevanceModel`, e a descoberta de skills usa `skills.modelDiscovery` — modelos generativos empregados para devolver, no fim, uma escolha entre opções.

Surgiu uma classe de modelo dedicada a isso ("System One"), que devolve valor tipado com probabilidade calibrada em vez de texto, com custo e latência uma a duas ordens de grandeza menores. A primeira implementação pública é o Jev, da TypeSafe AI.

---

## Drivers de Decisão

- Trocar sorteio por decisão sem transformar cada turno numa chamada cara de LLM
- Dependências mínimas (princípio arquitetural #1) — teto de 4 dependências diretas
- Zero lock-in: o harness não pode passar a exigir um fornecedor específico
- O Jev está em acesso antecipado; a API pode mudar
- Comportamento atual não pode regredir para quem não configurar nada

---

## Opções Consideradas

### Opção A: Chamar o Jev direto nos pontos de decisão

Simples, menos código. Mas espalha o formato do fornecedor por `memory/`, `skills/` e `tools/`, e amarra o SDK a um produto em acesso antecipado.

### Opção B: Port plugável `Decider` + adapter isolado

Uma interface no `src/contracts/`, no mesmo padrão de `MemoryStore`/`VectorStore`/`ConversationStore` (ADR-005). O `JevDecider` implementa por HTTP com `fetch` nativo. Quem não configura decisor continua na heurística.

### Opção C: Não fazer nada

Mantém o sorteio. Custo zero, mas o problema de memória perdida permanece.

---

## Decisão

**Escolhemos a Opção B.** A interface `Decider` aceita perguntas `bool`, `choice` e `score` — os três primitivos que cobrem toda decisão in-loop — e responde a todas as perguntas de um mesmo estado numa única ida à rede, para que a latência não se multiplique.

Tudo que é específico do fornecedor vive em `src/decision/jev-decider.ts`. A configuração é opcional (`AgentConfig.decider`): sem ela, nada muda.

O primeiro ponto a usar o decisor é o gate de extração de memória (`src/memory/extraction-gate.ts`), porque é onde a heurística atual é mais fraca — um sorteio — e onde o efeito é visível para o usuário final.

---

## Consequências

### Positivas

- A pergunta "este turno tem fato durável?" passa a rodar em 100% dos turnos, e o LLM extrator (o custo real) só dispara quando há o que extrair
- Comportamento fica determinístico: `Math.random()` sai do caminho quando há decisor, o que também melhora a testabilidade
- A interface serve aos próximos pontos (relevância de memória, ativação de skill, roteamento de modelo, risco de tool call) sem novo desenho
- Nenhuma dependência nova: o adapter é `fetch` nativo

### Negativas

- Mais um ponto de falha de rede num caminho que antes era local — mitigado por degradação explícita: erro ou timeout cai na heurística de sempre
- O gate passou a ser assíncrono, então o reset do contador por thread acontece dentro do bloco fire-and-forget

### Riscos

- **API em acesso antecipado pode mudar** — *Mitigação:* o formato do fio está confinado ao `JevDecider`; a interface não conhece a TypeSafe
- **Latência somada se o decisor for usado em muitos pontos** — *Mitigação:* `decide()` responde várias perguntas por chamada; usar uma chamada por ponto do loop, não por pergunta
- **Custo de decisão onde já havia heurística exata** — *Mitigação:* não usar decisor em compactação de contexto, que é aritmética de token e não se beneficia

---

## Ações Necessárias

- [x] Interface `Decider` em `src/contracts/entities/decider.ts`
- [x] `JevDecider` (HTTP, `fetch` nativo, retry em 429/529)
- [x] Gate de extração de memória com degradação para a heurística
- [x] `AgentConfig.decider` e `memory.minConfidence`
- [ ] Medir em produção: memórias extraídas por 100 turnos e custo de extração, antes e depois
- [ ] Avaliar os demais pontos (relevância, skills, roteamento) após a medição

---

## Referências

- [TypeSafe AI — Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [API reference do System One](https://docs.typesafe.ai/api)
- ADR-005 (interfaces plugáveis) — mesmo padrão de port aplicado aqui

---

## Histórico

| Data | Mudança |
| ---- | ------- |
| 2026-09-21 | Criada e aceita |
