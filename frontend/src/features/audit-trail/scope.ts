/**
 * The two doors onto one Audit Trail.
 *
 * `/admin/audit-trail` reads the whole LMS. `/curriculum/audit-trail` reads
 * Curriculum Studio. They are the same page: same components, same requests,
 * same honesty rules about which sources are recorded. What differs is the
 * workspace the requests are scoped to and the chrome they are drawn inside.
 *
 * Keeping that difference in one small object is the point. Two copies of an
 * audit page drift, and when they drift one of them starts quietly saying
 * something untrue — so there is one implementation, and a scope.
 */
import type { SidebarNavItem } from '@/components/feature/Sidebar';

export interface AuditTrailScope {
  /**
   * The workspace to read, or '' for every workspace. Passed straight through
   * to the backend as `?workspace=`; the backend refuses a value it does not
   * recognise rather than answering with an empty page.
   */
  workspace: string;
  /** Where this door lives, e.g. `/admin/audit-trail`. No trailing slash. */
  basePath: string;
  /** WorkspaceShell's `role`, `roleLabel` and `workspaceLabel`. */
  role: string;
  roleLabel: string;
  workspaceLabel: string;
  navItems: SidebarNavItem[];
  /** What the hero and the empty states call the thing being audited. */
  subjectLabel: string;
  /** True when the workspace filter is offered — only on the system-wide door. */
  showWorkspaceFilter: boolean;
}

/**
 * Where one person's own page lives inside this door.
 *
 * The period travels with the link. Without it, opening somebody from a 90-day
 * list landed on their page showing 30 days, so the row said one thing and the
 * page it opened said another -- and the request the list had already made on
 * their behalf was for a different window, so it could not be reused either.
 */
export function personHref(scope: AuditTrailScope, email: string, days?: number): string {
  const path = `${scope.basePath}/people/${encodeURIComponent(email)}`;
  return days && days !== DEFAULT_WINDOW_DAYS ? `${path}?days=${days}` : path;
}

/** The window both halves of the Audit Trail open on, and the longest one:
 * page activity older than seven days is deleted. */
export const DEFAULT_WINDOW_DAYS = 7;

/** Curriculum Studio keeps its whole history, so it offers longer periods. */
export const UNLIMITED_WORKSPACES = new Set(['curriculum']);

const LONG_WINDOW_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: '3650', label: 'All time' },
];

export function windowOptionsFor(workspace: string | undefined) {
  const short = [
    { value: '1', label: 'Today (last 24 hours)' },
    { value: String(DEFAULT_WINDOW_DAYS), label: 'Last 7 days' },
  ];
  return workspace && UNLIMITED_WORKSPACES.has(workspace) ? [...short, ...LONG_WINDOW_OPTIONS] : short;
}

/** The longest period a workspace's Audit Trail can read, in days. */
export function windowLimitFor(workspace: string | undefined): number {
  return workspace && UNLIMITED_WORKSPACES.has(workspace) ? 3650 : DEFAULT_WINDOW_DAYS;
}

