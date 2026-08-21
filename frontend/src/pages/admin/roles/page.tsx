// ============================================================================
// Roles — the four the platform actually authorises on
//
// There is no role table and no role editor, because there is nothing to edit:
// `require_role` in login/permissions.py and `_PERMISSIONS` in login/identity.py
// are the authority, and a "create role" button would write a value that no
// code path checks. The previous version of this page offered fifteen invented
// roles with editable permission counts; this one reports the real four and
// says plainly where membership of each comes from.
// ============================================================================
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchRoles } from '@/api/platformAdmin';

const ROLE_ICONS: Record<string, string> = {
  admin: 'ri-shield-star-line',
  staff: 'ri-team-line',
  employer: 'ri-building-2-line',
  learner: 'ri-graduation-cap-line',
};

export default function AdminRolesPage() {
  const { data, loading, error, reload } = useAdminData(useCallback(() => fetchRoles(), []));

  const roles = data?.results ?? [];
  const totalAccounts = roles.reduce((sum, r) => sum + (r.counts.total ?? 0), 0);

  return (
    <AdminPage
      title="Roles"
      subtitle="The roles this platform authorises on, and who holds them"
      icon="ri-shield-check-line"
      heroTitle="Role management"
      heroBlurb={
        <>Four roles are enforced in code. Membership is derived from the enrolment record each person was created from — it is not assigned here.</>
      }
      stats={[
        { label: 'Roles', value: loading && !data ? '—' : roles.length },
        { label: 'Accounts', value: loading && !data ? '—' : totalAccounts },
      ]}
    >
      <DataPanel loading={loading && !data} error={error} empty={roles.length === 0} onRetry={reload}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {roles.map(role => (
            <div key={role.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <div className="flex items-start gap-3 mb-4">
                <span className="w-11 h-11 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                  <AppIcon className={`${ROLE_ICONS[role.id] || 'ri-shield-line'} text-lg`}></AppIcon>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">{role.name}</h3>
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500 border border-foreground-200/60">
                      built-in
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground-500 mt-1 leading-relaxed">{role.description}</p>
                </div>
                <span className="text-2xl font-heading font-semibold text-foreground-900 shrink-0">{role.counts.total ?? 0}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <Count label="Active" value={role.counts.active ?? 0} tone="ok" />
                <Count label="Invited" value={role.counts.invited ?? 0} tone="neutral" />
                <Count label="Suspended" value={role.counts.suspended ?? 0} tone={(role.counts.suspended ?? 0) > 0 ? 'bad' : 'neutral'} />
              </div>

              <div className="mb-3">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-1.5">
                  Permissions ({role.permissions.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {role.permissions.map(p => (
                    <span key={p} className="text-[10px] px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 border border-primary-200/40 font-mono">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-foreground-200/60 flex items-center justify-between gap-2">
                <p className="text-[10px] text-foreground-400 truncate">
                  <AppIcon className="ri-database-2-line mr-1"></AppIcon>{role.source}
                </p>
                <Link to={`/admin/users?role=${role.id}`} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer shrink-0">
                  View accounts <AppIcon className="ri-arrow-right-line text-[10px]"></AppIcon>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </DataPanel>

      <SourceNote>
        Roles are fixed in code, not configuration. A staff member becomes an <strong>admin</strong> by having
        their position set to Admin on their staff record; every other position resolves to <strong>staff</strong>.
        Learners and employers take their role from the table they were created in.
      </SourceNote>
    </AdminPage>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'bad' | 'neutral' }) {
  const map = { ok: 'text-emerald-600', bad: 'text-red-600', neutral: 'text-foreground-700' };
  return (
    <div className="bg-background-100/70 rounded-lg p-2 text-center">
      <p className={`text-base font-heading font-bold ${map[tone]}`}>{value}</p>
      <p className="text-[10px] text-foreground-400">{label}</p>
    </div>
  );
}
