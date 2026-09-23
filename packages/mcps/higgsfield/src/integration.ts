import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { McpProvider } from '@oinko/agent-runtime';
import type { Agent } from '@oinko/core';
import { higgsfieldHeaders } from './credentials.js';

export const DEFAULT_HIGGSFIELD_TOOLS = [
  'generate_image',
  'generate_video',
  'job_status',
  'jobs_wait',
  'models_explore',
];
export const HIGGSFIELD_INSTRUCTIONS =
  '\nHiggsfield: consulte models_explore para obter IDs reais de modelos. Após gerar, aguarde com jobs_wait. Para usar a imagem enviada na conversa, chame preparar_imagem_enviada antes da geração. Retorne links reais dos resultados; nunca invente IDs ou URLs.';
export interface HiggsfieldOptions {
  credentialPath: string;
  name?: string;
  url?: string;
  tools?: string[];
  timeoutMs?: number;
}

/** Each instance owns its upload MCP session; only credentials are shared. */
export function createHiggsfieldIntegration(options: HiggsfieldOptions) {
  const url = options.url ?? 'https://mcp.higgsfield.ai/mcp';
  const timeout = options.timeoutMs ?? 120_000;
  const headers = () => higgsfieldHeaders({ path: options.credentialPath });
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;
  const uploaded = new Map<string, { url: string; mediaId: string; createdAt: number }>();
  async function uploadClient(): Promise<Client> {
    connecting ??= (async () => {
      const next = new Client({ name: 'oinko-higgsfield', version: '1.0.0' });
      try {
        await next.connect(
          new StreamableHTTPClientTransport(new URL(url), {
            fetch: async (input, init) => {
              const requestHeaders = new Headers(init?.headers);
              for (const [key, value] of Object.entries(await headers()))
                requestHeaders.set(key, value);
              return fetch(input, {
                ...init,
                headers: requestHeaders,
                signal: init?.signal ?? AbortSignal.timeout(timeout),
              });
            },
          }),
        );
        client = next;
        return next;
      } catch (error) {
        await next.close();
        connecting = undefined;
        throw error;
      }
    })();
    return connecting;
  }
  async function call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const connection = await uploadClient();
    const result = await connection.callTool({ name, arguments: args }, undefined, { timeout });
    if (result.isError) throw new Error(`Higgsfield: ${name} falhou.`);
    if (result.structuredContent)
      return z.record(z.string(), z.unknown()).parse(result.structuredContent);
    const contents = result.content as { type: string; text?: string }[];
    const text = contents.find((part) => part.type === 'text')?.text;
    return z.record(z.string(), z.unknown()).parse(text ? JSON.parse(text) : {});
  }
  async function uploadImage(
    bytes: Uint8Array,
    mimeType: string,
    filename: string,
  ): Promise<{ mediaId: string }> {
    const result = await call('media_upload', {
      method: 'upload_url',
      filename,
      content_type: mimeType,
    });
    const upload = z
      .object({
        uploads: z
          .array(
            z.object({
              upload_url: z.url(),
              media_id: z.string(),
              content_type: z.string().optional(),
            }),
          )
          .min(1),
      })
      .parse(result).uploads[0]!;
    // Presigned storage requests never receive the Higgsfield Authorization header.
    const response = await fetch(upload.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': upload.content_type ?? mimeType },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Upload Higgsfield falhou: HTTP ${response.status}`);
    const confirmation = await call('media_confirm', { type: 'image', media_id: upload.media_id });
    const confirmed = z
      .object({ results: z.array(z.object({ status: z.string() })) })
      .parse(confirmation);
    if (confirmed.results[0]?.status !== 'uploaded')
      throw new Error('Higgsfield não confirmou o upload.');
    return { mediaId: upload.media_id };
  }
  return {
    uploadImage,
    async connect(agent: Agent) {
      await agent.connectMCP({
        name: options.name ?? 'higgsfield',
        transport: 'http',
        url,
        getHeaders: headers,
        tools: options.tools ?? DEFAULT_HIGGSFIELD_TOOLS,
        timeout,
      });
      agent.addTool({
        name:
          options.name && options.name !== 'higgsfield'
            ? `${options.name}_preparar_imagem_enviada`
            : 'preparar_imagem_enviada',
        description:
          'Envia a última imagem desta conversa ao Higgsfield e devolve media_id para usar como referência na geração.',
        parameters: z.object({}),
        execute: async (_args, _signal, _progress, context) => {
          const threadId = context?.threadId;
          if (!threadId) return 'Conversa não identificada.';
          const history = agent.getHistory(threadId);
          let image: string | undefined;
          for (const message of [...history].reverse()) {
            if (message.role !== 'user' || !Array.isArray(message.content)) continue;
            image = [...message.content].reverse().find((part) => part.type === 'image_url')
              ?.image_url?.url;
            if (image) break;
          }
          const match = image?.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
          if (!image || !match)
            return 'Envie uma imagem nesta conversa antes de gerar uma referência.';
          const previous = uploaded.get(threadId);
          if (previous?.url === image && Date.now() - previous.createdAt < 23 * 3600_000)
            return JSON.stringify({ mediaId: previous.mediaId });
          const result = await uploadImage(
            Buffer.from(match[2]!, 'base64'),
            match[1]!,
            `imagem.${match[1]!.split('/')[1]}`,
          );
          uploaded.delete(threadId);
          uploaded.set(threadId, { url: image, mediaId: result.mediaId, createdAt: Date.now() });
          while (uploaded.size > 20) uploaded.delete(uploaded.keys().next().value!);
          return JSON.stringify(result);
        },
      });
    },
    async close() {
      if (connecting) {
        try {
          await connecting;
        } catch {
          /* Failed connection has no session. */
        }
      }
      await client?.close();
      connecting = undefined;
      client = undefined;
      uploaded.clear();
    },
  };
}

export const higgsfieldMcp: McpProvider = async (options, context) => {
  const parsed = z
    .object({
      credentialPath: z.string().min(1),
      url: z.url().optional(),
      tools: z.array(z.string()).optional(),
      timeoutMs: z.number().positive().optional(),
    })
    .parse(options);
  const integration = createHiggsfieldIntegration({ ...parsed, name: context.id });
  const cleanup = async () => {
    try {
      await context.agent.disconnectMCP(context.id);
    } finally {
      context.agent.removeTool(
        context.id === 'higgsfield'
          ? 'preparar_imagem_enviada'
          : `${context.id}_preparar_imagem_enviada`,
      );
      await integration.close();
    }
  };
  try {
    await integration.connect(context.agent);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return cleanup;
};
