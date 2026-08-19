// ============================================================================
// Super Admin console API client
//
// Talks to /login_api/admin/* (backend/login/platform_admin.py), which is gated
// on the `admin` role. Every field here is backed by a real table — the admin
// workspace used to render from fixtures, and these types deliberately have no
// shape for the things that were invented (tenants, integrations, automations).
//
// Sections that can be unavailable carry an `available` flag rather than
// defaulting to zero: on a database where a schema has not been provisioned, a
// zero would read as "nothing happened" when the truth is "nobody asked".
// ============================================================================

const BASE = '/login_api/admin';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      // Sends the kbc_session cookie — every endpoint here requires an
      // authenticated admin session.
      credentials: 'include',
      ...init,
      // Spread last so a caller passing headers cannot drop these two and
      // trip the backend's CSRF header check.
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Build a query string, dropping empty values so `?role=` never reaches the API. */
function qs(params: object): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export interface Paged<T> {
  count: number;
  page: number;
  pageSize: number;
  results: T[];
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export type PlatformRole = 'admin' | 'staff' | 'employer' | 'learner';

export interface PlatformOverview {
  generatedAt: string;
  accounts: {
    available: boolean;
    error: string | null;
    total: number;
    active: number;
    suspended: number;
    withPassword: number;
    /** Accounts that exist but never completed an invitation. */
    neverSignedIn: number;
    locked: number;
    activeLast30d: number;
    liveSessions: number;
    byRole: Record<PlatformRole, number>;
  };
  invitations: { pending: number; expired: number; failed: number };
  authActivity: {
    available: boolean;
    events24h: number;
    signIns24h: number;
    failedSignIns24h: number;
    distinctSignIns7d: number;
  };
  people: {
    available: boolean;
    learners: number;
    apprenticeship: number;
    commercial: number;
    learnersActive: number;
    staff: number;
    employers: number;
    organisations: number;
  };
  documents: {
    available: boolean;
    total: number;
    docTypes: number;
    signed: number;
    last30d: number;
  };
  curriculum: { available: boolean; programmes: number; cohorts: number; modules: number };
  delivery: { available: boolean; activeLearners: number; inactiveLearners: number };
}

export function fetchPlatformOverview(): Promise<PlatformOverview> {
  return request<PlatformOverview>(`${BASE}/overview/`);
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export type AccountStatus = 'active' | 'suspended' | 'locked' | 'invited';

export interface PlatformAccount {
  id: number;
  email: string;
  displayName: string;
  role: PlatformRole;
  subjectType: 'learner' | 'employer' | 'staff';
  subjectId: number;
  isActive: boolean;
  hasPassword: boolean;
  locked: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  passwordSetAt: string | null;
  createdAt: string | null;
  status: AccountStatus;
  /**
   * Staff access grant — '' for non-staff subjects and for staff nobody has
   * granted yet. Editable from the accounts table; the write goes to the staff
   * record (`updateStaffUser`), which is where the grant lives.
   */
  access: string;
}

export interface AccountQuery {
  role?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function fetchAccounts(query: AccountQuery = {}): Promise<Paged<PlatformAccount>> {
  return request<Paged<PlatformAccount>>(`${BASE}/accounts/${qs(query)}`);
}

/**
 * Suspend, restore, unlock, or re-send an account's onboarding mail.
 *
 * Role is deliberately not editable here — it is recomputed from the person's
 * enrolment row on every request, so a value written from this console would be
 * silently reverted.
 *
 * `resend-invitation` and `send-password-reset` are mutually exclusive and the
 * server enforces which applies: an invitation sets a first password, a reset
 * replaces one that already exists, so sending the wrong one is rejected rather
 * than quietly doing nothing. Both supersede any earlier unused link, so the
 * previous one stops working rather than leaving two live at once, and both
 * throw when the send fails, carrying the transport's reason.
 */
export function accountAction(
  id: number,
  action:
    | 'suspend'
    | 'restore'
    | 'unlock'
    | 'resend-invitation'
    | 'send-password-reset',
): Promise<{
  account: PlatformAccount;
  resent?: boolean;
  resetSent?: boolean;
  sentTo?: string;
}> {
  return request<{
    account: PlatformAccount;
    resent?: boolean;
    resetSent?: boolean;
    sentTo?: string;
  }>(`${BASE}/accounts/${id}/`, { method: 'POST', body: JSON.stringify({ action }) });
}

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                 */
/* -------------------------------------------------------------------------- */

export interface AuditEntry {
  id: number;
  event: string;
  email: string | null;
  accountId: number | null;
  succeeded: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
  severity: 'critical' | 'warning' | 'info';
}

export interface AuditQuery {
  event?: string;
  outcome?: 'success' | 'failure' | '';
  q?: string;
  days?: number;
  page?: number;
  pageSize?: number;
}

export interface AuditPage extends Paged<AuditEntry> {
  /** Distinct event names present in the log — drives the filter dropdown. */
  eventTypes: string[];
}

export function fetchAuditLog(query: AuditQuery = {}): Promise<AuditPage> {
  return request<AuditPage>(`${BASE}/audit/${qs(query)}`);
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

export interface RoleRow {
  id: PlatformRole;
  name: string;
  description: string;
  /** Which table membership of this role is derived from. */
  source: string;
  permissions: string[];
  counts: { total: number; active: number; invited: number; suspended: number };
}

export interface RolesResponse {
  generatedAt: string;
  /** Every permission any role holds — the columns of the matrix. */
  permissions: string[];
  results: RoleRow[];
}

export function fetchRoles(): Promise<RolesResponse> {
  return request<RolesResponse>(`${BASE}/roles/`);
}

/* -------------------------------------------------------------------------- */
/* Email delivery                                                              */
/* -------------------------------------------------------------------------- */

export interface EmailLogRow {
  id: string;
  kind: 'invitation' | 'reset';
  email: string;
  accountId: number | null;
  sentAt: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  error: string | null;
  status: 'failed' | 'accepted' | 'delivered' | 'queued';
}

export interface EmailLogResponse extends Paged<EmailLogRow> {
  stats: {
    sent: number;
    failed: number;
    last30d: number;
    invitations: number;
    resets: number;
    /** Null when nothing has been sent — not 100%. */
    deliveryRate: number | null;
  };
  transport: { configured: boolean; missing: string[] };
}

export function fetchEmailLog(
  query: { status?: string; kind?: string; page?: number; pageSize?: number } = {},
): Promise<EmailLogResponse> {
  return request<EmailLogResponse>(`${BASE}/email-log/${qs(query)}`);
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export interface AdminDocument {
  id: string;
  learnerKind: string;
  learnerId: number;
  learnerName: string;
  docType: string;
  docName: string;
  container: string;
  sizeBytes: number | null;
  signed: boolean;
  generatedAt: string | null;
  learnerSignedAt: string | null;
  employerSignedAt: string | null;
}

export interface DocumentsPage extends Paged<AdminDocument> {
  docTypes: string[];
  /** False when the document index is not provisioned on this deployment. */
  available: boolean;
  error: string | null;
}

export function fetchAdminDocuments(
  query: { docType?: string; signed?: string; q?: string; page?: number; pageSize?: number } = {},
): Promise<DocumentsPage> {
  return request<DocumentsPage>(`${BASE}/documents/${qs(query)}`);
}

/* -------------------------------------------------------------------------- */
/* Curriculum                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProgrammeRow {
  name: string;
  cohorts: number;
  modules: number;
  /** Learners whose enrolment record names this programme. */
  learners: number;
}

export interface CohortRow {
  name: string;
  programme: string | null;
  learners: number;
  startDate: string | null;
  endDate: string | null;
}

export interface CurriculumResponse {
  programmes: ProgrammeRow[];
  cohorts: CohortRow[];
  /** False when the curriculum schema is not provisioned on this deployment. */
  available: boolean;
  error: string | null;
}

export function fetchAdminCurriculum(programme?: string): Promise<CurriculumResponse> {
  return request<CurriculumResponse>(`${BASE}/curriculum/${qs({ programme })}`);
}

/* -------------------------------------------------------------------------- */
/* System status                                                               */
/* -------------------------------------------------------------------------- */

export interface SystemCheck {
  id: string;
  name: string;
  purpose: string;
  /** Settings are present. Not a claim that the remote end answered. */
  configured: boolean;
  detail: string;
}

export interface SystemStatus {
  generatedAt: string;
  checks: SystemCheck[];
  configuredCount: number;
  totalCount: number;
}

export function fetchSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>(`${BASE}/system/`);
}
