import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const root = resolve(process.argv[2]);
const exec = promisify(execFile);
const server = new McpServer({ name: 'evaluation', version: '1.0.0' });
const pathSchema = z.string().describe('Caminho relativo ao projeto de avaliação.');
function local(path) {
  const target = resolve(root, path);
  if (relative(root, target).startsWith('..')) throw new Error('Outside evaluation project');
  return target;
}
function tool(name, description, shape, run, readOnly = true) {
  server.registerTool(
    name,
    { description, inputSchema: shape, annotations: { readOnlyHint: readOnly } },
    async (args) => {
      try {
        return { content: [{ type: 'text', text: String(await run(args)) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: error.message }], isError: true };
      }
    },
  );
}
tool(
  'fixture_read',
  'Lê um arquivo do projeto de avaliação Neblina.',
  { path: pathSchema },
  ({ path }) => readFile(local(path), 'utf8'),
);
tool(
  'fixture_write',
  'Grava um arquivo do projeto de avaliação Neblina.',
  { path: pathSchema, content: z.string() },
  async ({ path, content }) => {
    await writeFile(local(path), content);
    return `Arquivo salvo: ${path}`;
  },
  false,
);
tool(
  'fixture_search',
  'Busca texto literal nos arquivos do projeto de avaliação Neblina.',
  { text: z.string() },
  async ({ text }) => {
    const { stdout } = await exec('rg', ['-n', '--fixed-strings', '--', text, '.'], { cwd: root });
    return stdout;
  },
);
tool(
  'fixture_test',
  'Executa os testes Node reais do projeto de avaliação Neblina.',
  {},
  async () => {
    const { stdout } = await exec(process.execPath, ['--test', 'sum.test.mjs'], { cwd: root });
    return stdout;
  },
);
tool(
  'fixture_git',
  'Consulta o diff e o status Git reais do projeto de avaliação Neblina.',
  {},
  async () => {
    const { stdout } = await exec('git', ['diff', '--', 'sum.mjs'], { cwd: root });
    return stdout;
  },
);
tool(
  'fixture_log',
  'Lê o relatório numerado de diagnóstico do projeto Neblina. Contém identificadores de auditoria e métricas.',
  { number: z.number().int().min(1).max(6) },
  ({ number }) => readFile(local(`report-${number}.txt`), 'utf8'),
);
tool(
  'fixture_calculate',
  'Calcula o total de uma lista de quantidades, útil para conferir métricas.',
  { values: z.array(z.number()) },
  ({ values }) => JSON.stringify({ total: values.reduce((a, b) => a + b, 0) }),
);
await server.connect(new StdioServerTransport());
