import type { TelemetryRecord, TelemetrySink } from '../contracts/entities/telemetry.js';

/**
 * Blinda um sink para que ele nao possa derrubar um turno.
 *
 * O contrato diz que `write` nunca lanca, mas um sink de terceiros pode
 * violar isso — e instrumentacao que quebra a execucao que observa e pior que
 * instrumentacao nenhuma. `flush` e `close` tambem sao cobertos: uma promessa
 * rejeitada aqui viraria unhandled rejection no encerramento do agente.
 */
export function guardSink(sink: TelemetrySink, onError?: (err: unknown) => void): TelemetrySink {
  const report = (err: unknown): void => {
    try {
      onError?.(err);
    } catch {
      // Nem o relato de erro pode escapar.
    }
  };

  return {
    write(record: TelemetryRecord): void {
      try {
        sink.write(record);
      } catch (err) {
        report(err);
      }
    },
    async flush(): Promise<void> {
      try {
        await sink.flush();
      } catch (err) {
        report(err);
      }
    },
    async close(): Promise<void> {
      try {
        await sink.close();
      } catch (err) {
        report(err);
      }
    },
    stats() {
      try {
        return sink.stats();
      } catch {
        return { written: 0, dropped: 0 };
      }
    },
  };
}
