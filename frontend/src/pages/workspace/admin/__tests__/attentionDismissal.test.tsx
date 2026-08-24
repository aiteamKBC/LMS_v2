/**
 * Dismissing an attention alert on the Super Admin dashboard.
 *
 * lib/__tests__/adminAlertDismissals covers the store itself; this covers the
 * wiring, which is where the feature can go wrong in ways the store cannot see:
 * the row has to actually disappear, the way back has to be on screen, and the
 * dismiss control must not navigate — it sits on a card that is otherwise one
 * big link to the page listing the failures.
 *
 * The "nothing needs attention" banner is pinned too. It reports the platform's
 * state, not the reader's view of it, so dismissing the last alert must not
 * produce a green all-clear for a problem that is still there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const authValue = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));

// The shell drags in the sidebar, breadcrumbs and the workspace switcher; none
// of that is under test here.
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const fetchPlatformOverview = vi.fn();
const fetchAuditLog = vi.fn();
const fetchSystemStatus = vi.fn();
vi.mock('@/api/platformAdmin', () => ({
  fetchPlatformOverview: () => fetchPlatformOverview(),
  fetchAuditLog: () => fetchAuditLog(),
  fetchSystemStatus: () => fetchSystemStatus(),
}));

const AdminDashboard = (await import('../page')).default;

/** An overview whose only live condition is one failed invitation email. */
function overview(failed = 1) {
  return {
    generatedAt: new Date('2026-08-22T09:00:00Z').toISOString(),
    accounts: {
      available: true, error: null, total: 4, active: 4, suspended: 0, withPassword: 4,
      neverSignedIn: 0, locked: 0, activeLast30d: 4, liveSessions: 1, byRole: {},
    },
    invitations: { pending: 0, expired: 0, failed },
    authActivity: { available: true, events24h: 3, signIns24h: 3, failedSignIns24h: 0, distinctSignIns7d: 2 },
    people: {
      available: true, learners: 1, apprenticeship: 0, commercial: 1, learnersActive: 1,
      staff: 3, employers: 1, organisations: 1,
    },
    documents: { available: false, total: 0, docTypes: 0, signed: 0, last30d: 0 },
    curriculum: { available: false, programmes: 0, cohorts: 0, modules: 0 },
    delivery: { available: false, activeLearners: 0, inactiveLearners: 0 },
  };
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/workspace/admin']}>
      <AdminDashboard />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

const alertText = /invitation email failed to send/;

beforeEach(() => {
  window.localStorage.clear();
  authValue.mockReturnValue({ auth: { isAuthenticated: true, account: { id: 1, displayName: 'Admin' }, user: null } });
  fetchPlatformOverview.mockResolvedValue(overview());
  fetchAuditLog.mockResolvedValue({ results: [] });
  fetchSystemStatus.mockResolvedValue({ configuredCount: 2, totalCount: 2, checks: [] });
});

describe('attention alerts', () => {
  it('shows the alert, with a way to dismiss it', async () => {
    renderDashboard();
    expect(await screen.findByText(alertText)).toBeTruthy();
    expect(screen.getByLabelText(/^Dismiss: 1 invitation email/)).toBeTruthy();
  });

  it('hides the alert when dismissed, and offers it back', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText(alertText);

    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));

    expect(screen.queryByText(alertText)).toBeNull();
    expect(screen.getByText(/1 alert dismissed/)).toBeTruthy();
  });

  it('does not navigate when dismissing', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText(alertText);

    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));

    expect(screen.getByTestId('path').textContent).toBe('/workspace/admin');
  });

  it('brings it back on "show them again"', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText(alertText);
    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));

    await user.click(screen.getByText(/1 alert dismissed/));

    expect(screen.getByText(alertText)).toBeTruthy();
  });

  it('stays dismissed across a reload, for that account', async () => {
    const user = userEvent.setup();
    const first = renderDashboard();
    await screen.findByText(alertText);
    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));
    first.unmount();

    renderDashboard();
    await waitFor(() => expect(screen.getByText(/1 alert dismissed/)).toBeTruthy());
    expect(screen.queryByText(alertText)).toBeNull();
  });

  it('does not stay dismissed for a different administrator', async () => {
    const user = userEvent.setup();
    const first = renderDashboard();
    await screen.findByText(alertText);
    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));
    first.unmount();

    authValue.mockReturnValue({ auth: { isAuthenticated: true, account: { id: 2, displayName: 'Other' }, user: null } });
    renderDashboard();
    expect(await screen.findByText(alertText)).toBeTruthy();
  });

  it('comes back when another invitation fails', async () => {
    const user = userEvent.setup();
    const first = renderDashboard();
    await screen.findByText(alertText);
    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));
    first.unmount();

    // Same alert, worse: dismissing "1 failed" said nothing about "2 failed".
    fetchPlatformOverview.mockResolvedValue(overview(2));
    renderDashboard();
    expect(await screen.findByText(/2 invitation emails failed to send/)).toBeTruthy();
  });

  it('never calls the platform all-clear while a dismissed alert is live', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText(alertText);
    await user.click(screen.getByLabelText(/^Dismiss: 1 invitation email/));

    expect(screen.queryByText(/Nothing needs attention/)).toBeNull();
  });
});
