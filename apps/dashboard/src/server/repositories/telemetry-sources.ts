import 'server-only';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { env } from '@/config/env';
import { botManager } from '@/server/bots/manager';
import { telemetryDb } from './telemetry-connection';

export interface TelemetrySelection {
  id: string;
  name: string;
  path: string;
  options: { id: string; name: string }[];
  database: DatabaseSync | undefined;
  emptyMessage: string;
}

/** A URL identifica um bot; caminhos de arquivos vêm apenas do cadastro local. */
export function selectTelemetry(botId?: string): TelemetrySelection | undefined {
  const store = botManager().store;
  const sources = store.list().map((bot) => ({
    id: bot.id,
    name: bot.name,
    path: resolve(store.runtime(bot.id).paths.telemetryDbPath),
    enabled: bot.telemetry.enabled,
  }));
  const configuredPath = resolve(env.TELEMETRY_DB_PATH);
  let fallback = sources.find((source) => source.path === configuredPath);
  if (!fallback && (existsSync(configuredPath) || sources.length === 0)) {
    fallback = { id: '', name: 'Outras conversas', path: configuredPath, enabled: true };
    sources.push(fallback);
  }
  const source =
    botId === undefined ? (fallback ?? sources[0]) : sources.find(({ id }) => id === botId);
  if (!source) return undefined;
  return {
    ...source,
    options: sources.map(({ id, name }) => ({ id, name })),
    database: existsSync(source.path) ? telemetryDb(source.path) : undefined,
    emptyMessage: !source.enabled
      ? 'A telemetria deste bot está desativada. Ative-a na configuração do bot e reinicie-o para registrar novas respostas.'
      : 'Inicie o bot e envie uma mensagem. As respostas aparecerão aqui automaticamente.',
  };
}
