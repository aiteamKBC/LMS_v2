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

function showWorkspace(role: string, initialPath?: string) {
  const config = roleNavMap[role];
  const { container } = render(
    <MemoryRouter initialEntries={[initialPath || config.items.find(item => item.href)?.href || '/']}>
      <WorkspaceShell role={role} roleLabel={config.label} navItems={config.items} pageTitle="Workspace">
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

it('groups learner progress pages in the same menu while keeping direct destinations fixed', () => {
  const { sidebar, rail, panel } = showWorkspace('learner', '/learner/clubs/events');
  expect(within(rail).getByRole('button', { name: 'My Progress' })).toHaveAttribute('aria-expanded', 'false');
  for (const name of ['Monthly Logs', 'Monthly Coaching Meeting', 'Progress Review']) {
    expect(within(rail).queryByRole('link', { name })).not.toBeInTheDocument();
  }
  expect(within(rail).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  for (const name of ['Readiness', 'Community', 'Help']) {
    expect(within(rail).queryByRole('button', { name })).not.toBeInTheDocument();
  }
  expect(within(rail).queryByRole('link', { name: /training plan/i })).not.toBeInTheDocument();
  expect(panel).toBeNull();
  fireEvent.mouseEnter(within(rail).getByRole('link', { name: 'Dashboard' }));
  fireEvent.focus(within(rail).getByRole('link', { name: 'Dashboard' }));
  expect(sidebar.style.width).toBe('88px');
  fireEvent.click(within(rail).getByRole('button', { name: 'My Progress' }));
  expect(within(sidebar).getAllByRole('link', { name: 'Dashboard' })).toHaveLength(1);
  expect(within(rail).getByRole('button', { name: 'My Progress' })).toHaveAttribute('aria-expanded', 'true');
  const destinations = within(rail).getAllByRole('link').map(link => link.getAttribute('href'));
  for (const name of ['Monthly Logs', 'Monthly Coaching Meeting', 'Progress Review', 'Dashboard']) {
    const link = within(rail).getByRole('link', { name });
    fireEvent.mouseEnter(link);
    fireEvent.focus(link);
    fireEvent.click(link);
    expect(screen.getByTestId('route')).toHaveTextContent(link.getAttribute('href')!);
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(sidebar.style.width).toBe('338px');
    expect(within(rail).getAllByRole('link').map(item => item.getAttribute('href'))).toEqual(destinations);
  }
  fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
  expect(sidebar.style.width).toBe('338px');
  fireEvent.click(within(rail).getByRole('button', { name: 'My Progress' }));
  expect(within(rail).getByRole('button', { name: 'My Progress' })).toHaveAttribute('aria-expanded', 'false');
  expect(within(rail).queryByRole('link', { name: 'Monthly Logs' })).not.toBeInTheDocument();
  expect(within(rail).getByRole('link', { name: 'Dashboard' })).toBeVisible();
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
  it('reserves the chosen navigation width and supports manual collapse', () => {
    const { sidebar, shell, panel } = showWorkspace(role);
    expect(sidebar.style.width).toBe('88px');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('112px');
    if (role === 'learner') expect(panel).toBeNull();
    else expect(panel).toHaveAttribute('inert');

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
    expect(sidebar.style.width).toBe('338px');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('362px');
    if (role !== 'learner') expect(panel).not.toHaveAttribute('inert');
    expect(localStorage.getItem('kbc_sidebar_pinned')).toBe('true');

    fireEvent.mouseLeave(sidebar, { relatedTarget: document.body });
    if (role === 'learner') {
      expect(sidebar.style.width).toBe('338px');
      fireEvent.click(within(sidebar).getByRole('button', { name: 'Collapse navigation' }));
    }
    expect(sidebar.style.width).toBe('88px');
    expect(shell.style.getPropertyValue('--kbc-sidebar-width')).toBe('112px');
    if (role !== 'learner') expect(panel).toHaveAttribute('inert');
  });

  it('keeps role-specific destinations, route highlighting and navigation', () => {
    const config = roleNavMap[role];
    const item = config.items.find(item => item.children?.length) || config.items[0];
    const destination = item.children?.[0] || item;
    const { sidebar, rail, panel } = showWorkspace(role, destination.href);
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Expand navigation' }));
    const link = within(role === 'learner' ? rail : panel).getAllByRole('link').find(link => link.getAttribute('href') === destination.href)!;
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getAllByRole(role !== 'learner' && item.children?.length ? 'button' : 'link')
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
