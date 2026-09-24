import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvaluationDataset } from '@oinko/agent-runtime/programming';
import { BotStore } from '../src/store.js';
import { openProgramming } from '../src/programming/runtime.js';
import { runEvaluation } from '../src/programming/evaluation/harness.js';

const DATASET = JSON.parse(readFileSync(new URL('../evaluation/programming-baseline.v1.json', import.meta.url), 'utf8')) as EvaluationDataset;
const RUNNER = fileURLToPath(new URL('../../../apps/environment-runner/dist/main.js', import.meta.url));
const operator = { kind: 'operator' as const, id: 'ops' };

/**
 * The harness through the shipped environment runner and Docker sandbox:
 * the simulated model drives real sandboxed tools, including a process
 * restart recovered from durable state.
 */
describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')('evaluation harness in the Docker environment', () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  it('runs frozen cases through the real runner and skips what needs a real preview', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-eval-docker-prod-'));
    const work = mkdtempSync(join(tmpdir(), 'oinko-eval-docker-work-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => rmSync(work, { recursive: true, force: true }));
    const bots = new BotStore(root);
    bots.save({ id: 'alpha', name: 'Alpha', model: 'scripted', systemPrompt: 'Você programa.', programmingPolicy: { enabled: true } }, { apiKey: 'sk-test-0123456789abcdef' }, 0);
    const runtime = openProgramming({ root, producer: 'dashboard', bots });
    cleanup.push(async () => {
      await runtime.close();
      bots.close();
    });
    const { version } = runtime.evaluation.createDataset(operator, DATASET);
    const { results, aggregate, batch } = await runEvaluation({
      evaluation: runtime.evaluation,
      actor: operator,
      datasetVersion: version,
      bot: bots.runtime('alpha').definition,
      subject: 'baseline',
      environment: 'docker',
      workRoot: work,
      productionRoot: root,
      runnerPath: RUNNER,
      attemptTimeoutMs: 300_000,
    });
    expect(results.map((result) => [result.caseId, result.verdict, result.failure?.code])).toEqual([
      ['bug-sum', 'passed', undefined],
      ['monorepo-slugify', 'passed', undefined],
      ['visual-selo', 'skipped', 'preview_environment_unavailable'],
      ['long-interrupted', 'passed', undefined],
    ]);
    expect(results.find((result) => result.caseId === 'long-interrupted')!.metrics.restarts).toBe(1);
    expect(aggregate.completionRate).toBe(1);
    expect(runtime.evaluation.store.batch(batch.id)?.manifest).toMatchObject({ workspace: 'docker', provider: 'simulated' });
  }, 900_000);
});
