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
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { PORTAL_WORKSPACES } from '@/lib/portalWorkspaces';
import { ResendInvitationButton, canResendInvitation } from '@/pages/admin/_shared/ResendInvitation';
import { useAuth } from '@/hooks/useAuth';
import { SkeletonBlock } from '@/components/feature/Skeletons';
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
  const { auth } = useAuth();
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditTick, setAuditTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
  }, [auditTick]);

  /** Re-read just the audit feed — a re-send writes a new row to it. */
  const reloadAudit = () => setAuditTick(t => t + 1);

  const acc = overview?.accounts;
  const people = overview?.people;
  const subtitle = overview
    ? `${acc?.total ?? 0} sign-in accounts · ${people?.learners ?? 0} learners · ${people?.employers ?? 0} employers`
    : 'Loading platform records…';

  // Things that genuinely warrant attention, derived from real rows only.
  const attention: { tone: 'critical' | 'warning'; text: string; href: string }[] = [];
  if (overview) {
    if (acc && acc.locked > 0) {
      attention.push({
        tone: 'critical',
        text: `${acc.locked} account${acc.locked === 1 ? ' is' : 's are'} locked out after repeated failed sign-ins.`,
        href: '/admin/users?status=locked',
      });
    }
    if (overview.authActivity.failedSignIns24h > 0) {
      attention.push({
        tone: 'warning',
        text: `${overview.authActivity.failedSignIns24h} failed sign-in attempt${overview.authActivity.failedSignIns24h === 1 ? '' : 's'} in the last 24 hours.`,
        href: '/admin/access-logs?outcome=failure',
      });
    }
    if (overview.invitations.failed > 0) {
      attention.push({
        tone: 'critical',
        text: `${overview.invitations.failed} invitation email${overview.invitations.failed === 1 ? '' : 's'} failed to send.`,
        href: '/admin/notifications?status=failed',
      });
    }
    if (overview.invitations.expired > 0) {
      attention.push({
        tone: 'warning',
        text: `${overview.invitations.expired} invitation${overview.invitations.expired === 1 ? ' has' : 's have'} expired without being accepted.`,
        href: '/admin/notifications',
      });
    }
    if (system && system.configuredCount < system.totalCount) {
      const missing = system.checks.filter(c => !c.configured).map(c => c.name).join(', ');
      attention.push({ tone: 'warning', text: `Not configured: ${missing}.`, href: '/admin/system' });
    }
  }

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
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* ============================================================ */}
        {/* Header                                                        */}
        {/* ============================================================ */}
        <div className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative h-full flex flex-col justify-center px-6 md:px-8">
            <h2 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Platform Control</h2>
            <p className="text-[13px] text-white/50">
              {overview
                ? <>Accounts, access and platform records · updated {timeAgo(overview.generatedAt)}</>
                : 'Reading platform records…'}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-error-warning-fill text-red-600 text-sm"></AppIcon>
            </span>
            <div>
              <p className="text-sm font-semibold text-red-900">Could not load platform data</p>
              <p className="text-[12px] text-red-700 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Attention — only real conditions, only when they hold        */}
        {/* ============================================================ */}
        {attention.length > 0 && (
          <div className="space-y-2">
            {attention.map((a, i) => (
              <Link
                key={i}
                to={a.href}
                className={`rounded-xl p-3.5 flex items-start gap-3 cursor-pointer transition-smooth ${
                  a.tone === 'critical'
                    ? 'bg-red-50 border border-red-200/60 hover:bg-red-100/70'
                    : 'bg-amber-50 border border-amber-200/60 hover:bg-amber-100/70'
                }`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${a.tone === 'critical' ? 'bg-red-100' : 'bg-amber-100'}`}>
                  <AppIcon className={`${a.tone === 'critical' ? 'ri-error-warning-fill text-red-600' : 'ri-alert-line text-amber-600'} text-sm`}></AppIcon>
                </span>
                <p className={`text-[13px] font-medium flex-1 ${a.tone === 'critical' ? 'text-red-900' : 'text-amber-900'}`}>{a.text}</p>
                <AppIcon className={`ri-arrow-right-line text-sm shrink-0 ${a.tone === 'critical' ? 'text-red-400' : 'text-amber-400'}`}></AppIcon>
              </Link>
            ))}
          </div>
        )}

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          <MiniStat loading={loading} label="Sign-in accounts" value={acc?.total} sub={`${acc?.active ?? 0} able to sign in`} icon="ri-shield-user-line" color="primary" href="/admin/users" />
          <MiniStat loading={loading} label="Active last 30 days" value={acc?.activeLast30d} sub={`${acc?.liveSessions ?? 0} live sessions`} icon="ri-pulse-line" color="secondary" href="/admin/access-logs" />
          <MiniStat loading={loading} label="Awaiting first sign-in" value={acc?.neverSignedIn} sub={`${overview?.invitations.pending ?? 0} invitations pending`} icon="ri-mail-send-line" color="accent" href="/admin/users?status=invited" />
          <MiniStat loading={loading} label="Suspended or locked" value={(acc?.suspended ?? 0) + (acc?.locked ?? 0)} sub={`${acc?.suspended ?? 0} suspended · ${acc?.locked ?? 0} locked`} icon="ri-lock-line" color="primary" href="/admin/users?status=suspended" />

          {people?.available && <>
            <MiniStat loading={loading} label="Learners" value={people.learners} sub={`${people.apprenticeship} apprenticeship · ${people.commercial} commercial`} icon="ri-user-line" color="secondary" href="/users" />
            <MiniStat loading={loading} label="Employers" value={people.employers} sub={`${people.organisations} organisations`} icon="ri-building-2-line" color="accent" href="/admin/platform-report" />
          </>}
          {overview?.curriculum.available && <>
            <MiniStat loading={loading} label="Programmes" value={overview.curriculum.programmes} sub={`${overview.curriculum.modules} modules authored`} icon="ri-stack-line" color="primary" href="/admin/platform-report" />
            <MiniStat loading={loading} label="Cohorts" value={overview.curriculum.cohorts} sub="in the curriculum schema" icon="ri-group-2-line" color="secondary" href="/admin/platform-report" />
          </>}
        </div>

        {/* ============================================================ */}
        {/* Workspaces — jump into any section                            */}
        {/* ============================================================ */}
        {/* Super Admin access means every workspace, so these navigate
            straight there: unlike the public launcher, there is no demo
            account to assume. The list is shared with that launcher
            (lib/portalWorkspaces) so the two cannot drift apart. */}
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-heading font-semibold text-foreground-900">Workspaces</h2>
            <span className="text-[11px] text-foreground-400">{PORTAL_WORKSPACES.length} sections</span>
          </div>
          <p className="text-[11px] text-foreground-400 mb-4">
            Open any section directly — your access covers all of them.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {PORTAL_WORKSPACES.map(ws => (
              <Link
                key={ws.slug}
                to={ws.path}
                className="group flex flex-col items-start gap-2 p-3.5 rounded-xl border border-foreground-200/60 hover:border-primary-300 hover:bg-primary-50/40 transition-smooth cursor-pointer"
              >
                <span className="w-9 h-9 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 group-hover:bg-primary-200 transition-smooth">
                  <AppIcon className={`${ws.icon} text-base`}></AppIcon>
                </span>
                <span className="text-[13px] font-semibold text-foreground-900">{ws.label}</span>
                <span className="text-[10px] text-foreground-400 leading-snug">{ws.blurb}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ============================================================ */}
        {/* Main grid                                                     */}
        {/* ============================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Accounts by role */}
            <section>
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">Accounts by role</h2>
                <Link to="/admin/roles" className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
                  Manage roles <AppIcon className="ri-arrow-right-line text-[10px] ml-0.5"></AppIcon>
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {acc ? (Object.entries(acc.byRole) as [string, number][]).map(([role, count]) => {
                  const total = acc.total || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <Link key={role} to={`/admin/users?role=${role}`} className="block bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium cursor-pointer">
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
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Authentication activity</h3>
                <Link to="/admin/access-logs" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Access logs</Link>
              </div>
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
            </section>

            {/* Audit trail */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Recent access events</h3>
                <Link to="/admin/access-logs" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Full log</Link>
              </div>
              {audit.length === 0 ? (
                <p className="text-[12px] text-foreground-400 py-6 text-center">
                  {loading ? 'Loading audit trail…' : 'No access events recorded yet.'}
                </p>
              ) : (
                <div className="space-y-1">
                  {audit.map(entry => (
                    <div key={entry.id} className="flex items-start gap-2.5 py-2 border-b border-background-100/50 last:border-0">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        entry.severity === 'critical' ? 'bg-red-500' : entry.severity === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground-800">
                          {eventLabel(entry.event)}
                          {!entry.succeeded && <span className="ml-1.5 text-[10px] font-semibold text-red-600">failed{entry.reason ? ` · ${entry.reason}` : ''}</span>}
                        </p>
                        <p className="text-[10px] text-foreground-400 truncate">{entry.email || 'unknown address'}</p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <p className="text-[10px] text-foreground-400 whitespace-nowrap">{timeAgo(entry.createdAt)}</p>
                        {entry.ipAddress && <p className="text-[10px] text-foreground-300 whitespace-nowrap">{entry.ipAddress}</p>}
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
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-4 md:space-y-6">
            {/* System status */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">System status</h3>
                <Link to="/admin/system" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Details</Link>
              </div>
              <p className="text-[10px] text-foreground-400 mb-4">Whether each subsystem is configured in this deployment.</p>
              <div className="space-y-2.5">
                {system ? system.checks.map(check => (
                  <div key={check.id} className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      check.configured ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      <AppIcon className={`${check.configured ? 'ri-check-line' : 'ri-alert-line'} text-xs`}></AppIcon>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-foreground-800 truncate">{check.name}</p>
                      <p className="text-[10px] text-foreground-400 truncate">{check.detail}</p>
                    </div>
                  </div>
                )) : (
                  <p className="text-[12px] text-foreground-400 py-2">{loading ? 'Checking…' : 'Unavailable.'}</p>
                )}
              </div>
            </section>

            {/* Invitations */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Invitations</h3>
                <Link to="/admin/notifications" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Email log</Link>
              </div>
              {overview ? (
                <div className="grid grid-cols-3 gap-2">
                  <Figure value={overview.invitations.pending} label="Pending" tone="neutral" />
                  <Figure value={overview.invitations.expired} label="Expired" tone={overview.invitations.expired > 0 ? 'warn' : 'neutral'} />
                  <Figure value={overview.invitations.failed} label="Failed" tone={overview.invitations.failed > 0 ? 'bad' : 'neutral'} />
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

            {/* Documents */}
            {overview?.documents.available && (
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Compliance documents</h3>
                  <Link to="/admin/documents" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">Browse</Link>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Figure value={overview.documents.total} label="Stored" tone="neutral" />
                  <Figure value={overview.documents.signed} label="Signed" tone="ok" />
                  <Figure value={overview.documents.last30d} label="Last 30d" tone="neutral" />
                </div>
              </section>
            )}

            {/* Delivery — only when the Learner schema is provisioned */}
            {overview?.delivery.available && (
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Learner delivery</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Figure value={overview.delivery.activeLearners} label="Active" tone="ok" />
                  <Figure value={overview.delivery.inactiveLearners} label="Archived" tone="neutral" />
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

/* ======================================================================== */
/* Stat card — links through to the filtered list it summarises              */
/* ======================================================================== */
function MiniStat({ label, value, sub, icon, color, href, loading }: {
  label: string; value: number | undefined; sub: string; icon: string; color: string; href: string; loading: boolean;
}) {
  const bgMap: Record<string, string> = {
    primary: 'bg-primary-100 text-primary-600',
    secondary: 'bg-secondary-100 text-secondary-600',
    accent: 'bg-accent-50 text-accent-700',
  };
  return (
    <Link to={href} className="block bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 card-premium cursor-pointer">
      <span className={`w-7 md:w-8 h-7 md:h-8 rounded-lg flex items-center justify-center ${bgMap[color] || bgMap.primary} mb-2 md:mb-3`}>
        <AppIcon className={`${icon} text-xs md:text-sm`}></AppIcon>
      </span>
      <p className="text-xl md:text-2xl font-heading font-semibold text-foreground-900">
        {loading && value === undefined ? <span className="inline-block w-8 h-6 rounded bg-background-200 animate-pulse" /> : value ?? 0}
      </p>
      <p className="text-[10px] md:text-[11px] text-foreground-400 mt-1">{label}</p>
      <p className="text-[10px] text-foreground-300 truncate">{sub}</p>
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
    <div className="bg-background-100/70 rounded-lg p-3 text-center">
      <p className={`text-2xl font-heading font-bold ${toneMap[tone]}`}>{value}</p>
      <p className="text-[10px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}
