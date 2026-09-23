import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import { listEmployers, type EmployerRow } from '@/api/employers';
import { Hero, StatCard, btnSecondary } from '@/pages/users/components/ui';

// ============================================================================
// Employer workspace — one card per employer, reached from the header's
// WorkspaceSwitcher.
//
// An employer here is a contact person (enrolment."Employers"), not a company,
// which is what makes a card the right entry point: each one opens that
// person's existing side page at /employers/:id, where their learners and the
// documents they must sign live. This page adds no data of its own.
//
// Super Admin only. It sits under /workspace/admin so the route guard's
// existing admin rule covers it; the API behind it is staff-only either way.
// The endpoint returns every row unpaged, so the search filters locally.
// ============================================================================

const adminNav = roleNavMap.admin;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function location(row: EmployerRow): string {
  return [row.townCity, row.county].filter(Boolean).join(', ');
}

function EmployerCard({ employer, onOpen }: { employer: EmployerRow; onOpen: () => void }) {
  const place = location(employer);
  return (
    <button
      onClick={onOpen}
      className="text-left bg-background-50 rounded-2xl border border-foreground-200/60 p-5 card-premium transition-smooth cursor-pointer hover:border-primary-300"
    >
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-xl flex items-center justify-center text-[13px] font-bold shrink-0 bg-accent-100 text-accent-700 border border-accent-200/50">
          {initials(employer.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground-900 truncate" title={employer.name}>
            {employer.name || 'Unnamed contact'}
          </p>
          <p className="text-[12px] text-foreground-500 truncate" title={employer.email}>
            {employer.email || 'No email'}
          </p>
        </div>
        <AppIcon className="ri-arrow-right-line shrink-0 text-foreground-300" />
      </div>

      <dl className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <dt className="text-foreground-500">Mobile</dt>
          <dd className="text-foreground-800 font-medium truncate max-w-[60%]">{employer.mobile || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <dt className="text-foreground-500">Location</dt>
          <dd className="text-foreground-800 font-medium truncate max-w-[60%]" title={place}>{place || '—'}</dd>
        </div>
      </dl>

      <div className="mt-4 pt-3 border-t border-foreground-100 flex flex-wrap gap-1">
        {employer.employerGroupNames.length ? (
          employer.employerGroupNames.map((name, i) => (
            <span
              key={`${employer.id}-${i}`}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200/50"
            >
              {name || 'Unnamed organisation'}
            </span>
          ))
        ) : (
          <span className="text-[12px] text-foreground-400">Not linked to an organisation</span>
        )}
      </div>
    </button>
  );
}

export default function EmployerWorkspacePage() {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const [employers, setEmployers] = useState<EmployerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    setError(null);
    listEmployers()
      .then((page) => setEmployers(page.results))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const all = useMemo(() => employers ?? [], [employers]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((e) =>
      [e.name, e.email, ...e.employerGroupNames].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [all, search]);
  const linked = all.filter((e) => e.employerGroupIds.length > 0).length;
  const withEmail = all.filter((e) => e.email).length;

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Employer Workspace"
      pageSubtitle="Every employer contact and their learners"
      userName={auth.account?.displayName || auth.user?.fullName || 'Platform Admin'}
      userRole="Super Administrator"
    >
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-briefcase-line"
            title="Employers"
            subtitle={
              employers
                ? <><strong>{all.length} employer{all.length === 1 ? '' : 's'}</strong> · open one to see their learners and documents</>
                : undefined
            }
          />
        </div>

        {loading && (
          <p className="py-16 text-center text-[13px] text-foreground-400">
            <AppIcon className="ri-loader-4-line animate-spin mr-2" />Loading employers…
          </p>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-red-600 text-[13px] mb-3"><AppIcon className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><AppIcon className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {!loading && !error && employers && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              <StatCard icon="ri-briefcase-line" label="Employers" value={all.length} tint="primary" />
              <StatCard icon="ri-building-2-line" label="Linked to an organisation" value={linked} tint="emerald" />
              <StatCard icon="ri-mail-line" label="With email" value={withEmail} tint="amber" />
            </div>

            <label className="relative block max-w-xl">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or organisation"
                aria-label="Search employers"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            {visible.length === 0 ? (
              <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-12 text-center card-premium">
                <AppIcon className="ri-briefcase-line text-3xl text-foreground-300" />
                <p className="text-[13px] text-foreground-500 mt-3">
                  {search ? 'No employers match this search.' : 'No employers have been created yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
                {visible.map((employer) => (
                  <EmployerCard
                    key={employer.id}
                    employer={employer}
                    onOpen={() => navigate(`/employers/${employer.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
