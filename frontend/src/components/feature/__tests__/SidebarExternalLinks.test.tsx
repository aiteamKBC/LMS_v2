import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { adminNavItems } from '@/mocks/navigation';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canSeeNavItem: () => true }) }));

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

function showAdminSidebar() {
  render(
    <MemoryRouter initialEntries={['/workspace/admin']}>
      <Sidebar role="admin" roleLabel="Super Admin" navItems={adminNavItems} pinned mobileOpen={false} onCloseMobile={() => {}} />
      <CurrentPath />
    </MemoryRouter>,
  );
  const sidebar = screen.getByRole('complementary', { name: 'Super Admin sidebar' });
  const rail = within(within(sidebar).getByRole('navigation', { name: 'Super Admin primary navigation' }));
  // Hovering the group opens its children, wherever the sidebar renders them.
  fireEvent.mouseEnter(rail.getByRole('button', { name: 'External tools' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kbc_sidebar_expanded', '[]');
});

describe('Super Admin external tools', () => {
  it.each([
    ['Positive Moments', 'https://positive-moments.kentbusinesscollege.net'],
    ['Tutor Dashboard', 'https://tutordashboard.kentbusinesscollege.net'],
  ])('opens %s in a new tab without leaving the LMS', (label, href) => {
    showAdminSidebar();
    const link = screen.getByRole('link', { name: `${label} (opens in a new tab)` });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('aria-current');
    fireEvent.click(link);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/workspace/admin');
  });

  it('leaves in-app destinations as same-tab router links', () => {
    showAdminSidebar();
    const internal = screen.getAllByRole('link', { name: 'Platform Report' })[0];
    expect(internal).toHaveAttribute('href', '/admin/platform-report');
    expect(internal).not.toHaveAttribute('target');
    expect(internal).not.toHaveAttribute('rel');
  });

  it('marks only the two college sites as external', () => {
    const external = adminNavItems.flatMap(item => [item, ...(item.children ?? [])]).filter(item => item.external);
    expect(external.map(item => item.href)).toEqual([
      'https://positive-moments.kentbusinesscollege.net',
      'https://tutordashboard.kentbusinesscollege.net',
    ]);
  });
});
