'use client';
import { useRouter } from 'next/navigation';
export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-sm text-ink-muted underline"
      onClick={() => {
        void fetch('/api/session', { method: 'DELETE' }).then(() => {
          router.replace('/login');
          router.refresh();
        });
      }}
    >
      Sair
    </button>
  );
}
