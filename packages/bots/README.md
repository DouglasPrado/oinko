# Bots Oinko

Executor e cadastro compartilhados por bots configuráveis. Um novo bot precisa de configuração, não de outra aplicação.

## Dashboard

Depois de compilar o workspace e iniciar a dashboard, abra `/login`, defina a senha inicial e entre em `/bots`. Crie um bot com nome, modelo, instruções e canais. Credenciais são campos de escrita: deixe em branco ao editar para manter o valor salvo.

Salvar preserva o processo atual. Use **Reiniciar** para aplicar as alterações. **Parar** encerra somente aquele bot; fechar a dashboard ou a CLI não encerra os demais.

O Telegram exige IDs de usuário autorizados por padrão. Para atender qualquer pessoa em conversa privada, ative **Permitir qualquer usuário em conversas privadas**. Desative a opção e informe os IDs para restringir novamente; números de telefone não são IDs do Telegram. Grupos continuam desabilitados.

## Terminal

Na raiz do monorepo:

```bash
pnpm build:packages
pnpm bot list
pnpm bot start oink-lp
pnpm bot status oink-lp
pnpm bot chat oink-lp
pnpm bot restart oink-lp
pnpm bot stop oink-lp
```

`start` inicia um processo independente e retorna seu estado. `chat` acessa o processo existente. `CLI_SESSION_ID` seleciona a conversa da CLI. O ID usado nos comandos é definido ao criar o bot na dashboard.

## Armazenamento

`.harness/bots.db` guarda configurações versionadas e credenciais cifradas. `.harness/bots.key` é a chave AES-256-GCM, restrita ao usuário local. Faça backup dos dois arquivos juntos, além dos diretórios de dados. Não remova a chave separadamente.

Todos os bots gravam histórico, memória e telemetria em `.harness/bots/<id>`. O Oink LP usa esse mesmo cadastro e executor; não há aplicação, arquivo `.env` ou importação automática específicos para ele. `OINKO_ROOT` pode selecionar outro diretório de configuração e dados.

## Extensão

Conexões locais também podem ser salvas em `mcps` pelo `BotStore`, com `{ id: 'oinko', transport: 'stdio', command: '/caminho/node', args: ['/caminho/oinko/packages/mcps/oinko/dist/cli.js', '--root', '/caminho/oinko'], enabled: true }`. Use caminhos absolutos e preserve a revisão ao salvar. Reinicie o bot para aplicar. O subprocesso pertence ao ciclo de vida do bot e herda o ambiente padrão do transporte MCP; não há shell ou configuração de variáveis adicionais. Não coloque credenciais nos argumentos. A dashboard mostra a conexão local, mantém seus campos ao salvar e permite desabilitar ou remover.

O pacote compõe os adaptadores de `packages/channels` e `packages/mcps`. Hoje a interface oferece CLI, Telegram, Higgsfield e MCP HTTP. Um tipo novo de canal é implementado e registrado uma vez no executor. Ferramentas e skills específicas podem continuar sendo compostas por código com o núcleo e o runtime.
