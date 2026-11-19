import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { adminNavItems } from '@/mocks/navigation';

const { denied, auth } = vi.hoisted(() => {
  const denied = new Set<string>();
  return { denied, auth: { canSeeNavItem: (id: string) => !denied.has(id) } };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

function showSidebar(path = '/workspace/admin', pinned = true) {
  function ControlledSidebar() {
    const [open, setOpen] = useState(pinned);
    return <Sidebar role="admin" roleLabel="Super Admin" navItems={adminNavItems}
      pinned={open} onPinChange={setOpen} mobileOpen={false} onCloseMobile={() => {}} />;
  }
  render(<MemoryRouter initialEntries={[path]}><ControlledSidebar /><CurrentPath /></MemoryRouter>);
  const sidebar = screen.getByRole('complementary', { name: 'Super Admin sidebar' });
  return { sidebar, nav: within(sidebar).getByRole('navigation', { name: 'Super Admin primary navigation' }) };
}

beforeEach(() => {
  denied.clear();
  localStorage.clear();
  localStorage.setItem('kbc_sidebar_expanded', '[]');
});

describe('Super Admin single-column navigation', () => {
  it('shows every permitted section with its icon and label in one list', () => {
    const { sidebar, nav } = showSidebar();
    expect(within(sidebar).getAllByRole('navigation')).toHaveLength(1);
    expect(document.getElementById('admin-secondary-navigation')).toBeNull();
    for (const item of adminNavItems) {
      const control = within(nav).getByRole(item.children?.length ? 'button' : 'link', { name: item.external ? `${item.label} (opens in a new tab)` : item.label });
      expect(control.querySelector('svg')).not.toBeNull();
      expect(within(control).getByText(item.label, { exact: false })).not.toHaveClass('sr-only');
    }
  });

  it('keeps the complete list open when the pointer leaves', () => {
    const { sidebar, nav } = showSidebar();
    fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
    expect(within(sidebar).queryByRole('button', { name: /^(Collapse|Expand) navigation$/ })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Platform' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('discloses children inline without replacing other sections or changing the route', () => {
    const { nav } = showSidebar();
    const access = within(nav).getByRole('button', { name: 'User & Access Control' });
    const platform = within(nav).getByRole('button', { name: 'Platform' });
    fireEvent.click(access);
    fireEvent.click(platform);
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/admin/users');
    expect(within(nav).getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/admin/documents');
    fireEvent.click(platform);
    expect(within(nav).queryByRole('link', { name: 'Documents' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toBeVisible();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/workspace/admin');
  });

  it.each([['/workspace/admin', 'Dashboard'], ['/admin/roles', 'Roles']])(
    'retains the active destination when leaving the permanently open menu on %s', (path, label) => {
      const { sidebar, nav } = showSidebar(path);
      fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('current-path')).toHaveTextContent(path);
    },
  );

  it('ignores the legacy collapsed prop and discloses groups inline', () => {
    const { sidebar, nav } = showSidebar('/workspace/admin', false);
    fireEvent.click(within(nav).getByRole('button', { name: 'Platform' }));
    expect(within(sidebar).queryByRole('button', { name: /^(Collapse|Expand) navigation$/ })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Documents' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeVisible();
    fireEvent.click(within(nav).getByRole('button', { name: 'Platform' }));
    expect(within(nav).queryByRole('link', { name: 'Documents' })).toBeNull();
  });

  it.each([false, true])('preserves direct navigation regardless of the legacy pinned state (%s)', open => {
    const { sidebar, nav } = showSidebar('/workspace/admin', open);
    fireEvent.click(within(nav).getByRole('link', { name: 'Platform Report' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin/platform-report');
    expect(sidebar.style.width).toBe('264px');
    expect(within(sidebar).queryByRole('button', { name: /^(Collapse|Expand) navigation$/ })).toBeNull();
  });

  it('supports keyboard disclosure and child navigation', async () => {
    const user = userEvent.setup();
    const { nav } = showSidebar();
    within(nav).getByRole('button', { name: 'Platform' }).focus();
    await user.keyboard('{Enter}');
    const documents = within(nav).getByRole('link', { name: 'Documents' });
    documents.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin/documents');
    expect(documents).toHaveAttribute('aria-current', 'page');
  });

  it('filters forbidden groups and children in the same list', () => {
    denied.add('admin-group-platform');
    denied.add('admin-permissions');
    const { nav } = showSidebar();
    expect(within(nav).queryByRole('button', { name: 'Platform' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: 'User & Access Control' }));
    expect(within(nav).queryByRole('link', { name: 'Permissions' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/admin/users');
  });
});
