import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-medium">Essa execucao nao existe</h1>
      <p className="mt-3 text-sm text-ink-muted">
        O identificador pode ter expirado pela retencao, ou a thread foi purgada.
      </p>
      <Link href="/" className="mt-6 inline-block text-time underline">
        Ver as conversas
      </Link>
    </main>
  );
}
