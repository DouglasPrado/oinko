import { describe, it, expect } from 'vitest';
import { createLiveAgent, hasLLM, imageDataUrl, plain, solidPng } from './helpers.js';
import type { ContentPart } from '../../src/index.js';

/**
 * A prova de que a imagem chega ao modelo, e nao so ao SDK.
 *
 * Todo o resto da suite multimodal roda com transporte falso: diz que o corpo
 * da requisicao tem a forma certa, nao que alguem do outro lado enxergou. Aqui
 * o modelo so acerta a cor se tiver visto o quadrado.
 */
describe.skipIf(!hasLLM)('visao: imagem chega ao modelo', () => {
  const vermelho = imageDataUrl(solidPng(64, [220, 20, 20]));
  const azul = imageDataUrl(solidPng(64, [20, 40, 220]));

  const pergunta = (url: string): ContentPart[] => [
    { type: 'text', text: 'De que cor e este quadrado? Responda com uma palavra.' },
    { type: 'image_url', image_url: { url, detail: 'low' } },
  ];

  it('le a cor de uma imagem enviada inline', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const resposta = await agent.chat(pergunta(vermelho), { threadId: 'v1' });
      expect(plain(resposta)).toMatch(/vermelh|red/);
    } finally {
      await dispose();
    }
  });

  it('distingue duas imagens diferentes, e nao responde de sorte', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      const resposta = await agent.chat(pergunta(azul), { threadId: 'v2' });
      expect(plain(resposta)).toMatch(/azul|blue/);
      expect(plain(resposta)).not.toMatch(/vermelh|red/);
    } finally {
      await dispose();
    }
  });

  /**
   * O turno seguinte nao reenvia a imagem: ela tem que ter sobrevivido ao
   * armazenamento e voltado na montagem do contexto. Sem isso a funcionalidade
   * so valeria para a mensagem em que a imagem chegou.
   */
  it('ainda enxerga a imagem no turno seguinte da mesma thread', async () => {
    const { agent, dispose } = createLiveAgent({}, { withDecider: false });
    try {
      await agent.chat(pergunta(vermelho), { threadId: 'mesma' });
      const resposta = await agent.chat(
        'Sobre aquele mesmo quadrado: repita a cor dele em uma palavra.',
        { threadId: 'mesma' },
      );
      expect(plain(resposta)).toMatch(/vermelh|red/);
    } finally {
      await dispose();
    }
  });
});
