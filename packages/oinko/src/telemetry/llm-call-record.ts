import type { LLMCallTelemetry } from '../core/react-loop.js';
import type { TelemetryLLMCall } from '../contracts/entities/telemetry.js';

/** Preserve the provider's cost availability and the exact payload of this iteration. */
export function llmCallRecord(
  call: LLMCallTelemetry,
  options: { traceId: string; summaryCount: number; includeTools: boolean; providerKind: string },
): TelemetryLLMCall {
  return {
    kind: 'llm_call',
    id: `${options.traceId}:${call.seq}`,
    traceId: options.traceId,
    seq: call.seq + options.summaryCount,
    model: call.model,
    requestBody: JSON.stringify(
      options.includeTools
        ? { messages: call.requestMessages, tools: call.requestTools ?? [] }
        : call.requestMessages,
    ),
    responseText: call.responseText,
    ...(call.responseToolCalls !== undefined && {
      responseToolCalls: call.responseToolCalls,
    }),
    finishReason: call.finishReason,
    ...(call.usage !== undefined && { usage: call.usage }),
    ...(call.usageDetail !== undefined && { usageDetail: call.usageDetail }),
    // Tres estados, nao dois. Confirmado quando o valor veio no stream;
    // pendente quando o provedor tem como informar depois e ha id de
    // geracao para perguntar; indisponivel so quando nao ha a quem
    // perguntar. Estimar nao e opcao em nenhum deles.
    costStatus:
      call.usageDetail?.costUsd !== undefined
        ? 'confirmed'
        : options.providerKind === 'openrouter' && call.usageDetail?.generationId !== undefined
          ? 'pending'
          : 'unavailable',
    ...(call.usageDetail?.costUsd !== undefined && { costSource: 'stream_usage' as const }),
    ...(call.ttftMs !== undefined && { ttftMs: call.ttftMs }),
    ...(call.durationMs !== undefined && { durationMs: call.durationMs }),
    ...(call.queuedMs !== undefined && { queuedMs: call.queuedMs }),
    ...(call.attempts !== undefined && { attempts: call.attempts }),
    streamed: true,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
  };
}
