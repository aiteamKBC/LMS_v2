// ============================================================================
// Shared chrome for the Super Admin console pages.
//
// Every page in this section is the same shape — workspace shell, hero banner
// with headline figures, then a body that is loading, failed, empty or a table.
// Before this, each of those states was re-implemented per page (and several
// pages simply had no failure state, because their fixtures could not fail).
// Pulling it here means a page module is now just "fetch X, render X".
// ============================================================================
import { type ReactNode } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { RowsSkeleton } from '@/components/feature/Skeletons';

const adminNav = roleNavMap.admin;

export interface HeroStat {
  label: string;
  value: ReactNode;
}

/**
 * Page frame: shell + hero. `stats` render as the tiles on the right of the
 * banner; pass figures that come from the response, not constants.
 */
export function AdminPage({
  title, subtitle, icon, heroTitle, heroBlurb, stats, actions, children,
}: {
  title: string;
  subtitle: string;
  icon: string;
  heroTitle: string;
  heroBlurb: ReactNode;
  stats?: HeroStat[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { auth } = useAuth();
  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle={title}
      pageSubtitle={subtitle}
      userName={auth.account?.displayName || auth.user?.fullName || 'Platform Admin'}
      userRole="Super Administrator"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(108deg, oklch(var(--primary-700)) 0%, oklch(var(--primary-500)) 30%, oklch(var(--primary-100)) 66%, oklch(var(--background-50)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-5 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className={`${icon} text-white text-2xl`}></AppIcon>
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-heading font-bold text-white mb-1">{heroTitle}</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{heroBlurb}</p>
            </div>
            {stats && stats.length > 0 && (
              <div className="flex items-center gap-3 shrink-0 flex-wrap">
                {stats.map(s => (
                  <div key={s.label} className="bg-white/50 border border-white/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center min-w-[80px]">
                    <p className="text-2xl font-bold text-primary-900">{s.value}</p>
                    <p className="text-[10px] text-primary-800/75 uppercase tracking-wide whitespace-nowrap">{s.label}</p>
                  </div>
                ))}
              </div>
            )}
            {actions}
          </div>
        </div>
        {children}
      </div>
    </WorkspaceShell>
  );
}

/** Panel that resolves loading / error / empty before rendering its children. */
export function DataPanel({
  loading, error, empty, emptyMessage, onRetry, children, className = '', skeleton,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
  className?: string;
  /** Override the placeholder when the panel holds something other than rows. */
  skeleton?: ReactNode;
}) {
  if (loading) {
    // Skeleton rather than a spinner: this panel is the body of every admin
    // console page, so what is arriving is always a list of things — and the
    // page keeps its height instead of collapsing and jumping back.
    return (
      <div className={`bg-background-50 rounded-xl p-5 shadow-sm ${className}`}>
        {skeleton ?? <RowsSkeleton rows={5} />}
      </div>
    );
  }
  if (error) {
    return (
      <div className={`bg-red-50 rounded-xl border border-red-200/60 p-8 text-center ${className}`}>
        <span className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-3">
          <AppIcon className="ri-error-warning-line text-red-600 text-lg"></AppIcon>
        </span>
        <p className="text-sm font-semibold text-red-900">Could not load this page</p>
        <p className="text-[12px] text-red-700 mt-1 max-w-md mx-auto">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-4 px-4 py-2 bg-red-500 text-white rounded-xl text-[12px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer">
            Try again
          </button>
        )}
      </div>
    );
  }
  if (empty) {
    return (
      <div className={`bg-background-50 rounded-xl p-10 text-center shadow-sm ${className}`}>
        <span className="w-10 h-10 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
          <AppIcon className="ri-inbox-line text-foreground-300 text-lg"></AppIcon>
        </span>
        <p className="text-[13px] text-foreground-500">{emptyMessage || 'Nothing to show yet.'}</p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Status pill with the console's four tones. */
export function StatusBadge({ status, tone }: { status: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }) {
  const map = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
    bad: 'bg-red-50 text-red-700 border-red-200/50',
    warn: 'bg-amber-50 text-amber-700 border-amber-200/50',
    neutral: 'bg-background-100 text-foreground-500 border-foreground-200/60',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap capitalize ${map[tone]}`}>
      {status}
    </span>
  );
}

/** Card explaining that a screen reports rather than configures. */
export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background-100/60 border border-foreground-200/60 rounded-xl p-3.5 flex items-start gap-2.5">
      <AppIcon className="ri-information-line text-foreground-400 text-sm mt-0.5 shrink-0"></AppIcon>
      <p className="text-[11px] text-foreground-500 leading-relaxed">{children}</p>
    </div>
  );
}

/** Pagination footer shared by the long tables. */
export function Pager({ page, pageSize, count, onPage }: {
  page: number; pageSize: number; count: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);
  return (
    <div className="px-4 py-3 border-t border-background-100/60 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-[11px] text-foreground-400">Showing {from}–{to} of {count}</p>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="px-3 py-1.5 rounded-lg border border-foreground-200/60 text-[12px] text-foreground-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background-100 transition-smooth cursor-pointer"
        >
          Previous
        </button>
        <span className="text-[11px] text-foreground-400">Page {page} of {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="px-3 py-1.5 rounded-lg border border-foreground-200/60 text-[12px] text-foreground-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background-100 transition-smooth cursor-pointer"
        >
          Next
        </button>
      </div>
    </div>
  );
}
