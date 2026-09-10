import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WorkspaceShell } from '../WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import type { SidebarNavItem } from '../Sidebar';
import { AuditWorkspaceShell } from '@/features/audit/AuditWorkspaceShell';

const { denied, viewer } = vi.hoisted(() => ({ denied: new Set<string>(), viewer: { isAdmin: false } }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    auth: { user: { fullName: 'Workspace User' }, roles: [] },
    isAdmin: viewer.isAdmin,
    canSeeNavItem: (id: string) => !denied.has(id),
  }),
}));
vi.mock('@/hooks/useLearnerNavGate', () => ({
  useLearnerNavGate: (_role: string, items: SidebarNavItem[]) => items,
}));
vi.mock('../GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('../CoachViewAsBar', () => ({ CoachViewAsBar: () => null }));
vi.mock('../Header', () => ({
  Header: ({ onToggleMobileSidebar }: { onToggleMobileSidebar: () => void }) => (
    <button onClick={onToggleMobileSidebar}>Open mobile navigation</button>
  ),
}));

function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}{location.search}</output>;
}

function showWorkspace(role: string, initialPath?: string, navItems = roleNavMap[role].items) {
  const config = roleNavMap[role];
  const { container } = render(
    <MemoryRouter initialEntries={[initialPath || config.items.find(item => item.href)?.href || '/']}>
      <WorkspaceShell role={role} roleLabel={config.label} navItems={navItems} pageTitle="Workspace">
        <CurrentRoute />
      </WorkspaceShell>
    </MemoryRouter>,
  );
  const sidebar = screen.getByRole('complementary', { name: `${config.label} sidebar` });
  return {
    sidebar,
    shell: container.querySelector<HTMLElement>('.workspace-shell')!,
    rail: within(sidebar).getByRole('navigation', { name: `${config.label} primary navigation` }),
    panel: document.getElementById(`${role}-secondary-navigation`)!,
  };
}

beforeEach(() => {
  denied.clear();
  viewer.isAdmin = false;
  localStorage.clear();
  sessionStorage.clear();
});

it.each(['/users', '/users/42', '/users/42/wizard/introduction', '/employers/8', '/employers/8/learner/commercial/42'])(
  'retains Enrolment navigation and the updated page styling for an admin on %s', path => {
    viewer.isAdmin = true;
    render(
      <MemoryRouter initialEntries={[path]}>
        <WorkspaceShell role="compliance" roleLabel="Enrolment Officer" navItems={roleNavMap.apprentice.items} pageTitle="Users">
          <CurrentRoute />
        </WorkspaceShell>
      </MemoryRouter>,
    );
    const sidebar = screen.getByRole('complementary', { name: 'Enrolment Officer sidebar' });
    expect(sidebar.closest('.workspace-shell')).toHaveAttribute('data-workspace-role', 'admin');
    expect(sidebar).toHaveAttribute('data-workspace-role', 'compliance');
    expect(within(sidebar).queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
    const panel = within(document.getElementById('compliance-secondary-navigation')!);
    expect(panel.getAllByRole('link')).toHaveLength(1);
    expect(panel.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    expect(panel.queryByRole('link', { name: 'Roles' })).toBeNull();
    expect(screen.getByTestId('route')).toHaveTextContent(path);
  },
);

it('retains enrolment navigation for a non-admin opening the shared directory', () => {
  const { sidebar } = showWorkspace('compliance', '/users');
  expect(sidebar.closest('.workspace-shell')).toHaveAttribute('data-workspace-role', 'compliance');
  expect(screen.queryByRole('complementary', { name: 'Super Admin sidebar' })).toBeNull();
});

it('keeps an administrator in the selected coach workspace', () => {
  viewer.isAdmin = true;
  const { sidebar } = showWorkspace('coach', '/workspace/coach');
  expect(sidebar.closest('.workspace-shell')).toHaveAttribute('data-workspace-role', 'coach');
});

it.each([
  ['admin', '/workspace/admin'],
  ['coach', '/workspace/coach'],
  ['apprentice', '/users'],
  ['engagement', '/workspace/engagement'],
  ['tutor', '/workspace/tutor'],
  ['curriculum', '/workspace/curriculum'],
  ['auditor', '/workspace/auditor'],
])('uses the original %s menu for an administrator with the new open/close behaviour', (role, path) => {
  viewer.isAdmin = true;
  const { sidebar, rail, panel } = showWorkspace(role, path);
  const config = roleNavMap[role];
  const controls = Array.from(rail.querySelectorAll('a, button'));
  expect(controls).toHaveLength(config.items.length);
  expect(controls.map(control => control.getAttribute('title'))).toEqual(config.items.map(item => item.label));
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
  expect(panel).not.toHaveAttribute('inert');
  expect(sidebar.style.width).toBe('338px');
  fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
  expect(panel).toHaveAttribute('inert');
  expect(sidebar.style.width).toBe('88px');
  expect(screen.getByTestId('route')).toHaveTextContent(path);
});

describe.each(Object.keys(roleNavMap))('%s shared workspace sidebar', role => {
  it('opens and closes the same layout, reserving room for the panel', () => {
    const { sidebar, shell, panel } = showWorkspace(role);
    expect(sidebar.style.width).toBe('88px');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('112px');
    expect(panel).toHaveAttribute('inert');

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
    expect(sidebar.style.width).toBe('338px');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('362px');
    expect(panel).not.toHaveAttribute('inert');
    expect(localStorage.getItem('kbc_sidebar_pinned')).toBe('true');

    fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
    expect(sidebar.style.width).toBe('88px');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('112px');
    expect(panel).toHaveAttribute('inert');
  });

  it('keeps role-specific destinations, route highlighting and navigation', () => {
    const config = roleNavMap[role];
    const item = config.items.find(item => item.children?.length) || config.items[0];
    const destination = item.children?.[0] || item;
    const { sidebar, rail, panel } = showWorkspace(role, destination.href);
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
    const link = within(panel).getAllByRole('link').find(link => link.getAttribute('href') === destination.href)!;
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getAllByRole(item.children?.length ? 'button' : 'link')
      .some(item => item.hasAttribute('aria-current'))).toBe(true);
    fireEvent.click(link);
    expect(screen.getByTestId('route')).toHaveTextContent(destination.href!);
  });

  it('closes the mobile drawer after navigation without expanding desktop content', () => {
    const { shell } = showWorkspace(role);
    const drawer = screen.getByLabelText(`${roleNavMap[role].label} mobile navigation`);
    expect(drawer).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Open mobile navigation' }));
    expect(drawer).not.toHaveAttribute('inert');
    fireEvent.click(within(drawer).getAllByRole('link')[0]);
    expect(drawer).toHaveAttribute('inert');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('112px');
  });
});

it('filters restricted groups and children in non-admin workspaces', () => {
  const groups = roleNavMap.coach.items.filter(item => (item.children?.length ?? 0) > 1);
  denied.add(groups[0].id);
  denied.add(groups[1].children![0].id);
  const { rail, panel } = showWorkspace('coach');
  expect(within(rail).queryByRole('button', { name: groups[0].label })).toBeNull();
  fireEvent.click(within(rail).getByRole('button', { name: groups[1].label }));
  expect(within(panel).getAllByRole('link').some(link => link.getAttribute('href') === groups[1].children![0].href)).toBe(false);
});

it.each([false, true])('navigates directly to a standalone page without opening a subsidebar (already open: %s)', open => {
  const { sidebar, rail, panel, shell } = showWorkspace('admin', '/workspace/admin');
  if (open) {
    const group = roleNavMap.admin.items.find(item => item.children?.length)!;
    fireEvent.click(within(rail).getByRole('button', { name: group.label }));
    expect(panel).not.toHaveAttribute('inert');
  }
  const report = within(rail).getByRole('link', { name: 'Platform Report' });
  fireEvent.mouseEnter(report);
  fireEvent.focus(report);
  if (open) expect(within(panel).queryByRole('link', { name: 'Platform Report' })).toBeNull();
  fireEvent.click(report);
  expect(screen.getByTestId('route')).toHaveTextContent('/admin/platform-report');
  expect(panel).toHaveAttribute('inert');
  expect(sidebar.style.width).toBe('88px');
  expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('112px');
});

it('closes the subsidebar when clicking the standalone page that is already active', () => {
  const { sidebar, rail, panel } = showWorkspace('admin', '/admin/platform-report');
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
  fireEvent.click(within(rail).getByRole('link', { name: 'Platform Report' }));
  expect(panel).toHaveAttribute('inert');
  expect(screen.getByTestId('route')).toHaveTextContent('/admin/platform-report');
});

it('navigates directly when permission filtering leaves a group with no visible children', () => {
  const group: SidebarNavItem = { id: 'reports', label: 'Reports', href: '/reports', children: [
    { id: 'restricted-report', label: 'Restricted report', href: '/reports/restricted' },
  ] };
  group.children!.forEach(child => denied.add(child.id));
  const { rail, panel } = showWorkspace('admin', '/admin/platform-report', [group]);
  fireEvent.click(within(rail).getByRole('link', { name: group.label }));
  expect(screen.getByTestId('route')).toHaveTextContent(group.href!);
  expect(panel).toHaveAttribute('inert');
});

it.each(['/workspace/audit', '/workspace/auditor-copy', '/workspace/auditor-manual', '/workspace/auditor-hours-test'])(
  'keeps the audit sidebar inside its own system at %s', homePath => {
    render(
      <MemoryRouter initialEntries={[`${homePath}#/search`]}>
        <AuditWorkspaceShell homePath={homePath} title="Audit">
          <CurrentRoute />
        </AuditWorkspaceShell>
      </MemoryRouter>,
    );
    const sidebar = screen.getByRole('complementary', { name: 'Auditor sidebar' });
    const rail = within(sidebar).getByRole('navigation', { name: 'Auditor primary navigation' });
    const link = within(rail).getByRole('link', { name: 'Audit' });
    expect(link).toHaveAttribute('href', homePath);
    fireEvent.click(link);
    expect(screen.getByTestId('route')).toHaveTextContent(homePath);
  },
);
