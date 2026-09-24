#!/usr/bin/env node
/**
 * Validation suite of the programming-agents plan (VALIDATION.md).
 *
 *   node scripts/validation-suite.mjs [--skip-docker] [--skip-e2e] [--report <arquivo.md>]
 *
 * Runs the aggregated gates, each package suite (counting skipped tests by
 * name), the Docker suites when Docker answers, the dashboard E2E and the
 * pilot-id gate. Real provider, real GitHub App, real Telegram and human
 * acceptance are never simulated here: they are reported as pending.
 * Events go to OINKO_ROOT's programming.db when set (otherwise a temporary
 * root); the Markdown report is written next to the plan by default.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({
  options: {
    'skip-docker': { type: 'boolean', default: false },
    'skip-e2e': { type: 'boolean', default: false },
    report: { type: 'string' },
  },
});
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repo, encoding: 'utf8' }).trim() !== '';
const work = mkdtempSync(join(tmpdir(), 'oinko-validation-'));
const results = [];

function run(name, command, args, { cwd = repo, env = {}, environment = 'automated' } = {}) {
  const started = Date.now();
  process.stdout.write(`▶ ${name} … `);
  const log = join(work, `${name.replace(/[^a-z0-9]+/gi, '-')}.log`);
  const outcome = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(log, `${outcome.stdout ?? ''}\n${outcome.stderr ?? ''}`);
  const durationMs = Date.now() - started;
  process.stdout.write(`${outcome.status === 0 ? 'ok' : `falhou (${outcome.status})`} em ${Math.round(durationMs / 1000)}s\n`);
  return { status: outcome.status, log, durationMs, environment, command: [command, ...args].join(' '), cwd: relative(repo, cwd) || '.' };
}

function gate(name, command, args, options) {
  const outcome = run(name, command, args, options);
  results.push({ suite: name, environment: outcome.environment, command: outcome.command, result: outcome.status === 0 ? 'passed' : 'failed', passed: outcome.status === 0 ? 1 : 0, failed: outcome.status === 0 ? 0 : 1, skipped: [], durationMs: outcome.durationMs, log: outcome.log });
}

/** A vitest suite with its counts; skipped tests are named in the report. */
function vitest(name, packageDir, extra = [], options = {}) {
  const output = join(work, `${name.replace(/[^a-z0-9]+/gi, '-')}.json`);
  const outcome = run(name, 'pnpm', ['exec', 'vitest', 'run', ...extra, '--reporter=json', `--outputFile=${output}`], { cwd: join(repo, packageDir), ...options });
  let report;
  try {
    report = JSON.parse(readFileSync(output, 'utf8'));
  } catch {
    report = undefined;
  }
  const skipped = [];
  for (const file of report?.testResults ?? [])
    for (const test of file.assertionResults ?? [])
      if (test.status === 'skipped' || test.status === 'pending' || test.status === 'todo') skipped.push(`${relative(repo, file.name)} › ${test.fullName ?? test.title}`);
  results.push({
    suite: name,
    environment: outcome.environment,
    command: `${outcome.command} (em ${outcome.cwd})`,
    result: outcome.status === 0 ? (skipped.length ? 'partial' : 'passed') : 'failed',
    passed: report?.numPassedTests ?? 0,
    failed: report ? report.numFailedTests : 1,
    skipped,
    durationMs: outcome.durationMs,
    log: outcome.log,
  });
}

function pending(suite, environment, reason) {
  results.push({ suite, environment, command: '—', result: 'partial', passed: 0, failed: 0, skipped: [reason], durationMs: 0 });
  console.log(`⏸ ${suite}: ${reason}`);
}

// 1. Aggregated gates.
gate('pnpm build', 'pnpm', ['build']);
gate('pnpm typecheck', 'pnpm', ['typecheck']);
gate('pnpm lint', 'pnpm', ['lint']);
gate('pnpm test', 'pnpm', ['test']);

// 2. Package suites with counts.
for (const [name, dir] of [
  ['core (SDK)', 'packages/oinko'],
  ['agent-runtime', 'packages/agent-runtime'],
  ['workspaces', 'packages/workspaces'],
  ['environments', 'packages/environments'],
  ['bots', 'packages/bots'],
  ['mcp-oinko', 'packages/mcps/oinko'],
  ['dashboard (unit)', 'apps/dashboard'],
])
  vitest(name, dir);

// 3. Pilot ids never drive platform behaviour.
{
  const hits = spawnSync('grep', ['-rnE', "(=== ?|!== ?|case )['\"](dev|Dev)['\"]", 'packages/agent-runtime/src/programming', 'packages/bots/src/programming', 'packages/environments/src/browser', 'packages/environments/src/publication'], { cwd: repo, encoding: 'utf8' });
  const found = hits.stdout.trim();
  results.push({ suite: 'gate: sem condicional por ID de piloto', environment: 'automated', command: 'grep de comparações com "dev"', result: found ? 'failed' : 'passed', passed: found ? 0 : 1, failed: found ? 1 : 0, skipped: [], durationMs: 0, ...(found && { findings: found }) });
  console.log(`▶ gate de IDs de piloto … ${found ? 'falhou' : 'ok'}`);
}

// 4. Docker suites.
const docker = !values['skip-docker'] && spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' }).status === 0;
if (docker) {
  vitest('Docker: environments (runner, falhas, browser)', 'packages/environments', ['tests/docker.test.ts', 'tests/runner.e2e.test.ts', 'tests/failures.e2e.test.ts', 'tests/browser.e2e.test.ts', 'tests/workspace.e2e.test.ts', 'tests/publication-docker.e2e.test.ts'], { env: { OINKO_DOCKER_TEST: '1' }, environment: 'docker' });
  vitest('Docker: worker + runner + harness', 'packages/bots', ['tests/programming.e2e.test.ts', 'tests/evaluation.e2e.test.ts'], { env: { OINKO_DOCKER_TEST: '1' }, environment: 'docker' });
} else pending('Docker', 'docker', values['skip-docker'] ? 'pulado por --skip-docker' : 'Docker indisponível');

// 5. Dashboard E2E.
if (!values['skip-e2e']) {
  const output = join(work, 'playwright.json');
  const outcome = run('dashboard E2E (Playwright)', 'pnpm', ['exec', 'playwright', 'test', '--trace=off', '--reporter=json'], { cwd: join(repo, 'apps/dashboard'), env: { PLAYWRIGHT_JSON_OUTPUT_NAME: output, ...(docker && { OINKO_DOCKER_TEST: '1' }) } });
  let report;
  try {
    report = JSON.parse(readFileSync(output, 'utf8'));
  } catch {
    report = undefined;
  }
  const skipped = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) if (test.status === 'skipped') skipped.push(`${[...trail, spec.title].join(' › ')}`);
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of report?.suites ?? []) walk(suite, [suite.title]);
  results.push({ suite: 'dashboard E2E (Playwright)', environment: 'automated', command: outcome.command, result: outcome.status === 0 ? (skipped.length ? 'partial' : 'passed') : 'failed', passed: report?.stats?.expected ?? 0, failed: report ? (report.stats?.unexpected ?? 0) : 1, skipped, durationMs: outcome.durationMs, log: outcome.log });
} else pending('dashboard E2E', 'automated', 'pulado por --skip-e2e');

// 6. What automation cannot stand in for.
pending('provedor real (3 repetições por caso)', 'real_provider', 'sem credencial de provedor configurada para avaliação; `pnpm --filter @oinko/bots evaluate --environment real` quando houver');
pending('GitHub App real + repositório de teste', 'real_provider', 'depende de App e instalação do operador');
pending('Telegram real', 'real_provider', 'depende de bot e conversa reais');
pending('aceite humano (dashboard, diffs, PRs, fluxos)', 'human', 'revisão do operador ainda não registrada');

// Record in the journal and write the report.
const { openProgramming } = await import(new URL('../packages/bots/dist/programming/index.js', import.meta.url).href);
const { ValidationLog } = await import(new URL('../packages/agent-runtime/dist/programming/index.js', import.meta.url).href);
const root = process.env.OINKO_ROOT || mkdtempSync(join(tmpdir(), 'oinko-validation-root-'));
const runtime = openProgramming({ root, producer: 'validation-suite' });
const log = new ValidationLog(runtime.journal, runtime.database);
const operator = { kind: 'operator', id: process.env.USER ?? 'validation' };
const recorded = results.map((result) => {
  log.suiteStarted(operator, { suite: result.suite, environment: result.environment, sha, command: result.command });
  return { ...result, ...log.suiteFinished(operator, { suite: result.suite, environment: result.environment, sha, result: result.result, passed: result.passed, failed: result.failed, skipped: result.skipped, command: result.command, durationMs: result.durationMs }) };
});
await runtime.close();

const icon = { passed: '✅', failed: '❌', partial: '⚠️' };
const byEnvironment = { automated: 'Teste automatizado', docker: 'Docker real', real_provider: 'Provedor/serviços reais', human: 'Aceite humano' };
const lines = [
  `# Relatório de validação — ${sha.slice(0, 12)}`,
  '',
  `Gerado por \`node scripts/validation-suite.mjs\` em ${new Date().toISOString()}. Revisão \`${sha}\`${dirty ? ' (**com alterações não commitadas**)' : ''}. Node ${process.version}.`,
  '',
  'Um cenário *skipped* ou pendente impede afirmar cobertura dele. Resultados reais (provedor, GitHub, Telegram) e aceite humano nunca são simulados aqui.',
  '',
];
for (const [environment, title] of Object.entries(byEnvironment)) {
  const items = recorded.filter((item) => item.environment === environment);
  if (!items.length) continue;
  lines.push(`## ${title}`, '', '| Suíte | Resultado | Aprovados | Falhas | Não executados | Duração |', '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const item of items)
    lines.push(`| ${item.suite} | ${icon[item.result]} ${item.result} | ${item.passed} | ${item.failed} | ${item.skipped.length} | ${Math.round((item.durationMs ?? 0) / 1000)}s |`);
  lines.push('');
  for (const item of items.filter((entry) => entry.skipped.length)) {
    lines.push(`<details><summary>${item.suite}: ${item.skipped.length} não executado(s)</summary>`, '', ...item.skipped.slice(0, 100).map((name) => `- ${name}`), '', '</details>', '');
  }
  for (const item of items.filter((entry) => entry.findings)) lines.push('```', item.findings, '```', '');
}
lines.push('## Comandos', '', ...recorded.filter((item) => item.command !== '—').map((item) => `- \`${item.command}\``), '');
const reportPath = values.report ?? join(repo, 'docs/milestones/programming-agents/reports', `validation-${sha.slice(0, 12)}.md`);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${lines.join('\n')}\n`);
console.log(`\nRelatório: ${relative(repo, reportPath)}\nLogs: ${work}\nEventos: ${join(root, '.harness/programming.db')}`);
const failed = recorded.filter((item) => item.result === 'failed');
if (failed.length) {
  console.error(`Falhas: ${failed.map((item) => item.suite).join(', ')}`);
  process.exitCode = 1;
}
if (!existsSync(reportPath)) process.exitCode = 1;
