import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface ILRRecord {
  learner: string;
  programme: string;
  employer: string;
  aimRef: string;
  startDate: string;
  plannedEnd: string;
  tnp1: string;
  tnp2: string;
  plannedOtjh: string;
  employerId: string;
  rplApplied: boolean;
  issues: number;
  status: 'Ready' | 'Warnings' | 'Errors';
}

const ILR_RECORDS: ILRRecord[] = [
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', aimRef: 'ZPROG001', startDate: '02 Jun 2026', plannedEnd: '01 Jun 2027', tnp1: '12000', tnp2: '1500', plannedOtjh: '348', employerId: 'EMP001', rplApplied: false, issues: 0, status: 'Ready' },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', aimRef: 'ZPROG002', startDate: '01 Jun 2026', plannedEnd: '31 May 2027', tnp1: '', tnp2: '', plannedOtjh: '', employerId: 'EMP002', rplApplied: false, issues: 3, status: 'Warnings' },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', aimRef: '', startDate: '—', plannedEnd: '—', tnp1: '', tnp2: '', plannedOtjh: '', employerId: '', rplApplied: false, issues: 7, status: 'Errors' },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', aimRef: 'ZPROG003', startDate: '15 Jun 2026', plannedEnd: '14 Jun 2027', tnp1: '12000', tnp2: '1500', plannedOtjh: '348', employerId: 'EMP003', rplApplied: false, issues: 1, status: 'Warnings' },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', aimRef: '', startDate: '—', plannedEnd: '—', tnp1: '', tnp2: '', plannedOtjh: '', employerId: '', rplApplied: false, issues: 8, status: 'Errors' },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', aimRef: 'ZPROG004', startDate: '09 Jun 2026', plannedEnd: '08 Jun 2027', tnp1: '10000', tnp2: '1200', plannedOtjh: '278', employerId: 'EMP004', rplApplied: false, issues: 0, status: 'Ready' },
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', aimRef: 'ZPROG005', startDate: '05 Jun 2026', plannedEnd: '04 Jun 2027', tnp1: '12000', tnp2: '1500', plannedOtjh: '348', employerId: 'EMP005', rplApplied: false, issues: 0, status: 'Ready' },
  { learner: 'Emily Chen', programme: 'Business Admin L3', employer: 'Boots UK', aimRef: 'ZPROG006', startDate: '28 May 2026', plannedEnd: '27 May 2027', tnp1: '12000', tnp2: '1500', plannedOtjh: '348', employerId: 'EMP006', rplApplied: false, issues: 0, status: 'Ready' },
  { learner: 'Priya Sharma', programme: 'Business Admin L3', employer: 'NatWest', aimRef: 'ZPROG007', startDate: '10 Jun 2026', plannedEnd: '09 Jun 2027', tnp1: '12000', tnp2: '1500', plannedOtjh: '348', employerId: 'EMP007', rplApplied: false, issues: 0, status: 'Ready' },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', aimRef: 'ZPROG008', startDate: '08 Jun 2026', plannedEnd: '07 Jun 2027', tnp1: '12000', tnp2: '1500', plannedOtjh: '', employerId: 'EMP008', rplApplied: false, issues: 2, status: 'Warnings' },
];

const ready = ILR_RECORDS.filter(r => r.status === 'Ready').length;
const warnings = ILR_RECORDS.filter(r => r.status === 'Warnings').length;
const errors = ILR_RECORDS.filter(r => r.status === 'Errors').length;

export default function ILRPage() {
  const [filter, setFilter] = useState('all');

  const filtered = ILR_RECORDS.filter(r => {
    if (filter === 'ready') return r.status === 'Ready';
    if (filter === 'warnings') return r.status === 'Warnings';
    if (filter === 'errors') return r.status === 'Errors';
    return true;
  });

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="ILR Readiness" pageSubtitle="Individualised Learner Record validation and data completeness" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="ILR Readiness" description={`${ILR_RECORDS.length} records checked — ${ready} ready for submission, ${warnings} with warnings, ${errors} with errors.`} icon="ri-database-2-line" imageUrl="https://readdy.ai/api/search-image?query=data%20validation%20quality%20dashboard%20professional%20modern%20interface%20warm%20lighting%20clean%20UI%20abstract%20data%20visualisation&width=400&height=160&seq=ilr-hero-01&orientation=landscape" imageAlt="ILR readiness" stats={[{ label: 'Records', value: String(ILR_RECORDS.length) }, { label: 'Errors', value: String(errors), variant: 'danger' }, { label: 'Ready', value: String(ready), variant: 'success' }]} />

        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
          {['all', 'ready', 'warnings', 'errors'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer capitalize ${filter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f === 'all' ? 'All' : f}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Aim Ref</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Start</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Planned End</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">TNP1</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">TNP2</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">OTJH</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Employer ID</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Issues</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((r, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${r.status === 'Errors' ? 'bg-red-50/20' : r.status === 'Warnings' ? 'bg-amber-50/15' : ''}`}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                          r.status === 'Ready' ? 'bg-emerald-100 text-emerald-700' : r.status === 'Errors' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>{r.learner.charAt(0)}</span>
                        <span className="text-[12px] font-medium text-foreground-900 whitespace-nowrap">{r.learner}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-foreground-600 whitespace-nowrap">{r.aimRef}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-500 whitespace-nowrap">{r.startDate}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-500 whitespace-nowrap">{r.plannedEnd}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-500">{r.tnp1 || <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-500">{r.tnp2 || <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-500">{r.plannedOtjh || <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-500">{r.employerId || <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-3 text-[11px] font-semibold text-foreground-700">{r.issues}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        r.status === 'Ready' ? 'bg-emerald-50 text-emerald-700' : r.status === 'Warnings' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                      }`}>{r.status}</span>
                    </td>
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