'use client';
import { buttonVariants } from '@/components/ui/button';
import { cloneElement, useId, type ReactElement } from 'react';
import type { RunnerCommandInput, RunnerState } from '@oinko/environments/client';

export type { RunnerState, RunnerCommandInput };
/*
 * Todo controle de linha unica tem exatamente 36px, com ou sem valor, para que
 * input, select e numero lado a lado nunca fiquem desalinhados. O textarea tem
 * estilo proprio porque a altura dele cresce com o conteudo.
 */
const controlBase =
  'w-full min-w-0 rounded-md border border-rule-strong bg-canvas px-3 text-sm text-ink outline-offset-0 transition-colors hover:border-ink-disabled disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-disabled';
export const inputStyle = `${controlBase} h-9`;
export const textareaStyle = `${controlBase} block py-2 leading-6`;
export const buttonStyle = buttonVariants({ variant: 'outline' });
export const primaryButtonStyle = buttonVariants();
export const dangerButtonStyle = buttonVariants({ variant: 'destructive' });
/** Secao de formulario: contorno hairline, raio de painel, sem sombra. */
export const panelStyle = 'space-y-4 rounded-xl border border-rule bg-canvas p-5';
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
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={id} className="text-[13px] leading-5 font-medium text-ink">
        {label}
      </label>
      {cloneElement(children, { id, 'aria-describedby': help ? `${id}-help` : undefined })}
      {help && (
        <span id={`${id}-help`} className="text-xs leading-[1.45] text-ink-muted">
          {help}
        </span>
      )}
    </div>
  );
}
/** Opcao de liga/desliga em linha, com o rotulo exato como nome acessivel. */
export const checkRowStyle =
  'flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink transition-colors hover:bg-paper';
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
