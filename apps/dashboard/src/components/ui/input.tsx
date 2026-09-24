import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-rule-strong bg-canvas px-3 text-base text-ink transition-colors outline-offset-0 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:border-ink-disabled disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-disabled aria-invalid:border-error md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
