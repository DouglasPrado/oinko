# Oink LP

Agente especializado em criação de landing pages, com uma definição compartilhada e dois adaptadores de entrada: CLI e Telegram. No modo `both`, ambos usam a mesma instância do SDK. Instruções, modelo e extensões pertencem ao agente; transporte e apresentação pertencem aos canais.

## Executar

Na raiz do repositório:

```bash
pnpm install
cp apps/oink-lp/.env.example apps/oink-lp/.env
# Preencha LLM_API_KEY e AGENT_MODEL no arquivo acima.
pnpm --filter @oinko/oink-lp dev cli
```

`dev` compila o SDK e o aplicativo antes de executar. Para usar os outros modos:

```bash
pnpm --filter @oinko/oink-lp dev telegram
pnpm --filter @oinko/oink-lp dev both
```

Telegram exige `TELEGRAM_BOT_TOKEN` e `TELEGRAM_ALLOWED_USER_IDS` (IDs numéricos separados por vírgulas). O adaptador atende somente conversas privadas desses usuários. Ele usa long polling; execute um único consumidor por token e desative qualquer webhook anterior antes de usar. O exemplo em `examples/telegram-bot` não deve rodar simultaneamente com o mesmo token.

### Áudio e imagens no Telegram

O adaptador reaproveita o processamento de mídia do exemplo: aceita fotos e imagens como arquivo (JPEG, PNG, WebP e GIF, até 5 MB), notas de voz, músicas e documentos de áudio (até 20 MB). Áudio aceita OGG/Opus, OGA, MP3/MPEG, MP4/M4A, WAV, WebM e FLAC. Vídeos e outros documentos não são processados.

Imagens chegam ao modelo como conteúdo multimodal; `AGENT_MODEL` precisa aceitar imagens. A URL de download com o token do Telegram nunca é enviada ao modelo. Áudio é transcrito antes da conversa, preservando a legenda; somente o texto transcrito entra no histórico. Legendas e transcrições não executam comandos como `/reset`.

Configure `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_BASE_URL` e, opcionalmente, `TRANSCRIPTION_MODEL` para usar um provedor de transcrição separado. A API deve oferecer `/audio/transcriptions` compatível com o SDK. Sem configuração separada, usa a chave e a URL do LLM; o modelo padrão é `whisper-1`. Downloads respeitam os limites também durante a leitura e têm timeout de 30 segundos.

Após compilar, `pnpm --filter @oinko/oink-lp start both` reutiliza o build. `--help` mostra o uso sem exigir credenciais. `apps/oink-lp/.env` é carregado pelo Node; variáveis já presentes no processo têm prioridade. O `.env` da raiz não é carregado automaticamente.

## Conversas e comandos

- Texto livre: conversa com o agente.
- `/help` ou `/start`: ajuda.
- `/reset`: apaga somente o histórico da conversa atual; preserva memórias salvas.
- `/memory <texto>`: salva uma memória para a conversa atual.
- `/usage`: tokens da conversa desde o início do processo (contador não persistido).
- `/exit`: encerra a CLI e, no modo `both`, também o Telegram.

`Ctrl+C` ou `SIGTERM` cancela o turno ativo e encerra os canais antes de fechar o armazenamento. EOF na CLI também encerra o processo; para execução sem terminal, use `telegram`.

Histórico persiste em `AGENT_DATA_DIR/AGENT_ID/conversations.db`; memórias ficam em `AGENT_DATA_DIR/AGENT_ID/memory`. Caminhos relativos partem de `apps/oink-lp` quando executado com os comandos acima. A identidade de cada thread inclui agente, canal, conexão e conversa, sem compartilhar automaticamente histórico ou memória entre CLI e Telegram. `CLI_SESSION_ID` permite abrir outra conversa ou retomar uma existente.

## Estrutura e limites

A telemetria é gravada por padrão em `AGENT_DATA_DIR/AGENT_ID/telemetry.db`, com o rótulo `AGENT_ID`. Para acompanhar este agente na dashboard, configure `TELEMETRY_DB_PATH=../oink-lp/data/oink-lp/telemetry.db` em `apps/dashboard/.env.local` e reinicie a dashboard. Ajuste o caminho se mudar o ID ou diretório do agente. O banco é inicializado ao subir o agente, mesmo antes da primeira conversa.

`TELEMETRY=off` desliga a gravação; `TELEMETRY_CAPTURE=full|hashed|none` controla o conteúdo capturado (padrão `full`), e `TELEMETRY_RETENTION_DAYS` controla a retenção (padrão 30 dias). O histórico do exemplo antigo permanece no banco antigo; a troca do caminho não migra dados.

- `src/agent-factory.ts`: cria o agente e seu armazenamento; ponto único para registrar ferramentas, skills e MCP.
- `@oinko/agent-runtime`: roteamento, comandos e fila compartilhada. Turnos são serializados porque ferramentas e skills podem manter estado na instância do SDK.
- `@oinko/channel-cli` e `@oinko/channel-telegram`: adaptadores CLI e Telegram.
- `src/main.ts`: inicialização e encerramento dos canais.

Esta versão atende texto na CLI e texto, imagens e áudio no Telegram, com resposta final em texto nos dois canais. Higgsfield é consumido de `@oinko/mcp-higgsfield`: habilita geração e upload de referências quando autorizado na dashboard. Tavily, streaming visual, painel de configuração do agente e vinculação de identidade entre canais não estão implementados nesta aplicação. Não migra automaticamente dados dos exemplos. A extensão usa a API pública do SDK, sem alterar seu núcleo.

Testes com transporte simulado e SQLite real:

```bash
pnpm --filter @oinko/oink-lp build
pnpm --filter @oinko/oink-lp test
pnpm --filter @oinko/oink-lp typecheck
pnpm --filter @oinko/oink-lp lint
```

Referências do transporte: [grammY](https://grammy.dev/guide/filter-queries), [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage).

## Higgsfield

`HIGGSFIELD=on` (padrão) conecta o MCP se houver credencial. A conta é autorizada na dashboard e compartilhada por padrão em `.harness/credentials/higgsfield.json` na raiz do monorepo. `HIGGSFIELD_CREDENTIAL_PATH`, `HIGGSFIELD_MCP_URL` e `HIGGSFIELD_TOOLS` permitem configurar outra conta, endpoint ou seleção de ferramentas. Reinicie o agente depois da primeira autorização.
