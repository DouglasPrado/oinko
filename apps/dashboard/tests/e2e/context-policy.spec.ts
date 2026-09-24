import { test, expect } from './auth';
import { z } from 'zod';

const bots = z.array(
  z.object({ id: z.string(), context: z.record(z.string(), z.unknown()).optional() }),
);

test('edits context budgets and tool selection, preserving them after reload', async ({ page }) => {
  await page.goto('/bots');
  await page.getByRole('button', { name: 'Novo bot' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Contexto de teste');
  await page.getByLabel('Instruções', { exact: true }).fill('Ajude com projetos.');
  await page.getByLabel('Modelo de IA', { exact: true }).fill('test-model');
  await page.getByRole('checkbox', { name: 'Otimizar contexto', exact: true }).check();
  await page.getByLabel('Orçamento de contexto', { exact: true }).fill('16000');
  await page.getByLabel('Orçamento fast', { exact: true }).fill('6000');
  await page.getByRole('button', { name: 'Salvar bot' }).click();
  const data = bots.parse(await (await page.request.get('/api/bots')).json());
  expect(data.find((b) => b.id === 'contexto-de-teste')?.context).toMatchObject({
    enabled: true,
    maxInputTokens: 16000,
    fastInputTokens: 6000,
  });
  await page.reload();
  await page
    .getByRole('article', { name: 'Contexto de teste' })
    .getByRole('button', { name: 'Configurar' })
    .click();
  await expect(page.getByLabel('Orçamento de contexto', { exact: true })).toHaveValue('16000');
  await expect(page.getByLabel('Orçamento fast', { exact: true })).toHaveValue('6000');
  await page
    .getByRole('checkbox', { name: 'Selecionar ferramentas com Jev', exact: true })
    .uncheck();
  await page.getByRole('button', { name: 'Salvar bot' }).click();
  const saved = bots.parse(await (await page.request.get('/api/bots')).json());
  expect(saved.find((b) => b.id === 'contexto-de-teste')?.context?.selectTools).toBe(false);
});
