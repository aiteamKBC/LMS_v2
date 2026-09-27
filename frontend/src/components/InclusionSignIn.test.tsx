import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InclusionSignIn } from './InclusionSignIn';

const session = vi.hoisted(() => ({ auth: { account: null as null | { id: number } }, isInitialized: true }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => session }));
const state = 'a'.repeat(64);
const key = 'inclusion_sso_pending';

describe('Inclusion return after LMS sign-in', () => {
  const assign = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    session.auth.account = null;
    session.isInitialized = true;
    assign.mockReset();
    vi.stubGlobal('window', { location: { replace: assign } });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const show = (path = '/login') => render(<MemoryRouter initialEntries={[path]}><InclusionSignIn /></MemoryRouter>);

  it('remembers the request while the visitor signs in', () => {
    show(`/login?inclusion_state=${state}`);
    expect(JSON.parse(sessionStorage.getItem(key)! ).state).toBe(state);
    expect(assign).not.toHaveBeenCalled();
  });

  it('returns an authenticated account using the fixed backend endpoint', () => {
    session.auth.account = { id: 1 };
    show(`/login?inclusion_state=${state}`);
    expect(assign).toHaveBeenCalledWith(`/login_api/inclusion/authorize/?state=${state}`);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('resumes the pending request after Microsoft returns to a different page', () => {
    sessionStorage.setItem(key, JSON.stringify({ state, expires: Date.now() + 60_000 }));
    session.auth.account = { id: 1 };
    show('/workspace');
    expect(assign).toHaveBeenCalledOnce();
  });

  it('ignores expired requests and ordinary LMS visits', () => {
    sessionStorage.setItem(key, JSON.stringify({ state, expires: 0 }));
    session.auth.account = { id: 1 };
    show();
    expect(assign).not.toHaveBeenCalled();
  });

  it('hides routes while checking a pending sign-in, then allows real login', () => {
    session.isInitialized = false;
    const tree = <MemoryRouter initialEntries={[`/login?inclusion_state=${state}`]}><InclusionSignIn><p>Login form</p></InclusionSignIn></MemoryRouter>;
    const view = render(tree);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Login form')).not.toBeInTheDocument();
    session.isInitialized = true;
    view.rerender(<MemoryRouter initialEntries={[`/login?inclusion_state=${state}`]}><InclusionSignIn><p>Login form</p></InclusionSignIn></MemoryRouter>);
    expect(screen.getByText('Login form')).toBeInTheDocument();
  });

  it('keeps dashboard content hidden during an authenticated redirect', () => {
    session.auth.account = { id: 1 };
    render(<MemoryRouter initialEntries={[`/login?inclusion_state=${state}`]}><InclusionSignIn><p>Dashboard skeleton</p></InclusionSignIn></MemoryRouter>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard skeleton')).not.toBeInTheDocument();
  });
});
