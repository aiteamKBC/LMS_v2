import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface SyncRecord {
  learner: string;
  programme: string;
  employer: string;
  status: 'Ready' | 'Synced' | 'Error' | 'Pending';
  lastSync: string;
  missingFields: string[];
  mismatches: number;
}

const SYNC_RECORDS: SyncRecord[] = [
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', status: 'Ready', lastSync: '—', missingFields: [], mismatches: 0 },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', status: 'Ready', lastSync: '—', missingFields: [], mismatches: 0 },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', status: 'Ready', lastSync: '—', missingFields: [], mismatches: 0 },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', status: 'Ready', lastSync: '—', missingFields: [], mismatches: 0 },
  { learner: 'Emily Chen', programme: 'Business Admin L3', employer: 'Boots UK', status: 'Synced', lastSync: '10 Jun 2026, 08:30', missingFields: [], mismatches: 0 },
  { learner: 'Priya Sharma', programme: 'Business Admin L3', employer: 'NatWest', status: 'Synced', lastSync: '10 Jun 2026, 08:30', missingFields: [], mismatches: 0 },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', status: 'Error', lastSync: '9 Jun 2026, 14:15', missingFields: ['Planned OTJH', 'TNP2'], mismatches: 1 },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', status: 'Error', lastSync: '8 Jun 2026, 11:00', missingFields: ['Employer ID', 'Aim Reference', 'Start Date', 'TNP1', 'TNP2', 'Planned OTJH'], mismatches: 0 },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', status: 'Error', lastSync: '7 Jun 2026, 09:45', missingFields: ['Employer ID', 'Aim Reference', 'Start Date', 'TNP1', 'TNP2', 'Planned OTJH'], mismatches: 2 },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', status: 'Pending', lastSync: '—', missingFields: ['Planned OTJH'], mismatches: 0 },
  { learner: 'Fatima Hassan', programme: 'Healthcare Support L2', employer: 'Medway NHS Trust', status: 'Pending', lastSync: '—', missingFields: ['Employer ID format'], mismatches: 1 },
  { learner: 'Marcus Webb', programme: 'Team Leader L3', employer: 'Maidstone Borough Council', status: 'Pending', lastSync: '—', missingFields: ['Aim Reference', 'Start Date', 'TNP1', 'TNP2', 'Planned OTJH'], mismatches: 0 },
];

const ready = SYNC_RECORDS.filter(r => r.status === 'Ready').length;
const synced = SYNC_RECORDS.filter(r => r.status === 'Synced').length;
const errors = SYNC_RECORDS.filter(r => r.status === 'Error').length;
const pending = SYNC_RECORDS.filter(r => r.status === 'Pending').length;

export default function AptemSyncPage() {
  const [filter, setFilter] = useState('all');

  const filtered = SYNC_RECORDS.filter(r => {
    if (filter === 'ready') return r.status === 'Ready';
    if (filter === 'synced') return r.status === 'Synced';
    if (filter === 'error') return r.status === 'Error';
    if (filter === 'pending') return r.status === 'Pending';
    return true;
  });

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Aptem Sync" pageSubtitle="Records ready to sync, sync errors, missing fields, mismatches and sync history" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Aptem Sync" description={`${SYNC_RECORDS.length} records — ${ready} ready to sync, ${synced} synced, ${errors} with errors, ${pending} pending.`} icon="ri-refresh-line" imageUrl="https://readdy.ai/api/search-image?query=data%20synchronisation%20integration%20dashboard%20modern%20clean%20interface%20abstract%20technology%20flowing%20data%20patterns%20warm%20professional%20lighting&width=400&height=160&seq=aptem-hero-01&orientation=landscape" imageAlt="Aptem sync" stats={[{ label: 'Records', value: String(SYNC_RECORDS.length) }, { label: 'Errors', value: String(errors), variant: 'danger' }, { label: 'Synced', value: String(synced), variant: 'success' }]} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Ready to Sync', count: ready, icon: 'ri-check-double-line', color: 'bg-primary-100 text-primary-600' },
            { label: 'Synced', count: synced, icon: 'ri-cloud-line', color: 'bg-emerald-100 text-emerald-600' },
            { label: 'Sync Errors', count: errors, icon: 'ri-close-circle-line', color: 'bg-red-100 text-red-600' },
            { label: 'Pending', count: pending, icon: 'ri-hourglass-line', color: 'bg-amber-100 text-amber-600' },
          ].map(c => (
            <div key={c.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${c.color}`}><AppIcon className={`${c.icon} text-xs`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400">{c.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{c.count}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
          {['all', 'ready', 'synced', 'error', 'pending'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer capitalize ${filter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f === 'all' ? 'All' : f}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Last Sync</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Missing Fields</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Mismatches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((r, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${r.status === 'Error' ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-medium text-foreground-900 whitespace-nowrap">{r.learner}</span>
                      <p className="text-[10px] text-foreground-400">{r.programme} · {r.employer}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        r.status === 'Synced' ? 'bg-emerald-50 text-emerald-700' : r.status === 'Ready' ? 'bg-primary-50 text-primary-600' : r.status === 'Error' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-400 whitespace-nowrap">{r.lastSync}</td>
                    <td className="px-4 py-3 text-[11px]">
                      {r.missingFields.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.missingFields.map((f, idx) => <span key={idx} className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">{f}</span>)}
                        </div>
                      ) : <span className="text-foreground-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600">{r.mismatches > 0 ? <span className="text-red-600 font-semibold">{r.mismatches}</span> : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}