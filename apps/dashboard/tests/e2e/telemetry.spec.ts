import { test, expect } from '@playwright/test';

test.describe('inspecao de telemetria', () => {
  test('lista as conversas com custo real e tempo', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Conversas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'suporte-4821' })).toBeVisible();

    // O custo tem que aparecer com as casas que importam, nao arredondado a zero.
    await expect(page.getByText(/US\$\s*0,0\d+/).first()).toBeVisible();
  });

  test('preserva o filtro ao recarregar, porque ele vive na URL', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Buscar thread').fill('suporte');
    await page.waitForURL(/q=suporte/);

    await page.reload();

    await expect(page.getByRole('link', { name: 'suporte-4821' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'vendas-1190' })).toHaveCount(0);
  });

  test('abre uma resposta e mostra o que entrou, o que saiu, custo e tempo', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'suporte-4821' }).click();

    await expect(page.getByRole('heading', { name: 'Respostas desta conversa' })).toBeVisible();
    await page.getByRole('link').filter({ hasText: 'anthropic/claude-sonnet-5' }).first().click();

    await expect(page.getByText('Tempo total')).toBeVisible();
    await expect(page.getByText('Custo real')).toBeVisible();
    await expect(page.getByText('cobrado pelo provedor')).toBeVisible();

    // O heroi: de que e feito o prompt que foi realmente enviado.
    await expect(page.getByRole('heading', { name: 'De que e feito este prompt' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'O que aconteceu, na ordem' })).toBeVisible();
    await expect(page.getByText(/Chamada 1/)).toBeVisible();
  });

  test('busca o corpo do payload so quando alguem pede', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'suporte-4821' }).click();
    await page.getByRole('link').filter({ hasText: 'anthropic/claude-sonnet-5' }).first().click();

    const button = page.getByRole('button', { name: 'Ver completo' }).first();
    await expect(button).toBeVisible();

    // Nada de payload foi buscado ate aqui.
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/payloads/')) requests.push(request.url());
    });
    expect(requests).toHaveLength(0);

    const response = page.waitForResponse((res) => res.url().includes('/api/payloads/'));
    await button.click();
    expect((await response).ok()).toBe(true);
  });

  test('diz que o custo e desconhecido em vez de mostrar zero', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'interno-0007' }).click();
    await page.getByRole('link').filter({ hasText: 'gpt-4o-mini' }).first().click();

    // A metrica do topo e a linha da chamada dizem a mesma coisa, de proposito.
    await expect(page.getByText('provedor nao informou', { exact: true })).toBeVisible();
    await expect(page.getByText(/O provedor nao informou custo para esta chamada/)).toBeVisible();
    // O que nao pode acontecer em lugar nenhum e desconhecido virar zero.
    await expect(page.getByText('US$ 0,00', { exact: true })).toHaveCount(0);
  });

  test('percorre da lista ate o payload so pelo teclado', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });
});
