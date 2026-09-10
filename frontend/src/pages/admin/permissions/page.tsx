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
import { AppIcon } from '@/components/feature/AppIcon';
import styles from './permissions.module.css';

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
        <div className={`${styles.panel} bg-[var(--kbc-surface)] rounded-2xl border border-[var(--kbc-border)] overflow-hidden`}>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Role permissions">
            <table className={`${styles.matrix} w-full text-[13px]`} aria-label="Permission matrix">
              <colgroup>
                <col style={{ width: '32%' }} />
                {roles.map(role => <col key={role.id} style={{ width: `${68 / roles.length}%` }} />)}
              </colgroup>
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th scope="col" className={`${styles.permission} sticky left-0`}>
                    Permission
                  </th>
                  {roles.map(role => (
                    <th key={role.id} scope="col">
                      <span className={styles.roleName}>{role.name}</span>
                      <span className={styles.accountCount}>
                        {role.counts.total ?? 0} account{(role.counts.total ?? 0) === 1 ? '' : 's'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <Fragment key={group.area}>
                    <tr className={styles.group}>
                      <td colSpan={roles.length + 1}>
                        {AREA_LABELS[group.area] || group.area}
                      </td>
                    </tr>
                    {group.items.map(permission => (
                      <tr key={permission} className={styles.permissionRow}>
                        <td className={`${styles.permission} sticky left-0`}>
                          <span className="font-mono text-xs text-foreground-700">{permission}</span>
                        </td>
                        {roles.map(role => {
                          const granted = role.permissions.includes(permission);
                          return (
                            <td key={role.id}>
                              {granted ? (
                                <span className="inline-flex w-6 h-6 rounded-full bg-emerald-100 items-center justify-center" role="img" aria-label="Granted">
                                  <AppIcon className="ri-check-line text-emerald-600 text-xs"></AppIcon>
                                </span>
                              ) : (
                                <span className="inline-flex w-6 h-6 rounded-full bg-background-100 items-center justify-center" role="img" aria-label="Not granted">
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
