import { EnvironmentStore } from '@oinko/environments';
import { WorkspaceStore } from '@oinko/workspaces';
import type { RunnerState } from '@oinko/environments/client';
import { test, expect } from './auth';

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`creates a project first and keeps environments, previews and errors in context on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/projetos');
    await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
    await page.getByLabel('Nome do projeto', { exact: true }).fill(`Fluxo ${viewport.name}`);
    await page.getByLabel('Origem Git 1', { exact: true }).fill('https://example.com/monorepo.git');
    await expect(page.getByLabel('Ambiente', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
    const projectId = `fluxo-${viewport.name}`;
    await expect(page).toHaveURL(new RegExp(`/projetos/${projectId}$`));
    await expect(page.getByText('Prepare o primeiro ambiente')).toBeVisible();
    for (const label of ['Desenvolvimento', 'Revisão']) {
      await page.getByRole('button', { name: 'Novo ambiente', exact: true }).click();
      await page.getByLabel('Nome do ambiente', { exact: true }).fill(`${label} ${viewport.name}`);
      await page.getByRole('button', { name: 'Adicionar serviço', exact: true }).click();
      await page.getByLabel('ID do serviço 1', { exact: true }).fill('web');
      await page.getByLabel('Disponibilizar serviço 1 no navegador', { exact: true }).check();
      await page.getByRole('button', { name: 'Salvar ambiente', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Prévias', exact: true })).toHaveAttribute(
        'data-state',
        'active',
      );
      await page.getByRole('tab', { name: 'Serviços', exact: true }).click();
      await page.getByRole('button', { name: /web.*image/ }).click();
      await expect(page.getByText('Navegador', { exact: true })).toBeVisible();
      await page
        .getByRole('navigation', { name: 'breadcrumb' })
        .getByRole('link', { name: `Fluxo ${viewport.name}`, exact: true })
        .click();
    }
    const root = process.env.OINKO_E2E_ROOT!;
    const workspaces = new WorkspaceStore(root);
    const environments = new EnvironmentStore(root);
    const previews: RunnerState['previews'] = [];
    const taskId = `preview-${viewport.name}`;
    try {
      expect(workspaces.project(projectId).environmentIds).toHaveLength(2);
      workspaces.saveTask(
        {
          id: taskId,
          projectId,
          name: `Checkout ${viewport.name}`,
          branch: `task/${taskId}`,
          state: 'ready',
        },
        0,
      );
      for (const [prefix, state] of [
        ['desenvolvimento', 'ready'],
        ['revisao', 'failed'],
      ] as const) {
        previews.push({
          revision: 1,
          id: `${prefix}-${taskId}`,
          projectId,
          taskId,
          environmentId: environments
            .environments()
            .find(
              (env) =>
                env.name ===
                `${prefix === 'desenvolvimento' ? 'Desenvolvimento' : 'Revisão'} ${viewport.name}`,
            )!.id,
          state,
          createdAt: new Date().toISOString(),
          urls: state === 'ready' ? [{ serviceId: 'web', url: 'http://127.0.0.1:3190' }] : [],
          ...(state === 'failed' ? { error: 'Falha de build na revisão' } : {}),
        });
      }
    } finally {
      workspaces.close();
      environments.close();
    }
    // UI-only failure fixtures must not block the real Docker test's network settings.
    await page.route('**/api/workspaces', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const state = (await response.json()) as RunnerState;
      await route.fulfill({
        response,
        json: { ...state, previews: [...state.previews, ...previews] },
      });
    });
    await page.getByRole('link', { name: 'Abrir ambiente', exact: true }).first().click();
    await expect(page.getByRole('link', { name: 'Abrir web ↗' })).toBeVisible();
    await expect(page.getByText('Falha de build na revisão')).toHaveCount(0);
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Terminal', exact: true })).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.name}-environment.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page
      .getByRole('navigation', { name: 'breadcrumb' })
      .getByRole('link', { name: `Fluxo ${viewport.name}`, exact: true })
      .click();
    await page.getByRole('link', { name: 'Abrir ambiente', exact: true }).last().click();
    await expect(page.getByText('Falha de build na revisão')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir web ↗' })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: `Revisão ${viewport.name}`, exact: true }),
    ).toBeVisible();
  });
}
