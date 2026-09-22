import { describe, it, expect } from 'vitest';
import { createLiveAgent, hasLLM, plain, speak } from './helpers.js';

/**
 * A prova de que o audio vira texto de verdade.
 *
 * A fala e sintetizada na hora com uma frase conhecida, entao a asserçao e
 * sobre o conteudo que voltou, nao sobre a forma da requisicao — e nenhum
 * binario precisa morar no repositorio.
 */
describe.skipIf(!hasLLM)('audio: fala vira texto', () => {
  /**
   * Com acentuacao correta de proposito: sintetizar "O ceu" sem acento faz o
   * TTS pronunciar outra palavra, e a transcricao devolve fielmente o que foi
   * falado. O teste mediria a minha digitacao, nao o transcritor.
   */
  const FRASE = 'O céu está azul hoje.';

  it('transcreve o que foi falado', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const mp3 = await speak(FRASE);
      const texto = await agent.transcribe(mp3, 'fala.mp3', { language: 'pt' });

      expect(plain(texto)).toContain('azul');
      expect(plain(texto)).toContain('ceu');
    } finally {
      await dispose();
    }
  });

  /**
   * O formato que chega de verdade.
   *
   * Nota de voz do Telegram e sempre OGG/Opus, e o e2e acima usa mp3 — provar
   * so o mp3 deixaria de fora justamente o caminho do bot. O nome do arquivo e
   * o que decide: os mesmos bytes como `.opus` sao recusados, como `.ogg`
   * transcrevem.
   */
  it('transcreve OGG/Opus, que e o que uma nota de voz e', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const ogg = await speak(FRASE, 'opus');
      const texto = await agent.transcribe(ogg, 'voz.ogg', { language: 'pt' });

      expect(plain(texto)).toContain('azul');
    } finally {
      await dispose();
    }
  });

  /**
   * O ciclo que o bot de verdade faz: ouvir, transcrever e responder sobre o
   * que foi dito. Transcrever sem conseguir usar o texto no turno seguinte
   * seria meia funcionalidade.
   */
  it('responde sobre o que foi dito no audio', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const mp3 = await speak('Meu número favorito é quarenta e dois.');
      const texto = await agent.transcribe(mp3, 'fala.mp3', { language: 'pt' });

      await agent.chat(texto, { threadId: 'audio' });
      const resposta = await agent.chat('Qual e o meu numero favorito? Responda so o numero.', {
        threadId: 'audio',
      });

      expect(resposta.replace(/[.,\s]/g, '')).toContain('42');
    } finally {
      await dispose();
    }
  });
});
