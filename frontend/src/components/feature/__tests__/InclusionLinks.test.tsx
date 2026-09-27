import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CoachSidebar } from '../CoachSidebar';
import { Sidebar } from '../Sidebar';
import { adminNavItems, coachNavItems, learnerNavItems } from '@/mocks/navigation';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canSeeNavItem: () => true }) }));
afterEach(cleanup);

it.each([false, true])('opens coach Inclusion through a real external link (collapsed=%s)', collapsed => {
  render(<MemoryRouter><CoachSidebar navItems={coachNavItems} userName="Coach" userRole="coach"
    mobileOpen={false} onCloseMobile={() => {}} onOpenAccount={() => {}} collapsed={collapsed} onCollapsedChange={() => {}} /></MemoryRouter>);
  const link = screen.getByRole('link', { name: 'Inclusion Ticket System' });
  expect(link).toHaveAttribute('href', coachNavItems.find(item => item.id === 'coach-inclusion')!.href);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('exposes a labelled Inclusion icon to super admins', () => {
  render(<MemoryRouter><Sidebar role="admin" roleLabel="Super Admin" navItems={adminNavItems}
    mobileOpen={false} onCloseMobile={() => {}} /></MemoryRouter>);
  const link = screen.getAllByRole('link', { name: /Inclusion System/ })[0];
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('href', adminNavItems.find(item => item.id === 'admin-inclusion')!.href);
  expect(learnerNavItems.some(item => item.id.includes('inclusion'))).toBe(false);
});
