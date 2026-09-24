'use client';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'shrink-0 px-2' })}
      onClick={() => {
        void fetch('/api/session', { method: 'DELETE' }).then(() => {
          router.replace('/login');
          router.refresh();
        });
      }}
    >
      <LogOut aria-hidden />
      Sair
    </button>
  );
}
