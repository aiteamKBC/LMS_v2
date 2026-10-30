/**
 * The workspace switcher's contract.
 *
 * It replaced a five-card panel on the Super Admin dashboard. The panel's real
 * problem was where it lived — only on the dashboard, so changing section meant
 * going home first — so what matters here is that the switcher offers the whole
 * curated list and works from any page. It sits in the shared header, which
 * every role renders, so the gating is pinned too.
 *
 * Also pinned: it navigates and nothing more. The dead RoleSwitcher it replaced
 * called switchRole to assume a role; an administrator already has access to
 * every section, so doing that here would mutate RBAC state for no reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { workspacesFor } from '@/lib/portalWorkspaces';
import type { AccessWorkspace } from '@/api/auth';

const authValue = vi.fn();
const switchRole = vi.fn();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authValue() }));

const { WorkspaceSwitcher } = await import('../WorkspaceSwitcher');

function signedIn({ isAdmin = true, isAuthenticated = true, access = 'coach', accessWorkspaces = undefined }:
  { isAdmin?: boolean; isAuthenticated?: boolean; access?: string; accessWorkspaces?: AccessWorkspace[] } = {}) {
  authValue.mockReturnValue({ auth: { isAuthenticated,
    account: { role: isAdmin ? 'admin' : 'staff', access, accessWorkspaces } }, isAdmin, switchRole });
}

/** Reports the current URL, so a navigation is observable. */
function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <WorkspaceSwitcher />
      <CurrentPath />
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByTitle('Switch workspace');
const path = () => screen.getByTestId('path').textContent;

beforeEach(() => {
  switchRole.mockClear();
});

describe('WorkspaceSwitcher', () => {
  it('uses the prominent shared trigger treatment for an administrator', () => {
    signedIn();
    renderAt('/workspace/coach');
    expect(trigger()).toHaveClass('kbc-workspace-switcher-button', 'font-bold', 'shadow-sm');
  });

  it('is hidden from a non-admin with no workspaces', () => {
    signedIn({ isAdmin: false });
    renderAt('/workspace/coach');
    expect(screen.queryByTitle('Switch workspace')).toBeNull();
  });

  it('is hidden when only one workspace is granted', () => {
    signedIn({ isAdmin: false, accessWorkspaces: [{ access: 'coach', home: '/workspace/coach' }] });
    renderAt('/workspace/coach');
    expect(screen.queryByTitle('Switch workspace')).toBeNull();
  });

  it('offers only the granted workspaces and switches both ways without changing identity', async () => {
    signedIn({ isAdmin: false, accessWorkspaces: [
      { access: 'coach', home: '/workspace/coach' }, { access: 'tutor', home: '/workspace/tutor' },
    ] });
    const user = userEvent.setup();
    renderAt('/workspace/coach');
    await user.click(trigger());
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.queryByRole('menuitem', { name: /Super Admin|Curriculum|Learner|Enrolment/ })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: /Tutor/ }));
    expect(path()).toBe('/workspace/tutor');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger());
    expect(screen.getByRole('menuitem', { name: /Tutor/ })).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(path()).toBe('/workspace/coach');
    expect(switchRole).not.toHaveBeenCalled();
  });

  it.each(['commercial', 'apprenticeship'])('uses the server destination for the staff member’s own %s record', async kind => {
    const home = `/workspace/learner/${kind}/512`;
    signedIn({ isAdmin: false, accessWorkspaces: [
      { access: 'coach', home: '/workspace/coach' }, { access: 'learner', home },
    ] });
    renderAt('/workspace/coach');
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: /Learner/ }));
    expect(path()).toBe(home);
    await userEvent.click(trigger());
    expect(screen.getByRole('menuitem', { name: /Learner/ })).toHaveAttribute('aria-current', 'true');
  });

  it.each(['coach', 'record-monitor'])('includes monitoring when the primary grant is %s', async access => {
    signedIn({ isAdmin: false, access, accessWorkspaces: [
      { access: 'coach', home: '/workspace/coach' }, { access: 'record-monitor', home: '/old-otjh/monitor' },
    ] });
    renderAt('/workspace/coach');
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: /Learning record monitoring/ }));
    expect(path()).toBe('/old-otjh/monitor');
    await userEvent.click(trigger());
    expect(screen.getByRole('menuitem', { name: /Learning record monitoring/ })).toHaveAttribute('aria-current', 'true');
  });

  it('offers enrolment and support without adding unrelated admin workspaces', async () => {
    signedIn({ isAdmin: false, access: 'enrolment', accessWorkspaces: [
      { access: 'enrolment', home: '/users' }, { access: 'support', home: '/support/ticket-queue' },
    ] });
    renderAt('/users');
    await userEvent.click(trigger());
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByRole('menuitem', { name: /Enrolment/ })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: /Support/ }));
    expect(path()).toBe('/support/ticket-queue');
  });

  it('excludes Advanced Admin accounts even if extra workspaces are present', () => {
    signedIn({ isAdmin: false, access: 'advanced-admin', accessWorkspaces: [
      { access: 'advanced-admin', home: '/workspace/advanced-admin' }, { access: 'coach', home: '/workspace/coach' },
    ] });
    renderAt('/workspace/advanced-admin');
    expect(screen.queryByTitle('Switch workspace')).toBeNull();
  });

  it('removes the switcher when a refreshed account loses its second grant', async () => {
    const coach = { access: 'coach', home: '/workspace/coach' };
    signedIn({ isAdmin: false, accessWorkspaces: [coach, { access: 'tutor', home: '/workspace/tutor' }] });
    const view = renderAt('/workspace/coach');
    await userEvent.click(trigger());
    signedIn({ isAdmin: false, accessWorkspaces: [coach] });
    view.rerender(<MemoryRouter><WorkspaceSwitcher /><CurrentPath /></MemoryRouter>);
    expect(screen.queryByTitle('Switch workspace')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is hidden when nobody is signed in', () => {
    signedIn({ isAuthenticated: false });
    renderAt('/workspace/coach');
    expect(screen.queryByTitle('Switch workspace')).toBeNull();
  });

  it('offers every curated workspace, Super Admin included', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/coach');
    await user.click(trigger());

    // The menu labels each workspace; the trigger keeps its neutral label.
    const menu = within(screen.getByRole('menu'));
    // Learner is offered only to an account that has a record of its own, and
    // this signed-in admin has none -- so the menu is what workspacesFor
    // returns for them, not the whole curated list.
    const offered = workspacesFor(null);
    expect(menu.getAllByRole('menuitem')).toHaveLength(offered.length);
    for (const workspace of offered) {
      expect(menu.getByText(workspace.label)).toBeTruthy();
    }
    // Named explicitly: the switcher was lifted out of the Super Admin
    // dashboard, and for a while that was the one place it could not return to.
    expect(menu.getByText('Super Admin')).toBeTruthy();
  });

  it('has no filter box or group headings — a list this short needs neither', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/admin');
    await user.click(trigger());
    expect(screen.queryByLabelText('Filter workspaces')).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
    expect(screen.queryByText('Quality & compliance')).toBeNull();
  });

  it('marks the current section in its menu, from any page inside it', async () => {
    signedIn();
    renderAt('/users/commercial/19');
    expect(trigger().textContent).toContain('Workspaces');
    await userEvent.setup().click(trigger());
    expect(screen.getByRole('menuitem', { name: /Enrolment/ })).toHaveAttribute('aria-current', 'true');
  });

  it('marks Super Admin in its menu when you are in it', async () => {
    signedIn();
    renderAt('/workspace/admin');
    expect(trigger().textContent).toContain('Workspaces');
    await userEvent.setup().click(trigger());
    expect(screen.getByRole('menuitem', { name: /Super Admin/ })).toHaveAttribute('aria-current', 'true');
  });

  it('falls back to a neutral label outside the listed sections', () => {
    signedIn();
    // Leadership is routable but not a listed workspace. /admin/roles would do
    // as well: those pages sit under the Super Admin sidebar, not its route.
    renderAt('/workspace/leadership');
    expect(trigger().textContent).toContain('Workspaces');
  });

  it('navigates on pick, and does not touch RBAC state', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/admin');
    await user.click(trigger());
    await user.click(screen.getByText('Curriculum'));

    expect(path()).toBe('/workspace/curriculum');
    expect(switchRole).not.toHaveBeenCalled();
  });

  it('opens learner support tickets from the Super Admin dashboard', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/admin');
    await user.click(trigger());
    await user.click(screen.getByText('Support'));
    expect(path()).toBe('/support/ticket-queue');
    expect(switchRole).not.toHaveBeenCalled();
  });

  it('ticks the section you are in rather than offering it as a move', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/coach');
    await user.click(trigger());
    const rows = within(screen.getByRole('menu')).getAllByRole('menuitem');
    const marked = rows.filter((row) => row.getAttribute('aria-current') === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('Coach');
  });

  it('opens the keyboard-highlighted row on Enter', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/coach');
    await user.click(trigger());
    // Highlight starts on the current section (Coach, index 0); one step down
    // is Enrolment.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(path()).toBe('/users');
  });

  it('wraps the highlight around the ends of the list', async () => {
    signedIn();
    const user = userEvent.setup();
    // Start on the first row — Super Admin — so Up has somewhere to wrap from.
    renderAt('/workspace/admin');
    await user.click(trigger());
    // Up from the first row is the last one: AUDIT.
    await user.keyboard('{ArrowUp}{Enter}');
    expect(path()).toBe('/workspace/auditor-copy');
  });

  it('closes on Escape without navigating', async () => {
    signedIn();
    const user = userEvent.setup();
    renderAt('/workspace/admin');
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/workspace/admin');
  });
});
