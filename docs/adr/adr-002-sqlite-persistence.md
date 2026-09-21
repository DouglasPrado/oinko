# ADR-002: SQLite como persistência padrão

**Data:** 2026-04-01

**Status:** Aceita — emendada em 2026-09-21 (driver trocado, decisão mantida)

---

## Contexto

O sistema precisa persistir memórias, vetores de knowledge e histórico de conversas. Como pacote standalone, não pode exigir que o consumidor configure servidores de banco de dados.

---

## Drivers de Decisão

- Zero config para o consumidor (princípio: simplicidade)
- Dados sobrevivem restart do processo
- FTS5 para busca full-text sem API externa
- WAL mode para leitura concorrente

---

## Opções Consideradas

### Opção A: In-memory (Map/Array)

| Aspecto | Avaliação |
|---------|-----------|
| Prós | Zero dependência, zero I/O, máxima velocidade |
| Contras | Dados perdidos no restart, sem FTS, sem persistência |
| Esforço | Baixo |
| Risco | Alto (perda de dados) |

### Opção B: SQLite via better-sqlite3

| Aspecto | Avaliação |
|---------|-----------|
| Prós | Arquivo único, zero config, FTS5, WAL, prepared statements, `:memory:` para testes |
| Contras | Dependência nativa (compilação), busca vetorial brute-force limitada a ~100K |
| Esforço | Médio |
| Risco | Baixo |

### Opção C: PostgreSQL / Redis

| Aspecto | Avaliação |
|---------|-----------|
| Prós | Escalabilidade, pgvector nativo, Redis para cache |
| Contras | Requer servidor externo, configuração, connection string — viola "zero config" |
| Esforço | Alto |
| Risco | Médio (complexidade operacional) |

---

## Decisão

**Escolhemos a Opção B: SQLite via better-sqlite3** porque oferece persistência real com zero config. Para cenários que excedem as limitações do SQLite (>100K vetores), as interfaces plugáveis (ADR-005) permitem migrar para PostgreSQL/Pinecone sem alterar o core.

---

## Consequências

### Positivas

- Arquivo único `.harness/data.db` — consumidor não precisa instalar nada além do npm
- FTS5 para busca full-text em memórias sem custo de API
- WAL mode para leitura concorrente sem locks
- `:memory:` para testes unitários rápidos

### Negativas

- Dependência nativa `better-sqlite3` requer compilação (node-gyp)
- Busca vetorial brute-force O(n) — aceitável para ≤100K, degradada acima

### Riscos

- Compilação nativa pode falhar em ambientes restritos — **Mitigação:** documentar pré-requisitos (build tools)

---

## Atualização — 2026-09-21: driver trocado para `node:sqlite`

A decisão desta ADR (SQLite como persistência padrão) **continua valendo**. O que
mudou foi o driver: `better-sqlite3` saiu, `node:sqlite` entrou.

**Motivo:** o risco registrado acima se concretizou. O `better-sqlite3@11.10.0`
não tem prebuild para o ABI do Node 26, e o `node-gyp` falha na compilação — o
`pnpm install` simplesmente morre em qualquer máquina com Node 26.

**Por que o `node:sqlite` serve:** é síncrono, que é o que os contratos
`ConversationStore` e `VectorStore` (ADR-005) exigem — alternativas como libsql
obrigariam a tornar as interfaces assíncronas, o que subiria por `agent.ts` e
pelo loop ReAct. Verificado nas versões 22.23.0, 24.18.0 e 26.8.1: disponível
sem flag e com FTS5 compilado nas três.

**O que mudou em consequência:**

- as negativas "dependência nativa requer compilação (node-gyp)" e o risco de
  ambientes restritos **deixam de existir**: não há mais build nativo
- `zod` passa a ser a única dependência de runtime
- `engines.node` sobe de `>=22` para `>=22.5.0`, versão em que o `node:sqlite`
  surgiu. No Node 22 ele emite `ExperimentalWarning`; do 24 em diante, não
- `db.pragma()` e `db.transaction()` eram atalhos do better-sqlite3 e não
  existem no `node:sqlite`: o primeiro virou `exec('PRAGMA ...')`, o segundo
  virou `SQLiteDatabase.transaction()`, que faz BEGIN/COMMIT/ROLLBACK
- BLOB agora volta como `Uint8Array` em vez de `Buffer`

A negativa "busca vetorial brute-force O(n)" **permanece** — ela nunca foi do
driver, e sim do `SQLiteVectorStore`, que lê todas as linhas e calcula cosseno
em JS.

---

## Referências

- [node:sqlite](https://nodejs.org/api/sqlite.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (driver anterior)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- Modelo de dados: `docs/blueprint/05-data-model.md`
