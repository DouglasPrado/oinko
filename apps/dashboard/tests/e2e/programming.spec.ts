import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './auth';

interface Seed {
  completed: string;
  delivered: string;
  blocked: string;
  running: string;
  queued: string;
}
const seed = () =>
  JSON.parse(readFileSync(join(process.env.OINKO_E2E_ROOT!, 'programming-seed.json'), 'utf8')) as Seed;
const short = (id: string) => `#${id.slice(4, 12)}`;

test('lists the queue per bot and never shows another bot’s run by guessed id', async ({ page }) => {
  const { completed, queued } = seed();
  await page.goto('/trabalhos');
  await expect(page.getByRole('heading', { name: 'Trabalhos', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Todos', exact: true }).click();
  const list = page.getByRole('list', { name: 'Lista de trabalhos' });
  await expect(list.getByRole('link')).toHaveCount(5);
  await page.goto('/bots/beta/trabalhos');
  await page.getByRole('tab', { name: 'Todos', exact: true }).click();
  await expect(list.getByText('Analisar a cobertura de testes')).toBeVisible();
  await expect(list.getByText('Corrigir o total do carrinho com desconto')).toHaveCount(0);
  await expect(list.getByText(short(queued))).toBeVisible();
  await page.goto(`/bots/beta/trabalhos/${completed}`);
  await expect(page.getByText('Trabalho não encontrado', { exact: true })).toBeVisible();
});

test('explains a completed run with criteria, delivery level, evidence and a timeline', async ({ page }) => {
  const { completed } = seed();
  await page.goto(`/bots/alpha/trabalhos/${completed}`);
  const trail = page.getByRole('navigation', { name: 'breadcrumb' });
  await expect(trail.getByRole('link', { name: 'alpha', exact: true })).toBeVisible();
  await expect(trail.getByText(short(completed))).toBeVisible();
  await expect(page.getByText('Concluído tecnicamente')).toBeVisible();
  const criteria = page.getByRole('list', { name: 'Critérios' });
  await expect(criteria.getByText('atendido')).toHaveCount(2);
  const delivery = page.getByRole('region', { name: 'Entrega' });
  await expect(delivery.getByText('Publicado em draft PR')).toBeVisible();
  await expect(delivery.getByText('Aceito pelo usuário')).toBeVisible();
  const events = page.getByRole('list', { name: 'Eventos' });
  await expect(events.getByText('run_completed')).toBeVisible();
  await page.getByRole('tab', { name: 'Controle', exact: true }).click();
  await expect(events.getByText('acceptance_evaluated')).toBeVisible();
  await expect(events.getByText('run_created')).toHaveCount(0);
  // Evidence opens through the authorized route, already redacted.
  const evidence = page.getByRole('list', { name: 'Evidências' });
  const link = evidence.getByRole('link', { name: 'log', exact: true });
  const href = await link.getAttribute('href');
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const body = await response.text();
  expect(body).toContain('PASS cart.test.ts');
  expect(body).not.toContain('sk-seed-0123456789abcdef');
});

test('shows a draft PR with its CI state, the functional check revision and the screenshot', async ({ page }) => {
  const { delivered } = seed();
  await page.goto(`/bots/alpha/trabalhos/${delivered}`);
  await expect(page.getByText('Entregue em draft PR').first()).toBeVisible();
  const criteria = page.getByRole('list', { name: 'Critérios' });
  const flow = criteria.getByRole('listitem').filter({ hasText: 'Vitrine mostra o selo de frete grátis no celular' });
  await expect(flow.getByText('atendido')).toBeVisible();
  await expect(flow.getByText('rev 7')).toBeVisible();
  // Published while CI still runs: never labeled as fully validated.
  await expect(page.getByRole('link', { name: 'app · draft #12' })).toHaveAttribute('href', 'https://github.com/acme/vitrine/pull/12');
  await expect(page.getByText('CI em andamento · não validado integralmente')).toBeVisible();
  const evidence = page.getByRole('list', { name: 'Evidências' });
  const shot = evidence.getByRole('link', { name: 'captura de tela' });
  const response = await page.request.get((await shot.getAttribute('href'))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/png');
  await expect(evidence.getByRole('link', { name: 'relatório' })).toBeVisible();
});

test('shows why a run is blocked and requires a note to resume it', async ({ page }) => {
  const { blocked } = seed();
  await page.goto(`/bots/alpha/trabalhos/${blocked}`);
  await expect(page.getByText('Bloqueado: no_progress')).toBeVisible();
  await expect(page.getByText(/Cannot find module/).first()).toBeVisible();
  const resume = page.getByRole('button', { name: 'Retomar', exact: true });
  await expect(resume).toBeDisabled();
  await page.getByLabel('Como o bloqueio foi resolvido').fill('Dependência instalada no ambiente.');
  await resume.click();
  await expect(page.getByText('Run de volta à fila.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Na fila').first()).toBeVisible();
});

test('distinguishes a requested pause from a paused run and keeps it across reloads', async ({ page }) => {
  const { running, queued } = seed();
  await page.goto(`/bots/alpha/trabalhos/${running}`);
  await expect(page.getByText('Em execução · pausa solicitada').first()).toBeVisible();
  await expect(page.getByText('Pausado', { exact: true })).toHaveCount(0);
  await page.goto(`/bots/beta/trabalhos/${queued}`);
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByText('Pausa registrada; o run para no próximo ponto seguro.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Na fila · pausa solicitada').first()).toBeVisible();
  await page.getByLabel('Orientação').fill('Priorize os módulos de pagamento.');
  await page.getByRole('button', { name: 'Enviar orientação', exact: true }).click();
  await expect(page.getByText('Orientação registrada no plano do run.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Eventos' }).getByText('user_direction_received')).toBeVisible();
});

test('operates a run on a mobile viewport without horizontal overflow', async ({ page }) => {
  const { running } = seed();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/bots/alpha/trabalhos/${running}`);
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('region', { name: 'Critérios' })).toBeVisible();
});

test('refuses anonymous access to runs and evidence', async ({ browser }) => {
  const { completed } = seed();
  const anonymous = await browser.newContext();
  try {
    expect((await anonymous.request.get('http://127.0.0.1:3112/api/runs')).status()).toBe(403);
    expect((await anonymous.request.get(`http://127.0.0.1:3112/api/runs/${completed}`)).status()).toBe(403);
    expect((await anonymous.request.get('http://127.0.0.1:3112/api/artifacts/art-x')).status()).toBe(403);
  } finally {
    await anonymous.close();
  }
});

test('configures a durable programming policy per bot and shows the effective policy', async ({ page }) => {
  await page.goto('/bots/beta');
  await page.getByRole('button', { name: 'Configurar', exact: true }).first().click();
  await expect(page.getByText('Trabalhos de programação duráveis')).toBeVisible();
  await expect(page.getByText('Não há teto de gasto', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Política efetiva por projeto')).toContainText('loja');
  await expect(page.getByLabel('Autonomia', { exact: true })).toHaveValue('edit');
});
