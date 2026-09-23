import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BotStore } from '@oinko/bots/store';
import { test, expect } from './auth';

const root = process.env.OINKO_E2E_ROOT!;
const ids = { dev: 'telemetry-dev', landing: 'telemetry-landing', empty: 'telemetry-empty' };
async function seedBot(id: string, name: string) {
  const store = new BotStore(root);
  try {
    store.save({ id, name, model: 'test', systemPrompt: 'Ajude.', cli: false }, {}, 0);
    const path = store.runtime(id).paths.telemetryDbPath;
    mkdirSync(dirname(path), { recursive: true });
    const original = new DatabaseSync(join(root, 'telemetry.db'), { readOnly: true });
    try {
      await backup(original, path);
    } finally {
      original.close();
    }
    const db = new DatabaseSync(path);
    try {
      const latest = db
        .prepare(
          "SELECT trace_id,system_prompt_payload_id FROM executions WHERE thread_id='suporte-4821' ORDER BY started_at DESC LIMIT 1",
        )
        .get()!;
      const body = `${name}: conteúdo completo exclusivo. ${'Trecho da conversa. '.repeat(250)}`;
      db.prepare('UPDATE payloads SET body=?,size_bytes=?,preview=? WHERE id=?').run(
        body,
        Buffer.byteLength(body),
        `Resumo de ${name}`,
        String(latest.system_prompt_payload_id),
      );
      db.prepare('UPDATE executions SET app=?').run(id);
      return { path, payloadId: String(latest.system_prompt_payload_id) };
    } finally {
      db.close();
    }
  } finally {
    store.close();
  }
}

test('selects each bot throughout navigation, payloads, downloads and live updates', async ({
  page,
}) => {
  const dev = await seedBot(ids.dev, 'Dev de teste');
  const landing = await seedBot(ids.landing, 'LP de teste');
  expect(landing.payloadId).toBe(dev.payloadId);
  const store = new BotStore(root);
  try {
    store.save(
      { id: ids.empty, name: 'Bot sem turnos', model: 'test', systemPrompt: 'Ajude.' },
      {},
      0,
    );
  } finally {
    store.close();
  }

  await page.goto('/bots');
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Dev de teste', exact: true }) });
  await card.getByRole('link', { name: 'Ver telemetria' }).click();
  await expect(page.getByLabel('Telemetria do bot')).toHaveValue(ids.dev);
  await page.getByLabel('Buscar thread').fill('suporte');
  await page.waitForURL(/q=suporte/);
  expect(new URL(page.url()).searchParams.get('bot')).toBe(ids.dev);
  await page.reload();

  for (const [id, name] of [
    [ids.dev, 'Dev de teste'],
    [ids.landing, 'LP de teste'],
  ]) {
    if (id !== ids.dev) await page.getByLabel('Telemetria do bot').selectOption(id!);
    const thread = page
      .getByRole('navigation', { name: 'Conversas' })
      .getByRole('link', { name: /^suporte-4821/ });
    await expect(thread).toHaveAttribute('href', `/threads/suporte-4821?bot=${id}`);
    await thread.click();
    await page.waitForURL(/\/threads\/suporte-4821\/[^?]+\?bot=/);
    expect(new URL(page.url()).searchParams.get('bot')).toBe(id);
    const response = page.waitForResponse((res) =>
      res.url().includes(`/api/payloads/${dev.payloadId}`),
    );
    await page.getByRole('button', { name: 'Ver completo' }).first().click();
    expect(new URL((await response).url()).searchParams.get('bot')).toBe(id);
    await expect(
      page.getByText(`${name}: conteúdo completo exclusivo.`, { exact: false }).first(),
    ).toBeVisible();
    const download = page.getByRole('link', { name: 'Baixar' }).first();
    const href = (await download.getAttribute('href'))!;
    const file = await page.request.get(href);
    expect(file.headers()['content-disposition']).toContain('attachment');
    expect(await file.text()).toContain(`${name}: conteúdo completo exclusivo.`);
    await page.getByRole('link', { name: /chamada 1/ }).click();
    await page.waitForURL(/item=/);
    expect(new URL(page.url()).searchParams.get('bot')).toBe(id);
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Telemetria' })
      .click();
    expect(new URL(page.url()).searchParams.get('bot')).toBe(id);
  }

  await page.getByLabel('Telemetria do bot').selectOption(ids.dev);
  await page.waitForURL((url) => url.searchParams.get('bot') === ids.dev);
  await expect(page.getByLabel('Telemetria do bot')).toHaveValue(ids.dev);
  await expect(page.getByRole('status')).toContainText('ao vivo');
  const db = new DatabaseSync(dev.path);
  db.prepare(
    `INSERT INTO executions (trace_id,thread_id,model,provider_kind,status,total_tokens,started_at)
    VALUES ('live-dev','nova-conversa-dev','test','openrouter','ok',5,?)`,
  ).run(Date.now());
  db.close();
  await expect(
    page.getByRole('navigation', { name: 'Conversas' }).getByText('nova-conversa-dev'),
  ).toBeVisible();
  await page.getByLabel('Telemetria do bot').selectOption(ids.landing);
  await expect(
    page.getByRole('navigation', { name: 'Conversas' }).getByText('nova-conversa-dev'),
  ).toHaveCount(0);

  await page.getByLabel('Telemetria do bot').selectOption(ids.empty);
  await expect(page.getByText('Nenhuma conversa registrada ainda')).toBeVisible();
  expect(existsSync(join(root, '.harness/bots', ids.empty, 'telemetry.db'))).toBe(false);
  expect((await page.request.get('/?bot=unknown')).status()).toBe(404);
  expect((await page.request.get(`/api/payloads/${dev.payloadId}?bot=unknown`)).status()).toBe(404);
  expect((await page.request.get('/api/stream?bot=unknown')).status()).toBe(404);
});
