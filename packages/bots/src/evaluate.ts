import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BotStore } from './store.js';
import { openProgramming } from './programming/runtime.js';
import { runEvaluation } from './programming/evaluation/harness.js';
import { BotError } from './schema.js';

/**
 * pnpm --filter @oinko/bots evaluate --bot <id> --dataset <arquivo.json>
 *   [--environment simulated|docker|real] [--repetitions N] [--candidate <id>]
 *   [--split tuning|validation] [--work <dir>] [--runner <main.js>] [--keep]
 *
 * Results go to the installation (OINKO_ROOT); attempts run in isolated roots.
 * `real` uses the bot's own API key and requires the Docker runner.
 */
const root = process.env.OINKO_ROOT || fileURLToPath(new URL('../../../', import.meta.url));
const { values } = parseArgs({
  options: {
    bot: { type: 'string' },
    dataset: { type: 'string' },
    environment: { type: 'string', default: 'simulated' },
    repetitions: { type: 'string' },
    candidate: { type: 'string' },
    split: { type: 'string' },
    work: { type: 'string' },
    runner: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});

async function main() {
  if (!values.bot || !values.dataset) throw new BotError('Uso: evaluate --bot <id> --dataset <arquivo.json> [--environment simulated|docker|real]');
  const environment = values.environment as 'simulated' | 'docker' | 'real';
  if (!['simulated', 'docker', 'real'].includes(environment)) throw new BotError('Ambiente inválido: use simulated, docker ou real.');
  const bots = new BotStore(root);
  const runtime = openProgramming({ root, producer: 'evaluation-cli', bots });
  const actor = { kind: 'operator' as const, id: process.env.USER ?? 'cli' };
  try {
    const { version } = runtime.evaluation.createDataset(actor, JSON.parse(readFileSync(resolve(values.dataset), 'utf8')));
    const { definition, secrets } = bots.runtime(values.bot);
    const candidate = values.candidate ? runtime.evaluation.store.candidate(values.candidate) : undefined;
    if (values.candidate && candidate?.botId !== values.bot) throw new BotError('Candidato inexistente para este bot.');
    let platformCommit = 'unknown';
    try {
      // The platform version is the code's checkout, not the data root.
      platformCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* not a checkout: recorded as unknown */
    }
    const result = await runEvaluation({
      evaluation: runtime.evaluation,
      actor,
      datasetVersion: version,
      bot: definition,
      subject: candidate?.id ?? 'baseline',
      ...(candidate && { change: candidate.change }),
      environment,
      ...(values.repetitions && { repetitions: Number(values.repetitions) }),
      ...(values.split && { split: values.split as 'tuning' | 'validation' }),
      workRoot: values.work ?? join(tmpdir(), `oinko-evaluation-${Date.now()}`),
      productionRoot: root,
      ...(environment === 'real' && secrets.apiKey && { apiKey: secrets.apiKey }),
      ...(values.runner && { runnerPath: resolve(values.runner) }),
      keep: values.keep,
      manifest: { platformCommit, dataset: values.dataset },
    });
    console.log(
      JSON.stringify(
        {
          batchId: result.batch.id,
          datasetVersion: version,
          environment,
          results: result.results.map((item) => ({ case: item.caseId, repetition: item.repetition, verdict: item.verdict, ...(item.failure && { failure: item.failure }), runId: item.runId })),
          aggregate: result.aggregate,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
    bots.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha ao avaliar.');
  process.exitCode = 1;
});
