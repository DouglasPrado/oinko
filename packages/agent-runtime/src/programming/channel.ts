import { z } from 'zod';
import type { AgentTool, ToolExecuteContext } from '@oinko/core';
import type { Actor, ProgrammingRun } from './contracts.js';
import { ProgrammingError, toProgrammingError } from './errors.js';
import type { AccessPort } from './policy.js';
import type { ProgrammingRunService } from './service.js';
import type { RunQueries } from './query.js';
import type { TelemetryJournal } from './telemetry/journal.js';

export interface ChannelRoute {
  channel: string;
  connectionId: string;
  conversationId: string;
}

/** Channel identity of a conversation: the same person, bot and chat. */
export function channelActor(botId: string, route: ChannelRoute, userId?: string): Extract<Actor, { kind: 'channel' }> {
  return {
    kind: 'channel',
    botId,
    channel: route.channel,
    conversationId: `${route.connectionId}:${route.conversationId}`,
    ...(userId && { userId }),
  };
}

/** Route encoded by the runtime's thread id: [agentId, channel, connectionId, conversationId]. */
export function routeFromThread(threadId: string | undefined): { botId: string; route: ChannelRoute } | undefined {
  if (!threadId) return undefined;
  try {
    const value = JSON.parse(threadId) as unknown;
    if (Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === 'string')) {
      const [botId, channel, connectionId, conversationId] = value as [string, string, string, string];
      return { botId, route: { channel, connectionId, conversationId } };
    }
  } catch {
    /* not a channel thread */
  }
  return undefined;
}

const STATE_LABEL: Record<string, string> = {
  queued: 'na fila',
  running: 'em execução',
  paused: 'pausado',
  blocked: 'bloqueado',
  completed: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
};

export function shortId(runId: string): string {
  return runId.slice(4, 12);
}

const PENDING_LABEL: Record<string, string> = {
  pause: 'pausa solicitada',
  cancel: 'cancelamento solicitado',
  steer: 'orientação pendente',
  resume: 'retomada solicitada',
};

export function describeRun(run: ProgrammingRun, pendingControls: string[] = []): string {
  // A request is not the transition: say it is requested until the executor applies it.
  const pending = pendingControls.length
    ? ` · ${[...new Set(pendingControls)].map((kind) => PENDING_LABEL[kind] ?? kind).join(', ')}`
    : '';
  const blocked = run.blocked ? ` — ${run.blocked.message}${run.blocked.needs ? ` ${run.blocked.needs}` : ''}` : '';
  const outcome = run.finalOutcome ? ` — ${run.finalOutcome.summary.slice(0, 300)}` : '';
  return `#${shortId(run.id)} ${STATE_LABEL[run.state] ?? run.state}${pending} · ${run.projectId}${run.taskId ? `/${run.taskId}` : ''} · ciclo ${run.cycleCount}: ${run.request.text.slice(0, 120)}${blocked}${outcome}`;
}

export interface ChannelCommandsOptions {
  botId: string;
  service: ProgrammingRunService;
  queries: RunQueries;
  access: AccessPort;
  journal?: TelemetryJournal;
}

/**
 * Slash commands that control durable work from any channel. They are
 * answered from persisted state at once, never queued behind an LLM call.
 */
export class ChannelCommands {
  constructor(private readonly options: ChannelCommandsOptions) {}

  static readonly COMMANDS = ['/status', '/pause', '/resume', '/cancel', '/tarefa', '/analise', '/orientar'];
  readonly help =
    '/tarefa [projeto] <pedido> — trabalho de programação em segundo plano\n/analise [projeto] <pedido> — análise sem alterar o projeto\n/status [id] — andamento\n/pause, /resume [id] [nota], /cancel [id] — controle\n/orientar [id] <texto> — orientar o trabalho ativo';

  handles(text: string): boolean {
    const command = text.trim().split(/\s+/, 1)[0]?.replace(/@\w+$/, '') ?? '';
    return ChannelCommands.COMMANDS.includes(command);
  }

  /** `idempotencyKey` comes from the channel update (e.g. Telegram message id). */
  handle(route: ChannelRoute, text: string, meta: { userId?: string; idempotencyKey?: string } = {}): string {
    const actor = channelActor(this.options.botId, route, meta.userId);
    const [rawCommand = '', ...rest] = text.trim().split(/\s+/);
    const command = rawCommand.replace(/@\w+$/, '');
    const argument = rest.join(' ').trim();
    this.options.journal?.record('channel_request_received', { botId: this.options.botId }, { channel: route.channel, kind: command.slice(1) });
    try {
      if (command === '/tarefa' || command === '/analise')
        return this.start(actor, argument, command === '/analise' ? 'analysis' : 'change', meta.idempotencyKey);
      const runs = this.options.queries.list(actor, { states: ['queued', 'running', 'paused', 'blocked'], limit: 20 }, route.channel).items;
      if (command === '/status') {
        if (argument) return this.detail(actor, this.pick(actor, argument));
        if (!runs.length) return 'Nenhum trabalho ativo nesta conversa. Use /tarefa <pedido> para iniciar.';
        return runs
          .map((summary) => describeRun(this.options.service.get(actor, summary.id), summary.pendingControls))
          .join('\n');
      }
      const [first = '', ...note] = argument.split(/\s+/);
      const explicit = first && /^[a-f0-9]{4,}$/.test(first) ? first : undefined;
      const run = explicit ? this.pick(actor, explicit) : runs.length === 1 ? runs[0]!.id : undefined;
      if (!run)
        return runs.length
          ? `Há ${runs.length} trabalhos ativos; informe qual: ${runs.map((item) => `#${shortId(item.id)}`).join(', ')}.`
          : 'Nenhum trabalho ativo nesta conversa.';
      const rest = (explicit ? note.join(' ') : argument).trim();
      if (command === '/orientar') {
        if (!rest) return 'Uso: /orientar [id] <orientação>';
        return this.options.service.control(actor, run, 'steer', { text: rest }, route.channel).message;
      }
      const kind = command === '/pause' ? 'pause' : command === '/resume' ? 'resume' : 'cancel';
      const result = this.options.service.control(actor, run, kind, rest ? { note: rest } : {}, route.channel);
      const pending = result.pendingReconciliation.length
        ? ` Ainda exige reconciliação: ${result.pendingReconciliation.length} operação(ões) com resultado incerto.`
        : '';
      return `${result.message}${pending}`;
    } catch (error) {
      const structured = toProgrammingError(error);
      return structured.code === 'not_found' ? 'Trabalho não encontrado nesta conversa.' : structured.message;
    }
  }

  private start(actor: Extract<Actor, { kind: 'channel' }>, argument: string, mode: 'change' | 'analysis', idempotencyKey?: string): string {
    const projects = this.options.access.projectIdsFor(this.options.botId);
    const [maybeProject = '', ...words] = argument.split(/\s+/);
    const projectId = projects.includes(maybeProject) ? maybeProject : projects.length === 1 ? projects[0] : undefined;
    const request = (projectId === maybeProject ? words.join(' ') : argument).trim();
    if (!projectId)
      return projects.length
        ? `Em qual projeto? Use /tarefa <projeto> <pedido>. Projetos: ${projects.join(', ')}.`
        : 'Este bot não tem projetos autorizados.';
    if (!request) return 'Descreva o trabalho: /tarefa <pedido>.';
    const started = this.options.service.start(actor, {
      botId: this.options.botId,
      projectId,
      text: request,
      mode,
      ...(idempotencyKey && { idempotencyKey }),
    });
    const position = started.queuePosition ? ` Posição na fila: ${started.queuePosition + 1}.` : '';
    return `${started.deduplicated ? 'Pedido já recebido' : 'Trabalho registrado'}: #${shortId(started.run.id)} (${projectId}).${position} Use /status para acompanhar.`;
  }

  private pick(actor: Actor, prefix: string): string {
    const match = this.options.queries
      .list(actor, { limit: 100 })
      .items.filter((summary) => summary.id.slice(4).startsWith(prefix.replace(/^#/, '')));
    if (match.length !== 1) throw new ProgrammingError('not_found', 'Trabalho não encontrado.');
    return match[0]!.id;
  }

  private detail(actor: Actor, runId: string): string {
    const detail = this.options.queries.detail(actor, runId, 'channel');
    const run = this.options.service.get(actor, runId);
    const criteria = detail.criteria.map((criterion) => `${criterion.status === 'satisfied' ? '✓' : '·'} ${criterion.description}`).join('\n');
    const uncertain = detail.uncertain.length ? `\nOperações com resultado incerto: ${detail.uncertain.length}.` : '';
    return `${describeRun(run, detail.run.pendingControls)}\n${criteria}${uncertain}`;
  }
}

/**
 * Tools for the conversational agent: it recognizes a new request versus a
 * clarification of the active run, and asks when the intent is ambiguous.
 */
export function programmingChatTools(options: ChannelCommandsOptions): AgentTool[] {
  const actorOf = (context?: ToolExecuteContext) => {
    const parsed = routeFromThread(context?.threadId);
    if (!parsed || parsed.botId !== options.botId)
      throw new ProgrammingError('invalid_request', 'Estas ferramentas funcionam dentro de uma conversa de canal.');
    return { actor: channelActor(options.botId, parsed.route), route: parsed.route };
  };
  const reply = (value: unknown) => JSON.stringify(value);
  const wrap =
    <T>(schema: z.ZodType<T>, run: (args: T, context?: ToolExecuteContext) => unknown) =>
    async (args: unknown, _signal: AbortSignal, _progress?: unknown, context?: ToolExecuteContext) => {
      try {
        return reply(run(schema.parse(args), context));
      } catch (error) {
        const structured = toProgrammingError(error);
        return reply({ error: structured.toJSON() });
      }
    };
  const start = z.object({
    projectId: z.string().min(1),
    request: z.string().min(1).max(20_000),
    mode: z.enum(['change', 'analysis']).default('change'),
    taskId: z.string().optional(),
  });
  const status = z.object({ runId: z.string().optional() });
  const steer = z.object({ runId: z.string().min(1), text: z.string().min(1).max(8000), objective: z.string().max(8000).optional(), confirm: z.boolean().default(false) });
  const control = z.object({ runId: z.string().min(1), action: z.enum(['pause', 'resume', 'cancel']), note: z.string().max(2000).optional() });
  return [
    {
      name: 'programming_start',
      description:
        'Inicia um trabalho de programação durável em segundo plano (retorna runId imediatamente). Use quando a pessoa pedir uma alteração ou análise de código em um projeto autorizado; se já houver trabalho ativo e o pedido parecer um complemento, use programming_steer ou pergunte.',
      parameters: start,
      execute: wrap(start, (args, context) => {
        const { actor } = actorOf(context);
        const started = options.service.start(actor, {
          botId: options.botId,
          projectId: args.projectId,
          text: args.request,
          mode: args.mode,
          ...(args.taskId && { taskId: args.taskId }),
          ...(context?.toolCallId && { idempotencyKey: `tool:${context.toolCallId}` }),
        });
        return { runId: started.run.id, shortId: shortId(started.run.id), state: started.run.state, queuePosition: started.queuePosition, follow: started.follow };
      }),
    },
    {
      name: 'programming_status',
      description: 'Consulta os trabalhos de programação desta conversa (ou um runId), com estado, bloqueio e critérios.',
      parameters: status,
      isReadOnly: true,
      isConcurrencySafe: true,
      execute: wrap(status, (args, context) => {
        const { actor } = actorOf(context);
        if (args.runId) {
          const detail = options.queries.detail(actor, args.runId, 'agent');
          return { run: detail.run, criteria: detail.criteria, uncertain: detail.uncertain, levels: detail.levels };
        }
        return options.queries.list(actor, { limit: 10 }, 'agent');
      }),
    },
    {
      name: 'programming_steer',
      description: 'Registra uma orientação ou correção de escopo para um trabalho ativo, sem criar outro run. Mudança de objetivo exige confirmação explícita da pessoa (confirm).',
      parameters: steer,
      execute: wrap(steer, (args, context) => {
        const { actor, route } = actorOf(context);
        return options.service.control(actor, args.runId, 'steer', { text: args.text, ...(args.objective && { objective: args.objective }), confirm: args.confirm }, route.channel);
      }),
    },
    {
      name: 'programming_control',
      description: 'Pausa, retoma ou cancela um trabalho desta conversa. Cancelar não desfaz arquivos, commits nem prévias.',
      parameters: control,
      execute: wrap(control, (args, context) => {
        const { actor, route } = actorOf(context);
        const result = options.service.control(actor, args.runId, args.action, args.note ? { note: args.note } : {}, route.channel);
        return { status: result.status, state: result.run.state, message: result.message, pendingReconciliation: result.pendingReconciliation };
      }),
    },
  ];
}

export const PROGRAMMING_CHAT_INSTRUCTIONS = `
Trabalhos de programação rodam em segundo plano como runs duráveis. Para iniciar, use programming_start com o projeto autorizado e o pedido; responda com o identificador curto e diga que o progresso chegará aqui. Pedidos só de análise usam mode=analysis e nunca alteram o projeto. Se já houver um trabalho ativo nesta conversa e a mensagem parecer complemento, use programming_steer; se não estiver claro se é um novo trabalho ou uma orientação, pergunte. Use programming_status para responder sobre andamento com base no estado persistido, nunca em suposições. Merge, deploy e operações destrutivas não são feitos por estes trabalhos.`;
