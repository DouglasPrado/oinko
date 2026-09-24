'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';

const inputClass =
  'h-10 w-full rounded-md border border-rule-strong bg-canvas px-3 text-base font-normal text-ink outline-offset-0 transition-colors hover:border-ink-disabled md:text-sm';
export function LoginForm({ setup }: { setup: boolean }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (setup && password !== confirmation) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, setup }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
      setPassword('');
      setConfirmation('');
      router.replace('/bots');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="grid gap-4"
    >
      <label className="grid gap-1.5 text-[13px] font-medium">
        {setup ? 'Crie sua senha' : 'Senha'}
        <input
          required
          minLength={setup ? 12 : 1}
          type="password"
          autoComplete={setup ? 'new-password' : 'current-password'}
          className={inputClass}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {setup && (
        <label className="grid gap-1.5 text-[13px] font-medium">
          Confirme sua senha
          <input
            required
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-error-ink">
          {error}
        </p>
      )}
      <button disabled={busy} className={buttonVariants({ size: 'lg', className: 'mt-1 w-full' })}>
        {busy ? 'Aguarde…' : setup ? 'Criar senha e entrar' : 'Entrar'}
      </button>
    </form>
  );
}
