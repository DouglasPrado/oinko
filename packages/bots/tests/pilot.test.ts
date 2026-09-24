/* eslint-disable @typescript-eslint/no-explicit-any -- journal payloads are untyped JSON */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '@oinko/core';
import { WorkspaceStore } from '@oinko/workspaces';
import { AgentCycleExecutor, PROGRAMMING_RUN_INSTRUCTIONS, ValidationLog, readJournal, type Evidence, type RunExecutor } from '@oinko/agent-runtime/programming';
import { BotStore } from '../src/store.js';
import { openProgramming } from '../src/programming/runtime.js';
import { programmingRunTools } from '../src/programming/run-tools.js';
import { deliveryTools } from '../src/programming/delivery-tools.js';
import type { RunnerPort } from '../src/programming/tool-kit.js';
import { gitRepo, lastResult, scriptedProvider, type ScriptStep } from './helpers/programming.js';
import { DeliveryRunner } from './helpers/delivery.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const APP = {
  'package.json': JSON.stringify({ name: 'shop', scripts: { test: 'node check.cjs' } }),
  'page.txt': 'Formulário de entrega\n',
  'check.cjs': "const fs = require('fs');\nif (!fs.readFileSync('page.txt', 'utf8').includes('validate-cep')) process.exit(1);\n",
};
type Step = (messages: any[]) => ScriptStep;
const sequence = (steps: Step[]) => {
  let index = 0;
  return (messages: any[]) => (steps[index] ? steps[index++]!(messages) : { text: 'Aguardando.' });
};
const fix = (marker: string): Step[] => [
  () => ({ tool: 'workspace_read_range', args: { path: 'page.txt' } }),
  (messages) => ({ tool: 'workspace_replace', args: { path: 'page.txt', expectedHash: lastResult(messages).hash, oldText: 'Formulário de entrega', newText: `Formulário de entrega validate-cep ${marker}` } }),
  () => ({ tool: 'workspace_check', args: { kind: 'test', command: 'node check.cjs' } }),
];
const publish: Step = () => ({ tool: 'publication_publish', args: { title: 'Valida CEP', body: 'Mudança pequena.', commitMessage: 'fix: valida CEP' } });
const done = (summary: string): Step[] => [() => ({ tool: 'programming_complete', args: { summary } }), () => ({ text: summary })];

function worker(root: string, bots: BotStore, botId: string, model: string, runner: RunnerPort, steps: Step[]) {
  const provider = scriptedProvider(sequence(steps));
  const cycles: { current?: RunExecutor } = {};
  const runtime = openProgramming({ root, producer: `runtime:${botId}`, executeFor: botId, bots, runner, executor: { runCycle: (input) => cycles.current!.runCycle(input) } });
  const agent = Agent.create({
    apiKey: 'sk-test-0123456789abcdef',
    model,
    systemPrompt: `Bot ${botId}.${PROGRAMMING_RUN_INSTRUCTIONS}`,
    fetch: provider.fetch,
    memory: { enabled: false },
    knowledge: { enabled: false },
    telemetry: { enabled: true, dbPath: bots.runtime(botId).paths.telemetryDbPath, app: botId, capturePayloads: 'full' },
    logLevel: 'silent',
  });
  const policy = bots.runtime(botId).definition.programmingPolicy!;
  for (const tool of [
    ...programmingRunTools({ runner, service: runtime.service, pollMs: 10 }),
    ...deliveryTools({ runner, access: runtime.access, service: runtime.service, evidence: (runId) => runtime.store.evidence<Evidence>(runId).map((item) => item.value), journal: runtime.journal, capabilities: policy.capabilities, pollMs: 10, ciPollMs: 10 }),
  ])
    agent.addTool(tool);
  cycles.current = new AgentCycleExecutor(agent);
  cleanup.push(async () => {
    await runtime.close();
    await agent.destroy();
  });
  return { runtime, provider };
}

describe('M09-S03 two bots from the same code, configured differently', () => {
  it('runs both in parallel with isolated queues, visibility and telemetry, and denies publication to the non-publisher', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-pilot-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const bots = new BotStore(root);
    cleanup.push(() => bots.close());
    // Arbitrary ids: nothing in the platform depends on them.
    bots.save({ id: 'dev', name: 'Dev', model: 'model-dev', systemPrompt: 'Dev.', programmingPolicy: { enabled: true, models: { main: 'model-dev-main' } } }, { apiKey: 'sk-test-dev-0123456789' }, 0);
    bots.save({ id: 'revisor', name: 'Revisor', model: 'model-rev', systemPrompt: 'Revisor.', programmingPolicy: { enabled: true, autonomy: 'edit', capabilities: { browser: false, publication: true } } }, { apiKey: 'sk-test-rev-0123456789' }, 0);
    const workspaces = new WorkspaceStore(root);
    workspaces.saveProject({ id: 'shop', name: 'Shop', repositories: [{ id: 'app', source: 'https://example.com/shop.git' }], allowedBotIds: ['dev', 'revisor'], programming: { github: { repositories: [{ repositoryId: 'app', owner: 'acme', name: 'shop' }] }, publisherBotIds: ['dev'] } }, 0);
    workspaces.saveProject({ id: 'site', name: 'Site', repositories: [{ id: 'app', source: 'https://example.com/site.git' }], allowedBotIds: ['revisor'] }, 0);
    workspaces.saveTask({ id: 'fix', projectId: 'shop', name: 'Fix', branch: 'task/fix', state: 'ready' }, 0);
    workspaces.saveTask({ id: 'fix-rev', projectId: 'shop', name: 'Fix revisor', branch: 'task/fix-rev', state: 'ready' }, 0);
    workspaces.close();
    const devRepo = gitRepo(APP);
    const revRepo = gitRepo(APP);
    cleanup.push(devRepo.cleanup, revRepo.cleanup);
    const devRunner = new DeliveryRunner(devRepo.worktree, 'dev');
    const revRunner = new DeliveryRunner(revRepo.worktree, 'revisor');
    const dev = worker(root, bots, 'dev', 'model-dev-main', devRunner, [...fix('dev'), publish, ...done('Dev entregou draft.')]);
    const revisor = worker(root, bots, 'revisor', 'model-rev', revRunner, [
      ...fix('revisor'),
      publish,
      ...done('Revisor concluiu sem publicar.'),
      () => ({ tool: 'programming_complete', args: { summary: 'Análise do site.', report: '# Site\nSem problemas críticos.' } }),
      () => ({ text: 'Relatório entregue.' }),
    ]);
    const operator = { kind: 'operator' as const, id: 'ops' };
    const devRun = dev.runtime.service.start(operator, { botId: 'dev', projectId: 'shop', taskId: 'fix', text: 'Valide o CEP.' }).run.id;
    const revRun = revisor.runtime.service.start(operator, { botId: 'revisor', projectId: 'shop', taskId: 'fix-rev', text: 'Valide o CEP.' }).run.id;
    const revSite = revisor.runtime.service.start(operator, { botId: 'revisor', projectId: 'site', text: 'Analise o site.', mode: 'analysis' }).run.id;
    // One active run per bot; the two bots advance in parallel.
    expect(revisor.runtime.store.runsInState('revisor', ['running']).length).toBeLessThanOrEqual(1);
    dev.runtime.service.kick();
    revisor.runtime.service.kick();
    await Promise.all([dev.runtime.service.idle(), revisor.runtime.service.idle()]);
    await revisor.runtime.service.idle();
    const store = dev.runtime.store;
    expect(store.getRun(devRun)).toMatchObject({ state: 'completed', finalOutcome: { delivery: 'draft_pr' } });
    expect(store.getRun(revRun)).toMatchObject({ state: 'completed', finalOutcome: { delivery: 'technical' } });
    expect(store.getRun(revSite)).toMatchObject({ state: 'completed' });
    // Each bot ran with its own configured model.
    expect(new Set(dev.provider.requests.map((request) => request.model))).toEqual(new Set(['model-dev-main']));
    expect(new Set(revisor.provider.requests.map((request) => request.model))).toEqual(new Set(['model-rev']));
    // The non-publisher did the allowed work and got an auditable refusal to publish.
    const denied = readJournal(dev.runtime.database, { runId: revRun, type: 'permission_denied' }).map((event) => event.envelope.payload as any);
    expect(denied).toEqual([expect.objectContaining({ class: 'publish', operation: 'publication.publish' })]);
    expect(revRunner.published).toEqual([]);
    expect(devRunner.published).toHaveLength(1);
    // Neither bot sees the other's runs; a guessed id gets "not found".
    expect(() => dev.runtime.queries.detail({ kind: 'bot', botId: 'dev' }, revRun)).toThrow(/não encontrado/i);
    expect(() => revisor.runtime.queries.detail({ kind: 'bot', botId: 'revisor' }, devRun)).toThrow(/não encontrado/i);
    // Telemetry lands in each bot's own repository.
    await dev.runtime.deliverer.flush();
    await revisor.runtime.deliverer.flush();
    const devTelemetry = new DatabaseSync(bots.runtime('dev').paths.telemetryDbPath, { readOnly: true });
    const revTelemetry = new DatabaseSync(bots.runtime('revisor').paths.telemetryDbPath, { readOnly: true });
    const runsIn = (db: DatabaseSync) => new Set((db.prepare('SELECT DISTINCT run_id FROM telemetry_events WHERE run_id IS NOT NULL').all() as { run_id: string }[]).map((row) => row.run_id));
    expect([...runsIn(devTelemetry)]).toEqual([devRun]);
    expect([...runsIn(revTelemetry)].sort()).toEqual([revRun, revSite].sort());
    devTelemetry.close();
    revTelemetry.close();
    // The verification is recorded for the rollout decision.
    const log = new ValidationLog(dev.runtime.journal, dev.runtime.database);
    log.isolationVerified(operator, { result: 'passed', bots: ['dev', 'revisor'], checks: ['queues', 'visibility', 'telemetry', 'publication'] });
    expect(log.history()[0]).toMatchObject({ type: 'cross_bot_isolation_verified', payload: { result: 'passed' } });
  }, 60_000);
});
