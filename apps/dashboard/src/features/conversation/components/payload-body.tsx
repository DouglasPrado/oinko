'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { JsonViewer } from './json-viewer';
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
    <div className="mt-2">
      {options.length > 1 ? (
        <div
          className="mb-2 inline-flex rounded-md bg-hover p-0.5"
          role="group"
          aria-label="Como ler o conteudo"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={effective === option.id}
              className={cn(
                'h-6 rounded-sm px-2.5 text-xs transition-colors',
                effective === option.id
                  ? 'bg-canvas font-medium text-ink shadow-[0_0_0_1px_var(--color-rule)]'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-rule bg-paper">
        {effective === 'auto' && messages ? <MessageList messages={messages} /> : null}
        {effective === 'json' && json !== undefined ? <JsonViewer data={json} /> : null}
        {effective === 'raw' ? (
          <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre text-ink">
            {text}
            {truncated ? '\n…' : ''}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
