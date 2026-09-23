# 13. Seguranca

> Seguranca nao e uma feature — e uma propriedade do sistema. Documente como o sistema se protege.

> **Nota:** O AI Harness SDK é uma biblioteca, não um serviço. A segurança da aplicação final (autenticação de usuários, HTTPS, etc.) é responsabilidade da aplicação host. Este documento foca nas responsabilidades de segurança do pacote.

---

## 13.1 Modelo de Ameacas

| Ameaca | Categoria (STRIDE) | Impacto | Mitigacao |
|--------|---------------------|---------|-----------|
| API key do OpenRouter exposta em logs ou eventos | Information Disclosure | Alto — acesso não autorizado à conta OpenRouter, custos financeiros | API key nunca incluída em AgentEvents, logs ou mensagens de erro. Mascarada em qualquer output |
| Injeção de prompt via tool results | Tampering | Alto — LLM manipulado para executar ações não intencionadas | Tool results vão como `role: "tool"`, nunca como system. Tools com `untrustedOutput` (WebFetch, MCP, ConversationSearch) passam por triagem quando há `decider`; o conteúdo suspeito vai em `<untrusted-tool-output>`, que o próprio conteúdo não consegue fechar (`neutralizeControlTags`) |
| Tool maliciosa registrada pelo consumidor | Elevation of Privilege | Alto — tool pode acessar filesystem, rede ou executar código arbitrário | `beforeToolCall` hook permite bloqueio. Documentar que tools executam no mesmo processo — consumidor responsável por sandboxing |
| MCP server comprometido retorna dados maliciosos | Tampering / Spoofing | Alto — tool results manipulados, tools com nomes enganosos | `isolateErrors: true` por padrão. Timeout por tool. Consumidor valida quais servers conectar |
| Consumo descontrolado de tokens (runaway cost) | Denial of Service | Alto — fatura inesperada no OpenRouter | CostPolicy com maxTokensPerExecution e maxTokensPerSession. maxToolCallsPerExecution previne loops |
| Dados sensíveis persistidos em memórias sem criptografia | Information Disclosure | Médio — arquivo SQLite legível por qualquer processo com acesso ao filesystem | SQLite em `.harness/data.db` com permissões de arquivo do OS. Consumidor responsável por criptografia de disco se necessário |
| Memory extraction extrai PII de conversas | Information Disclosure | Médio — PII do usuário final persistida em arquivos de memória | Piso determinístico (`findNeverStore`): CPF e CNPJ (com dígito verificador), cartão (Luhn) e credenciais são recusados em `memory_write`/`memory_edit` e em `remember()` (`SensitiveDataError`). Categorias do art. 5º, II da LGPD ficam fora por padrão (`memory.sensitiveData: 'omit'`). Arquivos em `0600`. Desligar: `memory.enabled: false` ou `memory.extractionEnabled: false` |
| Concurrent thread access corrompe histórico | Tampering | Médio — mensagens misturadas entre threads | Mutex por thread no ConversationManager. Serialização de execuções na mesma thread |
| SQLite file locked por outro processo | Denial of Service | Baixo — Agent não consegue persistir | WAL mode reduz locks. Documentar: apenas um processo deve acessar o arquivo |

| Injeção persistente via memória ("sempre concorde comigo", "ignore as regras") | Tampering | Alto — instrução maliciosa reinjetada em todo turno | O extrator não recebe resultados de tools (`formatExtractionTranscript`); o prompt de extração nunca grava instruções que enfraquecem honestidade ou segurança; na aplicação, memórias são dados e instruções nelas são ignoradas |
| Memória ou knowledge com autoridade de instrução | Tampering | Alto — texto recuperado lido como ordem do host | Injeções `kind: 'data'` vão em `<context-data>` com aviso de que são referência; a injeção `context:protocol` diz ao modelo que só `<system-reminder>` fala pelo host |
| `<system-reminder>` forjado pelo usuário ou por uma tool | Spoofing | Alto — texto externo se passando por lembrete do sistema | `neutralizeControlTags` escapa as tags de controle no histórico (user, assistant, tool) e nas injeções |
| Vazamento de conversa entre usuários pela busca (`ConversationSearch`) | Information Disclosure | Alto — uma pessoa lendo o histórico de outra | Desligada por padrão. Escopo vem do `threadId` do contexto de execução, nunca dos argumentos; a tool é registrada uma vez, sem closure por turno; o id bruto da thread nunca aparece na saída |

<!-- APPEND:threats -->

---

## 13.2 Autenticacao

O AI Harness SDK é uma biblioteca — não gerencia autenticação de usuários finais.

- **Método:** API Key (OpenRouter)
- **Provedor:** OpenRouter (terceiro)
- **Fluxo:** Consumidor fornece `apiKey` no `AgentConfig`. Agent inclui em `Authorization: Bearer <key>` nos requests ao OpenRouter.

### Politicas de Credenciais

- API key fornecida via config, nunca hardcoded
- API key nunca aparece em logs, eventos ou mensagens de erro
- API key nunca incluída em tool results ou contexto do LLM
- Recomendação ao consumidor: passar via `AgentConfig.apiKey` em código

---

## 13.3 Autorizacao

- **Modelo:** N/A para a biblioteca. O Agent executa com as permissões do processo Node.js.

### Roles e Permissoes

| Role | Descricao | Permissoes |
|------|-----------|------------|
| Consumidor (código host) | Código que instancia e configura o Agent | Tudo: criar Agent, registrar tools/skills, conectar MCP, ingerir knowledge |
| LLM (OpenRouter) | Modelo de linguagem que gera respostas | Apenas: gerar texto e solicitar tool calls (via ReactLoop) |
| Tool | Função registrada no ToolExecutor | Apenas: receber args validados e retornar resultado |
| MCP Server | Servidor externo de tools | Apenas: listar tools e executar calls via protocolo MCP |

<!-- APPEND:roles -->

### Regras de Acesso

- LLM não pode executar tools diretamente — sempre passa pelo ToolExecutor com validação Zod
- `beforeToolCall` hook permite ao consumidor bloquear qualquer execução de tool
- Tools MCP executam com timeout — uma tool travada não bloqueia o sistema
- Consumidor é responsável por restringir quais tools registrar e quais MCP servers conectar

---

## 13.4 Protecao de Dados

### Dados em Transito

- **Protocolo:** HTTPS (TLS) — comunicação com OpenRouter API é obrigatoriamente HTTPS
- **MCP stdio:** Comunicação local via stdin/stdout do processo filho — não transita por rede
- **MCP SSE:** HTTPS recomendado — responsabilidade do consumidor configurar URL segura

### Dados em Repouso

- **SQLite local:** Arquivo `.harness/data.db` sem criptografia por padrão
- **Criptografia:** Não incluída no pacote. Consumidor pode usar criptografia de disco (LUKS, FileVault, BitLocker) ou SQLite Encryption Extension (SEE)
- **Permissões de arquivo:** `data.db` com as permissões padrão do OS (umask do processo); arquivos de memória em `0600` (só o dono)

### Dados Sensiveis

| Dado | Classificacao | Protecao | Retencao |
|------|---------------|----------|----------|
| API Key (OpenRouter) | Credencial | Nunca logada, nunca em eventos, apenas em Authorization header | Em memória apenas (não persistida) |
| Conteúdo de conversas | Potencialmente PII | Persistido em SQLite local (conversations table) | Controlado pelo consumidor (clearThread, destroy) |
| Memórias extraídas | Potencialmente PII | Arquivos `.md` em `memoryDir`, modo `0600`. CPF, CNPJ, cartão e credenciais recusados; categorias LGPD art. 5º, II omitidas por padrão | Até o usuário pedir para esquecer ou o arquivo ser apagado |
| Índice de busca de conversas (`conversations_fts`) | Potencialmente PII | Só texto de user/assistant; sem saídas de tools nem imagens | Acompanha o histórico: o trigger de delete remove do índice, com `secure-delete` |
| Embeddings | Representação vetorial | Persistido como BLOB em SQLite | Junto com o documento/memória associado |
| Tool arguments e results | Variável | Em memória durante execução, persistido no histórico | Controlado pelo consumidor |

- **Mascaramento:** A telemetria mascara credenciais e também CPF, CNPJ e números de cartão (`redactSecrets`). Fora da telemetria e da memória, o consumidor continua responsável por sanitizar PII antes de enviar ao Agent
- **Política de descarte:** `agent.destroy()` fecha conexões. Consumidor pode deletar `data.db` para limpeza completa

---

## 13.5 Checklist de Seguranca

Checklist adaptado do **OWASP Top 10** para contexto de biblioteca (não aplicação web):

### Status Atual

| Item | Status | Observacoes |
|------|--------|-------------|
| Prevenção de Injection (SQL) | Aplicado | `node:sqlite` usa prepared statements nativamente. Nenhum SQL construído por concatenação |
| Prevenção de Injection (Prompt) | Parcial | Tool results como `role: "tool"`; dados recuperados em `<context-data>`; tags de controle neutralizadas; triagem de `untrustedOutput` só com `decider`. Consumidor responsável por sanitizar inputs |
| Validação de entrada | Aplicado | Todas as configurações validadas via Zod. Args de tools validados via Zod antes de execução |
| Exposição de dados sensíveis | Aplicado | API key nunca em logs/eventos. Dados em SQLite sem criptografia (responsabilidade do consumidor) |
| Controle de acesso | Parcial | beforeToolCall hook disponível. Sem sistema de permissões built-in para tools |
| Vulnerabilidades em dependências | Aplicado | ≤4 dependências diretas, todas maduras e auditadas. `npm audit` no CI |
| Rate limiting / DoS | Aplicado | CostPolicy com limites por execução e sessão. maxToolCallsPerExecution. maxConsecutiveErrors |
| Logging seguro | Aplicado | Logger não inclui API keys. Eventos não expõem credenciais |

<!-- APPEND:security-checklist -->

---

## 13.6 Auditoria e Compliance

### Regulamentacoes Aplicaveis

- Nenhuma regulamentação se aplica diretamente à biblioteca. O consumidor (aplicação host) é responsável por compliance (LGPD, GDPR, SOC2, etc.)
- Recomendação: se o consumidor processa PII de usuários finais, considerar desabilitar memory extraction ou implementar sanitização antes do Agent

### Logging de Auditoria

- **Eventos auditados:** Todos os AgentEvents (incluindo tool_call_start/end) com traceId para correlação
- **Formato:** AgentEvent (TypeScript objects). Consumidor pode serializar para JSON via `hooks.onEvent`
- **Destino:** Controlado pelo consumidor via `AgentHooks.onEvent`. Pode redirecionar para qualquer sistema (console, arquivo, SIEM, OpenTelemetry)
- **Imutabilidade:** Não garantida pela biblioteca. Consumidor responsável por armazenamento imutável se necessário

### Retencao

| Tipo de Dado | Periodo de Retencao | Armazenamento | Justificativa |
|-------------|---------------------|---------------|---------------|
| Histórico de conversas | Indefinido (até clearThread/destroy) | SQLite local | Necessário para contexto multi-turno |
| Memórias | Decay automático (confidence < minConfidence → removidas) | SQLite local | Ciclo de vida gerenciado por decay |
| Knowledge vectors | Indefinido (até delete manual) | SQLite local | Documentos ingeridos persistem para RAG |
| Logs de eventos | Não persistidos pela lib | Responsabilidade do consumidor | Lib emite, consumidor decide onde armazenar |

### Resposta a Incidentes

- Não aplicável diretamente à biblioteca
- Se API key comprometida: consumidor deve revogar no OpenRouter e instanciar novo Agent com nova key
- Se arquivo SQLite comprometido: consumidor deve deletar e reiniciar Agent (perda de memórias e knowledge)

---

## Referencias

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [STRIDE Threat Model](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)
- [SQLite Security](https://www.sqlite.org/security.html)
