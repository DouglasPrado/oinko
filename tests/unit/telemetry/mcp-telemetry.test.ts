import { describe, it, expect, beforeEach } from 'vitest';
import { MCPAdapter } from '../../../src/tools/mcp-adapter.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { TelemetryRecord, TelemetrySink } from '../../../src/contracts/entities/telemetry.js';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';

let records: TelemetryRecord[];
let sink: TelemetrySink;
let adapter: MCPAdapter;

beforeEach(() => {
  records = [];
  sink = {
    write: (record) => records.push(record),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    stats: () => ({ written: records.length, dropped: 0 }),
  };
  adapter = new MCPAdapter(new ToolExecutor(), () => sink);
});

/** Converte uma tool MCP usando um cliente falso, sem rede nem processo. */
function convert(callTool: (req: unknown) => Promise<unknown>): AgentTool {
  return (
    adapter as unknown as {
      convertTool: (
        serverName: string,
        tool: { name: string; description?: string; inputSchema: unknown },
        client: unknown,
        config: Record<string, unknown>,
      ) => AgentTool;
    }
  ).convertTool(
    'albert',
    { name: 'buscar', description: 'busca algo', inputSchema: { type: 'object', properties: {} } },
    { callTool },
    {},
  );
}

function mcpRecords() {
  return records.filter((record) => record.kind === 'mcp_call');
}

describe('telemetria do MCP', () => {
  it('records what went in and what came back', async () => {
    const tool = convert(() =>
      Promise.resolve({ content: [{ type: 'text', text: 'resultado do servidor' }] }),
    );

    await tool.execute({ termo: 'pedido' }, new AbortController().signal, undefined, {
      traceId: 't1',
      toolCallId: 'call-9',
    });

    const [call] = mcpRecords();
    if (call?.kind !== 'mcp_call') throw new Error('nenhuma troca registrada');

    expect(call.traceId).toBe('t1');
    expect(call.toolCallId).toBe('call-9');
    expect(call.serverName).toBe('albert');
    expect(call.remoteToolName).toBe('buscar');
    expect(call.request).toContain('pedido');
    expect(call.response).toContain('resultado do servidor');
    expect(call.contentTypes).toBe('text');
    expect(call.isError).toBe(false);
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
  });

  // O achatamento troca a imagem por "[Image: …]" e o payload real some. A
  // telemetria grava antes disso.
  it('keeps the payload the server actually sent, not the flattened label', async () => {
    const tool = convert(() =>
      Promise.resolve({
        content: [{ type: 'image', mimeType: 'image/png', data: 'AAAABBBBCCCC' }],
      }),
    );

    await tool.execute({}, new AbortController().signal, undefined, { traceId: 't1' });

    const [call] = mcpRecords();
    if (call?.kind !== 'mcp_call') throw new Error('nenhuma troca registrada');
    expect(call.response).toContain('AAAABBBBCCCC');
    expect(call.contentTypes).toBe('image');
  });

  it('marks a server error', async () => {
    const tool = convert(() =>
      Promise.resolve({ content: [{ type: 'text', text: 'deu ruim' }], isError: true }),
    );

    await tool.execute({}, new AbortController().signal, undefined, { traceId: 't1' });

    const [call] = mcpRecords();
    expect(call?.kind === 'mcp_call' && call.isError).toBe(true);
  });

  it('separates a timeout from an ordinary failure', async () => {
    const tool = convert(() =>
      Promise.reject(new Error('MCP tool "buscar" timed out after 30000ms')),
    );

    await tool.execute({}, new AbortController().signal, undefined, { traceId: 't1' });

    const [call] = mcpRecords();
    if (call?.kind !== 'mcp_call') throw new Error('nenhuma troca registrada');
    expect(call.timedOut).toBe(true);
    expect(call.isError).toBe(true);
    expect(call.errorMessage).toContain('timed out');
  });

  it('records the failure of a call that threw for another reason', async () => {
    const tool = convert(() => Promise.reject(new Error('conexao recusada')));

    await tool.execute({}, new AbortController().signal, undefined, { traceId: 't1' });

    const [call] = mcpRecords();
    if (call?.kind !== 'mcp_call') throw new Error('nenhuma troca registrada');
    expect(call.timedOut).toBe(false);
    expect(call.errorMessage).toContain('conexao recusada');
  });

  it('works without a trace, because the adapter may run outside a turn', async () => {
    const tool = convert(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }));

    await tool.execute({}, new AbortController().signal);

    const [call] = mcpRecords();
    expect(call?.kind === 'mcp_call' && call.traceId).toBeUndefined();
  });

  it('records nothing when no sink is provided', async () => {
    adapter = new MCPAdapter(new ToolExecutor());
    const tool = convert(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }));

    await tool.execute({}, new AbortController().signal, undefined, { traceId: 't1' });

    expect(mcpRecords()).toHaveLength(0);
  });
});
