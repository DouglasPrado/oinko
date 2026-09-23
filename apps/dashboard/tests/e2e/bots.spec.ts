import { test, expect, PASSWORD } from './auth';
import type { BotProfile } from '@oinko/bots/schema';

test('saves open Telegram access and can restore the user restriction', async ({ page }) => {
  await page.goto('/bots');
  await page.getByRole('button', { name: 'Novo bot' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Acesso Telegram');
  await page.getByLabel('Instruções', { exact: true }).fill('Ajude a pessoa.');
  await page.getByLabel('Modelo de IA', { exact: true }).fill('test-model');
  await page.getByRole('checkbox', { name: 'Telegram', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Permitir qualquer usuário em conversas privadas' })
    .check();
  await expect(page.getByLabel('Usuários autorizados', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Salvar bot' }).click();
  const card = page.getByRole('article', { name: 'Acesso Telegram' });
  await expect(card).toBeVisible();
  let bots = (await (await page.request.get('/api/bots')).json()) as BotProfile[];
  expect(
    bots.find((bot: { id: string }) => bot.id === 'acesso-telegram')!.telegram.allowAllPrivateChats,
  ).toBe(true);
  await card.getByRole('button', { name: 'Configurar' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Permitir qualquer usuário em conversas privadas' }),
  ).toBeChecked();
  await page
    .getByRole('checkbox', { name: 'Permitir qualquer usuário em conversas privadas' })
    .uncheck();
  await page.getByLabel('Usuários autorizados', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Salvar bot' }).click();
  await expect(card).toBeVisible();
  bots = (await (await page.request.get('/api/bots')).json()) as BotProfile[];
  expect(bots.find((bot: { id: string }) => bot.id === 'acesso-telegram')!.telegram).toMatchObject({
    allowAllPrivateChats: false,
    allowedUserIds: ['42'],
  });
});

test('logs out and signs in again through the password form', async ({ page }) => {
  await page.goto('/bots');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/bots')).status()).toBe(403);
  await page.getByLabel('Senha', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Senha incorreta.' })).toBeVisible();
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/bots$/);
});

test('creates a bot, preserves secrets on edit and controls the shared executor', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(45_000);
  await page.goto('/bots');
  await page.getByRole('button', { name: 'Novo bot' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Suporte de teste');
  await page
    .getByLabel('Instruções', { exact: true })
    .fill('Ajude a pessoa com perguntas sobre o produto.');
  await page.getByLabel('Modelo de IA', { exact: true }).fill('test-model');
  await page.getByLabel('Chave da API', { exact: true }).fill('fake-key-for-browser-test');
  await page.screenshot({ path: test.info().outputPath('bot-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Salvar bot' }).click();
  const card = page.getByRole('article', { name: 'Suporte de teste' });
  try {
    await expect(card.getByText('Parado', { exact: true })).toBeVisible();
    const data = await (await page.request.get('/api/bots')).text();
    expect(data).not.toContain('fake-key-for-browser-test');
    await card.getByRole('button', { name: 'Iniciar', exact: true }).click();
    await expect(card.getByText('Em execução', { exact: true })).toBeVisible();
    await expect(card.getByText('CLI · conectado')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('bots-overview.png'), fullPage: true });
    await card.getByRole('button', { name: 'Configurar' }).click();
    await expect(page.getByLabel('Chave da API', { exact: true })).toHaveValue('');
    await page
      .getByLabel('Instruções', { exact: true })
      .fill('Instruções atualizadas e persistentes.');
    await page.getByRole('button', { name: 'Salvar bot' }).click();
    await expect(card.getByText(/Há alterações salvas/)).toBeVisible();
    await card.getByRole('button', { name: 'Reiniciar' }).click();
    await expect(card.getByText(/Há alterações salvas/)).toHaveCount(0);
    await page.reload();
    await expect(card.getByText('Instruções atualizadas e persistentes.')).toBeVisible();
    await card.getByRole('button', { name: 'Parar', exact: true }).click();
    await expect(card.getByText('Parado', { exact: true })).toBeVisible();
  } finally {
    await page.request
      .post('/api/bots/suporte-de-teste/stop', {
        headers: { origin: baseURL! },
        data: {},
        timeout: 1500,
      })
      .catch(() => undefined);
  }
});

test('requires login and rejects cross-origin bot mutations', async ({
  page,
  baseURL,
  playwright,
}) => {
  const outsider = await playwright.request.newContext({ baseURL });
  try {
    expect((await outsider.get('/api/bots')).status()).toBe(403);
    expect((await outsider.get('/api/stream')).status()).toBe(401);
    expect((await outsider.get('/api/payloads/unknown')).status()).toBe(401);
    expect(
      (
        await page.request.post('/api/bots', {
          headers: { origin: 'https://untrusted.example' },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const response = await outsider.get('/bots');
    expect(response.url()).toContain('/login');
  } finally {
    await outsider.dispose();
  }
});
