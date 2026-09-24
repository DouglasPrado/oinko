import { z } from 'zod';
import { openProgramming, type ProgrammingRuntime } from '@oinko/bots/programming';
import { RUN_STATES, type Actor } from '@oinko/agent-runtime/programming';

/** Registers one MCP tool; shared helper from the server so errors are uniform. */
export type RegisterTool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (args: z.output<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>,
  readOnly?: boolean,
) => void;

export { OINKO_TOOL_EQUIVALENTS } from '@oinko/bots/programming';

/**
 * Durable run tools over the same service and authorization as the dashboard
 * and channels. A bot-scoped server acts as that bot, never as administrator.
 */
export function registerRunTools(
  tool: RegisterTool,
  options: { actor: Actor; programming: () => ProgrammingRuntime },
) {
  const actor = options.actor;
  const audit = <T>(name: string, runId: string | undefined, run: () => T): T => {
    const runtime = options.programming();
    const started = Date.now();
    const correlation = runId ? { runId } : {};
    runtime.journal.record('mcp_call_started', correlation, { tool: name, actorKind: actor.kind }, 'started');
    try {
      const value = run();
      runtime.journal.emit({ type: 'mcp_call_finished', status: 'succeeded', ...correlation, durationMs: Date.now() - started, payload: { tool: name, actorKind: actor.kind, result: 'ok' } });
      return value;
    } catch (error) {
      runtime.journal.emit({ type: 'mcp_call_finished', status: 'failed', ...correlation, durationMs: Date.now() - started, payload: { tool: name, actorKind: actor.kind, result: 'error' } });
      throw error;
    }
  };
  const Run = z.string().regex(/^run-[a-f0-9-]{36}$/);
  tool(
    'oinko_runs',
    'Lista trabalhos de programação duráveis (fila, em execução, pausados, bloqueados e encerrados) com paginação por cursor.',
    {
      botId: z.string().optional(),
      projectId: z.string().optional(),
      states: z.array(z.enum(RUN_STATES)).optional(),
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async (args) =>
      audit('oinko_runs', undefined, () =>
        options.programming().queries.list(
          actor,
          {
            ...(args.botId && { botId: args.botId }),
            ...(args.projectId && { projectId: args.projectId }),
            ...(args.states && { states: args.states }),
            ...(args.cursor && { cursor: args.cursor }),
            limit: args.limit,
          },
          'mcp',
        ),
      ),
    true,
  );
  tool(
    'oinko_run',
    'Consulta um trabalho: plano, critérios, operações (incertas destacadas), evidências (referências), publicações, consumo e uma página da linha do tempo. Use timelineAfterId para continuar.',
    { runId: Run, timelineAfterId: z.number().int().nonnegative().optional(), timelineLimit: z.number().int().min(1).max(200).default(50) },
    async (args) =>
      audit('oinko_run', args.runId, () => {
        const runtime = options.programming();
        const detail = runtime.queries.detail(actor, args.runId, 'mcp');
        const timeline = runtime.queries.timeline(
          actor,
          args.runId,
          { ...(args.timelineAfterId !== undefined && { afterId: args.timelineAfterId }), limit: args.timelineLimit },
          'mcp',
        );
        return {
          ...detail,
          steps: detail.steps.map(({ summary, ...step }) => ({ ...step, summary: summary?.slice(0, 500) })),
          timeline: {
            entries: timeline.entries.map((entry) => ({ id: entry.id, type: entry.event.type, status: entry.event.status, occurredAt: entry.event.occurredAt, stepId: entry.event.stepId, operationId: entry.event.operationId })),
            ...(timeline.nextAfterId !== undefined && { nextAfterId: timeline.nextAfterId }),
          },
        };
      }),
    true,
  );
  tool(
    'oinko_run_start',
    'Inicia um trabalho de programação em segundo plano e responde imediatamente com runId, estado e posição na fila; não espera terminar. mode=analysis nunca altera o projeto.',
    {
      botId: z.string().min(1),
      projectId: z.string().min(1),
      request: z.string().min(1).max(20_000),
      mode: z.enum(['change', 'analysis']).default('change'),
      taskId: z.string().optional(),
      idempotencyKey: z.string().min(1).max(200).optional(),
    },
    async (args) =>
      audit('oinko_run_start', undefined, () => {
        const started = options.programming().service.start(actor, {
          botId: args.botId,
          projectId: args.projectId,
          text: args.request,
          mode: args.mode,
          ...(args.taskId && { taskId: args.taskId }),
          ...(args.idempotencyKey && { idempotencyKey: args.idempotencyKey }),
        });
        return { runId: started.run.id, state: started.run.state, queuePosition: started.queuePosition, deduplicated: started.deduplicated, follow: `Acompanhe com oinko_run { runId: "${started.run.id}" } ou na dashboard.` };
      }),
  );
  tool(
    'oinko_run_control',
    'Pausa, retoma, cancela ou orienta um trabalho. O pedido é persistido e aplicado no próximo ponto seguro; cancelar não desfaz arquivos, commits nem prévias.',
    {
      runId: Run,
      action: z.enum(['pause', 'resume', 'cancel', 'steer']),
      text: z.string().max(8000).optional(),
      note: z.string().max(2000).optional(),
      objective: z.string().max(8000).optional(),
      confirm: z.boolean().optional(),
    },
    async (args) =>
      audit('oinko_run_control', args.runId, () => {
        const { runId, action, ...payload } = args;
        const result = options.programming().service.control(actor, runId, action, payload, 'mcp');
        return { status: result.status, state: result.run.state, message: result.message, pendingReconciliation: result.pendingReconciliation };
      }),
  );
  tool(
    'oinko_run_explain',
    'Explica por que um trabalho está no estado atual: bloqueio, operação responsável e últimos eventos.',
    { runId: Run },
    async (args) => audit('oinko_run_explain', args.runId, () => options.programming().queries.explain(actor, args.runId)),
    true,
  );
  tool(
    'oinko_artifact',
    'Lê uma evidência de trabalho (diff, log, relatório) com limite de caracteres; conteúdo já redigido. Expiração e captura desativada aparecem como indisponibilidade.',
    { artifactId: z.string().min(1).max(100), maxChars: z.number().int().min(100).max(100_000).default(20_000) },
    async (args) =>
      audit('oinko_artifact', undefined, () => {
        const { artifact, content } = options.programming().artifacts.read(actor, args.artifactId, 'mcp');
        const text = artifact.mediaType.startsWith('text/') || artifact.mediaType === 'application/json';
        return {
          artifact: { id: artifact.id, type: artifact.type, mediaType: artifact.mediaType, size: artifact.size, runId: artifact.runId },
          ...(text
            ? { text: content.toString('utf8').slice(0, args.maxChars), truncated: content.length > args.maxChars }
            : { note: 'Conteúdo binário: abra pela dashboard.' }),
        };
      }),
    true,
  );
}

/** Lazily opened runtime shared by a server's calls. */
export function lazyProgramming(root: string | undefined) {
  let runtime: ProgrammingRuntime | undefined;
  return {
    get: () => {
      if (!root) throw new Error('Informe a raiz de dados para consultar trabalhos.');
      runtime ??= openProgramming({ root, producer: 'mcp' });
      return runtime;
    },
    close: async () => {
      await runtime?.close();
      runtime = undefined;
    },
  };
}
