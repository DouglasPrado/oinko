import { test, expect } from './auth';

test('keeps the sidebar and current section across all dashboard pages', async ({ page }) => {
  await page.goto('/bots');
  const navigation = page.getByRole('navigation', { name: 'Principal' });
  for (const [label, path] of [
    ['Projetos', '/projetos'],
    ['Integrações', '/integracoes'],
    ['Bots', '/bots'],
  ]) {
    await navigation.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(path!);
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link')).toHaveCount(3);
    await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toHaveCount(1);
  }
});

test('provides navigation and conversations in the mobile menu without overflowing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/telemetria');
  const navigation = page.getByRole('navigation', { name: 'Principal' });
  const conversations = page.getByRole('navigation', { name: 'Conversas' });
  await expect(navigation).toBeHidden();
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await expect(navigation).toBeVisible();
  await conversations.getByRole('link', { name: /suporte-4821/ }).click();
  await page.waitForURL(/\/threads\/suporte-4821\/[0-9a-f-]+/);
  await expect(navigation).toBeHidden();
  await page.getByRole('button', { name: 'Abrir menu' }).click();

  await expect(conversations.locator('[aria-current="page"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused();
  await expect(navigation).toBeHidden();
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await navigation.getByRole('link', { name: 'Projetos', exact: true }).click();
  await expect(page).toHaveURL('/projetos');
  await expect(navigation).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Conversas' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
