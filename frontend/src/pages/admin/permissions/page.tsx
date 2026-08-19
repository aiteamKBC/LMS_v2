// ============================================================================
// Permissions — the role/permission matrix as the server enforces it
//
// Read-only by design. The grid is rendered from the same `_PERMISSIONS` map
// that `require_permission` checks at request time, so what is shown here is
// what the API will actually allow — not a parallel copy that can drift.
// ============================================================================
import { Fragment, useCallback } from 'react';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchRoles } from '@/api/platformAdmin';

/** Group permissions by their dotted prefix so the matrix has sections. */
function groupPermissions(permissions: string[]): { area: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const p of permissions) {
    const area = p.includes('.') ? p.split('.')[0] : 'general';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area)!.push(p);
  }
  return [...groups.entries()]
    .map(([area, items]) => ({ area, items: items.sort() }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

const AREA_LABELS: Record<string, string> = {
  accounts: 'Account management',
  documents: 'Documents',
  enrolment: 'Enrolment',
  employers: 'Employers',
  learners: 'Learners',
  staff: 'Staff',
  self: 'Own record',
  'employer-portal': 'Employer portal',
};

export default function AdminPermissionsPage() {
  const { data, loading, error, reload } = useAdminData(useCallback(() => fetchRoles(), []));

  const roles = data?.results ?? [];
  const permissions = data?.permissions ?? [];
  const groups = groupPermissions(permissions);

  return (
    <AdminPage
      title="Permissions"
      subtitle="What each role is allowed to do, as enforced by the API"
      icon="ri-key-2-line"
      heroTitle="Permission matrix"
      heroBlurb={
        <>Rendered from the same map the server checks on every request, so this grid cannot drift from what the API actually permits.</>
      }
      stats={[
        { label: 'Permissions', value: loading && !data ? '—' : permissions.length },
        { label: 'Roles', value: loading && !data ? '—' : roles.length },
      ]}
    >
      <DataPanel loading={loading && !data} error={error} empty={permissions.length === 0} onRetry={reload}>
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider sticky left-0 bg-background-50">
                    Permission
                  </th>
                  {roles.map(role => (
                    <th key={role.id} className="px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider text-center whitespace-nowrap">
                      {role.name}
                      <span className="block text-[9px] text-foreground-300 font-normal normal-case mt-0.5">
                        {role.counts.total ?? 0} account{(role.counts.total ?? 0) === 1 ? '' : 's'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <Fragment key={group.area}>
                    <tr className="bg-background-100/60">
                      <td colSpan={roles.length + 1} className="px-4 py-1.5 text-[10px] font-semibold text-foreground-500 uppercase tracking-wider">
                        {AREA_LABELS[group.area] || group.area}
                      </td>
                    </tr>
                    {group.items.map(permission => (
                      <tr key={permission} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                        <td className="px-4 py-2.5 sticky left-0 bg-background-50">
                          <span className="font-mono text-[11px] text-foreground-700">{permission}</span>
                        </td>
                        {roles.map(role => {
                          const granted = role.permissions.includes(permission);
                          return (
                            <td key={role.id} className="px-4 py-2.5 text-center">
                              {granted ? (
                                <span className="inline-flex w-6 h-6 rounded-full bg-emerald-100 items-center justify-center">
                                  <AppIcon className="ri-check-line text-emerald-600 text-xs"></AppIcon>
                                </span>
                              ) : (
                                <span className="inline-flex w-6 h-6 rounded-full bg-background-100 items-center justify-center">
                                  <AppIcon className="ri-subtract-line text-foreground-300 text-xs"></AppIcon>
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DataPanel>

      <SourceNote>
        This matrix is read-only. Permissions are defined in code (<span className="font-mono">login/identity.py</span>)
        rather than stored per-tenant, so there is nothing here to save — changing a grant is a code change,
        which keeps the check and its definition in one place.
      </SourceNote>
    </AdminPage>
  );
}
