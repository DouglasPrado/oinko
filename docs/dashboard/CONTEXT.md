# Contexto e ferramentas por bot

Na dashboard, abra **Bots → Configurar → Contexto e ferramentas**. Habilite **Otimizar contexto**, ajuste os limites, salve e reinicie o bot. O histórico existente é preservado. A primeira conversa longa pode demorar mais enquanto seu primeiro resumo é criado.

O contexto enviado ao modelo reúne instruções, resumo persistente e turnos recentes. Resultados antigos extensos passam a ter trechos e referências: `ToolResult` lê o original arquivado, e `ConversationSearch` recupera mensagens. O resumo sobrevive ao reinício. `/reset` continua apagando a conversa, agora também seu resumo e resultados arquivados.

Quando a mensagem cita um campo técnico (por exemplo, `trace_id`) ou um literal entre aspas, o agente também procura trechos exatos nos últimos 200 resultados da própria conversa. Envia no máximo três trechos pequenos, identificados como dados históricos na telemetria. Essa busca local não faz outra chamada de IA e não substitui a consulta ao estado atual de arquivos e serviços.

Com **Usar Jev** e **Selecionar ferramentas com Jev** habilitados, o Jev recebe nomes e descrições resumidas, a mensagem atual e um estado curto da tarefa. Ele escolhe as ferramentas iniciais na mesma chamada que decide o modelo. O agente pode carregar outras pelo `ToolSearch`. Isso não concede permissões novas. Se o Jev falhar, todas as ferramentas autorizadas continuam disponíveis e a telemetria registra o fallback.

| Configuração | Padrão ao habilitar |
| --- | ---: |
| Orçamento de contexto normal | 20.000 tokens estimados |
| Orçamento fast | 8.000 tokens estimados |
| Janela recente | 6.000 tokens estimados |
| Tamanho alvo do resumo | 1.200 tokens |
| Trecho de resultado antigo | 2.000 caracteres |
| Ferramentas na seleção inicial | 10, além das ferramentas de descoberta/consulta |
| Confiança de seleção | 0,70 |

Os orçamentos são alvos, não limites rígidos do provedor. A mensagem atual, turnos completos e conteúdo fixado podem exigir mais espaço. O agente avisa quando excede o alvo. O tamanho do resumo também depende da geração; o limite de saída reserva espaço adicional para modelos com raciocínio.

## Conexão pelo MCP Oinko

Use `oinko_bots` para obter a revisão atual e depois `oinko_update_bot`:

```json
{
  "botId": "dev",
  "revision": 7,
  "changes": {
    "context": {
      "enabled": true,
      "maxInputTokens": 20000,
      "fastInputTokens": 8000,
      "recentTokens": 6000,
      "summaryTokens": 1200,
      "toolResultChars": 2000,
      "selectTools": true,
      "maxTools": 10,
      "minToolConfidence": 0.7
    }
  }
}
```

A revisão acima é ilustrativa. A política `context` é substituída integralmente; campos internos omitidos voltam aos padrões. Omitir `context` preserva a configuração; `context: null` desabilita sem apagar histórico. O retorno informa se é necessário reiniciar. Credenciais, canais e modelos permanecem iguais quando omitidos.

## SDK

```ts
import { Agent, JevDecider } from '@oinko/core';

const agent = Agent.create({
  apiKey: process.env.LLM_API_KEY!,
  model: 'identificador-do-modelo-no-provedor',
  dbPath: '.harness/data.db',
  context: { enabled: true },
  decider: new JevDecider({ apiKey: process.env.TYPESAFE_API_KEY! }),
});
```

`context` é opcional e desabilitado por padrão para preservar compatibilidade. Sem `decider`, a compactação funciona, mas todas as ferramentas ficam expostas. `summaryModel` permite escolher outro modelo de resumo; o padrão é o modelo principal. A política pode ser validada em interfaces web por `@oinko/core/context-policy`, sem carregar o runtime Node.

Stores personalizados devem implementar `getCheckpoint`, `saveCheckpoint`, `getToolResult` e `saveToolResult`, além da busca de mensagens quando habilitada. Os stores SQLite e em memória fornecidos pelo SDK já implementam esses métodos. Só o SQLite persiste após encerrar o processo.

## Como interpretar o consumo

A composição do contexto na dashboard é estimada. Tokens e custos das chamadas vêm do provedor. Chamadas de resumo aparecem na mesma execução e entram no consumo do agente. O consumo do Jev aparece em suas decisões, separado do LLM. Se seu provedor não retornar custo monetário, o valor é indisponível, nunca presumido zero.

Compare tokens do LLM **mais** tokens do Jev. Resumir e selecionar também custa tempo e tokens; o resultado depende do tamanho da conversa, catálogo e modelo. As instruções gerais dos MCPs continuam no prompt, mesmo quando apenas parte das definições das ferramentas é selecionada.

As conversas completas permanecem no armazenamento local. Esta mudança limita o payload enviado ao modelo, não a leitura do histórico em memória pelo processo. Resultados novos são arquivados antes do corte; partes já perdidas em resultados antigos não podem ser reconstruídas retroativamente.
