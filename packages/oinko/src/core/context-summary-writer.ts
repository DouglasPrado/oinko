import type { LLMClient } from '../llm/llm-client.js';
import type { TelemetryLLMCall, LLMUsageDetail } from '../contracts/entities/telemetry.js';
import type { TokenUsage } from '../contracts/entities/token-usage.js';
import { SUMMARY_INSTRUCTIONS } from './working-context.js';

/** Summary calls are observable and counted, including a failed/empty result. */
export function createContextSummaryWriter(options: {
  client: LLMClient;
  model: string;
  maxTokens: number;
  traceId: string;
  records: TelemetryLLMCall[];
  signal?: AbortSignal;
  onRecord?: (record: TelemetryLLMCall) => void;
}) {
  return async (transcript: string, previous: string): Promise<string> => {
    const startedAt = Date.now();
    const messages = [
      {
        role: 'system' as const,
        content: `${SUMMARY_INSTRUCTIONS}\nBe compact: at most ${Math.max(80, Math.floor(options.maxTokens * 0.3))} words. Prioritize unresolved work and user constraints. Completed reports need only their key values and retrieval references. Omit unrelated project status and repetitive log details. Do not repeat headings or quote entire messages.`,
      },
      {
        role: 'user' as const,
        content: `PREVIOUS SUMMARY:\n${previous || '(none)'}\n\nNEW TRANSCRIPT:\n${transcript}`,
      },
    ];
    let content = '',
      usage: TokenUsage | undefined,
      usageDetail: LLMUsageDetail | undefined,
      finishReason = 'error';
    let failure: { name: string; message: string } | undefined;
    try {
      for await (const chunk of options.client.streamChat({
        messages,
        model: options.model,
        maxTokens: options.maxTokens * 2 + 512,
        temperature: 0,
        signal: options.signal,
      })) {
        if (chunk.type === 'content') content += chunk.data;
        if (chunk.type === 'done') {
          usage = chunk.usage;
          usageDetail = chunk.usageDetail;
          finishReason = chunk.finishReason;
        }
      }
      if (finishReason === 'length')
        throw new Error('Conversation summary exceeded its output budget');
      if (!content.trim()) throw new Error('Empty conversation summary');
      return content;
    } catch (error) {
      failure = { name: error instanceof Error ? error.name : 'Error', message: String(error) };
      throw error;
    } finally {
      const seq = options.records.length;
      const record: TelemetryLLMCall = {
        kind: 'llm_call',
        id: `${options.traceId}:summary:${seq}`,
        traceId: options.traceId,
        seq,
        model: options.model,
        requestBody: JSON.stringify(messages),
        responseText: content,
        finishReason,
        usage,
        usageDetail,
        costStatus: usageDetail?.costUsd !== undefined ? 'confirmed' : 'unavailable',
        ...(usageDetail?.costUsd !== undefined && { costSource: 'stream_usage' }),
        streamed: true,
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        ...(failure && { error: failure }),
      };
      options.records.push(record);
      options.onRecord?.(record);
    }
  };
}
