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
const noProgress = () => {
  throw new Error('pnpm test falhou: Cannot find module "@loja/config"');
};
const blocked = await execute('Migrar o checkout para a API nova', [noProgress, noProgress, noProgress], 'interno');

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
await passive.close();
bots.close();
writeFileSync(
  join(root, 'programming-seed.json'),
  JSON.stringify({ completed: completed.id, blocked: blocked.id, running: running.id, queued: queued.id, states: [completed.state, blocked.state] }),
);
console.log(`seeded programming runs: ${completed.state}, ${blocked.state}, running, queued`);
