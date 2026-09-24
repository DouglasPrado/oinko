import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <p className="font-mono text-xs text-ink-muted">404</p>
        <h1 className="mt-2 text-xl leading-[1.3] font-semibold tracking-[-0.3px]">
          Essa execucao nao existe
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          O identificador pode ter expirado pela retencao, ou a thread foi purgada.
        </p>
        <Link href="/" className={buttonVariants({ variant: 'outline', className: 'mt-6' })}>
          Ver as conversas
        </Link>
      </div>
    </main>
  );
}
