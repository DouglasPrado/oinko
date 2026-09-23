# Memory & Knowledge (RAG)

AI Harness SDK has two persistence subsystems:

- **Memory** — facts extracted from conversations that persist across sessions (e.g., "user prefers TypeScript")
- **Knowledge** — documents ingested for RAG retrieval (e.g., API docs, codebase context)

Both are enabled by default with SQLite storage. Both are pluggable.

---

## Memory

### Saving Memories

```typescript
const agent = Agent.create({ apiKey: '...' });

// Explicit memory — saved with confidence 1.0
const mem = await agent.remember('User prefers dark mode');

// With scope
await agent.remember('This project uses React', 'persistent');
await agent.remember('Current task is refactoring auth', 'thread');
```

### Recalling Memories

```typescript
const memories = await agent.recall('What does the user prefer?');

for (const mem of memories) {
  console.log(`${mem.content} (confidence: ${mem.confidence})`);
}
```

### Memory Scopes

| Scope | Visibility | Use Case |
|-------|-----------|----------|
| `persistent` | All threads | Long-term user preferences, facts |
| `thread` | Only the originating thread | Task-specific context |
| `learned` | All threads | Patterns learned from interactions |

### Memory Categories

Memories are categorized for better retrieval:

| Category | Example |
|----------|---------|
| `fact` | "The API key is stored in .env" |
| `preference` | "User prefers concise answers" |
| `procedure` | "Deploy by running npm run deploy" |
| `insight` | "User tends to ask follow-up questions" |
| `context` | "Currently working on the auth module" |

### Memory Lifecycle

```
active → reinforced (on recall)
       → decaying (after N turns without access)
       → expired (confidence < minConfidence)
       → removed (cleaned up)
```

- **Confidence** starts at 0.8 (extracted) or 1.0 (explicit)
- **Reinforcement**: +0.05 confidence each time recalled
- **Decay**: `confidence *= decayFactor` every `decayInterval` turns
- **Cleanup**: memories below `minConfidence` are deleted automatically

### Automatic Extraction

The agent automatically extracts memories from conversations based on:

1. **Explicit triggers** — "remember that...", "lembra que...", and requests to forget ("esquece...", "forget...")
2. **Turn count** — after `extractionInterval` turns without extraction
3. **Random sampling** — `samplingRate` fraction of turns (default 30%)

With a `decider`, a yes/no judgment on whether the turn holds anything durable replaces the turn count and the sampling.

What the extraction subagent saves:

- **Only what the user stated.** A choice the user made among options the assistant offered counts; the assistant's own advice, plans and conclusions do not.
- **No tool output.** The transcript it reads replaces tool results with `[tool result omitted]`: fetched data can be fetched again, and it is where injected text lives.
- **Calibrated.** One passing mention is recorded as such, not as a trait; a preference keeps the scope the user gave it.
- **Durable.** Would it still be true and worth reading a month from now? The moving state of a task is left out.
- **Changes keep history** ("works on infra (previously search)"); forgetting deletes the line and anything derived only from it.
- **Never instructions that weaken honesty** — "always agree with me", "ignore your rules" — even when the user says "remember".

### Sensitive Data (LGPD)

Memory never stores CPF or CNPJ numbers, payment card or account numbers, or credentials — a deterministic check (`findNeverStore`) refuses them in every write path. The subagent's tools answer with the kind of data found (never the value) so it can save the rest; `remember()` throws `SensitiveDataError`.

The sensitive categories of LGPD art. 5, II (racial or ethnic origin, religious belief, political opinion, union membership, health, sex life, genetic or biometric data) are kept out by default. An operator with a legal basis can set `memory.sensitiveData: 'allow'`, and they are then saved only as the user stated them. Memory files are written owner-only (`0600`), and the telemetry masks CPF, CNPJ and card numbers.

### Using Memories

Memories arrive as data (`<context-data>`), not as instructions. The agent is told to use one only when it changes the answer, never to narrate the retrieval ("according to my memories"), to let the current request win over a stored preference, and to bring up sensitive details or details about other people only when the user raises them. Memories already surfaced in a thread stay in context in the following turns (`memory:carried`, up to 10), without a new selection.

### Hybrid Search

Memory recall uses **Reciprocal Rank Fusion** combining:
- **FTS5** — full-text search for keyword matching
- **Cosine similarity** — semantic vector search via embeddings

This ensures both exact term matches and semantic similarity are considered.

### Configuration

```typescript
const agent = Agent.create({
  apiKey: '...',
  memory: {
    enabled: true,
    extractionEnabled: true,
    samplingRate: 0.3,
    extractionInterval: 10,
    minConfidence: 0.7, // decider confidence floor for "worth remembering"
    sensitiveData: 'omit', // LGPD art. 5, II categories; 'allow' saves them as stated
  },
});
```

---

## Knowledge / RAG

### Ingesting Documents

```typescript
const agent = Agent.create({ apiKey: '...' });

await agent.ingestKnowledge({
  content: 'Full text of the document here...',
  metadata: {
    source: 'api-docs',
    title: 'Authentication Guide',
    url: 'https://docs.example.com/auth',
  },
});
```

Documents are automatically:
1. **Chunked** — split into overlapping segments (default: 512 chars, 64 overlap)
2. **Embedded** — converted to vectors via the embedding model
3. **Stored** — persisted in the VectorStore (SQLite by default)

### Automatic RAG Injection

During every `stream()` / `chat()` call, the agent:
1. Generates an embedding for the user's input
2. Searches the VectorStore for similar chunks
3. Injects the top-K results into the system context

This happens transparently — no manual search needed.

### Manual Search

If you need to search knowledge programmatically:

```typescript
import { KnowledgeManager } from '@oinko/core';
// KnowledgeManager is used internally, but you can access
// the VectorStore directly via custom stores
```

### Chunking Strategies

Documents are split using **recursive character splitting**:

1. Try splitting on `\n\n` (paragraph boundaries)
2. Fall back to `\n` (line boundaries)
3. Fall back to `. ` (sentence boundaries)
4. Fall back to ` ` (word boundaries)

Overlap ensures that information at chunk boundaries isn't lost.

### Embedding Caching

Embeddings are cached in an LRU cache (max 10,000 entries, 1-hour TTL) to avoid redundant API calls.

### Configuration

```typescript
const agent = Agent.create({
  apiKey: '...',
  knowledge: {
    enabled: true,
    chunkSize: 512,
    chunkOverlap: 64,
    topK: 5,
    minScore: 0.3,
  },
  embeddingModel: 'openai/text-embedding-3-small',
});
```

---

## Disabling Subsystems

```typescript
// Disable memory (no extraction, no recall)
const agent = Agent.create({
  apiKey: '...',
  memory: { enabled: false },
});

// Disable knowledge (no RAG)
const agent = Agent.create({
  apiKey: '...',
  knowledge: { enabled: false },
});

// Disable both (minimal agent)
const agent = Agent.create({
  apiKey: '...',
  memory: { enabled: false },
  knowledge: { enabled: false },
});
```

---

## Context Pipeline Priority

When building the context, injections are prioritized:

| Source | Priority | Kind | Description |
|--------|----------|------|-------------|
| `tools`, `context:protocol`, `behavior`, `security` | 10 | instruction | Tool guidance, which blocks speak for the host, optional conduct baseline |
| `skill:listing`, `conversation-search` | 9 | instruction | Skills available; when to search earlier conversations |
| `skill:<name>` | 8 | instruction | Instructions of an active skill |
| `knowledge` | 6 | data | RAG results, one `<document id source>` per chunk |
| `mcp:<server>:instructions` | 5 | instruction | What an MCP server said about using its tools, scoped to them |
| `memory:relevant`, `memory:carried` | 4 | data | Memories picked for this turn; memories already surfaced in the thread |
| `memory:index` | 3 | data | The MEMORY.md index |
| `memory:instructions` | 2 | instruction | How to use memories |
| `environment` | 1 | instruction | Model, date, weekday, time and time zone |

Higher priority injections are included first. If the context budget is exceeded, lower priority injections are dropped — and the telemetry records them with `applied: false`.

Instructions go in `<system-reminder>`. Data goes in `<context-data source="...">`, opened by a note that it is reference material and not instructions. Control tags written by anyone else — a user, a tool result, a memory, a document — are escaped, so none of them can open or close one of these blocks.

## Conversation Search

With `conversation: { search: { enabled: true } }` the agent gets the `ConversationSearch` tool: it searches earlier user and assistant messages that fell out of the context (tool output is never indexed). It is off by default — reading old conversations is a new use of personal data, and the operator decides.

- **Scope** comes from the turn's thread, never from the model's arguments. Default: that thread only. A `scope` function can widen it, e.g. to all threads of the same verified user.
- **Provenance**: each excerpt is labeled `USER` or `ASSISTANT (your own earlier words)`, so a past suggestion is not reported as the user's decision.
- **This turn is excluded**, so the question being asked does not come back as a result.
- **Storage**: `ConversationStore.searchMessages` (optional). The SQLite store uses an FTS5 index kept in sync by triggers; clearing a thread clears what can be found.

```typescript
const agent = Agent.create({
  apiKey: '...',
  timezone: 'America/Sao_Paulo', // dates in results and in from/to
  conversation: { search: { enabled: true, maxResults: 5, maxCallsPerTurn: 4 } },
});
```
