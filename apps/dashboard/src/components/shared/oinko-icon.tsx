import Image from 'next/image';
import { cn } from '@/lib/utils/cn';

/** Local copy of the PNG advertised by the Oinko MCP server. */
export function OinkoIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/oinko.png"
      alt=""
      width={16}
      height={16}
      loading="eager"
      unoptimized
      aria-hidden
      className={cn('shrink-0', className ?? 'size-4')}
    />
  );
}
