import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Agent, MCPConnectionConfigInput } from '@oinko/core';
import type { AgentRuntime } from './index.js';

const Entry = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  enabled: z.boolean().default(true),
  options: z.record(z.string(), z.unknown()).default({}),
});
const Schema = z.object({ channels: z.array(Entry).default([]), mcps: z.array(Entry).default([]) });
export type Connections = z.infer<typeof Schema>;
export interface ConnectionContext {
  id: string;
  runtime: AgentRuntime;
  agent: Agent;
  signal: AbortSignal;
  ready(): void;
}
export type ChannelProvider = (
  options: Record<string, unknown>,
  context: ConnectionContext,
) => Promise<void>;
export type McpProvider = (
  options: Record<string, unknown>,
  context: ConnectionContext,
) => Promise<() => Promise<void>>;
export interface ConnectionStatus {
  id: string;
  type: string;
  kind: 'channel' | 'mcp';
  state: 'connecting' | 'connected' | 'error';
  error?: string;
}

function resolveEnvironment(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveEnvironment(item, env));
  if (!value || typeof value !== 'object') return value;
  const entry = value as Record<string, unknown>;
  if (typeof entry.env === 'string') {
    const resolved = env[entry.env] ?? entry.default;
    if (entry.split === ',' && typeof resolved === 'string')
      return resolved
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    return resolved;
  }
  return Object.fromEntries(
    Object.entries(entry).map(([key, item]) => [key, resolveEnvironment(item, env)]),
  );
}

export function parseConnections(input: unknown, env: NodeJS.ProcessEnv): Connections {
  const parsed = Schema.safeParse(resolveEnvironment(input, env));
  if (!parsed.success)
    throw new Error('connections.json inválido: confira channels, mcps e suas opções.');
  for (const entries of [parsed.data.channels, parsed.data.mcps]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw new Error('IDs de conexão duplicados.');
  }
  return parsed.data;
}

export async function readConnections(path: string, env: NodeJS.ProcessEnv): Promise<Connections> {
  return parseConnections(JSON.parse(await readFile(path, 'utf8')), env);
}

interface Running {
  signature: string;
  status: ConnectionStatus;
  controller: AbortController;
  done: Promise<void>;
  close?: () => Promise<void>;
}

/** Connection lifecycle is shared by every app, independent of provider names. */
export class ConnectionManager {
  private readonly running = new Map<string, Running>();
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly host: { runtime: AgentRuntime; agent: Agent },
    private readonly channels: Record<string, ChannelProvider>,
    private readonly mcps: Record<string, McpProvider> = {},
  ) {}
  status(): ConnectionStatus[] {
    return [...this.running.values()].map(({ status }) => ({ ...status }));
  }
  hasChannel(id: string, type: string): boolean {
    return (
      this.running.get(`channel:${id}`)?.status.state === 'connected' &&
      this.running.get(`channel:${id}`)?.status.type === type
    );
  }
  reconcile(config: Connections): Promise<void> {
    const next = this.pending.then(() => this.apply(config));
    this.pending = next.catch(() => undefined);
    return next;
  }
  private async apply(config: Connections): Promise<void> {
    const entries = [
      ...config.mcps.map((entry) => ({ ...entry, kind: 'mcp' as const })),
      ...config.channels.map((entry) => ({ ...entry, kind: 'channel' as const })),
    ].filter((entry) => entry.enabled);
    const desired = new Map(entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
    for (const [key, running] of this.running) {
      const next = desired.get(key);
      if (!next || running.signature !== JSON.stringify(next) || running.status.state === 'error')
        await this.remove(key, running);
    }
    for (const [key, entry] of desired) {
      if (this.running.has(key)) continue;
      const running: Running = {
        signature: JSON.stringify(entry),
        status: { id: entry.id, type: entry.type, kind: entry.kind, state: 'connecting' },
        controller: new AbortController(),
        done: Promise.resolve(),
      };
      this.running.set(key, running);
      const context: ConnectionContext = {
        ...this.host,
        id: entry.id,
        signal: running.controller.signal,
        ready: () => {
          running.status.state = 'connected';
        },
      };
      const fail = () => {
        running.status.state = 'error';
        running.status.error = `Falha na conexão ${entry.id}; confira as opções e credenciais.`;
        console.error(running.status.error);
      };
      if (entry.kind === 'channel') {
        const provider = this.channels[entry.type];
        if (!provider) {
          fail();
          continue;
        }
        running.done = Promise.resolve()
          .then(() => provider(entry.options, context))
          .then(() => {
            if (!context.signal.aborted) fail();
          }, fail);
      } else {
        try {
          running.close = await this.host.runtime.exclusive(async () => {
            if (entry.type === 'mcp') {
              await this.host.agent.connectMCP({
                ...entry.options,
                name: entry.id,
              } as MCPConnectionConfigInput);
              return () => this.host.agent.disconnectMCP(entry.id);
            }
            const provider = this.mcps[entry.type];
            if (!provider) throw new Error('MCP provider not registered');
            return provider(entry.options, context);
          });
          context.ready();
        } catch {
          fail();
        }
      }
    }
  }
  private async remove(key: string, running: Running): Promise<void> {
    running.controller.abort();
    await running.done;
    if (running.close) await this.host.runtime.exclusive(running.close);
    this.running.delete(key);
  }
  async close(): Promise<void> {
    await this.pending;
    // Abort all channel turns before draining MCP resources.
    for (const entry of this.running.values()) entry.controller.abort();
    for (const [key, running] of this.running) await this.remove(key, running);
  }
}
