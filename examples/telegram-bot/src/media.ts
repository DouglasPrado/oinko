import type { Context } from 'grammy';
import type { ContentPart } from '@gba/ai-harness';
import { config } from './config.js';
import type { PendingImage } from './pending-media.js';

/**
 * Teto do que vale a pena inlinar.
 *
 * O `getFile` do Telegram so entrega arquivo de ate 20MB, mas base64 infla o
 * conteudo em ~33% e a imagem viaja dentro do JSON da requisicao a cada turno
 * da thread, nao so no turno em que chegou. 5MB brutos e um limite folgado
 * para foto de celular e ainda barato de reenviar.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Teto do audio.
 *
 * Um audio nao fica na thread como a imagem: ele e transcrito e so o texto
 * entra na conversa, entao o custo e uma transcricao unica. Vinte minutos de
 * voz cabem folgado em 20MB, que e tambem o limite do `getFile`.
 */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const TELEGRAM_FILE_HOST = 'https://api.telegram.org';

/** O que o handler deve fazer com a mensagem que chegou. */
export type BuiltInput =
  /**
   * `image` acompanha o turno quando a mensagem trouxe uma foto. O modelo ve a
   * imagem inline no `input`, mas um data URL nao serve como referencia para o
   * Higgsfield: ele quer um `media_id`, que so sai de um upload dos bytes. Por
   * isso os bytes viajam junto, para o handler guarda-los na conversa.
   */
  | { kind: 'ok'; input: string | ContentPart[]; image?: PendingImage }
  /** Audio a transcrever antes de virar turno — o handler faz a chamada. */
  | { kind: 'audio'; audio: Uint8Array; filename: string; caption: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'empty' };

/**
 * A extensao que o provedor usa para escolher o decoder.
 *
 * Nota de voz do Telegram e sempre OGG/Opus; audio enviado como arquivo traz
 * o mime real. O nome e derivado do mime, nunca fixado: um `.ogg` chamado de
 * `.mp3` e recusado por formato invalido.
 *
 * Toda extensao aqui esta na lista que o provedor aceita — flac, m4a, mp3,
 * mp4, mpeg, mpga, oga, ogg, wav, webm — verificada contra a API.
 */
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/oga': 'oga',
  // Opus viaja em conteiner OGG. Sondado contra a API: a extensao `.opus` e
  // recusada ("Invalid file format"), os mesmos bytes como `.ogg` passam.
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

export function audioFilename(mimeType: string | undefined): string {
  return `voz.${AUDIO_EXTENSIONS[mimeType ?? ''] ?? 'ogg'}`;
}

interface PhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

/**
 * A maior das versoes que cabe no teto.
 *
 * O Telegram manda a mesma foto em varias resolucoes, da miniatura ao
 * original, em ordem crescente. A maior e a que o modelo le melhor; se nem ela
 * couber, nao ha o que enviar — reduzir aqui seria reescrever a imagem que a
 * pessoa mandou.
 */
export function pickPhotoSize(sizes: readonly PhotoSize[]): PhotoSize | undefined {
  const cabem = sizes.filter((s) => (s.file_size ?? 0) <= MAX_IMAGE_BYTES);
  return cabem.reduce<PhotoSize | undefined>(
    (maior, atual) => ((atual.file_size ?? 0) > (maior?.file_size ?? -1) ? atual : maior),
    undefined,
  );
}

/** O nome do arquivo derivado do mime, para o upload que quiser um. */
export function imageFilename(mimeType: string): string {
  const extensao = mimeType.split('/')[1]?.split(';')[0] ?? 'jpg';
  return `imagem.${extensao === 'jpeg' ? 'jpg' : extensao}`;
}

/** Os bytes viram o data URL que o provedor aceita inline. */
export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Traduz a mensagem do Telegram no que o agente recebe.
 *
 * O `fetchImpl` e injetavel porque a unica parte desta funcao que toca a rede
 * e o download — e e justamente a que precisa ser observada em teste, para
 * provar que o token nao sai junto.
 */
export async function buildAgentInput(
  ctx: Context,
  fetchImpl: typeof fetch = fetch,
): Promise<BuiltInput> {
  const legenda = ctx.message?.text ?? ctx.message?.caption ?? '';

  const foto = ctx.message?.photo ? pickPhotoSize(ctx.message.photo) : undefined;
  const documento = ctx.message?.document;
  const documentoEhImagem = documento?.mime_type?.startsWith('image/') === true;

  // Nota de voz, audio enviado como musica e audio mandado como arquivo: tres
  // campos diferentes no payload do Telegram para a mesma coisa aqui.
  const voz = ctx.message?.voice ?? ctx.message?.audio;
  const documentoEhAudio = documento?.mime_type?.startsWith('audio/') === true;

  if (voz || documentoEhAudio) {
    const mime = voz?.mime_type ?? documento?.mime_type;
    const tamanho = voz?.file_size ?? documento?.file_size ?? 0;
    if (tamanho > MAX_AUDIO_BYTES) {
      return { kind: 'unsupported', reason: 'audio-too-large' };
    }

    const baixado = await downloadTelegramFile(ctx, fetchImpl);
    if (baixado.kind !== 'ok') return baixado;
    if (baixado.bytes.byteLength > MAX_AUDIO_BYTES) {
      return { kind: 'unsupported', reason: 'audio-too-large' };
    }

    return {
      kind: 'audio',
      audio: baixado.bytes,
      filename: audioFilename(mime),
      caption: legenda,
    };
  }

  if (ctx.message?.photo && !foto) {
    return { kind: 'unsupported', reason: 'image-too-large' };
  }

  if (documento && !documentoEhImagem) {
    return legenda
      ? { kind: 'ok', input: legenda }
      : { kind: 'unsupported', reason: 'not-an-image' };
  }

  if (documentoEhImagem && (documento.file_size ?? 0) > MAX_IMAGE_BYTES) {
    return { kind: 'unsupported', reason: 'image-too-large' };
  }

  if (!foto && !documentoEhImagem) {
    return legenda ? { kind: 'ok', input: legenda } : { kind: 'empty' };
  }

  const baixado = await downloadTelegramFile(ctx, fetchImpl);
  if (baixado.kind !== 'ok') return baixado;
  const bytes = baixado.bytes;

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    // O `file_size` e opcional no payload do Telegram: quando ele nao vem, o
    // tamanho real so aparece depois de baixar.
    return { kind: 'unsupported', reason: 'image-too-large' };
  }

  const mimeType = documentoEhImagem ? (documento.mime_type ?? 'image/jpeg') : 'image/jpeg';
  const imagem: ContentPart = {
    type: 'image_url',
    image_url: { url: toDataUrl(bytes, mimeType), detail: 'auto' },
  };

  // Sem legenda vai so a imagem: inventar um "descreva esta imagem" poria na
  // boca da pessoa um pedido que ela nao fez, e o modelo ja responde bem a uma
  // imagem sozinha.
  return {
    kind: 'ok',
    input: legenda ? [{ type: 'text', text: legenda }, imagem] : [imagem],
    image: { bytes, mimeType, filename: imageFilename(mimeType) },
  };
}

/**
 * Baixa o arquivo referenciado pela mensagem.
 *
 * A URL de download carrega o token do bot no proprio caminho. Ela nasce e
 * morre dentro desta funcao: o que sobe para o provedor sao os bytes, nunca o
 * endereco de onde vieram.
 */
async function downloadTelegramFile(
  ctx: Context,
  fetchImpl: typeof fetch,
): Promise<{ kind: 'ok'; bytes: Uint8Array } | { kind: 'unsupported'; reason: string }> {
  const file = await ctx.getFile();
  if (!file.file_path) return { kind: 'unsupported', reason: 'no-file-path' };

  const url = `${TELEGRAM_FILE_HOST}/file/bot${config.telegram.token}/${file.file_path}`;
  const resposta = await fetchImpl(url);
  if (!resposta.ok) return { kind: 'unsupported', reason: 'download-failed' };

  return { kind: 'ok', bytes: new Uint8Array(await resposta.arrayBuffer()) };
}
