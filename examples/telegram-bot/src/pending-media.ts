/**
 * A ultima imagem de cada conversa, para quando o pedido chega depois dela.
 *
 * O modelo ve a imagem inline no turno em que ela chega, mas isso nao serve
 * para gerar: o Higgsfield quer um `media_id`, e o id so existe depois de
 * subir os bytes. Guardar aqui e o que permite a pessoa mandar a foto e pedir
 * a edicao — no mesmo turno ou no seguinte.
 */
export interface PendingImage {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  /** Preenchido depois do upload, para nao subir a mesma imagem duas vezes. */
  mediaId?: string;
}

/**
 * Teto de conversas guardadas.
 *
 * Cada entrada carrega ate 5MB de bytes e nada aqui expira sozinho: sem um
 * limite, um bot com muitas conversas acumularia todas elas em memoria. O Map
 * preserva a ordem de insercao, entao a primeira chave e a mais antiga.
 */
const MAX_THREADS = 20;

const byThread = new Map<string, PendingImage>();

export function rememberImage(threadId: string, image: PendingImage): void {
  // Reinserir move a conversa para o fim da fila de descarte.
  byThread.delete(threadId);
  byThread.set(threadId, image);

  while (byThread.size > MAX_THREADS) {
    const maisAntiga = byThread.keys().next().value;
    if (maisAntiga === undefined) break;
    byThread.delete(maisAntiga);
  }
}

/**
 * Le sem consumir.
 *
 * Uma geracao pode falhar e ser tentada de novo, e a pessoa pode pedir duas
 * variacoes da mesma foto. Apagar na primeira leitura quebraria os dois casos;
 * a imagem sai quando outra chega ou quando a conversa e descartada.
 */
export function lastImage(threadId: string): PendingImage | undefined {
  return byThread.get(threadId);
}

/** Guarda o id devolvido pelo upload, para reaproveitar no proximo pedido. */
export function rememberMediaId(threadId: string, mediaId: string): void {
  const image = byThread.get(threadId);
  if (image) image.mediaId = mediaId;
}

export function forgetImage(threadId: string): void {
  byThread.delete(threadId);
}
