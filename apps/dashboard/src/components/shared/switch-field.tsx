'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Liga/desliga no padrao de configuracao: rotulo e explicacao a esquerda,
 * switch alinhado a direita.
 *
 * O rotulo fica sozinho no <label> para que o nome acessivel seja exatamente o
 * texto dele; a explicacao entra por aria-describedby.
 */
export function SwitchField({
  label,
  description,
  className,
  children,
  ...input
}: Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  label: string;
  description?: ReactNode;
  /** Conteudo que so aparece com a opcao ligada, recuado sob o rotulo. */
  children?: ReactNode;
}) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cn('py-3.5', className)}>
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={id} className="block cursor-pointer text-sm leading-5 font-medium">
            {label}
          </label>
          {description && (
            <p id={descriptionId} className="mt-0.5 text-[13px] leading-[1.45] text-ink-muted">
              {description}
            </p>
          )}
        </div>
        <input
          id={id}
          type="checkbox"
          className="switch"
          aria-describedby={descriptionId}
          {...input}
        />
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Grupo de switches separados por hairline, no corpo de uma secao. */
export function SwitchList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-rule', className)}>{children}</div>;
}
