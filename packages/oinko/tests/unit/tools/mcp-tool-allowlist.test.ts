import { describe, it, expect, beforeEach } from 'vitest';
import { MCPAdapter } from '../../../src/tools/mcp-adapter.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';

let executor: ToolExecutor;
let adapter: MCPAdapter;

const SERVER_TOOLS = [
  { name: 'generate_image', description: 'gera imagem', inputSchema: { type: 'object' } },
  { name: 'generate_video', description: 'gera video', inputSchema: { type: 'object' } },
  { name: 'show_plans_and_credits', description: 'planos', inputSchema: { type: 'object' } },
  { name: 'job_status', description: 'status', inputSchema: { type: 'object' } },
];

beforeEach(() => {
  executor = new ToolExecutor();
  adapter = new MCPAdapter(executor);
});

/** Registra as tools do servidor falso e devolve os nomes que entraram. */
function register(tools: readonly unknown[], allow?: string[]): string[] {
  const converted = (
    adapter as unknown as {
      selectTools: (
        tools: readonly { name: string }[],
        allow?: readonly string[],
      ) => { name: string }[];
    }
  ).selectTools(tools as { name: string }[], allow);
  return converted.map((tool) => tool.name);
}

describe('allowlist de ferramentas do MCP', () => {
  it('registers everything when no allowlist is given', () => {
    expect(register(SERVER_TOOLS)).toHaveLength(4);
  });

  // O servidor do Higgsfield publica 101 ferramentas: ~44 mil tokens de schema
  // em TODA chamada de LLM, acima do maxTokensPerExecution de muitos agentes.
  // Sem recorte, conectar um servidor grande e inviavel por custo.
  it('keeps only what was asked for', () => {
    expect(register(SERVER_TOOLS, ['generate_image', 'job_status'])).toEqual([
      'generate_image',
      'job_status',
    ]);
  });

  it('ignores a name the server does not publish', () => {
    expect(register(SERVER_TOOLS, ['generate_image', 'nao_existe'])).toEqual(['generate_image']);
  });

  it('treats an empty allowlist as no filter, not as zero tools', () => {
    // Lista vazia quase sempre e engano de configuracao; deixar o agente sem
    // nenhuma ferramenta silenciosamente seria pior que ignorar o campo.
    expect(register(SERVER_TOOLS, [])).toHaveLength(4);
  });
});
