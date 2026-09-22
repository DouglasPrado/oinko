# Changelog

## [3.0.0](https://github.com/DouglasPrado/oinko/compare/ai-harness-v2.1.2...ai-harness-v3.0.0) (2026-09-22)


### ⚠ BREAKING CHANGES

* turnos concorrentes na mesma thread agora enfileiram em vez de rodar juntos. Era o que ja se esperava de uma conversa.
* buildReasoningArgs nao recebe mais `hasTools`.
* shouldExtractWithDecider recebe a resposta do assistente como segundo argumento; DURABLE_FACT_QUESTION virou DURABLE_FACT_QUESTIONS.
* o modelo default mudou. Quem dependia do antigo ja estava quebrado, mas quem fixava a janela por engano vera o valor correto agora.
* ingestKnowledge e searchKnowledge exigem o escopo; VectorStore.search recebe a lista de escopos; KnowledgeChunk tem scope.
* remember(content, threadId, type?) troca a ordem dos argumentos e exige o escopo; quem gravava no acervo global deve chamar rememberGlobal. recall exige threadId.
* troca o better-sqlite3 pelo node:sqlite embutido no Node

### Features

* adiciona decisor plugavel e usa no gate de extracao de memoria ([396244c](https://github.com/DouglasPrado/oinko/commit/396244c7205398ac8d1472db884993f7718639ed))
* **agent:** liga a telemetria ao turno ([16c2ce4](https://github.com/DouglasPrado/oinko/commit/16c2ce4aaddd120d563fe76b9674f965487146e3))
* avalia os dois lados do turno antes de extrair memoria ([45975b0](https://github.com/DouglasPrado/oinko/commit/45975b007c4730a015a11daa60828b7543a81b3c))
* classifica erro de tool antes de gastar retry ([4f8dadb](https://github.com/DouglasPrado/oinko/commit/4f8dadb6ea3f4261aa5d9b857770f63ac680748c))
* consolida memoria duplicada em vez de empilhar arquivo parecido ([fd4fd23](https://github.com/DouglasPrado/oinko/commit/fd4fd23fee7377a85ba6586aacac6ae187e3ae51))
* **contracts:** traceId em todos os eventos, sem quebrar produtores ([43be571](https://github.com/DouglasPrado/oinko/commit/43be57101a27397129612fc5815df05edf4617f6))
* decide relevancia de memoria com o decisor em vez de uma chamada LLM ([3cc8377](https://github.com/DouglasPrado/oinko/commit/3cc83772c4abff8c10fb4d1a51f769d9c27064ad))
* detecta tentativa de jailbreak na mensagem do usuario ([94a04a1](https://github.com/DouglasPrado/oinko/commit/94a04a17e83be39d143558121c599bb8ee53d442))
* escolhe skill por decisao tipada em vez de embeddings ([4b83248](https://github.com/DouglasPrado/oinko/commit/4b8324860510be9f35aa63fe12474c41abcc9808))
* escopo obrigatorio na memoria e consumo por thread ([4bf9166](https://github.com/DouglasPrado/oinko/commit/4bf9166c9a02a5d83793ac44a14bb8e81d5e5d9b))
* **example:** liga o decisor instrumentado no bot do Telegram ([e4b383b](https://github.com/DouglasPrado/oinko/commit/e4b383b82e465efa883900ce09e5954610418513))
* **example:** o bot do Telegram passa a ler imagem e audio ([25bd307](https://github.com/DouglasPrado/oinko/commit/25bd307f8ef5a38b6651c7c5968770cfad9e7d42))
* instrumental para medir o decisor contra o que ele substituiu ([92af5f1](https://github.com/DouglasPrado/oinko/commit/92af5f164cf6bb3971a93fcd97c48d8a8ee89b6c))
* interrompe loop que gira em falso em vez de esperar maxIterations ([628f7d7](https://github.com/DouglasPrado/oinko/commit/628f7d755942a3c3d9200614cbe81e3cc7262a93))
* **llm:** captura custo real e tempos por chamada ([6cb007d](https://github.com/DouglasPrado/oinko/commit/6cb007da74d52176b9a09bf93d3cee112ba04716))
* **llm:** transcreve audio, que e o unico caminho que o endpoint aceita ([b41cd0a](https://github.com/DouglasPrado/oinko/commit/b41cd0a2b226d1487d0acb32a69827f0960687fd))
* recorte por escopo no knowledge (RAG) ([0842419](https://github.com/DouglasPrado/oinko/commit/0842419f920189de751c98d1672407188cd919c8))
* registro unico de modelos, aviso para desconhecido e checador de deriva ([5adcac7](https://github.com/DouglasPrado/oinko/commit/5adcac74249371d83a3d7c10a012a2bd9bf77970))
* rerankeia chunks do RAG por relevancia julgada ([110a6af](https://github.com/DouglasPrado/oinko/commit/110a6af94bcd0e08b4676fcf093491202a0f13cd))
* roteia turno trivial para um modelo mais barato ([eb04908](https://github.com/DouglasPrado/oinko/commit/eb04908a5c3b4f9795edd0f94fb6f6184e460955))
* telemetria de custo e tempos, e suporte a imagem e audio ([36cc1a9](https://github.com/DouglasPrado/oinko/commit/36cc1a963ea17f95d9a6697ef0333f2c31447f7f))
* **telemetry:** armazena payloads enderecados por hash ([a5951bf](https://github.com/DouglasPrado/oinko/commit/a5951bf4707d47b4ebc688a780a8e6cea6803d42))
* **telemetry:** banco proprio com migrations versionadas ([ff8f3da](https://github.com/DouglasPrado/oinko/commit/ff8f3dadae5f2e8bd6f977bfb97d388e72325f80))
* **telemetry:** expoe a camada na API publica ([2a053a4](https://github.com/DouglasPrado/oinko/commit/2a053a4e67c898f9bab112e428c2a5a8ab36cef5))
* **telemetry:** redige segredos antes de gravar payload ([d76846d](https://github.com/DouglasPrado/oinko/commit/d76846de6e6e7e3545dafb48d340fb86e72b6abd))
* **telemetry:** sink SQLite com contrato plugavel ([3185e81](https://github.com/DouglasPrado/oinko/commit/3185e81c81e3fb5643202870f1345a20f830b373))
* triagem de injecao em conteudo que vem de fora da conversa ([e5b1560](https://github.com/DouglasPrado/oinko/commit/e5b1560035587a0da6fc30afc1327c2ded682e28))
* troca o better-sqlite3 pelo node:sqlite embutido no Node ([cbc3592](https://github.com/DouglasPrado/oinko/commit/cbc359246326b7365654a364b51dc4a97aa7dfb8))
* usa o decisor para evitar RAG em turno que nao precisa ([1fb402c](https://github.com/DouglasPrado/oinko/commit/1fb402c71f54ed3b3184cc256ecc4d366b7a252a))


### Bug Fixes

* corrige a contagem de economia e atualiza as janelas da OpenAI ([dcaa3a3](https://github.com/DouglasPrado/oinko/commit/dcaa3a3bbb72341d609f53bfadad9a3cdc888e6d))
* corrige as regras de temperatura e tools por familia de modelo ([5ce3974](https://github.com/DouglasPrado/oinko/commit/5ce39743e4f858b68feffef43e1fb61b60336623))
* corrige o modelo default e as janelas de contexto da linha 1M ([e9dd37d](https://github.com/DouglasPrado/oinko/commit/e9dd37d9bcf63e76f854f7845acb05cf24c3f54d))
* detecta modelo que nao aceita tools em vez de forcar reasoning_effort ([6946542](https://github.com/DouglasPrado/oinko/commit/69465428725ed62a173febb8d66d4abdee065fd0))
* dois defeitos que so uma execucao de verdade revelou ([befb63a](https://github.com/DouglasPrado/oinko/commit/befb63a1e0c72e68ed551b12f5cb786200cecf6e))
* inclui scripts/ no tsconfig do eslint ([77cf2cd](https://github.com/DouglasPrado/oinko/commit/77cf2cdd946184fa22588a2b058ebf302fbbde9a))
* **llm:** tira o export de acceptsTemperature ([928e740](https://github.com/DouglasPrado/oinko/commit/928e7404d07b6bbde4c61ec5f61d943776cb0dab))
* para de vazar o nome interno reasoningEffort para a requisicao ([f485828](https://github.com/DouglasPrado/oinko/commit/f48582824c3f2003db7d291429529ebb038a479b))
* reconhece a linha gpt-6 e desliga o reasoning quando ha tools ([f5ec3c9](https://github.com/DouglasPrado/oinko/commit/f5ec3c90bbe62d00bd4136e4cc8f564adcd756a0))
* recusa modelo com prefixo de provedor no endpoint errado ([8d84ebe](https://github.com/DouglasPrado/oinko/commit/8d84ebe15eaf41ec267bb1fcd461cab700402567))
* serializa o turno inteiro por thread, nao so a escrita ([5865efb](https://github.com/DouglasPrado/oinko/commit/5865efb3222e6e4b1529098c852b1adc200b8916))
* **test:** tira a dupla asercao que so o CI reprovava ([6bebebd](https://github.com/DouglasPrado/oinko/commit/6bebebdcd5c01a018058c395e6fda921132bcd4e))


### Performance

* para de ensinar ao agente ferramentas que ele nao tem ([a68a40b](https://github.com/DouglasPrado/oinko/commit/a68a40b0391ee86d3a4652d10230db4764ea43ef))
* para de repetir a lista de tools no system prompt ([cced37a](https://github.com/DouglasPrado/oinko/commit/cced37a1caac90dbea5d4a07eb49a66db5ce7bfc))
* roda knowledge e skills em paralelo na montagem do contexto ([4a51912](https://github.com/DouglasPrado/oinko/commit/4a51912bb8bb819c66254aa17653021ac53d7884))


### Refactors

* **storage:** extrai runInTransaction para modulo proprio ([6004ade](https://github.com/DouglasPrado/oinko/commit/6004aded0ea48bbeff0a7843e783671e9835b0b9))
* **tools:** extrai truncagem head/tail para utils compartilhado ([5af7e5a](https://github.com/DouglasPrado/oinko/commit/5af7e5a4d40ee307fd25a59e240ebd16f0e5e396))


### Build System

* para de publicar comentario dentro do javascript ([5aeda10](https://github.com/DouglasPrado/oinko/commit/5aeda1007b806f5abb267ba8ddac58374bf3879a))

## [2.1.2](https://github.com/DouglasPrado/gba.dev/compare/ai-harness-v2.1.1...ai-harness-v2.1.2) (2026-08-31)


### Bug Fixes

* **ci:** publica os pacotes [@gba](https://github.com/gba) no registry privado, nao no npmjs ([#77](https://github.com/DouglasPrado/gba.dev/issues/77)) ([d7e339d](https://github.com/DouglasPrado/gba.dev/commit/d7e339df28889d8c87633fe9d82cab999d81f6f8))

## [2.1.1](https://github.com/DouglasPrado/gba.dev/compare/ai-harness-v2.1.0...ai-harness-v2.1.1) (2026-08-26)


### Bug Fixes

* **ai-harness:** aponta o teste de segurança para o workflow unificado ([#45](https://github.com/DouglasPrado/gba.dev/issues/45)) ([d3b1626](https://github.com/DouglasPrado/gba.dev/commit/d3b1626b341f231752dad7d29de5ca931a863ab8))

## [2.1.0](https://github.com/DouglasPrado/gba.dev/compare/ai-harness-v2.0.2...ai-harness-v2.1.0) (2026-08-24)


### Features

* **ai-harness:** permite plugar o ai-gateway via fetch injetavel ([#32](https://github.com/DouglasPrado/gba.dev/issues/32)) ([79d86c6](https://github.com/DouglasPrado/gba.dev/commit/79d86c62ace8218f350e48da391787462ab34d70))

## [2.0.2](https://github.com/DouglasPrado/gba.dev/compare/ai-harness-v2.0.1...ai-harness-v2.0.2) (2026-08-24)


### Bug Fixes

* **ai-harness:** anexa cause aos erros e recupera os mocks do vitest 4 ([#24](https://github.com/DouglasPrado/gba.dev/issues/24)) ([4a6e1a0](https://github.com/DouglasPrado/gba.dev/commit/4a6e1a0df1977c2ce4f9c1e282e73ef0299456db))

## [2.0.1](https://github.com/DouglasPrado/gba.dev/compare/ai-harness-v2.0.0...ai-harness-v2.0.1) (2026-08-24)


### Bug Fixes

* **ai-harness:** remove cast redundante que quebrou o lint na main ([#21](https://github.com/DouglasPrado/gba.dev/issues/21)) ([80cfbc2](https://github.com/DouglasPrado/gba.dev/commit/80cfbc2c8fa0f1c1ae211c26a7d58d2e74c963f9))

## [2.0.0](https://github.com/DouglasPrado/gba.dev/compare/ai-harness-v1.0.0...ai-harness-v2.0.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* renomeia o pacote harness para ai-harness ([#18](https://github.com/DouglasPrado/gba.dev/issues/18))

### Features

* renomeia o pacote harness para ai-harness ([#18](https://github.com/DouglasPrado/gba.dev/issues/18)) ([5262e79](https://github.com/DouglasPrado/gba.dev/commit/5262e79533cecd2bf08f0009aef29f9e47f36a01))

## [1.0.0](https://github.com/DouglasPrado/gba.dev/compare/harness-v0.8.0...harness-v1.0.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* o diretorio de dados mudou de `.agentx` para `.harness`. Instalacoes existentes nao encontrarao a memoria nem o banco SQLite anteriores e comecarao vazias. Para preservar, renomeie a pasta antes de atualizar: `mv .agentx .harness`. As notas de migracao em README e nos docs en/pt documentam isso.

### Features

* renomeia o pacote agentx para harness ([ec4000f](https://github.com/DouglasPrado/gba.dev/commit/ec4000f63e887e19ad7b47350eec5f14bd7c70f7))


### Bug Fixes

* completa o rename e corrige caminho de dados na documentacao ([699372d](https://github.com/DouglasPrado/gba.dev/commit/699372d8a54f2e6faebca3acf36f791cd85d62bf))

## [0.8.0](https://github.com/DouglasPrado/gba.dev/compare/agentx-v0.7.6...agentx-v0.8.0) (2026-08-24)

### Features

- **agentx:** converte AgentX em pacote @gba/agentx do monorepo ([53e1112](https://github.com/DouglasPrado/gba.dev/commit/53e1112280d06585f71a787e953a349b1b56df42))
- **agentx:** migra AgentX SDK para packages/agentx como @gba/agentx ([160942c](https://github.com/DouglasPrado/gba.dev/commit/160942cbdaf2b135c565f6942931f4610b063e7d))

## [0.7.6](https://github.com/DouglasPrado/agentx-sdk/compare/v0.7.5...v0.7.6) (2026-05-15)

### Bug Fixes

- cost_warning emitido apenas uma vez com onLimitReached warn (closes [#253](https://github.com/DouglasPrado/agentx-sdk/issues/253)) ([#256](https://github.com/DouglasPrado/agentx-sdk/issues/256)) ([5f1df44](https://github.com/DouglasPrado/agentx-sdk/commit/5f1df44510c00bc3a19b338bc6e702b6627ccddb))
- glob respeita AbortSignal e pula node_modules (closes [#254](https://github.com/DouglasPrado/agentx-sdk/issues/254)) ([#257](https://github.com/DouglasPrado/agentx-sdk/issues/257)) ([9ddaaf3](https://github.com/DouglasPrado/agentx-sdk/commit/9ddaaf3b57201ad781f2cdaed9d0994478166314))
- **memory-paths:** reject dangling symlinks in validateMemoryPathResolved ([#215](https://github.com/DouglasPrado/agentx-sdk/issues/215)) ([d6e2405](https://github.com/DouglasPrado/agentx-sdk/commit/d6e24056f5afc58202a09d7c8829378d236000b9))
- resolve [#211](https://github.com/DouglasPrado/agentx-sdk/issues/211) — sanitizar nomes e descrições MCP para prevenir prompt injection ([09072a3](https://github.com/DouglasPrado/agentx-sdk/commit/09072a33c9d166d05f091d8ff96f7c888f60aa03))
- resolve [#212](https://github.com/DouglasPrado/agentx-sdk/issues/212) — validar comando stdio contra allowedStdioCommands ([6413650](https://github.com/DouglasPrado/agentx-sdk/commit/6413650ac90ae86a3d7d9c298e9e1de6289a813d))
- resolve [#218](https://github.com/DouglasPrado/agentx-sdk/issues/218) — atribuir _db apenas após migração bem-sucedida ([7e786d1](https://github.com/DouglasPrado/agentx-sdk/commit/7e786d11115bd78b652734877a79e3f3d60b9134))
- resolve [#219](https://github.com/DouglasPrado/agentx-sdk/issues/219) — rastrear e abortar forks em background ao destruir Agent ([f55a83a](https://github.com/DouglasPrado/agentx-sdk/commit/f55a83aba6fc444233a3d6a68f4b897c4169c4fb))
- resolve [#220](https://github.com/DouglasPrado/agentx-sdk/issues/220) — isolar turnsSinceExtraction e surfacedMemories por thread ([d6789cc](https://github.com/DouglasPrado/agentx-sdk/commit/d6789cc4aa8e32ff0a6696c38f1a95cbcf698b07))
- resolve [#221](https://github.com/DouglasPrado/agentx-sdk/issues/221) — validar contagem de embeddings após chamada à API ([03c4111](https://github.com/DouglasPrado/agentx-sdk/commit/03c411171cc44e0c9a9b49ca9d68a6295aedb8b4))
- resolve [#236](https://github.com/DouglasPrado/agentx-sdk/issues/236) — bloqueia endereço IPv6 unspecified [::] no SSRF guard ([#242](https://github.com/DouglasPrado/agentx-sdk/issues/242)) ([0297e72](https://github.com/DouglasPrado/agentx-sdk/commit/0297e72de296bbd0da038ad51a4b7daeaa61549a))
- resolve [#237](https://github.com/DouglasPrado/agentx-sdk/issues/237) — strip Unicode bidi/zero-width/tag chars em sanitizeForPrompt ([#243](https://github.com/DouglasPrado/agentx-sdk/issues/243)) ([f160b38](https://github.com/DouglasPrado/agentx-sdk/commit/f160b382397c0501d9837a31180a5bf998f8bb42))
- resolve [#239](https://github.com/DouglasPrado/agentx-sdk/issues/239) — remove dead-code '::1' (sem colchetes) no SSRF guard ([#245](https://github.com/DouglasPrado/agentx-sdk/issues/245)) ([9486997](https://github.com/DouglasPrado/agentx-sdk/commit/948699780882836dfe26455aa172b0be2ebd45fe))
- sanitiza nome de tool MCP antes de inserir no system prompt (closes [#248](https://github.com/DouglasPrado/agentx-sdk/issues/248)) ([#250](https://github.com/DouglasPrado/agentx-sdk/issues/250)) ([f0c20c8](https://github.com/DouglasPrado/agentx-sdk/commit/f0c20c80527b8e7a5fa4d8a653fd0bdab3b5ed3f))
- **ssrf-guard:** block missing IANA reserved ranges ([#213](https://github.com/DouglasPrado/agentx-sdk/issues/213)) ([8e687cc](https://github.com/DouglasPrado/agentx-sdk/commit/8e687cc3705f3b5a907c40bc34ff929bf10abfd4))
- stop_hook_blocking recovery incrementa attempt corretamente (closes [#255](https://github.com/DouglasPrado/agentx-sdk/issues/255)) ([#258](https://github.com/DouglasPrado/agentx-sdk/issues/258)) ([e5b323c](https://github.com/DouglasPrado/agentx-sdk/commit/e5b323c5757c31dd3172b0527757929652cd3ccb))
- stripa tag &lt;system-reminder&gt; de abertura em injections de contexto (closes [#249](https://github.com/DouglasPrado/agentx-sdk/issues/249)) ([#251](https://github.com/DouglasPrado/agentx-sdk/issues/251)) ([579bce9](https://github.com/DouglasPrado/agentx-sdk/commit/579bce9ca4a3100272f39f80581a68658b446072))
- **tool-executor,skill-manager:** pass real recentMessages to validate/match contexts ([#214](https://github.com/DouglasPrado/agentx-sdk/issues/214)) ([7c95114](https://github.com/DouglasPrado/agentx-sdk/commit/7c95114f0a054a0ce66bc917226269a3f167d910))
- **vitest:** add resolve alias agentx-sdk → src/index.ts (closes [#188](https://github.com/DouglasPrado/agentx-sdk/issues/188)) ([#234](https://github.com/DouglasPrado/agentx-sdk/issues/234)) ([a81f397](https://github.com/DouglasPrado/agentx-sdk/commit/a81f397875d92a2f27eb09b133c21b033c3875a5))

## [0.7.5](https://github.com/DouglasPrado/agentx-sdk/compare/v0.7.4...v0.7.5) (2026-05-11)

### Bug Fixes

- bloqueia symlink path traversal em readMemory/deleteMemory (closes [#171](https://github.com/DouglasPrado/agentx-sdk/issues/171)) ([#176](https://github.com/DouglasPrado/agentx-sdk/issues/176)) ([45f43ef](https://github.com/DouglasPrado/agentx-sdk/commit/45f43efd6f88c9eec48d3464584d1db31b42e7da))
- file tools usam process.cwd() como raiz padrão quando workingDir é omitido (closes [#189](https://github.com/DouglasPrado/agentx-sdk/issues/189)) ([#192](https://github.com/DouglasPrado/agentx-sdk/issues/192)) ([ebb920a](https://github.com/DouglasPrado/agentx-sdk/commit/ebb920afa6e0aaacbbf3b0761f8fda5ccc442cbe))
- guard em LLMClient.embed() para json.data ausente/inválido (closes [#172](https://github.com/DouglasPrado/agentx-sdk/issues/172)) ([#177](https://github.com/DouglasPrado/agentx-sdk/issues/177)) ([099a477](https://github.com/DouglasPrado/agentx-sdk/commit/099a47709fd0140a091bb80fa2f2075f3f110c8c))
- guard url obrigatória em transport=auto (closes [#164](https://github.com/DouglasPrado/agentx-sdk/issues/164)) ([#167](https://github.com/DouglasPrado/agentx-sdk/issues/167)) ([284debe](https://github.com/DouglasPrado/agentx-sdk/commit/284debe0640a9fb2360cd6338c176ffd9e700782))
- invalida searchCache após ingest() no KnowledgeManager (closes [#170](https://github.com/DouglasPrado/agentx-sdk/issues/170)) ([#175](https://github.com/DouglasPrado/agentx-sdk/issues/175)) ([3e9b2e0](https://github.com/DouglasPrado/agentx-sdk/commit/3e9b2e0bc997848e0095b7558916ca39ad0602ea))
- override fast-uri &gt;=3.1.2 (closes [#163](https://github.com/DouglasPrado/agentx-sdk/issues/163)) ([#166](https://github.com/DouglasPrado/agentx-sdk/issues/166)) ([d1d03c0](https://github.com/DouglasPrado/agentx-sdk/commit/d1d03c036a5046a5c50192056168a0649f01ff14))
- remove viés de recência em SQLiteVectorStore.search() (closes [#173](https://github.com/DouglasPrado/agentx-sdk/issues/173)) ([#178](https://github.com/DouglasPrado/agentx-sdk/issues/178)) ([53fdf29](https://github.com/DouglasPrado/agentx-sdk/commit/53fdf2978c7abf27b4296ae80904673ced15b142))
- sanitiza &lt;/system-reminder&gt; do conteúdo de injeções em context-builder (closes [#191](https://github.com/DouglasPrado/agentx-sdk/issues/191)) ([#194](https://github.com/DouglasPrado/agentx-sdk/issues/194)) ([fb01c2c](https://github.com/DouglasPrado/agentx-sdk/commit/fb01c2c8a81de276aa89c9b6aaa680d996201f43))
- SSRF guard bloqueia prefixo NAT64 64:ff9b::/96 (closes [#190](https://github.com/DouglasPrado/agentx-sdk/issues/190)) ([#193](https://github.com/DouglasPrado/agentx-sdk/issues/193)) ([ed0a052](https://github.com/DouglasPrado/agentx-sdk/commit/ed0a052aa10bdc9b62a678f7171ee7c7c49e4189))
- valida alinhamento do buffer Float32Array (closes [#165](https://github.com/DouglasPrado/agentx-sdk/issues/165)) ([#168](https://github.com/DouglasPrado/agentx-sdk/issues/168)) ([c8579f4](https://github.com/DouglasPrado/agentx-sdk/commit/c8579f42bb2f3ac5201251548fb60dcb8f81f984))
- valida comprimento de embeddings antes do map em KnowledgeManager.ingest() (closes [#174](https://github.com/DouglasPrado/agentx-sdk/issues/174)) ([#179](https://github.com/DouglasPrado/agentx-sdk/issues/179)) ([83427b8](https://github.com/DouglasPrado/agentx-sdk/commit/83427b80fd42b24522b68d28ebaab2d14e9310e3))

## [0.7.4](https://github.com/DouglasPrado/agentx-sdk/compare/v0.7.3...v0.7.4) (2026-05-08)

### Bug Fixes

- aplica metachar guard incondicionalmente no BashTool (closes [#140](https://github.com/DouglasPrado/agentx-sdk/issues/140)) ([#146](https://github.com/DouglasPrado/agentx-sdk/issues/146)) ([ef8b0f9](https://github.com/DouglasPrado/agentx-sdk/commit/ef8b0f9a6950ab3913a0db891959f62afffd955b))
- bloqueia CGNAT 100.64.0.0/10 no ssrf-guard (closes [#141](https://github.com/DouglasPrado/agentx-sdk/issues/141)) ([#147](https://github.com/DouglasPrado/agentx-sdk/issues/147)) ([1c98525](https://github.com/DouglasPrado/agentx-sdk/commit/1c9852558ee706623d24cc8ccc986ba4ed7bf59a))
- bump hono override para &gt;=4.12.16 (closes [#143](https://github.com/DouglasPrado/agentx-sdk/issues/143)) ([#149](https://github.com/DouglasPrado/agentx-sdk/issues/149)) ([37bc316](https://github.com/DouglasPrado/agentx-sdk/commit/37bc31634fd80a104c7c817e4ae86a91c281d8b6))
- canonicaliza rootDir em assertSafePath para evitar falso positivo com symlink (closes [#157](https://github.com/DouglasPrado/agentx-sdk/issues/157)) ([#161](https://github.com/DouglasPrado/agentx-sdk/issues/161)) ([176edf5](https://github.com/DouglasPrado/agentx-sdk/commit/176edf5ba1732fcbecd1116538cb1067b4346fce))
- corrige falsos positivos no filtro ReDoS do GrepTool (closes [#145](https://github.com/DouglasPrado/agentx-sdk/issues/145)) ([#151](https://github.com/DouglasPrado/agentx-sdk/issues/151)) ([eb72789](https://github.com/DouglasPrado/agentx-sdk/commit/eb72789cdef4cc1331e7be496d12551fcd9f124d))
- delimitadores nonce-based em memory-extractor para prevenir prompt injection (closes [#155](https://github.com/DouglasPrado/agentx-sdk/issues/155)) ([#159](https://github.com/DouglasPrado/agentx-sdk/issues/159)) ([99b0029](https://github.com/DouglasPrado/agentx-sdk/commit/99b00295dd4c70e5d3022786a7e605660b6e4019))
- guarda explícita para choices[] vazio em llm-client.chat() (closes [#154](https://github.com/DouglasPrado/agentx-sdk/issues/154)) ([#158](https://github.com/DouglasPrado/agentx-sdk/issues/158)) ([5b5fa6f](https://github.com/DouglasPrado/agentx-sdk/commit/5b5fa6f8c1bc2460029ee26e310de690e983b1b9))
- guards explícitos para command/url em MCPAdapter (closes [#142](https://github.com/DouglasPrado/agentx-sdk/issues/142)) ([#148](https://github.com/DouglasPrado/agentx-sdk/issues/148)) ([7992ea4](https://github.com/DouglasPrado/agentx-sdk/commit/7992ea492097da0e62fca147dab66252295eccd3))
- limite de 10 MB no FileWrite para prevenir exaustão de disco (closes [#156](https://github.com/DouglasPrado/agentx-sdk/issues/156)) ([#160](https://github.com/DouglasPrado/agentx-sdk/issues/160)) ([b4af1af](https://github.com/DouglasPrado/agentx-sdk/commit/b4af1af3dbd22a9e38e32db21696efc8feec2a2f))
- StreamingToolExecutor usa logger injetável em vez de console.warn (closes [#144](https://github.com/DouglasPrado/agentx-sdk/issues/144)) ([#150](https://github.com/DouglasPrado/agentx-sdk/issues/150)) ([848c69d](https://github.com/DouglasPrado/agentx-sdk/commit/848c69dd4b7f40bfc12b44a90aae25aca14046e9))

## [0.7.3](https://github.com/DouglasPrado/agentx-sdk/compare/v0.7.2...v0.7.3) (2026-05-06)

### Bug Fixes

- **ci:** socket-issues evita duplicatas dentro do mesmo run ([#134](https://github.com/DouglasPrado/agentx-sdk/issues/134)) ([2add661](https://github.com/DouglasPrado/agentx-sdk/commit/2add6617c185de3f663ea16f13f83bc3408303bd))
- **ci:** socket-issues usa .data[] (formato real do socket scan view) ([#130](https://github.com/DouglasPrado/agentx-sdk/issues/130)) ([86b5f5a](https://github.com/DouglasPrado/agentx-sdk/commit/86b5f5abb8b340293b988ea3f46180d670c60608))
