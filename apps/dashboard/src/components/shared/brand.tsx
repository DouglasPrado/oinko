'use client';

import Link from 'next/link';
import { useId } from 'react';
import { cn } from '@/lib/utils/cn';

/*
 * Logo Oinko redesenhada em vetor a partir da arte original: o "O" e a cabeca
 * do porco, e as letras sao tracos de ponta redonda alternando grafite e rosa.
 * As coordenadas seguem as proporcoes da arte, para o desenho nao derivar.
 */

function PigHead({ maskId }: { maskId: string }) {
  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse">
        <rect x="0" y="0" width="2000" height="1000" fill="#fff" />
        {/* O vao branco entre orelha e cabeca da arte. */}
        <circle cx="318" cy="478" r="203" fill="#000" />
      </mask>
      <g fill="var(--color-brand)" mask={`url(#${maskId})`}>
        <path d="M156 372C106 306 108 256 132 240C180 236 230 262 264 304Z" />
        <path d="M480 372C530 306 528 256 504 240C456 236 406 262 372 304Z" />
      </g>
      <circle cx="318" cy="478" r="190" fill="var(--color-brand)" />
      <rect x="213" y="398" width="210" height="178" rx="89" fill="#fff" />
      <rect x="266" y="456" width="32" height="64" rx="16" fill="var(--color-brand)" />
      <rect x="338" y="456" width="32" height="64" rx="16" fill="var(--color-brand)" />
    </>
  );
}

/** Logotipo completo "Oinko", com a tagline opcional da arte original. */
export function Logo({ className, tagline = false }: { className?: string; tagline?: boolean }) {
  const id = useId();
  return (
    <svg
      viewBox={tagline ? '110 170 1600 610' : '110 170 1600 505'}
      role="img"
      aria-label="Oinko"
      className={cn('h-6 w-auto shrink-0', className)}
    >
      <PigHead maskId={`${id}-ears`} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="110">
        {/* i */}
        <circle cx="588" cy="238" r="60" fill="var(--color-ink)" stroke="none" />
        <path d="M588 375V610" stroke="var(--color-ink)" />
        {/* n */}
        <path d="M710 610V486.5A113.5 113.5 0 0 1 937 486.5V610" stroke="var(--color-brand)" />
        {/* k */}
        <path d="M1062 262V610M1072 500L1288 370M1182 472L1288 610" stroke="var(--color-ink)" />
        {/* o */}
        <circle cx="1515" cy="491" r="120" stroke="var(--color-brand)" />
      </g>
      {tagline && (
        <text
          x="910"
          y="760"
          textAnchor="middle"
          fill="var(--color-ink)"
          fontFamily="var(--font-sans)"
          fontSize="58"
          fontWeight="500"
          letterSpacing="15"
        >
          SMALL STEPS. BRIGHTER TOMORROWS.
        </text>
      )}
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/bots"
      aria-label="Oinko, ir para bots"
      className={cn('inline-flex rounded-md', className)}
    >
      <Logo className="h-[22px]" />
    </Link>
  );
}
