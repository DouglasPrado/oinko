import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

/*
 * Sem tailwind-merge no projeto, duas classes para a mesma propriedade viram
 * disputa de ordem no CSS. Por isso cada propriedade mora num lugar so: cor de
 * borda e fundo na variante; altura, raio e corpo de texto no tamanho.
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center border leading-none font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-ink bg-ink text-white hover:border-[#1f1f1f] hover:bg-[#1f1f1f] active:bg-black',
        outline:
          'border-rule-strong bg-canvas text-ink hover:bg-hover active:bg-active aria-expanded:bg-hover',
        secondary:
          'border-transparent bg-hover text-ink hover:bg-selected active:bg-active aria-expanded:bg-selected',
        ghost:
          'border-transparent text-ink-muted hover:bg-hover hover:text-ink active:bg-active aria-expanded:bg-hover aria-expanded:text-ink',
        destructive:
          'border-rule-strong bg-canvas text-error-ink hover:border-error/40 hover:bg-error-bg active:bg-error-bg',
        link: 'h-auto! border-transparent px-0! text-info-ink underline-offset-4 hover:underline',
      },
      size: {
        default:
          "h-9 gap-1.5 rounded-md px-3 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 rounded-md px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 rounded-md text-sm [&_svg:not([class*='size-'])]:size-4",
        'icon-xs': "size-6 rounded-sm text-xs [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': "size-8 rounded-md text-sm [&_svg:not([class*='size-'])]:size-4",
        'icon-lg': "size-10 rounded-md text-sm [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
