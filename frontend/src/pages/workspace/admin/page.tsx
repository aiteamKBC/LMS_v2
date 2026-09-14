import { WorkspaceMetricContent } from '@/components/ui/WorkspaceMetricContent';
// ============================================================================
// Super Admin dashboard
//
// Every number on this page comes from /login_api/admin/* (backend/login/
// platform_admin.py), which reads the login, enrolment and curriculum schemas.
//
// What used to be here and is deliberately gone: a tenant estate (this platform
// serves one provider), an integration board naming products nothing connects
// to, an automation feed with no scheduler behind it, and a global AI kill
// switch wired to a useState. They rendered convincingly and meant nothing.
//
// Sections whose source schema is not provisioned report `available: false` and
// are hidden rather than shown as zero — a zero is a claim, and an absent table
// does not support it.
// ============================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
// Explicit, though vite auto-imports it: vitest.config.ts deliberately omits
// unplugin-auto-import, so without this the page cannot be rendered in a test.
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { WorkspaceDashboardLayout } from '@/components/feature/WorkspaceDashboardLayout';
import { roleNavMap } from '@/mocks/navigation';
import { ResendInvitationButton, canResendInvitation } from '@/pages/admin/_shared/ResendInvitation';
import { useAuth } from '@/hooks/useAuth';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { readDismissed, dismiss, restoreAll } from '@/lib/adminAlertDismissals';
import {
  fetchAuditLog,
  fetchPlatformOverview,
  fetchSystemStatus,
  type AuditEntry,
  type PlatformOverview,
  type SystemStatus,
} from '@/api/platformAdmin';

const adminNav = roleNavMap.admin;

/** Relative time for the audit feed; falls back to the raw value if unparseable. */
function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  const days = Math.floor(secs / 86400);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Turn an audit event name into something a human reads without a lookup. */
const EVENT_LABELS: Record<string, string> = {
  login: 'Sign-in',
  logout: 'Sign-out',
  invite_sent: 'Invitation sent',
  invite_accepted: 'Invitation accepted',
  reset_requested: 'Password reset requested',
  reset_completed: 'Password reset completed',
  password_changed: 'Password changed',
  admin_suspend: 'Account suspended',
  admin_restore: 'Account restored',
  admin_unlock: 'Account unlocked',
};

function eventLabel(event: string): string {
  return EVENT_LABELS[event] || event.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export default function AdminDashboard() {
  const { auth, isInitialized: authInitialized = true } = useAuth();
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditTick, setAuditTick] = useState(0);
  const [authActivityOpen, setAuthActivityOpen] = useState(true);
  const [recentEventsOpen, setRecentEventsOpen] = useState(true);
  // Alerts this administrator has waved away. Read once per account rather than
  // on every render, and re-read if the signed-in account changes under us —
  // dismissals belong to the person, not to the tab.
  const accountId = auth.account?.id ?? null;
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(accountId));
  const [alertsOpen, setAlertsOpen] = useState(false);
  useEffect(() => setDismissed(readDismissed(accountId)), [accountId]);

  useEffect(() => {
    let cancelled = false;

    // `previewAs()` only changes local UI state; it deliberately does not
    // issue the HttpOnly `kbc_session` cookie that the admin API requires.
    // Do not fire three guaranteed-401 requests while a demo preview is open.
    if (!authInitialized) {
      setLoading(true);
      return () => { cancelled = true; };
    }
    if (!auth.account) {
      setOverview(null);
      setAudit([]);
      setSystem(null);
      setError('Sign in with an administrator account to retrieve platform data. Demo preview mode has no server session.');
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setError(null);
    // Settled rather than all-or-nothing: the audit feed failing should not
    // blank the counts, and vice versa.
    Promise.allSettled([
      fetchPlatformOverview(),
      fetchAuditLog({ pageSize: 12 }),
      fetchSystemStatus(),
    ]).then(([ov, au, sy]) => {
      if (cancelled) return;
      if (ov.status === 'fulfilled') setOverview(ov.value);
      else setError(ov.reason?.message || 'Could not load platform overview.');
      if (au.status === 'fulfilled') setAudit(au.value.results);
      if (sy.status === 'fulfilled') setSystem(sy.value);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [auditTick, auth.account, authInitialized]);

  /** Re-read just the audit feed — a re-send writes a new row to it. */
  const reloadAudit = () => setAuditTick(t => t + 1);

  const acc = overview?.accounts;
  const people = overview?.people;
  const subtitle = overview
    ? `${acc?.total ?? 0} sign-in accounts · ${people?.learners ?? 0} learners · ${people?.employers ?? 0} employers`
    : 'Loading platform records…';

  // Things that genuinely warrant attention, derived from real rows only.
  //
  // `signature` is what a dismissal is recorded against, and it carries the
  // count for exactly that reason: dismissing "1 invitation email failed" must
  // not also hide the day a second one does. See lib/adminAlertDismissals.
  const attention: { tone: 'critical' | 'warning'; text: string; href: string; signature: string }[] = [];
  if (overview) {
    if (acc && acc.locked > 0) {
      attention.push({
        tone: 'critical',
        text: `${acc.locked} account${acc.locked === 1 ? ' is' : 's are'} locked out after repeated failed sign-ins.`,
        href: '/admin/users?status=locked',
        signature: `accounts-locked:${acc.locked}`,
      });
    }
    if (overview.authActivity.failedSignIns24h > 0) {
      attention.push({
        tone: 'warning',
        text: `${overview.authActivity.failedSignIns24h} failed sign-in attempt${overview.authActivity.failedSignIns24h === 1 ? '' : 's'} in the last 24 hours.`,
        href: '/admin/access-logs?outcome=failure',
        signature: `sign-ins-failed:${overview.authActivity.failedSignIns24h}`,
      });
    }
    if (overview.invitations.failed > 0) {
      attention.push({
        tone: 'critical',
        text: `${overview.invitations.failed} invitation email${overview.invitations.failed === 1 ? '' : 's'} failed to send.`,
        href: '/admin/notifications?status=failed',
        signature: `invites-failed:${overview.invitations.failed}`,
      });
    }
    if (overview.invitations.expired > 0) {
      attention.push({
        tone: 'warning',
        text: `${overview.invitations.expired} invitation${overview.invitations.expired === 1 ? ' has' : 's have'} expired without being accepted.`,
        href: '/admin/notifications',
        signature: `invites-expired:${overview.invitations.expired}`,
      });
    }
    if (system && system.configuredCount < system.totalCount) {
      const missing = system.checks.filter(c => !c.configured).map(c => c.name).join(', ');
      attention.push({
        tone: 'warning',
        text: `Not configured: ${missing}.`,
        href: '/admin/system',
        signature: `system-unconfigured:${system.totalCount - system.configuredCount}`,
      });
    }
  }

  const visibleAttention = attention.filter(a => !dismissed.has(a.signature));
  const hiddenCount = attention.length - visibleAttention.length;
  const hasVisibleWarning = visibleAttention.some(a => a.tone === 'warning');

  const dismissAlert = (signature: string) =>
    setDismissed(dismiss(accountId, signature, attention.map(a => a.signature)));

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Super Admin Workspace"
      pageSubtitle={subtitle}
      userName={auth.account?.displayName || auth.user?.fullName || 'Platform Admin'}
      userRole="Super Administrator"
    >
      <WorkspaceDashboardLayout className="super-admin-dashboard" overview={<>

          <div className="flex items-center gap-3 border-b border-[var(--kbc-border)] pb-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600">
              <AppIcon className="ri-shield-user-line text-xl" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-foreground-900">{auth.account?.displayName || auth.user?.fullName || 'Platform Admin'}</p>
              <p className="mt-0.5 text-xs text-foreground-500">Super Administrator</p>
            </div>
          </div>
          <div className="flex items-center gap-2 py-4 text-[11px] text-foreground-500">
            <AppIcon className="ri-time-line text-sm text-primary-500" aria-hidden="true" />
            <span>{overview ? <>Updated {timeAgo(overview.generatedAt)}</> : 'Platform overview'}</span>
          </div>
          <div className="space-y-6 divide-y divide-[var(--kbc-border)] [&>section:not(:first-child)]:pt-5">
            {/* Invitations */}
            <section className="min-w-0 space-y-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Invitations</h3>
                <Link to="/admin/notifications" className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-[10px] font-medium whitespace-nowrap text-primary-600 transition-colors hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">Email log <AppIcon className="ri-arrow-right-line text-[10px]"></AppIcon></Link>
              </div>
              {overview ? (
                <div className="grid grid-cols-3 gap-2">
                  <RailFigure value={overview.invitations.pending} label="Pending" tone="neutral" />
                  <RailFigure value={overview.invitations.expired} label="Expired" tone={overview.invitations.expired > 0 ? 'warn' : 'neutral'} />
                  <RailFigure value={overview.invitations.failed} label="Failed" tone={overview.invitations.failed > 0 ? 'bad' : 'neutral'} />
                </div>
              ) : loading ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <SkeletonBlock className="h-5 w-10" />
                      <SkeletonBlock className="h-2.5 w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-foreground-400 py-2">Unavailable.</p>
              )}
            </section>

            {/* Audit trail */}
            <section className="min-w-0 space-y-3">
              <div className={`flex flex-wrap items-center justify-between gap-2 ${recentEventsOpen ? 'mb-4' : ''}`}>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">
                  <button
                    type="button"
                    onClick={() => setRecentEventsOpen(open => !open)}
                    aria-expanded={recentEventsOpen}
                    aria-controls="super-admin-recent-events-content"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <span>Recent access events</span>
                    <AppIcon className={recentEventsOpen ? 'ri-arrow-down-s-line text-xs text-foreground-400' : 'ri-arrow-right-s-line text-xs text-foreground-400'} aria-hidden="true"></AppIcon>
                  </button>
                </h3>
                <Link to="/admin/access-logs" className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-[10px] font-medium whitespace-nowrap text-primary-600 transition-colors hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">Full log <AppIcon className="ri-arrow-right-line text-[10px]"></AppIcon></Link>
              </div>
              {recentEventsOpen && (
                <div id="super-admin-recent-events-content">
                  {audit.length === 0 ? (
                    <p className="text-[12px] text-foreground-400 py-6 text-center">
                      {loading ? 'Loading audit trail…' : 'No access events recorded yet.'}
                    </p>
                  ) : (
                    <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl bg-primary-50/60 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" tabIndex={0} role="region" aria-label="Recent access events">
                      {audit.map(entry => (
                        <div key={entry.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 rounded-lg p-2 transition-colors hover:bg-[var(--kbc-surface)]">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                            entry.severity === 'critical' ? 'bg-red-100 text-red-600' : entry.severity === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-primary-100 text-primary-600'
                          }`}><AppIcon className="ri-user-line text-sm" aria-hidden="true" /></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-foreground-800">
                              {eventLabel(entry.event)}
                              {!entry.succeeded && <span className="mt-0.5 block text-[10px] font-medium text-red-600">failed{entry.reason ? ` · ${entry.reason}` : ''}</span>}
                            </p>
                            <p className="mt-0.5 break-all text-[11px] text-foreground-500">{entry.email || 'unknown address'}</p>
                          </div>
                          <div className="col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-[10px] text-foreground-400 whitespace-nowrap">{timeAgo(entry.createdAt)}</p>
                            {entry.ipAddress && <p className="text-[10px] text-foreground-400 whitespace-nowrap">{entry.ipAddress}</p>}
                            {/* A failed invitation is the one access-log row an
                                administrator can actually act on from here. */}
                            {canResendInvitation(entry) && (
                              <ResendInvitationButton entry={entry} onResent={reloadAudit} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
            {/* System status */}
            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">System status</h3>
                <Link to="/admin/system" className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-[10px] font-medium whitespace-nowrap text-primary-600 transition-colors hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">Details <AppIcon className="ri-arrow-right-line text-[10px]"></AppIcon></Link>
              </div>
              <p className="text-[11px] leading-relaxed text-foreground-500">Whether each subsystem is configured in this deployment.</p>
              <div className="divide-y divide-[var(--kbc-border)]">
                {system ? system.checks.map(check => (
                  <div key={check.id} className="flex items-start gap-2.5 py-3 first:pt-0 last:pb-0">
                    <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      check.configured ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      <AppIcon className={`${check.configured ? 'ri-check-line' : 'ri-alert-line'} text-xs`}></AppIcon>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground-800">{check.name}</p>
                      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-foreground-500">{check.detail}</p>
                    </div>
                  </div>
                )) : (
                  <p className="text-[12px] text-foreground-400 py-2">{loading ? 'Checking…' : 'Unavailable.'}</p>
                )}
              </div>
            </section>

            {/* Documents */}
            {overview?.documents.available && (
              <section className="min-w-0 space-y-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Compliance documents</h3>
                  <Link to="/admin/documents" className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-[10px] font-medium whitespace-nowrap text-primary-600 transition-colors hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">Browse <AppIcon className="ri-arrow-right-line text-[10px]"></AppIcon></Link>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <RailFigure value={overview.documents.total} label="Stored" tone="neutral" />
                  <RailFigure value={overview.documents.signed} label="Signed" tone="ok" />
                  <RailFigure value={overview.documents.last30d} label="Last 30d" tone="neutral" />
                </div>
              </section>
            )}

            {/* Delivery — only when the Learner schema is provisioned */}
            {overview?.delivery.available && (
              <section className="min-w-0 space-y-3">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Learner delivery</h3>
                <div className="grid grid-cols-2 gap-2">
                  <RailFigure value={overview.delivery.activeLearners} label="Active" tone="ok" />
                  <RailFigure value={overview.delivery.inactiveLearners} label="Archived" tone="neutral" />
                </div>
              </section>
            )}
          </div>

      </>}>
        <div className="flex flex-col justify-between gap-3 min-[1800px]:flex-row min-[1800px]:items-end">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground-950 md:text-3xl">Welcome back, Super Admin</h1>
            <p className="mt-1 text-[11px] text-foreground-500 md:text-xs">Monitor platform health, user engagement and system performance in real time.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/workspace/admin/certificates"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary-600 bg-[var(--kbc-primary)] px-3.5 text-xs font-extrabold text-white shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary-700 hover:bg-[var(--kbc-primary-deep)] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              <AppIcon className="ri-award-line text-base"></AppIcon>
              Certificate Builder
            </Link>
            <div className="super-admin-filters-anchor relative">
              <button
                type="button"
                onClick={() => setAlertsOpen(open => !open)}
                aria-expanded={alertsOpen}
                aria-controls="super-admin-alerts"
                className={`inline-flex h-10 min-w-[10.75rem] cursor-pointer items-center gap-2 rounded-xl border bg-amber-50 px-3.5 text-xs font-extrabold text-amber-700 shadow-sm transition-smooth hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${hasVisibleWarning ? 'border-amber-300' : 'border-amber-200'}`}
              >
                <AppIcon className="ri-alert-line h-4 w-4 shrink-0 text-inherit" aria-hidden="true" />
                <span>Platform issues</span>
                {visibleAttention.length > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-100 px-1 text-[11px] font-bold leading-none text-primary-700" aria-label={`${visibleAttention.length} active alert${visibleAttention.length === 1 ? '' : 's'}`}>
                    {visibleAttention.length}
                  </span>
                )}
              </button>

              {alertsOpen && (
                <div id="super-admin-alerts" className="super-admin-alert-popover" role="region" aria-label="Platform issues">
                  <div className="super-admin-alert-popover__header">
                    <div>
                      <p className="text-sm font-extrabold text-foreground-950">Platform issues</p>
                      <p className="mt-0.5 text-[11px] text-foreground-500">Platform issues that need your attention</p>
                    </div>
                    <span className="super-admin-alert-popover__count">{visibleAttention.length}</span>
                  </div>

                  {visibleAttention.length > 0 ? (
                    <div className="super-admin-alert-list">
                      {visibleAttention.map((a) => (
                        <div
                          key={a.signature}
                          className={`super-admin-alert-item ${a.tone === 'critical' ? 'super-admin-alert-item--critical' : 'super-admin-alert-item--warning'}`}
                        >
                          <Link
                            to={a.href}
                            onClick={() => setAlertsOpen(false)}
                            className="super-admin-alert-item__link"
                          >
                            <span className="super-admin-alert-item__icon">
                              <AppIcon className={a.tone === 'critical' ? 'ri-error-warning-fill' : 'ri-alert-line'}></AppIcon>
                            </span>
                            <span className="super-admin-alert-item__text">{a.text}</span>
                            <AppIcon className="ri-arrow-right-line super-admin-arrow-icon super-admin-alert-item__arrow"></AppIcon>
                          </Link>
                          <button
                            type="button"
                            onClick={() => dismissAlert(a.signature)}
                            title="Dismiss for me — it returns if this changes"
                            aria-label={`Dismiss: ${a.text}`}
                            className="super-admin-alert-item__dismiss"
                          >
                            <AppIcon className="ri-close-line"></AppIcon>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="super-admin-alert-popover__empty">No active alerts.</p>
                  )}

                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setDismissed(restoreAll(accountId))}
                      className="super-admin-alert-popover__restore"
                    >
                      <AppIcon className="ri-eye-off-line"></AppIcon>
                      {hiddenCount} alert{hiddenCount === 1 ? '' : 's'} dismissed · show {hiddenCount === 1 ? 'it' : 'them'} again
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="super-admin-hero-row grid grid-cols-1 items-stretch gap-3 min-[1800px]:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <WorkspaceHeroBanner
          title="Platform Control"
          description="Accounts, access and platform records"
          eyebrow="Administration"
          icon=""
          footer={<span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary-200/60 bg-primary-100/60 px-3 py-1.5 text-[11px] font-medium text-primary-700">
              <AppIcon className="ri-time-line shrink-0 text-sm" aria-hidden="true" />
              <span>{overview ? <>Updated {timeAgo(overview.generatedAt)}</> : 'Reading platform records…'}</span>
            </span>}
          visual={<div aria-hidden="true" className="pointer-events-none relative hidden h-32 w-44 shrink-0 sm:block">
            <div className="absolute left-8 top-12 h-16 w-24 rotate-[28deg] rounded-xl border border-primary-100 bg-[var(--kbc-surface)] shadow-[0_18px_28px_rgba(54,18,130,0.10)]" />
            <div className="absolute left-5 top-7 h-16 w-24 rotate-[28deg] rounded-xl border border-primary-100 bg-[var(--kbc-surface)]" />
            <div className="absolute left-[4.25rem] top-7 flex h-10 w-10 items-center justify-center rounded-xl border border-primary-100 bg-[var(--kbc-surface)] text-primary-600 shadow-sm">
              <AppIcon className="ri-stack-line text-lg" aria-hidden="true" />
            </div>
            <span className="absolute left-1 top-5 h-2 w-2 rounded-full bg-primary-200/60" />
            <span className="absolute right-2 top-9 h-2 w-2 rounded-full bg-primary-200/60" />
            <span className="absolute right-8 bottom-2 h-2 w-2 rounded-full bg-primary-200/60" />
          </div>}
        />

        <section className="super-admin-quick-actions flex h-full flex-col rounded-xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm md:p-3.5">
          <div className="mb-1.5 flex items-center gap-2"><AppIcon className="ri-flashlight-line text-sm text-primary-600"></AppIcon><h2 className="font-heading text-sm font-semibold text-foreground-900">Quick actions</h2></div>
          <div className="super-admin-quick-actions__grid grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            <QuickAction href="/admin/users" icon="ri-user-add-line" label="Invite new user" />
            <QuickAction href="/admin/access-logs" icon="ri-shield-check-line" label="View audit logs" />
            <QuickAction href="/curriculum/cohorts" icon="ri-group-line" label="Create cohort" />
            <QuickAction href="/admin/roles" icon="ri-shield-star-line" label="Manage roles" />
            <QuickAction href="/admin/platform-report" icon="ri-file-chart-line" label="Generate platform report" />
            <QuickAction href="/admin/platform-report" icon="ri-download-2-line" label="Export data" />
            <QuickAction href="/workspace/admin/certificates" icon="ri-award-line" label="Certificate builder" />
          </div>
        </section>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-error-warning-fill text-red-600 text-sm"></AppIcon>
            </span>
            <div>
              <p className="text-sm font-semibold text-red-900">Could not load platform data</p>
              <p className="text-[12px] text-red-700 mt-0.5">{error}</p>
              {!auth.account && (
                <Link to="/login" className="mt-2 inline-block text-[12px] font-semibold text-red-800 underline underline-offset-2 hover:text-red-950">
                  Sign in as administrator
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Alerts are surfaced from the Filters control above. */}
        {!loading && overview && attention.length === 0 && (
          <div className="bg-emerald-50/80 border border-emerald-200/50 rounded-xl p-3.5 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-check-line text-emerald-600 text-sm"></AppIcon>
            </span>
            <p className="text-[13px] font-medium text-emerald-900">
              Nothing needs attention — no locked accounts, no failed sign-ins or undelivered invitations.
            </p>
          </div>
        )}

        {/* ============================================================ */}
        {/* Stat cards                                                    */}
        {/* ============================================================ */}
        <div className="super-admin-stat-grid grid grid-cols-2 gap-3 min-[1600px]:grid-cols-4">
          <MiniStat loading={loading} label="Sign-in accounts" value={acc?.total} sub={`${acc?.active ?? 0} able to sign in`} icon="ri-user-star-line" color="primary" href="/admin/users" />
          <MiniStat loading={loading} label="Active last 30 days" value={acc?.activeLast30d} sub={`${acc?.liveSessions ?? 0} live sessions`} icon="ri-activity-line" color="primary" href="/admin/access-logs" />
          <MiniStat loading={loading} label="Awaiting first sign-in" value={acc?.neverSignedIn} sub={`${overview?.invitations.pending ?? 0} invitations pending`} icon="ri-mail-line" color="amber" href="/admin/users?status=invited" />
          <MiniStat loading={loading} label="Suspended or locked" value={(acc?.suspended ?? 0) + (acc?.locked ?? 0)} sub={`${acc?.suspended ?? 0} suspended · ${acc?.locked ?? 0} locked`} icon="ri-lock-line" color="danger" href="/admin/users?status=suspended" />
          <MiniStat loading={loading} label="Learners" value={people?.available ? people.learners : undefined} sub={people?.available ? `${people.apprenticeship} apprenticeship · ${people.commercial} commercial` : 'Schema unavailable'} icon="ri-graduation-cap-line" color="primary" href="/users" />
          <MiniStat loading={loading} label="Employers" value={people?.available ? people.employers : undefined} sub={people?.available ? `${people.organisations} organisations` : 'Schema unavailable'} icon="ri-briefcase-line" color="primary" href="/admin/platform-report" />
          <MiniStat loading={loading} label="Programmes" value={overview?.curriculum.available ? overview.curriculum.programmes : undefined} sub={overview?.curriculum.available ? `${overview.curriculum.modules} modules authored` : 'Schema unavailable'} icon="ri-book-open-line" color="primary" href="/admin/platform-report" />
          <MiniStat loading={loading} label="Cohorts" value={overview?.curriculum.available ? overview.curriculum.cohorts : undefined} sub={overview?.curriculum.available ? 'In the curriculum schema' : 'Schema unavailable'} icon="ri-group-line" color="primary" href="/admin/platform-report" />
        </div>

        {/* ============================================================ */}
        {/* Main grid                                                     */}
        {/* ============================================================ */}
        <div className="super-admin-main-grid grid min-w-0 grid-cols-1 gap-4 md:gap-6">
          <div className="min-w-0 space-y-3 md:space-y-4">
            {/* Accounts by role */}
            <section className="super-admin-accounts-section rounded-xl border border-foreground-200/60 bg-background-50 p-3 md:p-4">
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">Accounts by role</h2>
                <Link to="/admin/roles" className="super-admin-arrow-link inline-flex items-center gap-1 text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
                  Manage roles <AppIcon className="ri-arrow-right-line super-admin-arrow-icon text-[10px]"></AppIcon>
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {acc ? (Object.entries(acc.byRole) as [string, number][]).map(([role, count]) => {
                  const total = acc.total || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <Link key={role} to={`/admin/users?role=${role}`} className="block bg-background-50 rounded-xl border border-foreground-200/60 p-3 card-premium cursor-pointer md:p-3.5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                            <AppIcon className={`${
                              role === 'admin' ? 'ri-shield-star-line'
                                : role === 'staff' ? 'ri-team-line'
                                : role === 'employer' ? 'ri-building-2-line'
                                : 'ri-graduation-cap-line'
                            } text-lg`}></AppIcon>
                          </span>
                          <div>
                            <p className="text-sm font-heading font-semibold text-foreground-900 capitalize">{role}</p>
                            <p className="text-[11px] text-foreground-400">{pct}% of accounts</p>
                          </div>
                        </div>
                        <span className="text-xl font-heading font-semibold text-foreground-900">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-background-200 overflow-hidden">
                        <div className="h-full rounded-full bg-primary-500 transition-smooth" style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  );
                }) : (
                  <div className="col-span-2 text-[12px] text-foreground-400 py-6 text-center">
                    {loading ? 'Loading accounts…' : 'No account data available.'}
                  </div>
                )}
              </div>
            </section>

            {/* Authentication activity */}
            <section className="super-admin-auth-activity bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className={`flex items-center justify-between ${authActivityOpen ? 'mb-4' : ''}`}>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">
                  <button
                    type="button"
                    onClick={() => setAuthActivityOpen(open => !open)}
                    aria-expanded={authActivityOpen}
                    aria-controls="super-admin-auth-activity-content"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <span>Authentication activity</span>
                    <AppIcon className={authActivityOpen ? 'ri-arrow-down-s-line text-xs text-foreground-400' : 'ri-arrow-right-s-line text-xs text-foreground-400'} aria-hidden="true"></AppIcon>
                  </button>
                </h3>
                <Link to="/admin/access-logs" className="super-admin-arrow-link inline-flex items-center gap-1 text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Access logs <AppIcon className="ri-arrow-right-line super-admin-arrow-icon text-[10px]"></AppIcon></Link>
              </div>
              {authActivityOpen && (
                <div id="super-admin-auth-activity-content">
                  {overview?.authActivity.available ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Figure value={overview.authActivity.signIns24h} label="Sign-ins (24h)" tone="ok" />
                      <Figure value={overview.authActivity.failedSignIns24h} label="Failed (24h)" tone={overview.authActivity.failedSignIns24h > 0 ? 'bad' : 'neutral'} />
                      <Figure value={overview.authActivity.distinctSignIns7d} label="Distinct users (7d)" tone="neutral" />
                      <Figure value={overview.authActivity.events24h} label="Audit events (24h)" tone="neutral" />
                    </div>
                  ) : loading ? (
                    // Same four-up shape as the figures it replaces, so the section
                    // does not resize when the overview lands.
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="space-y-2">
                          <SkeletonBlock className="h-5 w-10" />
                          <SkeletonBlock className="h-2.5 w-20" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-foreground-400 py-4 text-center">Audit trail unavailable.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
        <footer className="super-admin-footer text-center text-[10px] text-foreground-400">
          © 2024 Super Admin Workspace. All rights reserved.
        </footer>
      </WorkspaceDashboardLayout>
    </WorkspaceShell>
  );
}

/* ======================================================================== */
/* Stat card — links through to the filtered list it summarises              */
/* ======================================================================== */
function QuickAction({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link to={href} className="super-admin-quick-action flex items-center gap-2.5 border-b border-foreground-100/70 py-2 text-[11px] text-foreground-700 transition-smooth hover:text-primary-600">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-50 text-primary-500"><AppIcon className={`${icon} text-xs`}></AppIcon></span>
      <span className="flex-1">{label}</span>
      <AppIcon className="ri-arrow-right-s-line super-admin-arrow-icon text-foreground-300"></AppIcon>
    </Link>
  );
}

function MiniStat({ label, value, sub, icon, color, href, loading }: {
  label: string; value: number | undefined; sub: string; icon: string; color: string; href: string; loading: boolean;
}) {
  const bgMap: Record<string, string> = {
    primary: 'bg-primary-100/60 text-primary-600 ring-primary-200/60',
    amber: '!bg-amber-50/50 !text-amber-700 ring-amber-200/60',
    danger: '!bg-red-50/50 !text-red-700 ring-red-200/60',
  };
  return (
    <Link to={href} className="flex min-w-0 items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 px-3.5 py-3 card-premium cursor-pointer md:px-4">
      <WorkspaceMetricContent
        label={label} note={sub} icon={icon} iconClassName={bgMap[color] || bgMap.primary}
        value={loading && value === undefined ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-background-200" /> : value ?? 0}
      />
    </Link>
  );
}

/* ======================================================================== */
/* Small labelled figure                                                     */
/* ======================================================================== */
function Figure({ value, label, tone }: { value: number; label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }) {
  const toneMap = {
    ok: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
    neutral: 'text-foreground-800',
  };
  return (
    <div className="min-w-0 rounded-xl bg-primary-50/60 px-2 py-3 text-center">
      <p className={`font-heading text-xl font-semibold tabular-nums ${toneMap[tone]}`}>{value}</p>
      <p className="mt-1 text-[10px] text-foreground-500">{label}</p>
    </div>
  );
}

/** Compact figures used only in the right-hand overview panel. */
function RailFigure({ value, label, tone }: { value: number; label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }) {
  const toneMap = {
    ok: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
    neutral: 'text-primary-700',
  };
  return (
    <div className="min-w-0 rounded-xl bg-primary-50/60 px-2 py-3 text-center">
      <p className={`font-heading text-xl font-semibold tabular-nums ${toneMap[tone]}`}>{value}</p>
      <p className="mt-1 text-[10px] text-foreground-500">{label}</p>
    </div>
  );
}
