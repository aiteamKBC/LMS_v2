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
import { PORTAL_WORKSPACES } from '@/lib/portalWorkspaces';

const authValue = vi.fn();
const switchRole = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));

const { WorkspaceSwitcher } = await import('../WorkspaceSwitcher');

function signedIn({ isAdmin = true, isAuthenticated = true } = {}) {
  authValue.mockReturnValue({ auth: { isAuthenticated }, isAdmin, switchRole });
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
  it('is hidden from a non-admin', () => {
    signedIn({ isAdmin: false });
    renderAt('/workspace/coach');
    expect(screen.queryByTitle('Switch workspace')).toBeNull();
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

    // Scoped to the menu: the trigger also carries the current section's label.
    const menu = within(screen.getByRole('menu'));
    expect(menu.getAllByRole('menuitem')).toHaveLength(PORTAL_WORKSPACES.length);
    for (const workspace of PORTAL_WORKSPACES) {
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

  it('names the section currently open, from any page inside it', () => {
    signedIn();
    renderAt('/users/commercial/19');
    // The trigger doubles as a "you are here" label; /users is Enrolment.
    expect(trigger().textContent).toContain('Enrolment');
  });

  it('names the Super Admin workspace when you are in it', () => {
    signedIn();
    renderAt('/workspace/admin');
    expect(trigger().textContent).toContain('Super Admin');
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
