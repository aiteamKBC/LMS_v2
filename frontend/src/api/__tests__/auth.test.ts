/**
 * The auth client's contract with the backend.
 *
 * Three things here are load-bearing and easy to break by accident:
 *
 *  - every request carries the session cookie (`credentials: 'include'`) and
 *    the `X-Requested-With` header the backend requires as its CSRF defence.
 *    Drop either and every write starts failing with a 403 that looks like a
 *    permissions bug;
 *  - a 401 from `/me/` means "not signed in", not "something broke", so it
 *    resolves to null instead of throwing;
 *  - the server's `code` (`locked`, `weak_password`, …) survives onto the
 *    thrown error, because the pages branch on it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AuthError,
  apiAcceptInvitation,
  apiAuthHealth,
  apiForgotPassword,
  apiInvitationInfo,
  apiInviteAccount,
  apiLogin,
  apiLogout,
  apiMe,
  apiResetPassword,
  describePasswordProblem,
  MIN_PASSWORD_LENGTH,
} from '../auth';

const ACCOUNT = {
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

/** Build a Response-alike; the client only uses `ok`, `status` and `text()`. */
function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The options object handed to fetch on the most recent call. */
function lastInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)![1] as RequestInit;
}

function lastHeaders(): Record<string, string> {
  return (lastInit().headers || {}) as Record<string, string>;
}

describe('request plumbing', () => {
  it('sends the session cookie and the CSRF header on every call', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await apiLogin('admin@kbc.test', 'pw');

    expect(lastInit().credentials).toBe('include');
    expect(lastHeaders()['X-Requested-With']).toBe('XMLHttpRequest');
    expect(lastHeaders()['Content-Type']).toBe('application/json');
  });

  it('sends the CSRF header on reads too, not just writes', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await apiMe();
    expect(lastHeaders()['X-Requested-With']).toBe('XMLHttpRequest');
  });

  it('targets the /login_api prefix the Vite proxy forwards', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await apiMe();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/login_api/me/');
  });

  it('turns a network failure into a readable AuthError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiMe()).rejects.toBeInstanceOf(AuthError);
    await expect(apiMe()).rejects.toThrow(/Could not reach the server/);
  });

  it('does not choke on an empty response body', async () => {
    fetchMock.mockResolvedValue(reply(200, undefined));
    await expect(apiLogout()).resolves.toBeUndefined();
  });

  it('reports a non-JSON response rather than throwing a parse error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>gateway</html>',
      headers: { get: () => 'text/html' },
    } as unknown as Response);

    await expect(apiMe()).rejects.toThrow(/unexpected response \(502\)/);
  });
});

describe('apiLogin', () => {
  it('returns the account on success', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await expect(apiLogin('admin@kbc.test', 'pw')).resolves.toEqual(ACCOUNT);
  });

  it('posts the credentials and the remember flag', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await apiLogin('admin@kbc.test', 'pw', true);

    expect(JSON.parse(lastInit().body as string)).toEqual({
      email: 'admin@kbc.test',
      password: 'pw',
      remember: true,
    });
  });

  it('defaults remember to false', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await apiLogin('admin@kbc.test', 'pw');
    expect(JSON.parse(lastInit().body as string).remember).toBe(false);
  });

  it('surfaces the server message on a bad password', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: 'Incorrect email or password.' }));
    await expect(apiLogin('a@b.test', 'wrong')).rejects.toThrow('Incorrect email or password.');
  });

  it('preserves the lockout code and lockedUntil', async () => {
    fetchMock.mockResolvedValue(
      reply(423, { error: 'Locked.', code: 'locked', lockedUntil: '2026-01-01T00:00:00Z' }),
    );

    // The page shows a different message for a lockout than for a bad password.
    await expect(apiLogin('a@b.test', 'pw')).rejects.toMatchObject({
      code: 'locked',
      status: 423,
      lockedUntil: '2026-01-01T00:00:00Z',
    });
  });

  it('preserves the throttled code', async () => {
    fetchMock.mockResolvedValue(reply(429, { error: 'Too many.', code: 'throttled' }));
    await expect(apiLogin('a@b.test', 'pw')).rejects.toMatchObject({ code: 'throttled' });
  });
});

describe('apiMe', () => {
  it('returns the account when signed in', async () => {
    fetchMock.mockResolvedValue(reply(200, { user: ACCOUNT }));
    await expect(apiMe()).resolves.toEqual(ACCOUNT);
  });

  it('resolves to null on 401 rather than throwing', async () => {
    // "Not signed in" is the normal answer on first page load, not an error.
    fetchMock.mockResolvedValue(reply(401, { error: 'Not authenticated.', code: 'unauthenticated' }));
    await expect(apiMe()).resolves.toBeNull();
  });

  it('still throws on a server error', async () => {
    fetchMock.mockResolvedValue(reply(502, { error: 'Database error' }));
    await expect(apiMe()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('token flows', () => {
  it('url-encodes the token in the invitation lookup', async () => {
    fetchMock.mockResolvedValue(reply(200, { email: 'a@b.test', displayName: null, expiresAt: 'x' }));
    // A raw token can legitimately contain characters that need escaping.
    await apiInvitationInfo('tok en/+&value');

    const url = fetchMock.mock.calls.at(-1)![0] as string;
    expect(url).toContain('tok%20en%2F%2B%26value');
    expect(url).not.toContain('tok en');
  });

  it('reports an invalid token with its code', async () => {
    fetchMock.mockResolvedValue(
      reply(400, { error: 'This link is invalid or has expired.', code: 'invalid_token' }),
    );
    await expect(apiInvitationInfo('dead')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('posts token and password when accepting an invitation', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, message: 'done' }));
    await expect(apiAcceptInvitation('TOK', 'Vaulted-Harbour-92!')).resolves.toBe('done');
    expect(JSON.parse(lastInit().body as string)).toEqual({
      token: 'TOK',
      password: 'Vaulted-Harbour-92!',
    });
  });

  it('reports a weak password with its code', async () => {
    fetchMock.mockResolvedValue(
      reply(400, { error: 'Password must be at least 8 characters.', code: 'weak_password' }),
    );
    await expect(apiResetPassword('TOK', 'short')).rejects.toMatchObject({
      code: 'weak_password',
    });
  });

  it('returns the uniform message from forgot-password', async () => {
    const message = 'If that address has an account, a reset link has been sent to it.';
    fetchMock.mockResolvedValue(reply(200, { ok: true, message }));
    await expect(apiForgotPassword('anyone@kbc.test')).resolves.toBe(message);
  });
});

describe('apiInviteAccount', () => {
  it('posts the subject reference', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, account: ACCOUNT }));
    await apiInviteAccount('staff', 42);
    expect(JSON.parse(lastInit().body as string)).toEqual({
      subjectType: 'staff',
      subjectId: 42,
    });
  });

  it('surfaces a forbidden invite', async () => {
    fetchMock.mockResolvedValue(
      reply(403, { error: 'Only an administrator can invite another administrator.', code: 'forbidden' }),
    );
    await expect(apiInviteAccount('staff', 42)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
  });
});

describe('apiAuthHealth', () => {
  it('reports which mail settings are missing', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        ok: true,
        database: { ok: true, error: null, accounts: 1, accountsWithPassword: 1 },
        email: { configured: false, missing: ['AZURE_MAIL_SENDER'] },
      }),
    );

    const health = await apiAuthHealth();
    expect(health.email.configured).toBe(false);
    expect(health.email.missing).toEqual(['AZURE_MAIL_SENDER']);
  });
});

describe('describePasswordProblem', () => {
  it('mirrors the server rules so the form can warn before submitting', () => {
    expect(describePasswordProblem('')).toMatch(/required/i);
    expect(describePasswordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/i);
    expect(describePasswordProblem('aaaaaaaaaa')).toMatch(/repeated character/i);
  });

  it('rejects a password containing the email local part', () => {
    expect(describePasswordProblem('jsmith-jsmith', 'jsmith@kbc.test')).toMatch(/email/i);
  });

  it('ignores the domain, which everyone shares', () => {
    expect(describePasswordProblem('Vaulted-Harbour-92!', 'pat@kbc.test')).toBeNull();
  });

  it('accepts a reasonable passphrase', () => {
    expect(describePasswordProblem('Vaulted-Harbour-92!')).toBeNull();
  });

  it('is advisory only — the server still re-validates', () => {
    // A password this client accepts can still be refused server-side (the
    // common-password list lives there), so the pages must handle a 400.
    expect(describePasswordProblem('password1234')).toBeNull();
  });
});
