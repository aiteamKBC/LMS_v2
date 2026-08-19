// ============================================================================
// Organisations — enrolment."Organisations"
//
// This is a directory of the actual organisation profiles used by employer
// records. It deliberately does not manufacture a provider/department tree:
// those are not relationships stored by this platform.
// ============================================================================
import { useCallback, useMemo, useState } from 'react';
import { listOrganisations, type OrganisationRow } from '@/api/employers';
import { AdminPage, DataPanel, SourceNote, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';

function location(org: OrganisationRow): string {
  return [org.cityTown, org.county, org.country].filter(Boolean).join(', ') || '—';
}

export default function AdminOrganisationsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useAdminData(
    useCallback(() => listOrganisations({ search: search || undefined, status: status || undefined }), [search, status]),
    [search, status],
  );

  // Memoised off `data` rather than the derived array: `?? []` builds a new
  // literal every render, which would defeat the memo below.
  const organisations = useMemo(() => data?.results ?? [], [data]);
  const statuses = useMemo(() => [...new Set(organisations.map(o => o.status).filter(Boolean))].sort(), [organisations]);
  const levyPayers = organisations.filter(o => o.levyPayer.toLowerCase() === 'yes').length;
  const withContact = organisations.filter(o => o.contactEmail || o.contactTelephone).length;

  return (
    <AdminPage
      title="Organisations"
      subtitle="Organisation profiles used by employer contacts and enrolment"
      icon="ri-building-line"
      heroTitle="Organisation directory"
      heroBlurb={<>Real records from <strong>enrolment.Organisations</strong>. This platform stores profiles, not a provider or tenant hierarchy.</>}
      stats={[
        { label: 'Organisations', value: loading && !data ? '—' : data?.count ?? 0 },
        { label: 'Levy payers', value: loading && !data ? '—' : levyPayers },
        { label: 'Contactable', value: loading && !data ? '—' : withContact },
      ]}
    >
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 flex flex-col md:flex-row gap-3">
        <label className="relative flex-1">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search organisation name"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-200" />
        </label>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-200">
          <option value="">Any status</option>
          {statuses.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      <DataPanel loading={loading && !data} error={error} empty={organisations.length === 0}
        emptyMessage={search || status ? 'No organisations match these filters.' : 'No organisation profiles have been created yet.'} onRetry={reload}>
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-foreground-400/50">
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Organisation</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Contact</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Location</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Levy payer</th>
              </tr></thead>
              <tbody>{organisations.map(org => (
                <tr key={org.id} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                  <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0"><AppIcon className="ri-building-line text-sm"></AppIcon></span><div><p className="font-medium text-foreground-800">{org.name || 'Unnamed organisation'}</p><p className="text-[10px] text-foreground-400">{org.groupType || 'Organisation'}{org.referenceNumber ? ` · ${org.referenceNumber}` : ''}</p></div></div></td>
                  <td className="px-4 py-3"><StatusBadge status={org.status || 'not set'} tone={org.status.toLowerCase() === 'active' ? 'ok' : org.status ? 'neutral' : 'warn'} /></td>
                  <td className="px-4 py-3"><p className="text-foreground-700">{org.contactName || '—'}</p><p className="text-[11px] text-foreground-400">{org.contactEmail || org.contactTelephone || 'No contact details'}</p></td>
                  <td className="px-4 py-3 text-foreground-600">{location(org)}</td>
                  <td className="px-4 py-3 text-foreground-600">{org.levyPayer || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </DataPanel>
      <SourceNote>Organisation records are created and maintained from the Users area. This screen is a live directory so there are no mock “departments” or made-up learner counts.</SourceNote>
    </AdminPage>
  );
}
