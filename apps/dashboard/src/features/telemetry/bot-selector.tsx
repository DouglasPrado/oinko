'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { telemetryHref } from './telemetry-href';

export function TelemetryBotSelector({
  selected,
  options,
}: {
  selected: string;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-surface px-5 py-3">
      <label htmlFor="telemetry-bot" className="text-sm text-ink-muted">
        Telemetria do bot
      </label>
      <select
        id="telemetry-bot"
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const href = telemetryHref('/', event.target.value);
          startTransition(() => router.push(href));
        }}
        className="min-w-0 max-w-full rounded-control border border-rule bg-paper px-3 py-2 text-sm"
      >
        {options.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      {pending ? <span className="text-xs text-ink-muted">Carregando…</span> : null}
    </div>
  );
}
