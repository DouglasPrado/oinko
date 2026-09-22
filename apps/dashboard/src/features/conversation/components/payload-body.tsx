'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { JsonTree } from './json-tree';
import { MessageList, parseMessages } from './message-list';

type Mode = 'auto' | 'json' | 'raw';

function parseJson(text: string): unknown {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Escolhe como ler o conteudo.
 *
 * Um payload de telemetria quase nunca e texto solto: e a lista de mensagens
 * enviada ao modelo, ou o schema das ferramentas, ou o resultado de uma tool.
 * Mostrar tudo como uma parede de JSON escapado obriga quem investiga a fazer
 * o parsing de cabeca.
 */
export function PayloadBody({ text, truncated }: { text: string; truncated: boolean }) {
  const messages = useMemo(() => parseMessages(text), [text]);
  const json = useMemo(() => parseJson(text), [text]);
  const [mode, setMode] = useState<Mode>('auto');

  const options: { id: Mode; label: string }[] = [
    ...(messages ? [{ id: 'auto' as const, label: 'Conversa' }] : []),
    ...(json !== undefined ? [{ id: 'json' as const, label: 'JSON' }] : []),
    { id: 'raw' as const, label: 'Texto' },
  ];

  // Sem estrutura reconhecida, nao ha escolha a oferecer.
  const effective: Mode = messages && mode === 'auto' ? 'auto' : mode === 'auto' ? 'raw' : mode;

  return (
    <div className="mt-1.5">
      {options.length > 1 ? (
        <div className="mb-1.5 flex gap-1" role="group" aria-label="Como ler o conteudo">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={effective === option.id}
              className={cn(
                'border px-2 py-0.5 text-xs',
                effective === option.id
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-surface hover:bg-paper',
              )}
              style={{ borderRadius: 'var(--radius-control)' }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-[28rem] overflow-auto border border-rule bg-surface">
        {effective === 'auto' && messages ? <MessageList messages={messages} /> : null}
        {effective === 'json' && json !== undefined ? <JsonTree data={json} /> : null}
        {effective === 'raw' ? (
          <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre">
            {text}
            {truncated ? '\n…' : ''}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
