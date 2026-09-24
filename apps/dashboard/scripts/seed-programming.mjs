/**
 * Seeds programming runs for the dashboard E2E through the real service:
 * two bots, two projects, runs in every state the UI must explain.
 *
 *   OINKO_ROOT=/tmp/x node apps/dashboard/scripts/seed-programming.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BotStore } from '@oinko/bots/store';
import { openProgramming } from '@oinko/bots/programming';
import { WorkspaceStore } from '@oinko/workspaces';

const root = process.env.OINKO_ROOT;
if (!root) throw new Error('Defina OINKO_ROOT.');
const bots = new BotStore(root);
for (const [id, name] of [['alpha', 'Alpha Dev'], ['beta', 'Beta Revisor']])
  if (!bots.has(id))
    bots.save(
      { id, name, model: `model-${id}`, systemPrompt: `Bot ${name}.`, programmingPolicy: { enabled: true, ...(id === 'beta' && { autonomy: 'edit' }) } },
      { apiKey: 'sk-seed-0123456789abcdef' },
      0,
    );
const workspaces = new WorkspaceStore(root);
for (const [id, allowed] of [['loja', ['alpha', 'beta']], ['interno', ['alpha']]])
  if (!workspaces.projects().some((project) => project.id === id))
    workspaces.saveProject({ id, name: id, repositories: [{ id: 'app', source: 'https://example.com/app.git' }], allowedBotIds: allowed }, 0);
// A project that publishes: previews, browser and draft PRs for alpha.
if (!workspaces.projects().some((project) => project.id === 'vitrine'))
  workspaces.saveProject(
    {
      id: 'vitrine',
      name: 'vitrine',
      repositories: [{ id: 'app', source: 'https://example.com/vitrine.git' }],
      allowedBotIds: ['alpha'],
      programming: { browser: { enabled: true }, github: { repositories: [{ repositoryId: 'app', owner: 'acme', name: 'vitrine' }] }, publisherBotIds: ['alpha'] },
    },
    0,
  );
workspaces.close();

let script = [];
const runtime = openProgramming({
  root,
  producer: 'seed',
  executeFor: 'alpha',
  bots,
  executor: { runCycle: async (input) => script.shift()(input) },
});
const operator = { kind: 'operator', id: 'seed' };
const { service, store } = runtime;

async function execute(text, cycles, projectId = 'loja') {
  script = cycles;
  const { run } = service.start(operator, { botId: 'alpha', projectId, taskId: 'carrinho', text });
  service.kick();
  await service.idle();
  return store.getRun(run.id);
}

const completed = await execute('Corrigir o total do carrinho com desconto', [
  (input) => {
    input.context.record({ kind: 'information', source: 'read', fingerprint: 'cart.ts:1' });
    input.context.saveArtifact({ type: 'diff', content: '--- a/cart.ts\n+++ b/cart.ts\n-  return a - b;\n+  return a + b;\n', mediaType: 'text/x-diff', treeHash: 'tree:2' });
    input.context.record({ kind: 'edit', repositoryId: 'app', paths: ['cart.ts'], revision: 'tree:2' });
    input.context.saveArtifact({ type: 'log', content: 'PASS cart.test.ts (3 tests)\nAuthorization: Bearer sk-seed-0123456789abcdef', treeHash: 'tree:2' });
    input.context.record({ kind: 'check', checkKind: 'test', repositoryId: 'app', result: 'passed', revision: 'tree:2', fingerprint: 'test:tree:2:passed' });
    input.context.signals.completion = { summary: 'Total corrigido; teste do carrinho passando na revisão final.' };
    return { summary: 'Corrigido e testado.', traceIds: [] };
  },
]);
// Delivered as a draft PR with a functional check on the preview and CI still running.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const delivered = await execute('Mostrar o selo de frete grátis na vitrine', [
  (input) => {
    input.context.emit('routing_decision', { model: 'model-alpha', tier: 'main' });
    input.context.emit('tools_selected', { source: 'decider', count: 9, tools: 'workspace_read_range,workspace_patch,workspace_check,workspace_preview,browser_open,browser_navigate,functional_check,publication_publish,programming_complete', schemaTokens: 2100 });
    input.context.emit('context_assembled', { model: 'model-alpha', totalTokens: 6400, components: { 'system:base': 900, 'tools:schema': 2100, 'history:recent': 3000, 'context:summary': 400 }, dropped: 0 });
    input.context.emit('tools_expanded', { source: 'tool_search', count: 1, tools: 'browser_screenshot' });
    input.context.record({ kind: 'edit', repositoryId: 'app', paths: ['banner.tsx'], revision: 'tree:7' });
    input.context.record({ kind: 'check', checkKind: 'test', repositoryId: 'app', result: 'passed', revision: 'tree:7', fingerprint: 'test:tree:7:passed' });
    const shot = input.context.saveArtifact({ type: 'screenshot', content: PNG, mediaType: 'image/png', treeHash: 'tree:7' });
    const report = input.context.saveArtifact({ type: 'report', content: JSON.stringify({ url: 'http://vitrine.preview/', viewport: '390x844', screenshot: shot?.id }), mediaType: 'application/json', treeHash: 'tree:7' });
    input.context.record({ kind: 'functional', criterionId: 'selo_frete', description: 'Vitrine mostra o selo de frete grátis no celular', result: 'passed', revision: 'tree:7', revisions: { app: 'tree:7', 'env:web': 'cfg:1' }, previewId: 'vitrine', url: 'http://vitrine.preview/', viewport: '390x844', fingerprint: 'selo:tree:7', artifactId: report?.id });
    service.recordPublication(input.run.id, { repositoryId: 'app', branch: 'task/carrinho', remoteSha: 'a'.repeat(40), prNumber: 12, prUrl: 'https://github.com/acme/vitrine/pull/12', prState: 'open', reconciliationState: 'synced', checkRefs: [`${'a'.repeat(40)}:running`] });
    input.context.record({ kind: 'publication', repositoryId: 'app', sha: 'a'.repeat(40), revision: 'tree:7', prNumber: 12, prUrl: 'https://github.com/acme/vitrine/pull/12', ci: 'running', validated: false, fingerprint: 'pr-12' });
    input.context.signals.completion = { summary: 'Selo publicado em draft; CI ainda em andamento.' };
    return { summary: 'Selo implementado e validado na prévia.', traceIds: [] };
  },
], 'vitrine');
const noProgress = () => {
  throw new Error('pnpm test falhou: Cannot find module "@loja/config"');
};
const blocked = await execute('Migrar o checkout para a API nova', [noProgress, noProgress, noProgress], 'interno');
// An effect whose outcome is unknown: the run cannot complete and says which operation.
const lost = async (input) => {
  await input.context
    .operation({ kind: 'workspace.exec', class: 'mutate', params: { command: 'pnpm run release:canary' }, intent: { command: 'pnpm run release:canary' } }, async () => {
      throw new Error('conexão com o runner perdida durante o comando');
    })
    .catch(() => undefined);
  return { summary: 'Comando de release sem resposta.', traceIds: [] };
};
const uncertain = await execute('Publicar a versão canário do pacote', [lost, noProgress, noProgress, noProgress], 'interno');

await runtime.close();

// No executor from here on: like the dashboard, this process only persists.
const passive = openProgramming({ root, producer: 'seed', bots });
// A run left running by a worker that is not up right now, with a pause the
// executor has not applied yet: the UI must say "pause requested", not "paused".
const running = passive.service.start(operator, { botId: 'alpha', projectId: 'loja', taskId: 'frete', text: 'Revisar o cálculo de frete' }).run;
passive.store.acquireLease(running.id, 'seed-worker', 3_600_000);
const claimed = passive.store.transitionRun(running.id, passive.store.getRun(running.id).revision, 'running', { phase: 'working', startedAt: Date.now() }).run;
passive.service.control(operator, claimed.id, 'pause', {}, 'seed');
const queued = passive.service.start(operator, { botId: 'beta', projectId: 'loja', text: 'Analisar a cobertura de testes', mode: 'analysis' }).run;
// Evaluation history for beta: a baseline and a prompt candidate that saves tokens.
const { evaluation } = passive;
const evalCase = {
  id: 'bug',
  title: 'Bug com teste',
  kind: 'bug_fix',
  request: { text: 'Corrija sum', mode: 'change' },
  fixture: { files: { 'sum.cjs': 'module.exports = (a, b) => a - b;\n' } },
  criteria: [{ id: 'changes', kind: 'diff', description: 'Correção aplicada' }],
};
const { version } = evaluation.createDataset(operator, { name: 'seed-eval', cases: [evalCase] });
const attempt = (tokens) => ({
  caseId: 'bug',
  repetition: 1,
  verdict: 'passed',
  criteria: [{ id: 'changes', status: 'satisfied' }],
  metrics: { durationMs: 42_000, calls: 6, cycles: 1, tokens: { total: tokens, byRole: { main: tokens } }, cost: { confirmedUsd: 0, pendingCalls: 6, unavailableCalls: 0, confirmedCalls: 0 }, interventions: 0, restarts: 0, fallbacks: 0 },
  evidenceRefs: [],
  traceIds: [],
});
const batchOf = (subject, tokens) => {
  const batch = evaluation.startBatch(operator, { datasetVersion: version, botId: 'beta', subject, policyVersion: `cfg:${subject.slice(0, 12)}`, environment: 'simulated', repetitions: 1, manifest: { platformCommit: 'seed' } });
  evaluation.caseStarted(batch.id, 'bug', 1);
  evaluation.caseFinished(batch.id, attempt(tokens));
  evaluation.finishBatch(batch.id);
  return batch;
};
const baselineBatch = batchOf('baseline', 2000);
const candidate = evaluation.createCandidate(operator, { botId: 'beta', kind: 'prompt', hypothesis: 'Prompt mais direto reduz tokens sem perder qualidade', change: { systemPrompt: 'Bot Beta Revisor. Seja direto.' } });
evaluation.compare(operator, baselineBatch.id, batchOf(candidate.id, 1200).id);
await passive.close();
bots.close();
writeFileSync(
  join(root, 'programming-seed.json'),
  JSON.stringify({ completed: completed.id, delivered: delivered.id, blocked: blocked.id, running: running.id, queued: queued.id, candidate: candidate.id, uncertain: uncertain.id, states: [completed.state, delivered.state, blocked.state] }),
);
console.log(`seeded programming runs: ${completed.state}, ${delivered.state}, ${blocked.state}, running, queued`);
