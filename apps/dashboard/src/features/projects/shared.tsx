'use client';
import { cloneElement, useId, type ReactElement } from 'react';
import type { RunnerCommandInput, RunnerState } from '@oinko/environments/client';

export type { RunnerState, RunnerCommandInput };
export const inputStyle =
  'w-full min-w-0 rounded-[2px] border border-rule bg-surface px-3 py-2 text-sm outline-offset-2';
export const buttonStyle =
  'inline-flex items-center justify-center gap-2 rounded-[2px] border border-rule bg-surface px-3 py-2 text-sm hover:bg-paper disabled:opacity-50 disabled:cursor-wait';
export const panelStyle = 'space-y-4 border border-rule bg-surface p-5';
export const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {cloneElement(children, { id, 'aria-describedby': help ? `${id}-help` : undefined })}
      {help && (
        <span id={`${id}-help`} className="text-xs leading-5 text-ink-muted">
          {help}
        </span>
      )}
    </div>
  );
}
export async function workspaceRequest<T = unknown>(command?: RunnerCommandInput): Promise<T> {
  const response = await fetch('/api/workspaces', {
    cache: 'no-store',
    ...(command
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        }
      : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'Não foi possível concluir a operação.',
    );
  return value as T;
}
export function variables(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        if (at < 1) throw new Error('Use uma variável KEY=VALUE por linha.');
        return [line.slice(0, at).trim(), line.slice(at + 1)];
      }),
  );
}
export function variableText(value: Record<string, string>) {
  return Object.entries(value)
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');
}
export const stateLabel: Record<string, string> = {
  queued: 'Na fila',
  running: 'Executando',
  succeeded: 'Concluído',
  failed: 'Falhou',
  creating: 'Preparando',
  ready: 'Pronto',
  stopped: 'Parado',
  building: 'Construindo',
  starting: 'Iniciando',
  absent: 'Não iniciado',
  unavailable: 'Docker indisponível',
  exited: 'Parado',
};
