/**
 * Client for the platform authentication API (Django `login` app, /login_api/).
 *
 * Every call goes through `request`, which does three things that matter:
 *
 *  - `credentials: 'include'` so the HttpOnly `kbc_session` cookie is sent and
 *    stored. The cookie is never readable from JS — that is the point of it —
 *    so there is no token for this module to hold.
 *  - Sets `X-Requested-With: XMLHttpRequest` on every request. The backend
 *    requires it as its CSRF defence (see login/views.py): a cross-origin form
 *    post cannot set a custom header, and a fetch that tries needs a preflight
 *    this origin does not grant.
 *  - Surfaces the server's `error` string, and preserves the machine-readable
 *    `code` (`locked`, `weak_password`, `invalid_token`, …) on the thrown error
 *    so pages can react to the kind of failure, not just its text.
 */

export type Role = 'admin' | 'staff' | 'employer' | 'learner';
export type SubjectType = 'learner' | 'employer' | 'staff';

export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
  role: Role;
  subjectType: SubjectType;
  subjectId: number;
  hasPassword: boolean;
  lastLoginAt: string | null;
  permissions: string[];
  /** Staff only — the Position column, e.g. "Caseowner". */
  position?: string | null;
  /**
   * Staff access grant — one of ACCESS_OPTIONS in `staffUsers.ts`, or '' when
   * none is recorded. Decides where the account lands and which sidebar it
   * gets; the server enforces what it may actually reach.
   */
  access?: string | null;
  /** Landing route for `access`, chosen server-side (ACCESS_HOME_ROUTES). */
  accessHome?: string | null;
  /** `roleNavMap` key for `access`, chosen server-side (ACCESS_NAV_ROLES). */
  accessNavRole?: string | null;
  /** Learners only. */
  learnerType?: string | null;
  programme?: string | null;
  /** Employers only — the organisations they belong to. */
  organisationIds?: number[];
}

/** An API failure that carries the backend's machine-readable code. */
export class AuthError extends Error {
  code?: string;
  status: number;
  /** Present on a 423: when the lockout lifts. */
  lockedUntil?: string | null;

  constructor(message: string, status: number, code?: string, lockedUntil?: string | null) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.lockedUntil = lockedUntil;
  }
}

const BASE = '/login_api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // Required by the backend — see the module comment.
        'X-Requested-With': 'XMLHttpRequest',
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new AuthError(
      'Could not reach the server. Is the backend running on port 8000?',
      0,
      'network',
    );
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AuthError(`The server returned an unexpected response (${res.status}).`, res.status);
    }
  }

  if (!res.ok) {
    throw new AuthError(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.code === 'string' ? data.code : undefined,
      typeof data.lockedUntil === 'string' ? data.lockedUntil : null,
    );
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function apiLogin(
  email: string,
  password: string,
  remember = false,
): Promise<AuthUser> {
  const data = await request<{ user: AuthUser }>('/login/', {
    method: 'POST',
    body: JSON.stringify({ email, password, remember }),
  });
  return data.user;
}

export async function apiLogout(): Promise<void> {
  await request('/logout/', { method: 'POST' });
}

/**
 * The signed-in identity, or null when there is no live session.
 *
 * A 401 here is the normal "not signed in" answer, not an error, so it is
 * translated to null; anything else still throws.
 */
export async function apiMe(): Promise<AuthUser | null> {
  try {
    const data = await request<{ user: AuthUser }>('/me/');
    return data.user;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function apiChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request('/change-password/', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/**
 * Request a reset email. Always resolves for a well-formed address — the
 * backend deliberately does not disclose whether an account exists.
 */
export async function apiForgotPassword(email: string): Promise<string> {
  const data = await request<{ message: string }>('/forgot-password/', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return data.message;
}

export interface TokenInfo {
  email: string;
  displayName: string | null;
  expiresAt: string;
  /** Invitations only. */
  role?: Role;
}

export function apiResetInfo(token: string): Promise<TokenInfo> {
  return request<TokenInfo>(`/reset/?token=${encodeURIComponent(token)}`);
}

export async function apiResetPassword(token: string, password: string): Promise<string> {
  const data = await request<{ message: string }>('/reset-password/', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
  return data.message;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export function apiInvitationInfo(token: string): Promise<TokenInfo> {
  return request<TokenInfo>(`/invitation/?token=${encodeURIComponent(token)}`);
}

export async function apiAcceptInvitation(token: string, password: string): Promise<string> {
  const data = await request<{ message: string }>('/accept-invitation/', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
  return data.message;
}

export interface InviteResult {
  ok: boolean;
  accountCreated: boolean;
  emailSent: boolean;
  emailError: string | null;
  expiresAt: string;
  account: AuthUser;
}

/** (Staff) Invite or re-invite an existing person. */
export function apiInviteAccount(
  subjectType: SubjectType,
  subjectId: number,
): Promise<InviteResult> {
  return request<InviteResult>('/accounts/invite/', {
    method: 'POST',
    body: JSON.stringify({ subjectType, subjectId }),
  });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface AuthHealth {
  ok: boolean;
  database: { ok: boolean; error: string | null; accounts: number | null; accountsWithPassword: number | null };
  email: { configured: boolean; missing: string[] };
}

export function apiAuthHealth(): Promise<AuthHealth> {
  return request<AuthHealth>('/health/');
}

// ---------------------------------------------------------------------------
// Shared password rules
// ---------------------------------------------------------------------------
// Mirrors login/security.py so the forms can give immediate feedback. The
// server re-validates on every submit; this is a convenience, never the check.

export const MIN_PASSWORD_LENGTH = 8;

export function describePasswordProblem(password: string, email?: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (new Set(password).size === 1) {
    return 'Password cannot be a single repeated character.';
  }
  if (email) {
    const local = email.split('@')[0]?.trim().toLowerCase();
    if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
      return 'Password must not contain your email address.';
    }
  }
  return null;
}
