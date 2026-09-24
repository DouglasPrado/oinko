import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './auth';

interface Seed {
  completed: string;
  mobile: string;
  queued: string;
  delivered: string;
  uncertain: string;
}
const seed = () => JSON.parse(readFileSync(join(process.env.OINKO_E2E_ROOT!, 'programming-seed.json'), 'utf8')) as Seed;

test('shows runs as a bot → project → task tree', async ({ page }) => {
  await page.goto('/trabalhos');
  const tree = page.getByRole('region', { name: 'Árvore de trabalhos' });
  await expect(tree.getByRole('link', { name: 'alpha', exact: true })).toBeVisible();
  await expect(tree.getByText('interno', { exact: true })).toBeVisible();
  await expect(tree.getByText('vitrine', { exact: true })).toBeVisible();
  await expect(tree.getByText(/carrinho:/).first()).toBeVisible();
});

test('explains why a run is stuck and points to the operation with an unknown outcome', async ({ page }) => {
  const { uncertain } = seed();
  await page.goto(`/bots/alpha/trabalhos/${uncertain}`);
  await expect(page.getByText('Bloqueado: no_progress')).toBeVisible();
  await expect(page.getByText('Operações com resultado incerto')).toBeVisible();
  const operation = page.getByRole('list', { name: 'Operações' }).getByRole('listitem').filter({ hasText: 'workspace.exec' });
  await expect(operation).toContainText('uncertain');
  // The run explanation used by channels and MCP names the same operation.
  const explain = (await (await page.request.get(`/api/runs/${uncertain}`)).json()) as { uncertain: string[] };
  expect(explain.uncertain).toHaveLength(1);
});

test('updates a run page live when it changes elsewhere, without reload', async ({ page }) => {
  // A run no other spec touches: the blocked one with an uncertain operation.
  const { uncertain: queued } = seed();
  await page.goto(`/bots/alpha/trabalhos/${queued}`);
  await page.getByRole('tab', { name: 'Controle', exact: true }).click();
  const events = page.getByRole('list', { name: 'Eventos' });
  await expect(events.getByText('user_direction_received')).toHaveCount(0);
  // Another operator tab steers the same run.
  const other = await page.context().newPage();
  await other.goto(`/bots/alpha/trabalhos/${queued}`);
  await other.getByLabel('Orientação', { exact: true }).fill('Priorize os testes de integração.');
  await other.getByRole('button', { name: 'Enviar orientação' }).click();
  await expect(events.getByText('user_direction_received').first()).toBeVisible({ timeout: 10_000 });
  await other.close();
});

test('shows the worktree, time per phase and how the prompt was assembled', async ({ page }) => {
  const { delivered } = seed();
  await page.goto(`/bots/alpha/trabalhos/${delivered}`);
  await expect(page.getByRole('link', { name: 'carrinho', exact: true })).toHaveAttribute('href', '/projetos/vitrine#tarefa-carrinho');
  await expect(page.getByText(/contexto .* · modelo .* · ferramentas/)).toBeVisible();
  const context = page.getByLabel('Contexto e modelo', { exact: true });
  await expect(context.getByText('9 (escolhidas pelo Jev) · 1 expansão(ões)')).toBeVisible();
  await expect(context.getByText('6.400')).toBeVisible();
  await expect(context.getByText('history:recent')).toBeVisible();
  await expect(context.getByText('model-alpha (main)')).toBeVisible();
});

test('configures commands, browser and GitHub per project and tells installed from reachable', async ({ page }) => {
  await page.goto('/projetos/vitrine');
  await page.getByRole('button', { name: 'Configurar', exact: true }).first().click();
  const settings = page.getByRole('region', { name: 'Programação do projeto' });
  await settings.getByLabel('Comandos por pacote').fill('app:.:test = node check.cjs\napp:.:lint = pnpm lint');
  await settings.getByLabel('Origens adicionais permitidas').fill('https://docs.exemplo.com');
  await settings.getByLabel('Origens adicionais permitidas').press('Tab');
  await settings.getByLabel('Credenciais de teste (nomes)').fill('login_teste');
  await settings.getByLabel('Credenciais de teste (nomes)').press('Tab');
  await settings.getByLabel('GitHub de app').fill('acme/vitrine@develop');
  await settings.getByLabel('GitHub de app').press('Tab');
  await page.getByRole('button', { name: 'Salvar projeto' }).click();
  await expect(page.getByRole('button', { name: 'Salvar projeto' })).toBeHidden({ timeout: 15_000 });
  await page.reload();
  await page.getByRole('button', { name: 'Configurar', exact: true }).first().click();
  const reloaded = page.getByRole('region', { name: 'Programação do projeto' });
  await expect(reloaded.getByLabel('Comandos por pacote')).toHaveValue('app:.:test = node check.cjs\napp:.:lint = pnpm lint');
  await expect(reloaded.getByLabel('Origens adicionais permitidas')).toHaveValue('https://docs.exemplo.com');
  await expect(reloaded.getByLabel('Credenciais de teste (nomes)')).toHaveValue('login_teste');
  await expect(reloaded.getByLabel('GitHub de app')).toHaveValue('acme/vitrine@develop');
  // Without a GitHub App configured in this installation the check says so, never "ready".
  await reloaded.getByRole('button', { name: 'Verificar acesso' }).click();
  const access = reloaded.getByLabel('Acesso do GitHub');
  await expect(access.getByText(/GitHub App da instância ainda não foi configurada|Runner|runner/)).toBeVisible({ timeout: 20_000 });
  await expect(access.getByText('Instalada: desconhecido')).toBeVisible();
});

test('configures two new bots with different programming policies through the same service', async ({ page }) => {
  test.setTimeout(60_000);
  for (const [name, autonomy] of [
    ['Programador Piloto', 'draft_pr'],
    ['Revisor Piloto', 'analysis'],
  ] as const) {
    await page.goto('/bots');
    await page.getByRole('button', { name: 'Novo bot' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(name);
    await page.getByLabel('Instruções', { exact: true }).fill(`Você é ${name}.`);
    await page.getByLabel('Modelo de IA', { exact: true }).fill(`model-${autonomy}`);
    await page.getByLabel('Chave da API', { exact: true }).fill('fake-key-for-programming-test');
    const settings = page.getByLabel('Trabalhos de programação', { exact: true });
    await settings.getByLabel('Trabalhos de programação duráveis').check();
    await settings.getByLabel('Autonomia', { exact: true }).selectOption(autonomy);
    await page.getByRole('button', { name: 'Salvar bot' }).click();
    await expect(page.getByRole('article', { name, exact: true })).toBeVisible();
  }
  const bots = (await (await page.request.get('/api/bots')).json()) as { bots?: { id: string; name: string }[] } | { id: string; name: string }[];
  const list = Array.isArray(bots) ? bots : (bots.bots ?? []);
  const ids = Object.fromEntries(list.map((bot) => [bot.name, bot.id]));
  const policy = async (id: string) => (await (await page.request.get(`/api/programming/policy?botId=${encodeURIComponent(id)}`)).json()) as { enabled: boolean; policy: { autonomy: string } };
  expect(await policy(ids['Programador Piloto']!)).toMatchObject({ enabled: true, policy: { autonomy: 'draft_pr' } });
  expect(await policy(ids['Revisor Piloto']!)).toMatchObject({ enabled: true, policy: { autonomy: 'analysis' } });
  expect(JSON.stringify(list)).not.toContain('fake-key-for-programming-test');
});

test('goes from a live aggregate to the runs (and traces) behind it', async ({ page }) => {
  const { delivered } = seed();
  await page.goto('/bots/alpha/avaliacoes');
  const groups = page.getByRole('list', { name: 'Grupos de trabalhos reais' });
  await page.getByLabel('Agrupar por').selectOption('project');
  const vitrine = groups.getByRole('listitem').filter({ hasText: 'vitrine' });
  await expect(vitrine).toContainText('1/1 concluídos');
  await expect(vitrine).toContainText('amostra insuficiente');
  await vitrine.getByRole('link', { name: `#${delivered.slice(4, 12)}` }).click();
  await expect(page).toHaveURL(new RegExp(`/bots/alpha/trabalhos/${delivered}$`));
  await expect(page.getByText('Entregue em draft PR').first()).toBeVisible();
});

test('shows plan, diff, confirmed cost apart from pending, the model calls and the configuration version', async ({ page }) => {
  const { delivered, completed } = seed();
  await page.goto(`/bots/alpha/trabalhos/${delivered}`);
  await expect(page.getByText('Mostrar o selo de frete grátis na vitrine').first()).toBeVisible();
  // Confirmed cost is shown with its coverage; the pending call is counted, never priced as zero.
  await expect(page.getByText(/0[.,]0123/).first()).toBeVisible();
  await expect(page.getByText(/cobertura 50% · 1 pendente\(s\)/)).toBeVisible();
  await expect(page.getByText(/5\.905|5,905/).first()).toBeVisible();
  await expect(page.getByText(/política [0-9a-f]{12}/)).toBeVisible();
  const trace = page.getByRole('link', { name: 'trace-se', exact: true });
  await expect(trace).toHaveAttribute('href', /\/bots\/alpha\/telemetria\/threads\/.+\/trace-seed-vitrine$/);
  await trace.click();
  await expect(page).toHaveURL(/\/telemetria\/threads\/.+\/trace-seed-vitrine$/);
  await page.goto(`/bots/alpha/trabalhos/${completed}`);
  const evidence = page.getByRole('list', { name: 'Evidências' });
  const diff = await (await page.request.get((await evidence.getByRole('link', { name: 'diff', exact: true }).getAttribute('href'))!)).text();
  expect(diff).toContain('+  return a + b;');
});

test('shows where the effective policy comes from and that running work keeps its own', async ({ page }) => {
  await page.goto('/bots/alpha');
  await page.getByRole('button', { name: 'Configurar', exact: true }).first().click();
  const effective = page.getByLabel('Política efetiva por projeto');
  await expect(effective.getByText(/origem: bot rev\. \d+ \+ projeto rev\. \d+/).first()).toBeVisible();
  await expect(effective.getByText(/trabalhos em andamento mantêm a sua/)).toBeVisible();
});

test('operates controls and opens evidence on a phone without losing the run context', async ({ page }) => {
  const { mobile, delivered } = seed();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/bots/beta/trabalhos/${mobile}`);
  const trail = page.getByRole('navigation', { name: 'breadcrumb' });
  await expect(trail.getByRole('link', { name: 'beta', exact: true })).toBeVisible();
  await expect(trail.getByRole('link', { name: 'loja', exact: true })).toHaveAttribute('href', '/projetos/loja');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByText('Pausa registrada; o run para no próximo ponto seguro.')).toBeVisible();
  await expect(page.getByText('Na fila · pausa solicitada').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.goto(`/bots/alpha/trabalhos/${delivered}`);
  const shot = page.getByRole('list', { name: 'Evidências' }).getByRole('link', { name: 'captura de tela' });
  await expect(shot).toBeVisible();
  const response = await page.request.get((await shot.getAttribute('href'))!);
  expect(response.headers()['content-type']).toContain('image/png');
  await expect(page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link', { name: 'vitrine', exact: true })).toBeVisible();
});
