import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { RunnerState } from '@oinko/environments/client';
import { test, expect } from './auth';

for (const viewport of [
  { name: 'desktop', width: 1365, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`recovers real Git/build failures and finishes after closing the page on ${viewport.name}`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    test.skip(process.env.OINKO_DOCKER_TEST !== '1', 'Requires local Docker');
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const id = `recovery-${viewport.name}`;
    const source = join(process.env.OINKO_E2E_ROOT!, id);
    const command = async (data: unknown) => {
      const result = await page.request.post('/api/workspaces', {
        headers: { origin: baseURL! },
        data,
      });
      expect(result.ok(), await result.text()).toBe(true);
      return result.json() as Promise<unknown>;
    };
    await command({
      action: 'saveEnvironment',
      definition: {
        id,
        name: id,
        services: [{ id: 'worker', repositoryId: 'app', builder: 'dockerfile' }],
      },
      revision: 0,
    });
    await command({
      action: 'saveProject',
      definition: { id, name: id, environmentId: id, repositories: [{ id: 'app', source }] },
      revision: 0,
    });
    const url = `/projetos/${id}/ambientes/${id}`;
    await page.goto(url);
    await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
    await page.getByLabel('Nome da tarefa', { exact: true }).fill('Recuperação');
    await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
    const card = page
      .locator('[data-slot=card]')
      .filter({ has: page.getByRole('heading', { name: 'Recuperação', exact: true }) });
    await expect(card.getByRole('alert')).toContainText(/does not exist|not exist|não existe/, {
      timeout: 30_000,
    });
    await expect(card.getByRole('button', { name: 'Terminal', exact: true })).toBeDisabled();
    mkdirSync(source);
    writeFileSync(join(source, 'Dockerfile'), 'FROM node:22-alpine\nRUN exit 17\n');
    const git = (args: string[]) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'main']);
    git(['add', '.']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'fixture']);
    await card.getByRole('button', { name: 'Tentar preparar novamente', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Subir prévia', exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    await card.getByRole('button', { name: 'Subir prévia', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText(/17|failed/, { timeout: 60_000 });
    await expect(card.getByRole('link', { name: /Abrir/ })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`real-build-failure-${viewport.name}.png`),
      fullPage: true,
    });
    await card.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page
      .getByLabel('Comando no sandbox', { exact: true })
      .fill(
        'cat > Dockerfile <<\'EOF\'\nFROM node:22-alpine\nRUN sleep 2\nCMD ["sleep","infinity"]\nEOF',
      );
    await page.getByRole('button', { name: 'Executar comando', exact: true }).click();
    await expect(page.getByText('Código de saída: 0', { exact: false })).toBeVisible();
    await page.keyboard.press('Escape');
    const accepted = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/workspaces') &&
        res.request().method() === 'POST' &&
        (res.request().postDataJSON() as { action?: string } | null)?.action === 'startPreview',
    );
    await card.getByRole('button', { name: 'Subir prévia', exact: true }).click();
    expect((await accepted).ok()).toBe(true);
    await page.close();
    const returned = await context.newPage();
    try {
      await returned.setViewportSize(viewport);
      await returned.goto(url);
      await expect(
        returned.getByText('Serviços sem rota de navegador', { exact: true }),
      ).toBeVisible({ timeout: 60_000 });
      expect(
        await returned.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const state = (await (await returned.request.get('/api/workspaces')).json()) as RunnerState;
      expect(state.previews.find((preview) => preview.projectId === id)?.state).toBe('ready');
      await returned.getByRole('button', { name: 'Parar prévia', exact: true }).click();
      await expect(returned.getByText('Parado', { exact: true })).toBeVisible({ timeout: 30_000 });
      await returned.getByRole('tab', { name: 'Atividade', exact: true }).click();
      await returned.getByRole('button', { name: 'Ver saída', exact: true }).last().click();
      await expect(returned.getByRole('dialog')).toContainText(
        /does not exist|not exist|não existe/,
      );
    } finally {
      await returned.close();
    }
  });
}

test('rejects invalid and oversized workspace API requests and stale edits without changing saved configuration', async ({
  page,
  baseURL,
  browser,
}, testInfo) => {
  const post = (data: unknown, headers = { origin: baseURL! }) =>
    page.request.post('/api/workspaces', { headers, data });
  const anonymous = await browser.newContext();
  try {
    expect(
      (
        await anonymous.request.post(`${baseURL}/api/workspaces`, {
          headers: { origin: baseURL! },
          data: { action: 'state' },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await anonymous.close();
  }
  expect((await post({ action: 'state' }, {} as { origin: string })).status()).toBe(403);
  const invalid = await post({ action: 'unknown' });
  expect(invalid.status(), await invalid.text()).toBe(400);
  expect((await invalid.json()) as { error: string }).toMatchObject({
    error: expect.stringContaining('No matching discriminator'),
  });
  const oversized = await post({ action: 'writeFile', content: 'x'.repeat(200_001) });
  expect(oversized.status(), await oversized.text()).toBe(400);
  expect(await oversized.json()).toEqual({ error: 'Configuração muito grande.' });
  expect(
    (
      await page.request.post('/api/workspaces', {
        headers: { origin: baseURL!, 'content-type': 'text/plain' },
        data: 'bad',
      })
    ).status(),
  ).toBe(400);
  const definition = { id: `revision-e2e-${testInfo.repeatEachIndex}`, name: 'Original' };
  const created = await post({ action: 'saveEnvironment', definition, revision: 0 });
  expect(created.ok(), `${created.status()}: ${await created.text()}`).toBe(true);
  expect(
    (
      await post({
        action: 'saveEnvironment',
        definition: { ...definition, name: 'Updated' },
        revision: 1,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await post({
        action: 'saveEnvironment',
        definition: { ...definition, name: 'Stale' },
        revision: 1,
      })
    ).status(),
  ).toBe(400);
  const state = (await (await page.request.get('/api/workspaces')).json()) as RunnerState;
  expect(state.environments.find((env) => env.id === definition.id)?.name).toBe('Updated');
});

test('creates environments concurrently and rejects one of two simultaneous edits to the same revision', async ({
  page,
  baseURL,
}, testInfo) => {
  const definitions = Array.from({ length: 12 }, (_, index) => ({
    id: `concurrent-${testInfo.repeatEachIndex}-${index}`,
    name: `Concurrent ${index}`,
  }));
  const save = (definition: (typeof definitions)[number], revision: number) =>
    page.request.post('/api/workspaces', {
      headers: { origin: baseURL! },
      data: { action: 'saveEnvironment', definition, revision },
    });
  const creations = await Promise.all(definitions.map((definition) => save(definition, 0)));
  for (const response of creations) expect(response.status(), await response.text()).toBe(200);
  const edits = definitions.slice(0, 2).map((definition) => ({
    ...definitions[0]!,
    name: definition.name,
  }));
  const responses = await Promise.all(edits.map((definition) => save(definition, 1)));
  const results = await Promise.all(
    responses.map(async (response) => ({
      status: response.status(),
      body: (await response.json()) as { name?: string; error?: string },
    })),
  );
  expect(results.map((result) => result.status).sort(), JSON.stringify(results)).toEqual([
    200, 400,
  ]);
  expect(results.find((result) => result.status === 400)?.body.error).toContain(
    'O cadastro foi alterado',
  );
  const response = await page.request.get('/api/workspaces');
  expect(response.status(), await response.text()).toBe(200);
  const state = (await response.json()) as RunnerState;
  expect(
    state.environments.filter((env) => definitions.some((item) => item.id === env.id)),
  ).toHaveLength(definitions.length);
  expect(state.environments.find((env) => env.id === definitions[0]!.id)).toMatchObject({
    name: results.find((result) => result.status === 200)!.body.name,
    revision: 2,
  });
});
