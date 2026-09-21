import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonlSink } from '../../../src/decision/jsonl-sink.js';

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function tempFile(name = 'decisions.jsonl'): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'jsonl-sink-'));
  return join(dir, name);
}

describe('JsonlSink', () => {
  it('writes one JSON object per line', async () => {
    const file = await tempFile();
    const sink = new JsonlSink(file);

    sink.write({ id: 'a', point: 'memory_extraction' });
    sink.write({ id: 'b', point: 'knowledge_gate' });
    await sink.close();

    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ id: 'a', point: 'memory_extraction' });
    expect(JSON.parse(lines[1]!)).toEqual({ id: 'b', point: 'knowledge_gate' });
  });

  it('creates missing directories', async () => {
    const file = join(await tempFile(), '..', 'nested', 'deep', 'out.jsonl');
    const sink = new JsonlSink(file);

    sink.write({ id: 'a' });
    await sink.close();

    expect((await readFile(file, 'utf8')).trim()).toContain('"a"');
  });

  it('flushes automatically once the buffer fills', async () => {
    const file = await tempFile();
    const sink = new JsonlSink(file, { maxBuffer: 2 });

    sink.write({ id: 'a' });
    sink.write({ id: 'b' });
    await sink.flush();

    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(2);
    await sink.close();
  });

  it('appends across sinks instead of truncating', async () => {
    const file = await tempFile();

    const first = new JsonlSink(file);
    first.write({ id: 'a' });
    await first.close();

    const second = new JsonlSink(file);
    second.write({ id: 'b' });
    await second.close();

    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('counts what it wrote', async () => {
    const file = await tempFile();
    const sink = new JsonlSink(file);

    sink.write({ id: 'a' });
    sink.write({ id: 'b' });
    await sink.close();

    expect(sink.stats().written).toBe(2);
    expect(sink.stats().dropped).toBe(0);
  });

  it('drops an unserialisable record instead of throwing', async () => {
    const file = await tempFile();
    const sink = new JsonlSink(file);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => sink.write(circular)).not.toThrow();
    await sink.close();

    expect(sink.stats().dropped).toBe(1);
  });

  it('ignores writes after close', async () => {
    const file = await tempFile();
    const sink = new JsonlSink(file);

    sink.write({ id: 'a' });
    await sink.close();
    sink.write({ id: 'b' });

    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});
