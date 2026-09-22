# Oink LP

O Oink LP agora é um cadastro no executor comum `@oinko/bots`. Novos bots são criados na dashboard, sem copiar esta pasta.

Na primeira abertura do cadastro ou execução de um comando antigo, a configuração de `.env` e `connections.json` é importada. Os arquivos e dados originais são preservados. Depois da importação, edite instruções, modelo, credenciais e conexões em `/bots`; os arquivos antigos não sobrescrevem as alterações da dashboard.

```bash
pnpm --filter @oinko/oink-lp build
pnpm bot import-oink-lp
pnpm bot start oink-lp
pnpm bot chat oink-lp
pnpm bot status oink-lp
pnpm bot restart oink-lp
pnpm bot stop oink-lp
```

Os comandos anteriores `pnpm --filter @oinko/oink-lp start|chat|status` continuam disponíveis e chamam o executor compartilhado. `reload` agora reinicia o bot para aplicar a configuração salva. `start` retorna depois de iniciar o processo; fechar o terminal não encerra o bot.

O processo anterior à migração precisa ser encerrado uma vez antes do primeiro controle pelo executor novo. Cada token Telegram deve ter um único consumidor.

CLI atende texto; Telegram atende texto, imagens e áudio, restrito aos usuários autorizados. Conversas e memórias permanecem isoladas por agente, canal e conversa. A configuração de transcrição pode usar um provedor separado. Higgsfield usa a conta autorizada em **Integrações**.

Os dados já existentes permanecem em `AGENT_DATA_DIR/AGENT_ID`; a importação também preserva um caminho personalizado de telemetria. Não há migração automática do histórico de `examples/telegram-bot`.

O código de factory e os testes locais permanecem como exemplo de composição programática. A inicialização de produção está centralizada em `packages/bots`.

[Executor comum](../../packages/bots/README.md) · [Dashboard](../dashboard/README.md)
