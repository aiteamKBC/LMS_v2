// ============================================================================
// Employers — enrolment."Employers"
//
// An employer here is a contact person, possibly associated with one or more
// organisation profiles. Contracts and apprentice totals are not stored on this
// table, so the old page's invented figures have been removed.
// ============================================================================
import { useCallback, useState } from 'react';
import { listEmployers } from '@/api/employers';
import { AdminPage, DataPanel, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';

function address(row: { townCity: string; county: string; country: string }): string {
  return [row.townCity, row.county, row.country].filter(Boolean).join(', ') || '—';
}

export default function AdminEmployersPage() {
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useAdminData(
    useCallback(() => listEmployers({ search: search || undefined }), [search]),
    [search],
  );
  const employers = data?.results ?? [];
  const withEmail = employers.filter(e => e.email).length;
  const linked = employers.filter(e => e.employerGroupIds.length > 0).length;

  return (
    <AdminPage
      title="Employers"
      subtitle="Employer contacts and their organisation memberships"
      icon="ri-building-2-line"
      heroTitle="Employer contacts"
      heroBlurb={<>Real contact profiles from <strong>enrolment.Employers</strong>. An employer can belong to more than one organisation.</>}
      stats={[
        { label: 'Contacts', value: loading && !data ? '—' : data?.count ?? 0 },
        { label: 'With email', value: loading && !data ? '—' : withEmail },
        { label: 'Linked to an org', value: loading && !data ? '—' : linked },
      ]}
    >
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
        <label className="relative block max-w-xl"><AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email" className="w-full pl-9 pr-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-200" /></label>
      </div>

      <DataPanel loading={loading && !data} error={error} empty={employers.length === 0}
        emptyMessage={search ? 'No employer contacts match this search.' : 'No employer contacts have been created yet.'} onRetry={reload}>
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-foreground-400/50">
          <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Contact</th>
          <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Email</th>
          <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Mobile</th>
          <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Organisation memberships</th>
          <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Location</th>
        </tr></thead><tbody>{employers.map(emp => <tr key={emp.id} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
          <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-lg bg-accent-100 text-accent-700 flex items-center justify-center shrink-0 font-semibold">{(emp.name || '?').charAt(0).toUpperCase()}</span><p className="font-medium text-foreground-800">{emp.name || 'Unnamed contact'}</p></div></td>
          <td className="px-4 py-3 text-foreground-600">{emp.email || '—'}</td><td className="px-4 py-3 text-foreground-600">{emp.mobile || '—'}</td>
          <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{emp.employerGroupNames.length ? emp.employerGroupNames.map((name, i) => <span key={`${emp.id}-${i}`} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200/50">{name || 'Unnamed organisation'}</span>) : <span className="text-[11px] text-foreground-400">Not linked</span>}</div></td>
          <td className="px-4 py-3 text-foreground-600">{address(emp)}</td>
        </tr>)}</tbody></table></div></div>
      </DataPanel>
      <SourceNote>Employer profiles are contact people, not employer companies. Their organisation memberships are the stored relationship; contract and apprentice counts are not inferred from unrelated records.</SourceNote>
    </AdminPage>
  );
}
