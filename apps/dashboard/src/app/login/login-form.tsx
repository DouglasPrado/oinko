'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
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
      className="grid gap-5"
    >
      <label className="grid gap-2 text-sm">
        {setup ? 'Crie sua senha' : 'Senha'}
        <input
          required
          minLength={setup ? 12 : 1}
          type="password"
          autoComplete={setup ? 'new-password' : 'current-password'}
          className="border border-rule bg-surface p-3"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {setup && (
        <label className="grid gap-2 text-sm">
          Confirme sua senha
          <input
            required
            type="password"
            autoComplete="new-password"
            className="border border-rule bg-surface p-3"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-fault">
          {error}
        </p>
      )}
      <button disabled={busy} className="bg-ink px-5 py-3 text-sm text-surface disabled:opacity-50">
        {busy ? 'Aguarde…' : setup ? 'Criar senha e entrar' : 'Entrar'}
      </button>
    </form>
  );
}
