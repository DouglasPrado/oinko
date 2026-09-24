import type { Decider } from '../contracts/entities/decider.js';
import type { TelemetrySink } from '../contracts/entities/telemetry.js';
import {
  RecordingDecider,
  type DecisionRecord,
  type StateMode,
} from '../decision/recording-decider.js';

export interface DecisionTraceContext {
  traceId: string;
  threadId: string;
}

/**
 * Envolve um decider para que cada decisao chegue a telemetria carimbada com a
 * execucao em que foi tomada.
 *
 * O carimbo e por execucao, e nao um campo global no agente, porque threads
 * diferentes correm em paralelo — um campo compartilhado atribuiria a decisao
 * de uma conversa ao trace de outra. Aqui o contexto e fechado no wrapper no
 * momento em que o turno comeca.
 *
 * Reusa o `RecordingDecider` que ja existe em vez de reimplementar a captura:
 * ele ja mede latencia, infere o ponto de decisao pelas chaves das perguntas e
 * decide quanto do estado avaliado guardar. Um `RecordingDecider` que o host
 * tenha montado por fora continua funcionando — os dois observam a mesma
 * decisao, um para o JSONL dele, outro para o banco.
 */
export function traceDecisions(
  decider: Decider,
  sink: TelemetrySink,
  context: DecisionTraceContext,
  stateMode: StateMode = 'hash',
): Decider {
  return new RecordingDecider(
    decider,
    (record: DecisionRecord) => sink.write(toTelemetry(record, context)),
    {
      stateMode,
    },
  );
}

function toTelemetry(record: DecisionRecord, context: DecisionTraceContext) {
  return {
    kind: 'decision' as const,
    id: record.id,
    traceId: context.traceId,
    threadId: context.threadId,
    point: record.point,
    ...(record.state !== undefined && { state: record.state }),
    ...(record.stateHash !== undefined && { stateHash: record.stateHash }),
    questions: record.questions,
    answers: record.answers,
    durationMs: record.durationMs,
    ...(record.usage && { usage: record.usage }),
    ...(record.error !== undefined && { error: record.error }),
    createdAt: record.timestamp,
  };
}
