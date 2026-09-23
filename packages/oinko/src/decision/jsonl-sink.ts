import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface JsonlSinkOptions {
  /** Lines held in memory before a flush is triggered. Default 50. */
  maxBuffer?: number;
  /** Milliseconds between automatic flushes. Default 5000. */
  flushIntervalMs?: number;
}

export interface JsonlSinkStats {
  written: number;
  dropped: number;
}

/**
 * Appends records to a JSONL file, one object per line.
 *
 * Writes are buffered and flushed off the caller's path — `write()` returns
 * immediately and never throws, because this sits behind instrumentation that
 * must not be able to fail a turn. A record that cannot be serialised, or a
 * disk that refuses the write, is counted in `stats()` and dropped.
 */
export class JsonlSink {
  private buffer: string[] = [];
  private written = 0;
  private dropped = 0;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly maxBuffer: number;
  private readonly timer?: NodeJS.Timeout;

  constructor(
    private readonly filePath: string,
    options?: JsonlSinkOptions,
  ) {
    this.maxBuffer = options?.maxBuffer ?? 50;

    const interval = options?.flushIntervalMs ?? 5_000;
    if (interval > 0) {
      this.timer = setInterval(() => void this.flush(), interval);
      // Never hold the process open just to flush instrumentation.
      this.timer.unref?.();
    }
  }

  write(record: unknown): void {
    if (this.closed) return;

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      this.dropped++;
      return;
    }

    this.buffer.push(line);
    if (this.buffer.length >= this.maxBuffer) void this.flush();
  }

  /** Writes whatever is buffered. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return this.pending;

    const batch = this.buffer;
    this.buffer = [];

    // Chain writes so lines never interleave.
    this.pending = this.pending.then(async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, batch.join('\n') + '\n', 'utf8');
        this.written += batch.length;
      } catch {
        this.dropped += batch.length;
      }
    });

    return this.pending;
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
  }

  stats(): JsonlSinkStats {
    return { written: this.written, dropped: this.dropped };
  }
}
