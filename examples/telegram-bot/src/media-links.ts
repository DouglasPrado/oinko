type MediaKind = "photo" | "video";

export interface MediaLink {
  url: string;
  kind: MediaKind;
}

export interface ExtractedMedia {
  /** O texto sem os enderecos que viraram midia. */
  text: string;
  media: MediaLink[];
}

const PHOTO_EXT = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm)$/i;

/** Markdown de imagem: o Telegram nao renderiza, entao vira anexo. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>()[\]]+/g;

function kindOf(url: string): MediaKind | null {
  // A extensao mora no caminho; a query de uma URL assinada nao entra na conta.
  const path = url.split("?")[0] ?? url;
  if (PHOTO_EXT.test(path)) return "photo";
  if (VIDEO_EXT.test(path)) return "video";
  return null;
}

/**
 * Separa o que e midia do que e texto.
 *
 * O agente responde com markdown de imagem, que o Telegram entrega como texto
 * cru — quem le recebe uma URL em vez da imagem. Aqui o endereco sai do texto e
 * vira anexo de verdade; links comuns, de documentacao por exemplo, ficam onde
 * estao.
 */
export function extractMedia(text: string): ExtractedMedia {
  const media: MediaLink[] = [];
  const seen = new Set<string>();

  const remember = (url: string): boolean => {
    const kind = kindOf(url);
    if (!kind) return false;
    // A mesma imagem citada duas vezes e um anexo so.
    if (!seen.has(url)) {
      seen.add(url);
      media.push({ url, kind });
    }
    return true;
  };

  let cleaned = text.replace(MARKDOWN_IMAGE, (match, url: string) =>
    remember(url) ? "" : match,
  );

  cleaned = cleaned.replace(BARE_URL, (url) => (remember(url) ? "" : url));

  // Sobram as quebras que cercavam o endereco removido.
  cleaned = cleaned
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: cleaned, media };
}
