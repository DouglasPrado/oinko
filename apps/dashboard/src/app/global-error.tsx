'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          padding: '4rem 1rem',
          color: '#171717',
          background: '#ffffff',
          fontSize: 14,
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.3px' }}>
          A aplicacao parou
        </h1>
        <p style={{ marginTop: '0.5rem', color: '#666666' }}>
          Recarregue a pagina. Se continuar, verifique o log do servidor.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '1.25rem',
            height: 36,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid #dcdcdc',
            background: '#ffffff',
            color: '#171717',
            font: 'inherit',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Recarregar
        </button>
      </body>
    </html>
  );
}
