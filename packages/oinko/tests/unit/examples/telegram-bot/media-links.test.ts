import { describe, it, expect } from 'vitest';
import { extractMedia } from '../../../../../../examples/telegram-bot/src/media-links.js';

const PNG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3GJ/hf_20260922_191540_9fbbdb44.png';
const MP4 = 'https://cdn.exemplo.test/gerado/clipe.mp4';

describe('extractMedia', () => {
  // O Telegram nao renderiza markdown de imagem: quem le recebe a URL crua.
  it('pulls the image out of a markdown embed and drops the embed', () => {
    const { text, media } = extractMedia(
      `Aqui esta a capa:\n\n![Nova Capa](${PNG})\n\nSe precisar, avise.`,
    );

    expect(media).toEqual([{ url: PNG, kind: 'photo' }]);
    expect(text).not.toContain(PNG);
    expect(text).not.toContain('![');
    expect(text).toContain('Aqui esta a capa:');
    expect(text).toContain('Se precisar, avise.');
  });

  it('pulls a bare URL too, which is how some answers come', () => {
    const { text, media } = extractMedia(`Pronto: ${PNG}`);

    expect(media).toEqual([{ url: PNG, kind: 'photo' }]);
    expect(text.trim()).toBe('Pronto:');
  });

  it('tells video apart from image, because they are sent differently', () => {
    const { media } = extractMedia(`imagem ${PNG} e video ${MP4}`);

    expect(media).toEqual([
      { url: PNG, kind: 'photo' },
      { url: MP4, kind: 'video' },
    ]);
  });

  it('sends the same file once, even if the answer repeats it', () => {
    const { media } = extractMedia(`![a](${PNG}) e de novo ${PNG}`);
    expect(media).toHaveLength(1);
  });

  it('leaves ordinary links alone', () => {
    const text = 'Veja a documentacao em https://exemplo.test/docs e o painel em http://localhost:3111/';
    const result = extractMedia(text);

    expect(result.media).toEqual([]);
    expect(result.text).toBe(text);
  });

  it('keeps a query string, which signed URLs need', () => {
    const signed = `${PNG}?Expires=123&Signature=abc`;
    const { media } = extractMedia(`resultado: ${signed}`);

    // Cortar a query invalidaria a assinatura e o Telegram receberia 403.
    expect(media[0]?.url).toBe(signed);
  });

  it('leaves text with no media untouched', () => {
    const { text, media } = extractMedia('Nenhuma imagem por aqui.');
    expect(media).toEqual([]);
    expect(text).toBe('Nenhuma imagem por aqui.');
  });

  it('does not leave an empty caption when the answer was only the link', () => {
    const { text, media } = extractMedia(`![capa](${PNG})`);
    expect(media).toHaveLength(1);
    expect(text).toBe('');
  });
});
