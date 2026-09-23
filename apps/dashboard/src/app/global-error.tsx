'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1rem', color: '#1B2320' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 500 }}>A aplicacao parou</h1>
        <p style={{ marginTop: '0.75rem', color: '#5A635E' }}>
          Recarregue a pagina. Se continuar, verifique o log do servidor.
        </p>
        <button type="button" onClick={reset} style={{ marginTop: '1.5rem' }}>
          Recarregar
        </button>
      </body>
    </html>
  );
}
