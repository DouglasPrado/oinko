// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { wakeWorker, wakeNotice } from '@/server/programming/wake';

function manager(state: string, start: () => Promise<unknown> = () => Promise.resolve({ state: 'running' })) {
  const started: string[] = [];
  return {
    started,
    status: () => Promise.resolve({ state }),
    start: (id: string) => {
      started.push(id);
      return start();
    },
  };
}

describe('work handed back to the queue wakes the bot worker', () => {
  it('starts a stopped worker so a resumed run actually runs', async () => {
    const fake = manager('stopped');
    expect(await wakeWorker(fake as never, 'dev')).toBe('started');
    expect(fake.started).toEqual(['dev']);
    expect(wakeNotice('started')).toMatch(/estava parado e foi iniciado/);
  });

  it('leaves a running worker alone', async () => {
    const fake = manager('running');
    expect(await wakeWorker(fake as never, 'dev')).toBe('running');
    expect(fake.started).toEqual([]);
    expect(wakeNotice('running')).toBe('');
  });

  it('says so when the worker cannot be started, instead of leaving the run silently queued', async () => {
    const fake = manager('stopped', () => Promise.reject(new Error('Configure a chave da API')));
    expect(await wakeWorker(fake as never, 'dev')).toBe('failed');
    expect(wakeNotice('failed')).toMatch(/não pôde ser iniciado[\s\S]*Bots/);
  });
});
