import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  render(
    <MemoryRouter initialEntries={[path]}>
      <ControlledSidebar />
      <CurrentPath />
    </MemoryRouter>,
  );
  const sidebar = screen.getByRole('complementary', { name: 'Super Admin sidebar' });
  return {
    rail: within(within(sidebar).getByRole('navigation', { name: 'Super Admin primary navigation' })),
    panel: within(sidebar.querySelector('#admin-secondary-navigation') as HTMLElement),
  };
}

beforeEach(() => {
  denied.clear();
  localStorage.clear();
  localStorage.setItem('kbc_sidebar_expanded', '[]');
});

describe('Super Admin secondary navigation preview', () => {
  it('closes when the pointer leaves the entire sidebar', () => {
    const { rail } = showSidebar();
    fireEvent.mouseEnter(rail.getByRole('button', { name: 'Platform' }));
    fireEvent.mouseLeave(screen.getByRole('complementary', { name: 'Super Admin sidebar' }), { relatedTarget: document.body });
    expect(document.getElementById('admin-secondary-navigation')).toHaveAttribute('inert');
    expect(document.getElementById('admin-secondary-navigation')).toHaveAttribute('aria-hidden', 'true');
    expect(rail.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });

  it.each([
    ['/workspace/admin', 'Dashboard'],
    ['/admin/roles', 'Roles'],
  ])('opens the current page from the hamburger on %s instead of the last preview', (path, label) => {
    const { rail, panel } = showSidebar(path);
    fireEvent.mouseEnter(rail.getByRole('button', { name: 'Platform' }));
    const sidebar = screen.getByRole('complementary', { name: 'Super Admin sidebar' });
    fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
    // Even hovering another icon while collapsed must not change what the hamburger opens.
    fireEvent.mouseEnter(rail.getByRole('link', { name: 'Platform Report' }));
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
    expect(document.getElementById('admin-secondary-navigation')).not.toHaveAttribute('inert');
    expect(panel.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(panel.queryByRole('link', { name: 'Platform Report' })).toBeNull();
    expect(screen.getByTestId('current-path')).toHaveTextContent(path);
  });

  it.each([
    ['button', 'Platform', 'Documents'],
    ['link', 'Platform Report', 'Platform Report'],
  ])('clears the hover appearance for %s %s while retaining its panel', (role, label, childLabel) => {
    const { rail, panel } = showSidebar();
    const item = rail.getByRole(role, { name: label });
    const idleClasses = item.className;
    fireEvent.mouseEnter(item);
    fireEvent.mouseLeave(item, { relatedTarget: document.getElementById('admin-secondary-navigation') });
    expect(item.className).toBe(idleClasses);
    expect(item).not.toHaveAttribute('aria-current');
    expect(panel.getByRole('link', { name: childLabel })).toBeTruthy();
    expect(rail.getByRole('link', { name: 'Dashboard' })).toHaveClass('bg-brand-accent');
  });

  it.each([
    ['/workspace/admin', 'link', 'Dashboard'],
    ['/admin/roles', 'button', 'User & Access Control'],
  ])('keeps the current main item active on %s while another group is previewed', (path, role, label) => {
    const { rail } = showSidebar(path);
    const active = rail.getByRole(role, { name: label });
    fireEvent.mouseEnter(rail.getByRole('button', { name: 'Platform' }));
    expect(active).toHaveClass('bg-brand-accent');
    expect(active).toHaveAttribute('aria-current');
    expect(rail.getByRole('button', { name: 'Platform' })).not.toHaveClass('bg-brand-accent');
  });

  it('opens the collapsed panel on group click and keeps it open on repeated clicks', () => {
    const { rail, panel } = showSidebar('/workspace/admin', false);
    const group = rail.getByRole('button', { name: 'Platform' });
    expect(document.getElementById('admin-secondary-navigation')).toHaveAttribute('inert');
    fireEvent.click(group);
    expect(document.getElementById('admin-secondary-navigation')).not.toHaveAttribute('inert');
    expect(panel.getByRole('link', { name: 'Documents' })).toBeTruthy();
    fireEvent.click(group);
    expect(panel.getByRole('link', { name: 'Documents' })).toBeTruthy();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/workspace/admin');
  });

  it('opens the panel for a clicked direct link and preserves navigation', () => {
    const { rail, panel } = showSidebar('/workspace/admin', false);
    fireEvent.click(rail.getByRole('link', { name: 'Platform Report' }));
    expect(panel.getByRole('link', { name: 'Platform Report' })).toHaveAttribute('href', '/admin/platform-report');
    expect(document.getElementById('admin-secondary-navigation')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin/platform-report');
  });

  it('shows only the hovered group, regardless of saved accordion state', () => {
    const { rail, panel } = showSidebar();
    fireEvent.mouseEnter(rail.getByRole('button', { name: 'User & Access Control' }));
    expect(panel.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/admin/users');
    expect(panel.queryByRole('link', { name: 'Documents' })).toBeNull();
    fireEvent.mouseEnter(rail.getByRole('button', { name: 'Platform' }));
    expect(panel.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/admin/documents');
    expect(panel.queryByRole('link', { name: 'Accounts' })).toBeNull();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/workspace/admin');
  });

  it('keeps the preview available while moving into its submenu', () => {
    const { rail, panel } = showSidebar();
    const group = rail.getByRole('button', { name: 'Platform' });
    fireEvent.mouseEnter(group);
    const documents = panel.getByRole('link', { name: 'Documents' });
    fireEvent.mouseLeave(group, { relatedTarget: documents });
    fireEvent.mouseEnter(documents);
    fireEvent.click(documents);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin/documents');
  });

  it.each(['Dashboard', 'Platform Report'])('repeats the %s icon and original link when it has no submenu', (label) => {
    const { rail, panel } = showSidebar();
    const primary = rail.getByRole('link', { name: label });
    fireEvent.mouseEnter(primary);
    const secondary = panel.getByRole('link', { name: label });
    expect(panel.getAllByRole('link')).toHaveLength(1);
    expect(secondary).toHaveAttribute('href', primary.getAttribute('href'));
    expect(secondary.querySelector('svg')?.innerHTML).toBe(primary.querySelector('svg')?.innerHTML);
  });

  it('supports keyboard focus and starts with the current route group', () => {
    const { rail, panel } = showSidebar('/admin/roles');
    expect(panel.getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page');
    fireEvent.focus(rail.getByRole('button', { name: 'Platform' }));
    expect(panel.getByRole('link', { name: 'Evidence' })).toBeTruthy();
    expect(panel.queryByRole('link', { name: 'Roles' })).toBeNull();
  });

  it('uses permission-filtered navigation for both groups and children', () => {
    denied.add('admin-group-platform');
    denied.add('admin-permissions');
    const { rail, panel } = showSidebar();
    expect(rail.queryByRole('button', { name: 'Platform' })).toBeNull();
    fireEvent.mouseEnter(rail.getByRole('button', { name: 'User & Access Control' }));
    expect(panel.queryByRole('link', { name: 'Permissions' })).toBeNull();
    expect(panel.getByRole('link', { name: 'Accounts' })).toBeTruthy();
  });
});
