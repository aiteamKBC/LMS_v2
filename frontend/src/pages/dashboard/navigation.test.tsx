import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import QualityAssurancePage from './page';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: 1 } } }) }));
vi.mock('./useQualityNotifications', () => ({ useQualityNotifications: () => ({ notifications: [], loading: false, error: '', refresh: vi.fn() }) }));
vi.mock('@/pages/executive/page', () => ({ default: ({ attentionPanel }: { attentionPanel: ReactNode }) => <><h1>Quality overview</h1>{attentionPanel}</> }));
vi.mock('./components/DeepDivePage', () => ({ default: () => <h1>Deep Dive content</h1> }));
vi.mock('@/components/feature/Header', () => ({ Header: () => null }));
vi.mock('@/components/feature/Sidebar', () => ({ Sidebar: ({ navItems }: { navItems: SidebarNavItem[] }) => <nav aria-label="Curriculum menu">
  {navItems.flatMap(item => [item, ...(item.children || [])]).filter(item => item.href).map(item => <Link key={item.id} to={item.href!} aria-current={item.active ? 'page' : undefined}>{item.label}</Link>)}
</nav> }));

beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ReviewDestination() {
  const location = useLocation();
  return <output aria-label="Saved reviews destination">{location.pathname}{location.search}</output>;
}

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/curriculum/quality-demo" element={<QualityAssurancePage />} />
    <Route path="/curriculum/coaching-recordings/reviews" element={<ReviewDestination />} />
  </Routes></MemoryRouter>);
}

it('keeps the Curriculum menu while opening Deep Dive and returning directly to the quality overview', async () => {
  open('/curriculum/quality-demo?view=deep-dive&programme=example');
  const menu = within(screen.getByRole('navigation', { name: 'Curriculum menu' }));
  expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/workspace/curriculum');
  expect(menu.getByRole('link', { name: 'Deep Dive' })).toHaveAttribute('aria-current', 'page');
  expect(menu.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Deep Dive content' })).toBeInTheDocument();
  fireEvent.click(menu.getByRole('link', { name: 'Quality Assurance' }));
  await screen.findByRole('heading', { name: 'Quality overview' });
  expect(menu.getByRole('link', { name: 'Quality Assurance' })).toHaveAttribute('aria-current', 'page');
  expect(menu.getByRole('link', { name: 'Deep Dive' })).not.toHaveAttribute('aria-current');
  fireEvent.click(menu.getByRole('link', { name: 'Quality Checks' }));
  await waitFor(() => expect(screen.getByLabelText('Saved reviews destination')).toHaveTextContent('/curriculum/coaching-recordings/reviews'));
});

it('opens old Quality Checks links directly and preserves saved review and filter parameters', async () => {
  open('/curriculum/quality-demo?view=checks&type=FORM_EXAMPLE&status=all&review=00000000-0000-4000-8000-000000000001&from=2026-11-01');
  const destination = await screen.findByLabelText('Saved reviews destination');
  expect(destination).toHaveTextContent('/curriculum/coaching-recordings/reviews?type=FORM_EXAMPLE&status=all&review=00000000-0000-4000-8000-000000000001&from=2026-11-01');
  expect(destination).not.toHaveTextContent('view=checks');
});
