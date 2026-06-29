import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface WorkplaceConfirmation {
  id: string;
  apprentice: string;
  initials: string;
  type: string;
  description: string;
  status: 'pending' | 'confirmed' | 'rejected';
  requestedBy: string;
  requestedDate: string;
  dueDate: string;
}

const CONFIRMATIONS: WorkplaceConfirmation[] = [
  { id: 'wc-01', apprentice: 'Sophie Williams', initials: 'SW', type: 'Workplace Training Hours', description: 'Confirm Sophie completed 16 hours of workplace-based training during May 2026 at Tim Hortons Canterbury', status: 'pending', requestedBy: 'Med Maher (Coach)', requestedDate: '1 Jun 2026', dueDate: '15 Jun 2026' },
  { id: 'wc-02', apprentice: 'Tom Richards', initials: 'TR', type: 'Line Manager Verification', description: 'Verify Tom is employed in a role that matches the Marketing Executive apprenticeship standard and receives appropriate supervision', status: 'pending', requestedBy: 'Sarah Khan (Coach)', requestedDate: '3 Jun 2026', dueDate: '17 Jun 2026' },
  { id: 'wc-03', apprentice: 'Daniel Clarke', initials: 'DC', type: 'Workplace Project Validation', description: 'Confirm the Business Communication project submitted is genuine workplace output from Tim Hortons Dover location', status: 'confirmed', requestedBy: 'Med Maher (Coach)', requestedDate: '28 May 2026', dueDate: '11 Jun 2026' },
  { id: 'wc-04', apprentice: 'Mark Jensen', initials: 'MJ', type: 'Employer Reference', description: 'Provide employer reference confirming Mark\'s role as Digital Marketer and his involvement in social media campaign work', status: 'pending', requestedBy: 'Med Maher (Coach)', requestedDate: '5 Jun 2026', dueDate: '19 Jun 2026' },
  { id: 'wc-05', apprentice: 'Rachel Thompson', initials: 'RT', type: 'Workplace Training Hours', description: 'Confirm Rachel completed 28 hours of data analysis training and workplace projects during May-June 2026', status: 'confirmed', requestedBy: 'Sarah Khan (Coach)', requestedDate: '2 Jun 2026', dueDate: '16 Jun 2026' },
  { id: 'wc-06', apprentice: 'Lucy Barnes', initials: 'LB', type: 'Job Role Confirmation', description: 'Confirm Lucy\'s HR role provides sufficient exposure to HR practices to meet the HR Consultant apprenticeship requirements', status: 'pending', requestedBy: 'David Osei (Coach)', requestedDate: '6 Jun 2026', dueDate: '20 Jun 2026' },
];

export default function EmployerWorkplaceConfirmations() {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = statusFilter === 'all' ? CONFIRMATIONS : CONFIRMATIONS.filter(c => c.status === statusFilter);
  const pending = CONFIRMATIONS.filter(c => c.status === 'pending').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Workplace Confirmations" pageSubtitle="Confirm workplace training, job roles and apprentice employment details" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-building-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Workplace Confirmations</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{CONFIRMATIONS.length} confirmations</strong> · {pending} pending</p>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-amber-300">{pending}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p></div>
          </div>
        </div>

        {pending > 0 && (
          <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0"><i className="ri-alert-line text-amber-600 text-base"></i></span>
            <div className="flex-1"><p className="text-sm font-semibold text-amber-800">{pending} workplace confirmations need your attention</p><p className="text-[12px] text-amber-600 mt-0.5">These confirmations are required for funding compliance and apprenticeship progress</p></div>
          </div>
        )}

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
          {[{ key: 'all', label: 'All' },{ key: 'pending', label: 'Pending' },{ key: 'confirmed', label: 'Confirmed' }].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map(item => (
            <div key={item.id} className={`bg-background-50 rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${item.status === 'pending' ? 'border-amber-200/50 bg-amber-50/10' : 'border-foreground-200/60'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 shrink-0 ${item.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : 'bg-amber-100 text-amber-700 ring-amber-200'}`}>
                <span className="text-sm font-bold">{item.initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{item.type}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.status}</span>
                </div>
                <p className="text-sm font-semibold text-foreground-900 mb-1">{item.apprentice}</p>
                <p className="text-[12px] text-foreground-500 mb-2">{item.description}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-400">
                  <span>Requested: {item.requestedBy}</span><span>{item.requestedDate}</span><span className="flex items-center gap-1"><i className="ri-calendar-line text-[10px]"></i> Due: {item.dueDate}</span>
                </div>
              </div>
              {item.status === 'pending' && (
                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Confirm</button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Decline</button>
                </div>
              )}
              {item.status === 'confirmed' && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1 shrink-0"><i className="ri-check-double-line"></i> Confirmed</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}