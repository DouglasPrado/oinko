import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { RunnerState } from '@oinko/environments/client';
import { test, expect } from './auth';

test('requires a session and same-origin mutations for environments', async ({ page, browser }) => {
  const anonymous = await browser.newContext();
  try {
    const response = await anonymous.request.get('http://127.0.0.1:3112/api/workspaces');
    expect(response.status()).toBe(403);
  } finally {
    await anonymous.close();
  }
  expect(
    (
      await page.request.post('/api/workspaces', {
        headers: { origin: 'https://untrusted.example' },
        data: { action: 'state' },
      })
    ).status(),
  ).toBe(403);
});

test('configures projects, runs worktrees and opens real previews on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.skip(process.env.OINKO_DOCKER_TEST !== '1', 'Requires local Docker');
  test.setTimeout(300_000);
  const source = join(process.env.OINKO_E2E_ROOT!, 'fixture-monorepo');
  mkdirSync(join(source, 'apps/web'), { recursive: true });
  mkdirSync(join(source, 'packages/shared'), { recursive: true });
  writeFileSync(join(source, 'packages/shared/message.txt'), 'worktree-preview');
  writeFileSync(
    join(source, 'apps/web/server.cjs'),
    "console.log(process.env.ALPHA);require('node:http').createServer((req,res)=>res.end(require('node:fs').readFileSync('packages/shared/message.txt'))).listen(3000,'0.0.0.0')",
  );
  writeFileSync(
    join(source, 'Dockerfile'),
    'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node","apps/web/server.cjs"]\n',
  );
  const git = (args: string[]) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git(['init', '-b', 'main']);
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'fixture']);
  const state = async () =>
    (await (await page.request.get('/api/workspaces')).json()) as RunnerState;

  await page.goto('/bots');
  await page.getByRole('button', { name: 'Novo bot', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Programadora E2E');
  await page.getByLabel('Modelo de IA', { exact: true }).fill('fixture-model');
  await page
    .getByLabel('Instruções', { exact: true })
    .fill('Trabalhe somente nos projetos autorizados.');
  await page.getByLabel('Trabalhar com código em ambientes Docker', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar bot', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Programadora E2E', exact: true })).toBeVisible();

  await page.goto('/projetos');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  await page.getByLabel('Nome do projeto', { exact: true }).fill('Base E2E');
  await page.getByLabel('Origem Git 1', { exact: true }).fill(source);
  await page.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
  await page.getByRole('button', { name: 'Novo ambiente', exact: true }).click();
  await page.getByLabel('Nome do ambiente', { exact: true }).fill('Ambiente E2E');
  await page.getByRole('button', { name: 'Adicionar serviço', exact: true }).click();
  await page.getByLabel('ID do serviço 1', { exact: true }).fill('web');
  await page.getByLabel('Método de build 1', { exact: true }).selectOption('dockerfile');
  await page.getByLabel('Disponibilizar serviço 1 no navegador', { exact: true }).check();
  await page.getByLabel('Segredos usados 1', { exact: true }).pressSequentially('ALPHA, BETA');
  for (const name of ['ALPHA', 'BETA']) {
    await page.getByLabel('Nome do novo segredo', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Adicionar segredo', exact: true }).click();
    await page.getByLabel(name, { exact: true }).fill(`e2e-private-${name}`);
  }
  await page.getByRole('button', { name: 'Salvar ambiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambiente E2E', exact: true })).toBeVisible();
  const initial = await state();
  const environmentId = initial.environments.find((env) => env.name === 'Ambiente E2E')!.id;
  expect(
    initial.environments.find((env) => env.id === environmentId)?.services[0]?.secrets,
  ).toEqual(['ALPHA', 'BETA']);
  expect(JSON.stringify(initial)).not.toContain('e2e-private-');
  await page.getByRole('button', { name: 'Configurar', exact: true }).click();
  await page.getByLabel('CPUs por container', { exact: true }).fill('1.5');
  await expect(page.getByLabel('ALPHA', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Salvar ambiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambiente E2E', exact: true })).toBeVisible();
  expect((await state()).environments.find((env) => env.id === environmentId)?.cpus).toBe(1.5);
  await page.getByRole('button', { name: 'Ações do projeto' }).click();
  await page.getByRole('menuitem', { name: 'Acesso às prévias' }).click();
  await page.getByLabel('Porta do Traefik', { exact: true }).fill('3190');
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
  await page.keyboard.press('Escape');

  for (const viewport of [
    { name: 'desktop', width: 1365, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/projetos');
    await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
    await page.getByLabel('Nome do projeto', { exact: true }).fill(`Projeto ${viewport.name}`);
    await page.getByLabel('Origem Git 1', { exact: true }).fill(source);
    await page.getByLabel('Programadora E2E', { exact: true }).check();
    await page.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `Projeto ${viewport.name}`, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Configurar', exact: true }).click();
    await expect(page.getByLabel('Programadora E2E', { exact: true })).toBeChecked();
    await page.getByLabel('Referência inicial 1', { exact: true }).fill('main');
    await page.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `Projeto ${viewport.name}`, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Novo ambiente', exact: true }).click();
    await page.getByRole('button', { name: 'Reutilizar configuração existente' }).click();
    await page.getByLabel('Ambiente existente').selectOption(environmentId);
    await page.getByRole('button', { name: 'Vincular ambiente' }).click();
    await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
    await page.getByLabel('Nome da tarefa', { exact: true }).fill(`Tarefa ${viewport.name}`);
    await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
    const card = page
      .locator('[data-slot=card]')
      .filter({ has: page.getByRole('heading', { name: `Tarefa ${viewport.name}`, exact: true }) });
    await expect(card.getByRole('button', { name: 'Subir prévia', exact: true })).toBeEnabled({
      timeout: 60_000,
    });
    await card.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page
      .getByLabel('Comando no sandbox', { exact: true })
      .fill(
        `printf '${viewport.name}-preview' > packages/shared/message.txt && git status --short`,
      );
    await page.getByRole('button', { name: 'Executar comando', exact: true }).click();
    await expect(page.getByText('Código de saída: 0', { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Subir prévia', exact: true }).click();
    const link = card.getByRole('link', { name: 'Abrir web ↗', exact: true });
    await expect(link).toBeVisible({ timeout: 120_000 });
    await page.screenshot({
      path: testInfo.outputPath(`projects-${viewport.name}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const [preview] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await expect(preview.locator('body')).toHaveText(`${viewport.name}-preview`, {
      timeout: 15_000,
    });
    await preview.close();
    await card.getByRole('button', { name: 'Logs dos serviços', exact: true }).click();
    await expect(page.getByText('[redacted]', { exact: false })).toBeVisible();
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Parar prévia', exact: true }).click();
    await expect(card.getByText('Parado', { exact: true })).toBeVisible({ timeout: 30_000 });
  }
});
