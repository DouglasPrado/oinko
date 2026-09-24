import Image from 'next/image';
import { StatusDot } from '@/components/shared/status-dot';
import { ActionToast } from '@/components/shared/action-toast';
import { buttonVariants } from '@/components/ui/button';
import type { CredentialStatus } from '@/server/higgsfield/credential-store';

const MESSAGE: Record<
  string,
  { tone: 'success' | 'error' | 'info'; title: string; description: string }
> = {
  ok: {
    tone: 'success',
    title: 'Higgsfield autorizado',
    description: 'O agente já pode gerar imagem e vídeo.',
  },
  negado: {
    tone: 'info',
    title: 'Autorização cancelada',
    description: 'Você cancelou a autorização no Higgsfield.',
  },
  invalido: {
    tone: 'error',
    title: 'O retorno não conferiu',
    description: 'Tente autorizar de novo.',
  },
  falhou: {
    tone: 'error',
    title: 'A troca de credenciais falhou',
    description:
      'Se o servidor não devolveu refresh token, o agente não conseguiria renovar sozinho.',
  },
};

function when(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Uma integracao por linha: marca e proposito, estado, e a acao que resolve. */
export function ConnectionCard({ status, result }: { status: CredentialStatus; result?: string }) {
  const feedback = result ? MESSAGE[result] : undefined;

  return (
    <section
      aria-labelledby="hf-heading"
      className="grid gap-x-6 gap-y-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-center"
    >
      <div className="flex min-w-0 gap-3">
        {/*
          A marca do servico no lugar de um icone generico: numa pagina que
          lista integracoes, o que identifica cada linha e de quem ela e. O
          arquivo e copia local do /icon.png do proprio site — pedir a imagem
          ao higgsfield.ai a cada carga contaria a eles quando a dashboard
          abre, e quebraria a pagina se o site saisse do ar.
        */}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-rule">
          <Image
            src="/higgsfield.png"
            alt=""
            width={16}
            height={16}
            className="size-4 rounded-[3px]"
            aria-hidden
          />
        </span>
        <div className="min-w-0">
          <h2 id="hf-heading" className="text-sm font-medium">
            Higgsfield
          </h2>
          <p className="mt-0.5 max-w-prose text-[13px] text-ink-muted">
            Geracao de imagem e video pelo agente. A autorizacao acontece aqui, porque precisa de
            navegador; quem renova depois e o agente, que fica de pe.
          </p>
        </div>
      </div>

      <div className="pl-11 md:pl-0">
        {status.connected ? (
          <StatusDot tone="ready" label="Conectado" />
        ) : (
          <StatusDot tone="neutral" label="Nao conectado" />
        )}
      </div>

      <div className="pl-11 md:pl-0">
        <a
          href="/api/auth/higgsfield/start"
          className={buttonVariants({
            variant: status.connected ? 'outline' : 'default',
            size: 'sm',
          })}
        >
          {status.connected ? 'Autorizar de novo' : 'Autorizar'}
        </a>
      </div>

      <div className="space-y-1.5 pl-11 md:col-span-full">
        {feedback ? <ActionToast {...feedback} clearParam="higgsfield" /> : null}

        {status.connected && status.expiresAt ? (
          <p className="tabular text-xs text-ink-muted">
            Token valido ate {when(status.expiresAt)} — o agente renova sozinho antes disso.
          </p>
        ) : null}

        <p className="font-mono text-xs break-all text-ink-muted">{status.path}</p>
      </div>
    </section>
  );
}
