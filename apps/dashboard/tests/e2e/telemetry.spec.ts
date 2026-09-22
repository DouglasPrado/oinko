import { test, expect } from './auth';

test.describe('inspecao de telemetria', () => {
  test('lista as conversas com custo real e tempo', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'suporte-4821' }).first()).toBeVisible();
    // O custo aparece com as casas que importam, nao arredondado a zero.
    await expect(page.getByText(/US\$\s*0,0\d+/).first()).toBeVisible();
  });

  test('preserva o filtro ao recarregar, porque ele vive na URL', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Buscar thread').fill('suporte');
    await page.waitForURL(/q=suporte/);

    await page.reload();

    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'suporte-4821' })).toBeVisible();
    await expect(table.getByRole('link', { name: 'vendas-1190' })).toHaveCount(0);
  });

  test('abre a resposta mais recente da conversa direto', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();

    // Sem tela intermediaria: a lista de respostas ja vive na barra lateral.
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);
    await expect(page.getByText('Tempo total')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'De que e feito este prompt' })).toBeVisible();
  });

  test('mostra o turno e a fita do que aconteceu', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);

    await expect(page.getByText('Pessoa')).toBeVisible();
    await expect(page.getByText('Agente', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /chamada 1/ })).toBeVisible();
  });

  test('abre a etapa no inspetor sem trocar de pagina', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);

    const before = new URL(page.url()).pathname;
    await page.getByRole('link', { name: /chamada 1/ }).click();
    await page.waitForURL(/item=/);

    // Mesma rota, so o parametro muda: e isso que preserva o contexto.
    expect(new URL(page.url()).pathname).toBe(before);
    await expect(page.getByRole('heading', { name: 'Etapa selecionada' })).toBeVisible();
    await expect(page.getByText('Ate o primeiro token')).toBeVisible();
  });

  test('busca o corpo do payload so quando alguem pede', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);
    await page.getByRole('link', { name: /chamada 1/ }).click();

    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/payloads/')) requests.push(request.url());
    });

    const button = page.getByRole('button', { name: 'Ver completo' }).first();
    await expect(button).toBeVisible();
    expect(requests).toHaveLength(0);

    const response = page.waitForResponse((res) => res.url().includes('/api/payloads/'));
    await button.click();
    expect((await response).ok()).toBe(true);
  });

  test('le o prompt como conversa, nao como JSON escapado', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);
    await page.getByRole('link', { name: /chamada 1/ }).click();
    await page.getByRole('button', { name: 'Ver completo' }).first().click();

    const modes = page.getByRole('group', { name: 'Como ler o conteudo' }).first();
    await expect(modes.getByRole('button', { name: 'Conversa' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await modes.getByRole('button', { name: 'JSON' }).click();
    await expect(modes.getByRole('button', { name: 'JSON' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Linha numerada e bloco que dobra: e assim que se confere a forma do que
    // foi enviado.
    const fold = page.getByRole('button', { name: 'Recolher bloco' }).first();
    await expect(fold).toBeVisible();
    await fold.click();
    await expect(page.getByRole('button', { name: 'Expandir bloco' }).first()).toBeVisible();
  });

  test('diz que o custo e desconhecido em vez de mostrar zero', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('interno-0007').click();
    await page.waitForURL(/\/threads\/interno-0007\/[0-9a-f-]+/);

    await expect(page.getByText('Custo nao informado')).toBeVisible();
    // O que nao pode acontecer em lugar nenhum e desconhecido virar zero.
    await expect(page.getByText('US$ 0,00', { exact: true })).toHaveCount(0);
  });

  test('ajusta a largura do inspetor e lembra a escolha', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);

    const handle = page.getByRole('separator', { name: 'Largura do painel' });
    const before = Number(await handle.getAttribute('aria-valuenow'));

    // Pelo teclado, que e deterministico — e o unico caminho para quem nao usa
    // mouse.
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    const after = Number(await handle.getAttribute('aria-valuenow'));
    expect(after).toBeGreaterThan(before);

    // A medida e preferencia de quem olha: sobrevive ao recarregamento.
    await page.reload();
    await expect(handle).toHaveAttribute('aria-valuenow', String(after));
  });

  test('diz quais ferramentas existiam e quais foram chamadas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Conversas' }).getByText('suporte-4821').click();
    await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);

    // A ferramenta registrada aparece mesmo quando o turno nao a chamou.
    const tools = page.getByRole('region', { name: 'Ferramentas disponiveis' });
    await expect(tools.getByText('buscar_pedido')).toBeVisible();
    await expect(tools).toContainText('nenhuma foi chamada neste turno');

    // O turno que de fato chamou: a chamada aparece na fita, com origem e tempo.
    const rail = page.getByRole('navigation', { name: 'Conversas' });
    await rail
      .getByRole('link')
      .filter({ hasText: /\d{2}\/\d{2}/ })
      .last()
      .click();
    await expect(page.getByRole('link', { name: /buscar_pedido/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ferramentas disponiveis' })).not.toContainText(
      'nenhuma foi chamada',
    );
  });

  test('acompanha o agente em tempo real', async ({ page }) => {
    await page.goto('/');

    // Sem este aviso, tela parada e ambigua: nao da para distinguir "nada
    // aconteceu" de "parei de receber".
    await expect(page.getByRole('status')).toContainText(/ao vivo|conectando/);
  });

  test('percorre a interface pelo teclado', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    await expect(page.locator(':focus')).toBeVisible();
  });
});
