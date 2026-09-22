# Oink LP

Agente especializado em landing pages. Um único processo carrega os canais e MCPs habilitados em `connections.json`. CLI e Telegram usam a mesma instância; adaptadores são compartilhados entre os agentes do monorepo.

## Executar

Configure `apps/oink-lp/.env` a partir de `.env.example`, sem sobrescrever suas credenciais. Na raiz:

```bash
pnpm --filter @oinko/oink-lp build
pnpm --filter @oinko/oink-lp start
```

Isso mantém o bot rodando com todas as conexões configuradas. Em outro terminal:

```bash
pnpm --filter @oinko/oink-lp chat
pnpm --filter @oinko/oink-lp status
```

`chat` conecta ao bot existente, sem iniciar outro agente ou consumidor Telegram. Pode abrir mais de um terminal. `/exit`, EOF ou Ctrl+C no cliente fecha somente aquele cliente. Ctrl+C no processo `start` encerra o bot e todas as conexões. `dev` compila e inicia o mesmo serviço.

## Configurar conexões

Edite `connections.json`: cada entrada em `channels` ou `mcps` tem `id`, `type`, `options` e `enabled` (padrão `true`). As opções podem referenciar segredos do `.env` com `{ "env": "NOME" }`. A configuração inicial habilita CLI, Telegram e Higgsfield.

Após alterar o arquivo ou as credenciais no `.env`:

```bash
pnpm --filter @oinko/oink-lp reload
pnpm --filter @oinko/oink-lp status
```

O serviço reconcilia as conexões alteradas sem recriar o agente. `status` mostra `connecting`, `connected` ou `error` sem expor credenciais. Uma conexão com falha não desliga as outras; `reload` tenta novamente. Mudanças no modelo, prompt ou armazenamento exigem reiniciar o bot. No reload das conexões, valores do `.env` prevalecem sobre os herdados pelo processo.

Canais disponíveis: `cli` e `telegram`. Um novo tipo de canal é implementado uma vez em `packages/channels` e registrado na composição do aplicativo; todos os agentes podem reutilizá-lo. Adicionar outra conexão de um tipo registrado exige apenas configuração. Cada token Telegram deve ter um único consumidor.

MCPs padrão aceitam `type: "mcp"` com as opções do SDK, sem implementar outro adaptador. Exemplo de entrada em `mcps`:

```json
{
  "id": "meu-servidor",
  "type": "mcp",
  "options": {
    "transport": "http",
    "url": "https://seu-servidor.example/mcp",
    "headers": { "Authorization": { "env": "MEU_MCP_AUTHORIZATION" } }
  }
}
```

O tipo `higgsfield` acrescenta OAuth e upload de referências à conexão MCP. `HIGGSFIELD=off` também o desabilita. `AGENT_CONNECTIONS_FILE` permite escolher outro arquivo. `CLI_CONNECTION_ID` seleciona uma conexão CLI (padrão `local`).

Telegram exige `TELEGRAM_BOT_TOKEN` e `TELEGRAM_ALLOWED_USER_IDS` (IDs numéricos separados por vírgulas). Atende conversas privadas desses usuários usando long polling. O exemplo antigo não deve rodar com o mesmo token.

### Áudio e imagens no Telegram

O adaptador reaproveita o processamento de mídia do exemplo: aceita fotos e imagens como arquivo (JPEG, PNG, WebP e GIF, até 5 MB), notas de voz, músicas e documentos de áudio (até 20 MB). Áudio aceita OGG/Opus, OGA, MP3/MPEG, MP4/M4A, WAV, WebM e FLAC. Vídeos e outros documentos não são processados.

Imagens chegam ao modelo como conteúdo multimodal; `AGENT_MODEL` precisa aceitar imagens. A URL de download com o token do Telegram nunca é enviada ao modelo. Áudio é transcrito antes da conversa, preservando a legenda; somente o texto transcrito entra no histórico. Legendas e transcrições não executam comandos como `/reset`.

Configure `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_BASE_URL` e, opcionalmente, `TRANSCRIPTION_MODEL` para usar um provedor de transcrição separado. A API deve oferecer `/audio/transcriptions` compatível com o SDK. Sem configuração separada, usa a chave e a URL do LLM; o modelo padrão é `whisper-1`. Downloads respeitam os limites também durante a leitura e têm timeout de 30 segundos.

## Conversas e comandos

- Texto livre: conversa com o agente.
- `/help` ou `/start`: ajuda.
- `/reset`: apaga somente o histórico da conversa atual; preserva memórias salvas.
- `/memory <texto>`: salva uma memória para a conversa atual.
- `/usage`: tokens da conversa desde o início do processo (contador não persistido).
- `/exit`: desconecta somente o cliente CLI.

Histórico persiste em `AGENT_DATA_DIR/AGENT_ID/conversations.db`; memórias ficam em `AGENT_DATA_DIR/AGENT_ID/memory`. Caminhos relativos partem de `apps/oink-lp` quando executado com os comandos acima. A identidade de cada thread inclui agente, canal, conexão e conversa, sem compartilhar automaticamente histórico ou memória entre CLI e Telegram. `CLI_SESSION_ID` permite abrir outra conversa ou retomar uma existente.

## Estrutura e limites

A telemetria é gravada por padrão em `AGENT_DATA_DIR/AGENT_ID/telemetry.db`, com o rótulo `AGENT_ID`. Para acompanhar este agente na dashboard, configure `TELEMETRY_DB_PATH=../oink-lp/data/oink-lp/telemetry.db` em `apps/dashboard/.env.local` e reinicie a dashboard. Ajuste o caminho se mudar o ID ou diretório do agente. O banco é inicializado ao subir o agente, mesmo antes da primeira conversa.

`TELEMETRY=off` desliga a gravação; `TELEMETRY_CAPTURE=full|hashed|none` controla o conteúdo capturado (padrão `full`), e `TELEMETRY_RETENTION_DAYS` controla a retenção (padrão 30 dias). O histórico do exemplo antigo permanece no banco antigo; a troca do caminho não migra dados.

- `src/agent-factory.ts`: cria o agente e seu armazenamento; ponto para definir instruções, ferramentas e skills do produto.
- `@oinko/agent-runtime`: serviço local, conexões configuráveis, roteamento, comandos e fila compartilhada. Turnos são serializados porque ferramentas e skills podem manter estado na instância do SDK.
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

`HIGGSFIELD=on` (padrão) conecta o MCP se houver credencial. A conta é autorizada na dashboard e compartilhada por padrão em `.harness/credentials/higgsfield.json` na raiz do monorepo. `HIGGSFIELD_CREDENTIAL_PATH`, `HIGGSFIELD_MCP_URL` e `HIGGSFIELD_TOOLS` permitem configurar outra conta, endpoint ou seleção de ferramentas. Execute `pnpm --filter @oinko/oink-lp reload` depois da primeira autorização.
