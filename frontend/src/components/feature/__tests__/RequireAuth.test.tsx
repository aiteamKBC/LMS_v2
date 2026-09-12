import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from '../RequireAuth';

const session = vi.hoisted(() => ({
  auth: { account: null, isAuthenticated: false },
  isInitialized: false,
  initializationError: null as string | null,
  retryInitialization: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => session }));
vi.mock('@/features/old-otjh/hooks', () => ({
  OldOtjhGate: ({ children }: { children: ReactNode }) => children,
}));

function LoginDestination() {
  const location = useLocation();
  return <h1>Login from {location.state?.from}</h1>;
}

function renderGate(path: string) {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/login" element={<LoginDestination />} />
      <Route element={<RequireAuth />}>
        <Route path="*" element={<h1>Protected content</h1>} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  session.isInitialized = false;
  session.initializationError = null;
  session.auth.isAuthenticated = false;
  session.retryInitialization.mockClear();
});

describe('RequireAuth after integrating the record loading shell', () => {
  it.each(['/learner', '/learner/my-learning', '/workspace/learner', '/workspace/learner/dashboard'])(
    'preserves the learner loading theme at %s while the session is pending', path => {
      renderGate(path);
      expect(screen.getByLabelText('Loading page')).toHaveAttribute('data-workspace-role', 'learner');
      expect(screen.queryByRole('heading')).toBeNull();
    },
  );

  it.each([
    ['/old-otjh/months', 'Loading monthly records'],
    ['/old-otjh/months/', 'Loading monthly records'],
    ['/old-otjh/months/7', 'Loading monthly report'],
  ])('shows the record loading shell at %s', (path, label) => {
    renderGate(path);
    expect(screen.getByRole('status', { name: label })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('keeps the generic shell for staff pages', () => {
    renderGate('/curriculum');
    expect(screen.getByLabelText('Loading page')).not.toHaveAttribute('data-workspace-role');
  });

  it('keeps session failures retryable without redirecting to login', () => {
    session.isInitialized = true;
    session.initializationError = 'We could not check your session.';
    renderGate('/learner/my-learning');
    expect(screen.getByRole('alert')).toHaveTextContent(session.initializationError);
    expect(screen.queryByText('Protected content')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(session.retryInitialization).toHaveBeenCalledOnce();
  });

  it('requires a real account and preserves the full return path after initialization', () => {
    session.isInitialized = true;
    session.auth.isAuthenticated = true;
    renderGate('/learner/my-learning?module=7');
    expect(screen.getByRole('heading')).toHaveTextContent('Login from /learner/my-learning?module=7');
    expect(screen.queryByText('Protected content')).toBeNull();
  });
});
