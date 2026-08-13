/**
 * The three pages a user meets before they have a session.
 *
 * What matters here is not the layout but the wiring: that the login form
 * shows the *server's* message rather than inventing one, that the
 * set-password page validates its token before asking for a password, and that
 * "forgot password" never reveals whether an address has an account.
 *
 * The set-password page is mounted twice in the router (invitation and reset),
 * so both modes are exercised.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';

// --- module mocks ----------------------------------------------------------
const login = vi.fn();
const apiForgotPassword = vi.fn();
const apiInvitationInfo = vi.fn();
const apiAcceptInvitation = vi.fn();
const apiResetInfo = vi.fn();
const apiResetPassword = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login,
    auth: { isAuthenticated: false, account: null, user: null, roles: [], tenant: null },
    isInitialized: true,
  }),
}));

vi.mock('@/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/api/auth')>('@/api/auth');
  return {
    ...actual,
    apiForgotPassword: (...a: unknown[]) => apiForgotPassword(...a),
    apiInvitationInfo: (...a: unknown[]) => apiInvitationInfo(...a),
    apiAcceptInvitation: (...a: unknown[]) => apiAcceptInvitation(...a),
    apiResetInfo: (...a: unknown[]) => apiResetInfo(...a),
    apiResetPassword: (...a: unknown[]) => apiResetPassword(...a),
  };
});

vi.mock('@/components/BrandLockup', () => ({
  BrandLockup: () => <div data-testid="brand" />,
}));

// AppIcon is a global auto-import in the app build; supply it for tests.
(globalThis as Record<string, unknown>).AppIcon = ({ className }: { className?: string }) => (
  <i className={className} />
);

const { AuthError } = await import('@/api/auth');
const LoginPage = (await import('../login/page')).default;
const ForgotPasswordPage = (await import('../forgot-password/page')).default;
const SetPasswordPage = (await import('../set-password/page')).default;

function renderAt(ui: ReactNode, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path.split('?')[0]} element={ui} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  login.mockReset();
  apiForgotPassword.mockReset();
  apiInvitationInfo.mockReset();
  apiAcceptInvitation.mockReset();
  apiResetInfo.mockReset();
  apiResetPassword.mockReset();
});

// ---------------------------------------------------------------------------

describe('LoginPage', () => {
  it('submits the typed credentials', async () => {
    login.mockResolvedValue({ role: 'admin' });
    const user = userEvent.setup();
    renderAt(<LoginPage />, '/login');

    await user.type(screen.getByLabelText(/email address/i), 'admin@kbc.test');
    await user.type(screen.getByLabelText(/^password$/i), 'Vaulted-Harbour-92!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith('admin@kbc.test', 'Vaulted-Harbour-92!', false),
    );
  });

  it('passes "remember me" through when ticked', async () => {
    login.mockResolvedValue({ role: 'admin' });
    const user = userEvent.setup();
    renderAt(<LoginPage />, '/login');

    await user.type(screen.getByLabelText(/email address/i), 'admin@kbc.test');
    await user.type(screen.getByLabelText(/^password$/i), 'pw');
    await user.click(screen.getByRole('button', { name: /remember me/i }));
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin@kbc.test', 'pw', true));
  });

  it('shows the server error rather than a generic one', async () => {
    // The server distinguishes bad-password from locked from throttled; the
    // page must not flatten that into "login failed".
    login.mockRejectedValue(new AuthError('Incorrect email or password.', 401));
    const user = userEvent.setup();
    renderAt(<LoginPage />, '/login');

    await user.type(screen.getByLabelText(/email address/i), 'admin@kbc.test');
    await user.type(screen.getByLabelText(/^password$/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('shows the lockout message with its own wording', async () => {
    login.mockRejectedValue(
      new AuthError('This account is temporarily locked.', 423, 'locked'),
    );
    const user = userEvent.setup();
    renderAt(<LoginPage />, '/login');

    await user.type(screen.getByLabelText(/email address/i), 'a@b.test');
    await user.type(screen.getByLabelText(/^password$/i), 'pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/temporarily locked/i)).toBeInTheDocument();
  });

  it('re-enables the button after a failure so the user can retry', async () => {
    login.mockRejectedValue(new AuthError('Incorrect email or password.', 401));
    const user = userEvent.setup();
    renderAt(<LoginPage />, '/login');

    await user.type(screen.getByLabelText(/email address/i), 'a@b.test');
    await user.type(screen.getByLabelText(/^password$/i), 'pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByText('Incorrect email or password.');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('no longer advertises a demo password', async () => {
    renderAt(<LoginPage />, '/login');
    expect(screen.queryByText(/Password123/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('ForgotPasswordPage', () => {
  it('sends the address and shows the uniform confirmation', async () => {
    const message = 'If that address has an account, a reset link has been sent to it.';
    apiForgotPassword.mockResolvedValue(message);
    const user = userEvent.setup();
    renderAt(<ForgotPasswordPage />, '/forgot-password');

    await user.type(screen.getByLabelText(/email address/i), 'someone@kbc.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(apiForgotPassword).toHaveBeenCalledWith('someone@kbc.test');
  });

  it('says the same thing for an address with no account', async () => {
    // Account enumeration: the two cases must be indistinguishable.
    const message = 'If that address has an account, a reset link has been sent to it.';
    apiForgotPassword.mockResolvedValue(message);
    const user = userEvent.setup();
    renderAt(<ForgotPasswordPage />, '/forgot-password');

    await user.type(screen.getByLabelText(/email address/i), 'nobody@nowhere.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('does not send a malformed address to the API', async () => {
    // The input is type="email" + required, so the browser's own constraint
    // validation blocks submit and the handler never runs. That is the desired
    // outcome — assert on it rather than on the handler's fallback message,
    // which only fires for input the browser lets through.
    const user = userEvent.setup();
    renderAt(<ForgotPasswordPage />, '/forgot-password');

    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(apiForgotPassword).not.toHaveBeenCalled();
    expect(screen.queryByText(/reset link has been sent/i)).not.toBeInTheDocument();
  });

  it('rejects an address the browser accepts but the handler should not', async () => {
    // "a@b" passes type="email" validation in some engines; the handler's own
    // check is the backstop.
    const user = userEvent.setup();
    renderAt(<ForgotPasswordPage />, '/forgot-password');

    const field = screen.getByLabelText(/email address/i);
    // Bypass the browser check the way a paste + programmatic submit would.
    await user.type(field, 'missing-at-sign.test');
    (field as HTMLInputElement).setCustomValidity('');
    field.closest('form')!.noValidate = true;
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(apiForgotPassword).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('SetPasswordPage — invitation mode', () => {
  const INFO = { email: 'new@kbc.test', displayName: 'New Person', expiresAt: '2026-01-01T00:00:00Z' };

  it('validates the token on load and greets the invitee', async () => {
    apiInvitationInfo.mockResolvedValue(INFO);
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password?token=TOK');

    expect(await screen.findByText(/New Person/)).toBeInTheDocument();
    expect(apiInvitationInfo).toHaveBeenCalledWith('TOK');
  });

  it('fails early on a dead link instead of after typing a password', async () => {
    apiInvitationInfo.mockRejectedValue(
      new AuthError('This link is invalid or has expired.', 400, 'invalid_token'),
    );
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password?token=DEAD');

    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it('refuses a link with no token at all', async () => {
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password');
    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
    expect(apiInvitationInfo).not.toHaveBeenCalled();
  });

  it('blocks submission until both fields match', async () => {
    apiInvitationInfo.mockResolvedValue(INFO);
    const user = userEvent.setup();
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password?token=TOK');

    await screen.findByLabelText(/new password/i);
    await user.type(screen.getByLabelText(/new password/i), 'Vaulted-Harbour-92!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Different-Value-77!');

    expect(await screen.findByText(/must match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate account/i })).toBeDisabled();
  });

  it('warns about a too-short password without contacting the server', async () => {
    apiInvitationInfo.mockResolvedValue(INFO);
    const user = userEvent.setup();
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password?token=TOK');

    await screen.findByLabelText(/new password/i);
    await user.type(screen.getByLabelText(/new password/i), 'short');

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(apiAcceptInvitation).not.toHaveBeenCalled();
  });

  it('submits a valid password and confirms activation', async () => {
    apiInvitationInfo.mockResolvedValue(INFO);
    apiAcceptInvitation.mockResolvedValue('Your password has been set.');
    const user = userEvent.setup();
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password?token=TOK');

    await screen.findByLabelText(/new password/i);
    await user.type(screen.getByLabelText(/new password/i), 'Vaulted-Harbour-92!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Vaulted-Harbour-92!');
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    await waitFor(() =>
      expect(apiAcceptInvitation).toHaveBeenCalledWith('TOK', 'Vaulted-Harbour-92!'),
    );
    expect(await screen.findByText(/account is ready/i)).toBeInTheDocument();
  });

  it('surfaces a server-side rejection of the password', async () => {
    // The client's checks are advisory; the server owns the real policy.
    apiInvitationInfo.mockResolvedValue(INFO);
    apiAcceptInvitation.mockRejectedValue(
      new AuthError('That password is too common.', 400, 'weak_password'),
    );
    const user = userEvent.setup();
    renderAt(<SetPasswordPage mode="invitation" />, '/set-password?token=TOK');

    await screen.findByLabelText(/new password/i);
    await user.type(screen.getByLabelText(/new password/i), 'password1234');
    await user.type(screen.getByLabelText(/confirm password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    expect(await screen.findByText(/too common/i)).toBeInTheDocument();
  });
});

describe('SetPasswordPage — reset mode', () => {
  const INFO = { email: 'back@kbc.test', displayName: 'Returning User', expiresAt: 'x' };

  it('uses the reset endpoints, not the invitation ones', async () => {
    apiResetInfo.mockResolvedValue(INFO);
    renderAt(<SetPasswordPage mode="reset" />, '/reset-password?token=RTOK');

    await screen.findByText(/Returning User/);
    expect(apiResetInfo).toHaveBeenCalledWith('RTOK');
    expect(apiInvitationInfo).not.toHaveBeenCalled();
  });

  it('completes a reset and points the user at sign-in', async () => {
    apiResetInfo.mockResolvedValue(INFO);
    apiResetPassword.mockResolvedValue('done');
    const user = userEvent.setup();
    renderAt(<SetPasswordPage mode="reset" />, '/reset-password?token=RTOK');

    await screen.findByLabelText(/new password/i);
    await user.type(screen.getByLabelText(/new password/i), 'Fresh-Harbour-2026!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Fresh-Harbour-2026!');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() =>
      expect(apiResetPassword).toHaveBeenCalledWith('RTOK', 'Fresh-Harbour-2026!'),
    );
    // Deliberately does not auto-sign-in — the user proves they know the new
    // password by typing it.
    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to sign in/i })).toBeInTheDocument();
  });
});
