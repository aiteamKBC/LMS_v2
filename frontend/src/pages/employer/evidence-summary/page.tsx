import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface EvidenceEntry {
  id: string;
  apprentice: string;
  initials: string;
  title: string;
  type: string;
  module: string;
  submitted: string;
  ksbCount: number;
  status: 'validated' | 'pending' | 'rejected';
  employerAction: 'none' | 'confirm' | 'validate';
}

const EVIDENCE_DATA: EvidenceEntry[] = [
  { id: 'ev-01', apprentice: 'Sophie Williams', initials: 'SW', title: 'Customer Persona for Tim Hortons Breakfast Campaign', type: 'Workplace Project', module: 'Marketing Planning', submitted: '8 Jun 2026', ksbCount: 3, status: 'pending', employerAction: 'validate' },
  { id: 'ev-02', apprentice: 'Sophie Williams', initials: 'SW', title: 'Workplace Reflection: Applying Segmentation at Work', type: 'Reflection', module: 'Marketing Planning', submitted: '6 Jun 2026', ksbCount: 2, status: 'pending', employerAction: 'confirm' },
  { id: 'ev-03', apprentice: 'Tom Richards', initials: 'TR', title: 'Tim Hortons Seasonal Menu Campaign Research', type: 'Research', module: 'Marketing Planning', submitted: '3 Jun 2026', ksbCount: 4, status: 'pending', employerAction: 'validate' },
  { id: 'ev-04', apprentice: 'Daniel Clarke', initials: 'DC', title: 'Meeting Minutes — Q2 Team Review', type: 'Meeting Notes', module: 'Business Communication', submitted: '5 Jun 2026', ksbCount: 2, status: 'validated', employerAction: 'none' },
  { id: 'ev-05', apprentice: 'Daniel Clarke', initials: 'DC', title: 'Office Project: Stakeholder Communication Plan', type: 'Workplace Project', module: 'Business Communication', submitted: '1 Jun 2026', ksbCount: 3, status: 'validated', employerAction: 'none' },
  { id: 'ev-06', apprentice: 'Mark Jensen', initials: 'MJ', title: 'Instagram Campaign Content Plan for Tim Hortons', type: 'Campaign Materials', module: 'Digital Channels', submitted: '6 Jun 2026', ksbCount: 3, status: 'pending', employerAction: 'validate' },
  { id: 'ev-07', apprentice: 'Mark Jensen', initials: 'MJ', title: 'Social Media Analytics Dashboard', type: 'Analytics Report', module: 'Digital Channels', submitted: '3 Jun 2026', ksbCount: 5, status: 'rejected', employerAction: 'validate' },
  { id: 'ev-08', apprentice: 'Rachel Thompson', initials: 'RT', title: 'Customer Footfall Analysis Q1 2026', type: 'Data Analysis', module: 'Data Visualisation', submitted: '4 Jun 2026', ksbCount: 4, status: 'validated', employerAction: 'none' },
  { id: 'ev-09', apprentice: 'Tom Richards', initials: 'TR', title: 'Marketing Environment PESTLE Analysis', type: 'Report', module: 'Marketing Principles', submitted: '25 May 2026', ksbCount: 3, status: 'validated', employerAction: 'none' },
  { id: 'ev-10', apprentice: 'Lucy Barnes', initials: 'LB', title: 'Workplace HR Policy Review', type: 'Workplace Project', module: 'HR Foundations', submitted: '2 Jun 2026', ksbCount: 3, status: 'pending', employerAction: 'confirm' },
  { id: 'ev-11', apprentice: 'Priya Sharma', initials: 'PS', title: 'Business Email Portfolio', type: 'Portfolio', module: 'Business Communication', submitted: '4 Jun 2026', ksbCount: 2, status: 'validated', employerAction: 'none' },
  { id: 'ev-12', apprentice: 'Alex Morgan', initials: 'AM', title: 'Coding Project: Inventory Management API', type: 'Code Project', module: 'Programming Fundamentals', submitted: '7 Jun 2026', ksbCount: 5, status: 'pending', employerAction: 'confirm' },
];

export default function EmployerEvidenceSummary() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = EVIDENCE_DATA.filter(e => {
    if (search && !e.apprentice.toLowerCase().includes(search.toLowerCase()) && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    return true;
  });

  const pendingAction = EVIDENCE_DATA.filter(e => e.employerAction !== 'none').length;
  const validated = EVIDENCE_DATA.filter(e => e.status === 'validated').length;
  const pending = EVIDENCE_DATA.filter(e => e.status === 'pending').length;
  const rejected = EVIDENCE_DATA.filter(e => e.status === 'rejected').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Evidence Summary" pageSubtitle="Overview of apprentice evidence submissions and validation status" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-folder-upload-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Evidence Summary</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{EVIDENCE_DATA.length} evidence items</strong> · {pendingAction} need your action · {validated} validated
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pendingAction}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Need Action</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{validated}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Validated</p>
              </div>
            </div>
          </div>
        </div>

        {pendingAction > 0 && (
          <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0"><i className="ri-alert-line text-amber-600 text-base"></i></span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">{pendingAction} evidence items need your review</p>
              <p className="text-[12px] text-amber-600 mt-0.5">Confirm or validate workplace evidence to support your apprentices' progress</p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search evidence..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All', count: EVIDENCE_DATA.length },{ key: 'pending', label: 'Pending', count: pending },{ key: 'validated', label: 'Validated', count: validated },{ key: 'rejected', label: 'Rejected', count: rejected }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label} <span className="ml-1 text-[10px] opacity-60">{f.count}</span></button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(item => (
            <div key={item.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${item.employerAction !== 'none' ? 'border-amber-200/50 bg-amber-50/10' : 'border-foreground-200/60'}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ring-1 text-[10px] font-bold ${item.status === 'validated' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : item.status === 'pending' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-red-100 text-red-700 ring-red-200'}`}>
                    {item.initials}
                  </div>
                  <span className="text-[11px] font-medium text-foreground-700">{item.apprentice}</span>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.status === 'validated' ? 'bg-emerald-100 text-emerald-700' : item.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{item.status}</span>
              </div>
              <h4 className="text-[13px] font-semibold text-foreground-900 mb-2">{item.title}</h4>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-400 mb-3">
                <span>{item.type}</span><span className="text-[8px]">&middot;</span><span>{item.module}</span><span className="text-[8px]">&middot;</span><span>{item.submitted}</span><span className="text-[8px]">&middot;</span><span>{item.ksbCount} KSBs</span>
              </div>
              {item.employerAction !== 'none' && (
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-check-line mr-1"></i> {item.employerAction === 'validate' ? 'Validate' : 'Confirm'}
                  </button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-file-search-line mr-1"></i> Review
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}