import { Plug, CircleCheck, CircleAlert } from 'lucide-react';
import type { CredentialStatus } from '@/server/higgsfield/credential-store';

const MESSAGE: Record<string, { text: string; tone: string }> = {
  ok: { text: 'Autorizado. O agente ja pode gerar imagem e video.', tone: 'text-ok' },
  negado: { text: 'Voce cancelou a autorizacao.', tone: 'text-ink-muted' },
  invalido: { text: 'O retorno nao conferiu. Tente de novo.', tone: 'text-fault' },
  falhou: {
    text: 'A troca falhou. Se o servidor nao devolveu refresh token, o agente nao conseguiria renovar sozinho.',
    tone: 'text-fault',
  },
};

function when(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function ConnectionCard({ status, result }: { status: CredentialStatus; result?: string }) {
  const feedback = result ? MESSAGE[result] : undefined;

  return (
    <section aria-labelledby="hf-heading" className="border-b border-rule px-5 py-4">
      <h2 id="hf-heading" className="flex items-center gap-2 text-sm font-medium">
        <Plug className="size-4 text-judge" aria-hidden />
        Higgsfield
      </h2>

      <p className="mt-1 max-w-prose text-[0.8125rem] text-ink-muted">
        Geracao de imagem e video pelo agente. A autorizacao acontece aqui, porque precisa de
        navegador; quem renova depois e o agente, que fica de pe.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {status.connected ? (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <CircleCheck className="size-4" aria-hidden />
            Conectado
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-ink-muted">
            <CircleAlert className="size-4" aria-hidden />
            Nao conectado
          </span>
        )}

        <a
          href="/api/auth/higgsfield/start"
          className="border border-rule bg-surface px-3 py-1.5 text-sm hover:bg-paper"
          style={{ borderRadius: 'var(--radius-control)' }}
        >
          {status.connected ? 'Autorizar de novo' : 'Autorizar'}
        </a>
      </div>

      {feedback ? (
        <p role="status" className={`mt-2 text-[0.8125rem] ${feedback.tone}`}>
          {feedback.text}
        </p>
      ) : null}

      {status.connected && status.expiresAt ? (
        <p className="tabular mt-2 text-xs text-ink-muted">
          Token valido ate {when(status.expiresAt)} — o agente renova sozinho antes disso.
        </p>
      ) : null}

      <p className="mt-2 font-mono text-xs break-all text-ink-muted">{status.path}</p>
    </section>
  );
}
