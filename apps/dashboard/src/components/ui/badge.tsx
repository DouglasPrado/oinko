import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

/**
 * Pilula compacta para estado, ambiente e metadado curto.
 *
 * O preenchimento colorido fica para o que e semantico (info, erro, aviso).
 * Sucesso nao pinta a pilula: usa ponto verde e texto escuro, no StatusDot.
 */
const badgeVariants = cva(
  'group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2 text-xs leading-none font-normal whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-ink text-white',
        secondary: 'border-transparent bg-hover text-ink-muted',
        outline: 'border-rule-strong bg-canvas text-ink-muted [a]:hover:bg-hover',
        /** Contorno neutro com texto escuro: para estado que carrega um ponto colorido. */
        neutral: 'border-rule-strong bg-canvas text-ink',
        info: 'border-transparent bg-info-bg text-info-ink',
        destructive: 'border-transparent bg-error-bg text-error-ink',
        warning: 'border-transparent bg-warning-bg text-warning-ink',
        ghost: 'border-transparent text-ink-muted hover:bg-hover',
        link: 'border-transparent text-info-ink underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'outline',
    },
  },
);

function Badge({
  className,
  variant = 'outline',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
