import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Agent, JevDecider, SQLiteDatabase, SQLiteConversationStore } from '../../dist/index.js';
import { BotStore } from '../../../bots/dist/index.js';
import {
  programmingTools,
  PROGRAMMING_INSTRUCTIONS,
} from '../../../bots/dist/programming-tools.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const phase = process.argv[2];
if (!phase || !/^[a-z0-9-]+$/.test(phase)) throw new Error('Provide a new evidence run name');
const output = join(root, '.harness/context-evaluation', phase);
if (existsSync(output)) throw new Error(`Evidence is immutable: ${output} already exists`);
mkdirSync(output, { recursive: true, mode: 0o700 });
const project = join(output, 'project');
mkdirSync(project);
const scenariosBytes = readFileSync(join(directory, 'scenarios.json'));
const scenarios = JSON.parse(scenariosBytes);
writeFileSync(join(output, 'scenarios.json'), scenariosBytes);
writeFileSync(
  join(project, 'README.md'),
  'Projeto Neblina. EXPECTED: sum(a, b) soma os dois números, incluindo negativos. Preserve a exportação nomeada sum.\n',
);
writeFileSync(join(project, 'sum.mjs'), 'export function sum(a, b) { return a - b; }\n');
writeFileSync(
  join(project, 'sum.test.mjs'),
  "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { sum } from './sum.mjs'; test('soma inteiros',()=>assert.equal(sum(2,3),5)); test('negativos',()=>assert.equal(sum(-2,-3),-5)); test('zero',()=>assert.equal(sum(0,9),9));\n",
);
for (let number = 1; number <= 6; number++) {
  const lines = Array.from(
    { length: 95 },
    (_, i) =>
      `Amostra ${String(i).padStart(3, '0')} segmento ${number}: tempo=24ms memoria=128MB fila=0 operacao=verificacao processamento regular.\n`,
  );
  lines[40] = `audit-marker=AUDIT-${number}-X9Q7\n`;
  writeFileSync(
    join(project, `report-${number}.txt`),
    `RELATORIO ${number}\nErros: ${10 + number}\n${lines.join('')}\nFim: erros=${10 + number}.\n`,
  );
}
execFileSync('git', ['init', '-q'], { cwd: project });
execFileSync('git', ['add', '.'], { cwd: project });
execFileSync(
  'git',
  [
    '-c',
    'user.name=Oinko Evaluation',
    '-c',
    'user.email=evaluation@localhost',
    'commit',
    '-qm',
    'fixture',
  ],
  { cwd: project },
);
const store = new BotStore(root);
const runtime = store.runtime('dev');
store.close();
const { definition: bot, secrets } = runtime;
const mcp = bot.mcps.find((entry) => entry.id === 'oinko');
const requests = [],
  pending = [],
  results = [];
let currentId = 'startup';
function observer(kind) {
  return async (request) => {
    const body = JSON.parse(await request.clone().text());
    const row = {
      case: currentId,
      kind,
      startedAt: Date.now(),
      model: body.model,
      stream: body.stream === true,
      tools: (body.tools ?? []).map((t) => t.function.name),
      toolChars: JSON.stringify(body.tools ?? []).length,
      messageChars: JSON.stringify(body.messages ?? body.state ?? '').length,
      messages: body.messages,
      questions: body.questions,
    };
    requests.push(row);
    try {
      const response = await fetch(request);
      row.status = response.status;
      pending.push(
        response
          .clone()
          .text()
          .then((text) => {
            row.durationMs = Date.now() - row.startedAt;
            const chunks = body.stream
              ? text
                  .split('\n')
                  .filter((l) => l.startsWith('data: {'))
                  .map((l) => JSON.parse(l.slice(6)))
              : [JSON.parse(text)];
            row.usage = chunks.findLast((chunk) => chunk.usage)?.usage;
            row.error = chunks.find((chunk) => chunk.error)?.error;
            if (kind === 'jev') row.answers = chunks[0]?.answers;
          })
          .catch((error) => {
            row.captureError = error.message;
          }),
      );
      return response;
    } catch (error) {
      row.error = error.message;
      throw error;
    }
  };
}
let database, agent;
async function start() {
  database = new SQLiteDatabase(join(output, 'conversations.db'));
  database.initialize();
  agent = Agent.create({
    apiKey: secrets.apiKey,
    baseUrl: bot.baseUrl,
    model: bot.model,
    systemPrompt:
      bot.systemPrompt +
      PROGRAMMING_INSTRUCTIONS +
      '\nAvaliação: existe um projeto local Neblina acessível exclusivamente pelas ferramentas fixture_*. Use fixture_* para esse projeto. O MCP Oinko e workspace_* são somente para consultas nesta avaliação. Respostas breves, fundamentadas nos resultados. Nunca publique ou modifique recursos externos. Não leia nem altere sum.test.mjs.',
    fetch: observer('llm'),
    decider: new JevDecider({
      apiKey: secrets.typesafeKey,
      timeout: 15000,
      fetch: observer('jev'),
    }),
    routing: { fastModel: bot.intelligence.fastModel, minConfidence: 0.85 },
    conversation: { store: new SQLiteConversationStore(database), search: { enabled: true } },
    ...(process.env.OINKO_EVAL_CONTEXT
      ? { context: JSON.parse(process.env.OINKO_EVAL_CONTEXT) }
      : {}),
    memory: { enabled: false },
    knowledge: { enabled: false },
    maxIterations: 15,
    maxOutputTokens: 1500,
    logLevel: 'warn',
    telemetry: { enabled: true, dbPath: join(output, 'telemetry.db'), capturePayloads: 'full' },
  });
  for (const tool of programmingTools(root, 'dev')) agent.addTool(tool);
  await agent.connectMCP({
    name: 'oinko',
    transport: 'stdio',
    command: mcp.command,
    args: mcp.args,
  });
  await agent.connectMCP({
    name: 'evaluation',
    transport: 'stdio',
    command: process.execPath,
    args: [join(directory, 'fixture.mjs'), project],
  });
}
async function stop() {
  await agent?.destroy();
  database?.close();
}
const metadata = {
  phase,
  startedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scenarioHash: createHash('sha256').update(scenariosBytes).digest('hex'),
  harnessHash: createHash('sha256')
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .update(readFileSync(join(directory, 'fixture.mjs')))
    .digest('hex'),
  model: bot.model,
  fastModel: bot.intelligence.fastModel,
  configuration: process.env.OINKO_EVAL_CONTEXT ? JSON.parse(process.env.OINKO_EVAL_CONTEXT) : null,
  limits:
    'Live providers and real MCP/file/Git/test execution. Synthetic isolated project. Oinko read-only. Long-term memory disabled equally to isolate conversation context.',
};
function save() {
  writeFileSync(
    join(output, 'results.json'),
    JSON.stringify({ metadata, results, requests }, null, 2),
    { mode: 0o600 },
  );
}
try {
  await start();
  for (const scenario of scenarios) {
    currentId = scenario.id;
    if (scenario.restart) {
      await stop();
      await start();
    }
    const entry = {
      id: scenario.id,
      prompt: scenario.prompt,
      tools: [],
      answer: '',
      events: [],
      startedAt: Date.now(),
    };
    results.push(entry);
    try {
      for await (const event of agent.stream(scenario.prompt, {
        threadId: scenario.thread,
        ...(scenario.route ? {} : { model: bot.model }),
        signal: AbortSignal.timeout(180000),
      })) {
        if (event.type === 'text_delta') entry.answer += event.content;
        if (event.type === 'tool_call_start') entry.tools.push(event.toolCall.function.name);
        if (event.type === 'agent_start') entry.model = event.model;
        if (event.type === 'agent_end') entry.usage = event.usage;
        if (event.type === 'error') entry.error = event.error.message;
        if (!['text_delta', 'tool_call_delta'].includes(event.type))
          entry.events.push({ ...event, ...(event.error ? { error: event.error.message } : {}) });
      }
      const normal = entry.answer.toLowerCase();
      entry.checks = {
        answer: normal.trim().length > 0,
        noError: !entry.error,
        facts: (scenario.contains ?? []).every((value) => normal.includes(value.toLowerCase())),
        excludes: (scenario.excludes ?? []).every((value) => !normal.includes(value.toLowerCase())),
        tools: (scenario.tools ?? []).every((name) =>
          entry.tools.some((actual) => actual.endsWith(name)),
        ),
        noTools: !scenario.noTools || entry.tools.length === 0,
      };
      if (scenario.fileFixed) {
        try {
          execFileSync(process.execPath, ['--test', 'sum.test.mjs'], {
            cwd: project,
            stdio: 'pipe',
          });
          entry.checks.fileFixed = true;
        } catch {
          entry.checks.fileFixed = false;
        }
      }
      entry.passed = Object.values(entry.checks).every(Boolean);
    } catch (error) {
      entry.error = error.message;
      entry.passed = false;
    }
    entry.durationMs = Date.now() - entry.startedAt;
    await Promise.allSettled(pending);
    save();
    console.log(
      JSON.stringify({
        id: entry.id,
        passed: entry.passed,
        checks: entry.checks,
        tools: entry.tools,
        usage: entry.usage,
        ms: entry.durationMs,
        error: entry.error,
      }),
    );
  }
} finally {
  await stop();
  await Promise.allSettled(pending);
  metadata.finishedAt = new Date().toISOString();
  save();
}
console.log(
  JSON.stringify({
    phase,
    passed: results.filter((r) => r.passed).length,
    total: scenarios.length,
    output,
  }),
);
