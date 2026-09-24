import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-rule-strong bg-canvas px-3 py-2 text-base leading-6 text-ink transition-colors outline-offset-0 hover:border-ink-disabled disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-disabled aria-invalid:border-error md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
