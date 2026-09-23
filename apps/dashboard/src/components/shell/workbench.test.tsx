import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi, expect, it } from 'vitest';
import { Workbench } from './workbench';

let pathname = '/bots';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./thread-rail', () => ({
  ThreadRail: () => <nav aria-label="Conversas">Conversa de teste</nav>,
}));

it.each([
  ['/bots', 'Bots'],
  ['/projetos', 'Projetos'],
  ['/ambientes', 'Ambientes'],
  ['/previas', 'Prévias'],
  ['/integracoes', 'Integrações'],
  ['/', 'Telemetria'],
  ['/threads/example/response', 'Telemetria'],
])('keeps the same navigation and marks the current section at %s', (path, label) => {
  pathname = path;
  render(<Workbench>Conteúdo da página</Workbench>);
  const navigation = screen.getByRole('navigation', { name: 'Principal' });
  expect(within(navigation).getAllByRole('link')).toHaveLength(6);
  expect(within(navigation).getByRole('link', { name: label })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(screen.getAllByRole('main')).toHaveLength(1);
});

it('closes the mobile menu after navigation and restores its trigger on Escape', () => {
  pathname = '/bots';
  render(<Workbench>Conteúdo da página</Workbench>);
  const trigger = screen.getByRole('button', { name: 'Abrir menu' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('link', { name: 'Projetos' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('navigation', { name: 'Principal' }), { key: 'Escape' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
});
