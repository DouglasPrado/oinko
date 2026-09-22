import { afterEach, expect, it, vi } from 'vitest';
import type { Agent, AgentTool } from '@oinko/core';

const transport = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), callTool: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = transport.connect;
    close = transport.close;
    callTool = transport.callTool;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}));
import { createHiggsfieldIntegration } from '../src/integration.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('uses the SDK upload protocol, keeps credentials off storage requests and releases the session', async () => {
  transport.callTool
    .mockResolvedValueOnce({
      structuredContent: {
        uploads: [
          {
            upload_url: 'https://storage.example.com/upload',
            media_id: 'media-1',
            content_type: 'image/png',
          },
        ],
      },
    })
    .mockResolvedValueOnce({ structuredContent: { results: [{ status: 'uploaded' }] } });
  const put = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
  const integration = createHiggsfieldIntegration({
    credentialPath: '/unused',
    tools: ['generate_image'],
  });
  expect(await integration.uploadImage(new Uint8Array([1, 2]), 'image/png', 'image.png')).toEqual({
    mediaId: 'media-1',
  });
  expect(put).toHaveBeenCalledWith(
    'https://storage.example.com/upload',
    expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/png' } }),
  );
  expect(transport.callTool.mock.calls.map((call) => call[0].name)).toEqual([
    'media_upload',
    'media_confirm',
  ]);
  await integration.close();
  expect(transport.close).toHaveBeenCalledTimes(1);
});

it('registers only requested MCP tools and scopes reference images to the requesting thread', async () => {
  let tool: AgentTool | undefined;
  const agent = {
    connectMCP: vi.fn(),
    addTool: vi.fn((value: AgentTool) => {
      tool = value;
    }),
    getHistory: vi.fn().mockReturnValue([]),
  };
  const integration = createHiggsfieldIntegration({
    credentialPath: '/unused',
    tools: ['generate_image'],
  });
  await integration.connect(agent as unknown as Agent);
  expect(agent.connectMCP).toHaveBeenCalledWith(
    expect.objectContaining({ tools: ['generate_image'] }),
  );
  await tool!.execute({}, new AbortController().signal, undefined, {
    threadId: 'private-thread',
    traceId: 'test',
  });
  expect(agent.getHistory).toHaveBeenCalledWith('private-thread');
  expect(transport.callTool).not.toHaveBeenCalled();
  await integration.close();
});
