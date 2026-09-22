import { higgsfieldHeaders } from './higgsfield-auth.js';
import { config } from './config.js';

/**
 * Cliente MCP minimo para o que o modelo nao consegue fazer sozinho.
 *
 * `media_upload` devolve uma URL pre-assinada e espera que o cliente suba os
 * bytes por PUT. Um LLM so chama ferramenta com JSON — ele nao tem como
 * transferir bytes — entao esse pedaco tem de ser codigo. A alternativa,
 * `media_import_url`, exigiria entregar ao Higgsfield a URL do arquivo no
 * Telegram, que carrega o token do bot no caminho.
 */
let sessionId: string | undefined;

interface Upload {
  upload_url: string;
  media_id: string;
  content_type?: string;
}

async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(config.higgsfield.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // O transporte StreamableHTTP responde em SSE; sem este Accept o
      // servidor recusa a requisicao.
      Accept: 'application/json, text/event-stream',
      ...(await higgsfieldHeaders()),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });

  const session = response.headers.get('mcp-session-id');
  if (session) sessionId = session;

  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} falhou com HTTP ${response.status}`);

  const linha = text.split('\n').find((l) => l.startsWith('data: '));
  const body = JSON.parse(linha ? linha.slice(6) : text) as {
    result?: { structuredContent?: Record<string, unknown>; isError?: boolean };
    error?: { message: string };
  };
  if (body.error) throw new Error(`MCP ${method}: ${body.error.message}`);
  if (body.result?.isError) throw new Error(`MCP ${method} devolveu erro`);
  return body.result?.structuredContent ?? {};
}

/** A sessao morre com o processo; uma por bot basta. */
async function ensureSession(): Promise<void> {
  if (sessionId) return;
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'telegram-bot', version: '1' },
  });
}

/**
 * Sobe uma imagem para o Higgsfield e devolve o id que a geracao aceita.
 *
 * Tres passos: pedir a URL pre-assinada, colocar os bytes nela, confirmar. O
 * `Content-Type` do PUT nao e opcional: a assinatura da S3 cobre esse header
 * (`X-Amz-SignedHeaders=content-type;host`) e trocar o valor invalida a URL.
 */
export async function uploadImage(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<{ mediaId: string }> {
  await ensureSession();

  const pedido = await rpc('tools/call', {
    name: 'media_upload',
    arguments: { method: 'upload_url', filename, content_type: mimeType },
  });

  const upload = (pedido['uploads'] as Upload[] | undefined)?.[0];
  if (!upload?.upload_url || !upload.media_id) {
    throw new Error('media_upload nao devolveu upload_url e media_id');
  }

  const put = await fetch(upload.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': upload.content_type ?? mimeType },
    body: bytes,
  });
  if (!put.ok) throw new Error(`O armazenamento recusou os bytes: HTTP ${put.status}`);

  const confirmacao = await rpc('tools/call', {
    name: 'media_confirm',
    arguments: { type: 'image', media_id: upload.media_id },
  });

  const status = (confirmacao['results'] as { status?: string }[] | undefined)?.[0]?.status;
  if (status !== 'uploaded') {
    throw new Error(`media_confirm nao confirmou a imagem (status: ${status ?? 'ausente'})`);
  }

  return { mediaId: upload.media_id };
}
