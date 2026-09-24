import Image from 'next/image';
import { cn } from '@/lib/utils/cn';

/*
 * Icones coloridos dos canais e integracoes de um bot. Cada um carrega a cor
 * de quem o usuario reconhece de fora (o azul do Telegram, o terminal escuro)
 * para que a linha diga de relance por onde o bot atende.
 */

/** `className` substitui o tamanho padrao de 16px; sem tailwind-merge, os dois nao somam. */
type IconProps = { className?: string };

export function TelegramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', className ?? 'size-4')}>
      <circle cx="12" cy="12" r="12" fill="#229ED9" />
      <path
        fill="#fff"
        d="M5.4 11.7l11.9-4.6c.55-.2 1.03.13.85.95l-2.03 9.55c-.15.67-.55.83-1.1.52l-3.05-2.25-1.47 1.42c-.16.16-.3.3-.62.3l.22-3.1 5.64-5.1c.25-.22-.05-.34-.38-.12l-6.97 4.39-3-.94c-.66-.2-.67-.66.14-.98z"
      />
    </svg>
  );
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', className ?? 'size-4')}>
      <rect width="24" height="24" rx="6" fill="#333333" />
      <path
        d="M7 8.5l3.5 3.5L7 15.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 15.5H17" stroke="#45D6B6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function McpIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', className ?? 'size-4')}>
      <rect width="24" height="24" rx="6" fill="#6E56CF" />
      <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 5.5v3M14.5 5.5v3" />
        <path d="M7.5 8.5h9v2.5a4.5 4.5 0 0 1-9 0z" />
        <path d="M12 15.5v3" />
      </g>
    </svg>
  );
}

export function HiggsfieldIcon({ className }: IconProps) {
  // Copia local do /icon.png do proprio site, a mesma usada em Integracoes.
  return (
    <Image
      src="/higgsfield.png"
      alt=""
      width={16}
      height={16}
      aria-hidden
      className={cn('shrink-0 rounded-[4px]', className ?? 'size-4')}
    />
  );
}

/** Icone do canal ou integracao pelo tipo da conexao do runtime. */
export function ChannelIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'cli') return <TerminalIcon {...(className !== undefined && { className })} />;
  if (type === 'telegram') return <TelegramIcon {...(className !== undefined && { className })} />;
  if (type === 'higgsfield')
    return <HiggsfieldIcon {...(className !== undefined && { className })} />;
  return <McpIcon {...(className !== undefined && { className })} />;
}
