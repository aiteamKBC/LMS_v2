/**
 * The auth context's contract with the rest of the app.
 *
 * The session lives in an HttpOnly cookie, so JS cannot read it — the only way
 * to know whether someone is signed in is to ask the server. That makes two
 * behaviours load-bearing:
 *
 *  - `isInitialized` stays false until `/me/` has answered. Routes that guard on
 *    `isAuthenticated` before that would bounce a signed-in user to /login on
 *    every refresh;
 *  - a failed `/me/` renders as signed-out rather than crashing the app.
 *
 * `previewAs` is also pinned here: it is the landing page's demo shortcut and
 * must stay clearly distinguishable from a real session (no `account`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const apiMe = vi.fn();
const apiLogin = vi.fn();
const apiLogout = vi.fn();

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth');
  return {
    ...actual,
    apiMe: (...args: unknown[]) => apiMe(...args),
    apiLogin: (...args: unknown[]) => apiLogin(...args),
    apiLogout: (...args: unknown[]) => apiLogout(...args),
  };
});

// The provider clears the chat session on sign-out; irrelevant here.
vi.mock('@/api/chat', () => ({ clearChatSession: vi.fn() }));

const { AuthProvider, useAuth } = await import('../useAuth');

const ADMIN = {
  id: 1,
  email: 'admin@kbc.test',
  displayName: 'Demo Admin',
  role: 'admin' as const,
  subjectType: 'staff' as const,
  subjectId: 13,
  hasPassword: true,
  lastLoginAt: null,
  permissions: ['accounts.manage'],
};

const LEARNER = { ...ADMIN, id: 2, email: 'l@kbc.test', role: 'learner' as const, displayName: 'A Learner' };

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

/** Render and wait for the initial /me/ round-trip to settle. */
async function renderAuth() {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.isInitialized).toBe(true));
  return view;
}

beforeEach(() => {
  apiMe.mockReset().mockResolvedValue(null);
  apiLogin.mockReset();
  apiLogout.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('hydration from the session cookie', () => {
  it('starts uninitialised and signed out', () => {
    // Never let a route decide before /me/ has answered.
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isInitialized).toBe(false);
    expect(result.current.auth.isAuthenticated).toBe(false);
  });

  it('signs in from an existing cookie without any user action', async () => {
    apiMe.mockResolvedValue(ADMIN);
    const { result } = await renderAuth();

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.account).toEqual(ADMIN);
    expect(result.current.auth.user?.email).toBe('admin@kbc.test');
  });

  it('settles as signed out when there is no session', async () => {
    const { result } = await renderAuth();
    expect(result.current.auth.isAuthenticated).toBe(false);
    expect(result.current.auth.account).toBeNull();
  });

  it('settles rather than hanging when /me/ fails', async () => {
    // A backend outage must not leave the app stuck on a loading screen.
    apiMe.mockRejectedValue(new Error('network down'));
    const { result } = await renderAuth();
    expect(result.current.auth.isAuthenticated).toBe(false);
  });
});

describe('login', () => {
  it('adopts the account the server returns', async () => {
    apiLogin.mockResolvedValue(ADMIN);
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.login('admin@kbc.test', 'pw');
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.account?.role).toBe('admin');
  });

  it('passes the remember flag through', async () => {
    apiLogin.mockResolvedValue(ADMIN);
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.login('admin@kbc.test', 'pw', true);
    });

    expect(apiLogin).toHaveBeenCalledWith('admin@kbc.test', 'pw', true);
  });

  it('propagates a failure and stays signed out', async () => {
    apiLogin.mockRejectedValue(new Error('Incorrect email or password.'));
    const { result } = await renderAuth();

    await expect(
      act(async () => {
        await result.current.login('admin@kbc.test', 'wrong');
      }),
    ).rejects.toThrow('Incorrect email or password.');

    expect(result.current.auth.isAuthenticated).toBe(false);
  });
});

describe('role mapping', () => {
  it('maps the admin role onto a wildcard RBAC role', async () => {
    apiMe.mockResolvedValue(ADMIN);
    const { result } = await renderAuth();

    expect(result.current.isAdmin).toBe(true);
    // Wildcard bypass — matches the server, where admin holds every permission.
    expect(result.current.hasPermission('anything.at.all')).toBe(true);
  });

  it('does not grant a learner admin rights', async () => {
    apiMe.mockResolvedValue(LEARNER);
    const { result } = await renderAuth();

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.auth.roles.map(r => r.slug)).toContain('learner');
  });

  it('gives an unauthenticated visitor no permissions', async () => {
    const { result } = await renderAuth();
    expect(result.current.hasPermission('dashboard.view')).toBe(false);
    expect(result.current.canSeeNavItem('anything')).toBe(false);
  });

  it('projects the server account onto the TenantUser shape the app reads', async () => {
    apiMe.mockResolvedValue(ADMIN);
    const { result } = await renderAuth();

    // A real account will not be in the mock user list, so it must be projected
    // rather than looked up.
    expect(result.current.auth.user).toMatchObject({
      email: 'admin@kbc.test',
      fullName: 'Demo Admin',
      status: 'active',
    });
  });

  it('falls back to the email when the account has no display name', async () => {
    apiMe.mockResolvedValue({ ...ADMIN, displayName: null });
    const { result } = await renderAuth();
    expect(result.current.auth.user?.fullName).toBe('admin@kbc.test');
  });
});

describe('logout', () => {
  it('revokes the session server-side and clears local state', async () => {
    apiMe.mockResolvedValue(ADMIN);
    const { result } = await renderAuth();

    act(() => result.current.logout());

    expect(apiLogout).toHaveBeenCalled();
    await waitFor(() => expect(result.current.auth.isAuthenticated).toBe(false));
    expect(result.current.auth.account).toBeNull();
  });

  it('clears local state even if the revoke call fails', async () => {
    // The user asked to sign out; a network error must not leave them looking
    // signed in.
    apiMe.mockResolvedValue(ADMIN);
    apiLogout.mockRejectedValue(new Error('offline'));
    const { result } = await renderAuth();

    act(() => result.current.logout());

    await waitFor(() => expect(result.current.auth.isAuthenticated).toBe(false));
  });
});

describe('previewAs', () => {
  it('enters a demo workspace without a server session', async () => {
    const { result } = await renderAuth();

    act(() => result.current.previewAs('learner@kbc.test'));

    expect(result.current.auth.isAuthenticated).toBe(true);
    // The distinguishing mark: no server account backs this state, so any
    // protected request will still 401.
    expect(result.current.auth.account).toBeNull();
    expect(apiLogin).not.toHaveBeenCalled();
  });

  it('ignores an unknown demo address', async () => {
    const { result } = await renderAuth();
    act(() => result.current.previewAs('nobody@nowhere.test'));
    expect(result.current.auth.isAuthenticated).toBe(false);
  });
});
