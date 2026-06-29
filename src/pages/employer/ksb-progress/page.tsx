import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface KSBEntry {
  id: string;
  apprentice: string;
  initials: string;
  abbreviation: string;
  name: string;
  category: 'Knowledge' | 'Skill' | 'Behaviour';
  module: string;
  progress: number;
  status: 'complete' | 'in-progress' | 'not-started';
  evidenceCount: number;
}

const KSB_DATA: KSBEntry[] = [
  { id: 'kb-01', apprentice: 'Sophie Williams', initials: 'SW', abbreviation: 'K1', name: 'Marketing Principles and Theory', category: 'Knowledge', module: 'Marketing Principles', progress: 85, status: 'in-progress', evidenceCount: 3 },
  { id: 'kb-02', apprentice: 'Sophie Williams', initials: 'SW', abbreviation: 'S1', name: 'Campaign Planning and Execution', category: 'Skill', module: 'Marketing Planning', progress: 60, status: 'in-progress', evidenceCount: 2 },
  { id: 'kb-03', apprentice: 'Sophie Williams', initials: 'SW', abbreviation: 'B1', name: 'Professional Communication', category: 'Behaviour', module: 'Professional Practice', progress: 40, status: 'in-progress', evidenceCount: 1 },
  { id: 'kb-04', apprentice: 'Daniel Clarke', initials: 'DC', abbreviation: 'K2', name: 'Business Communication Theory', category: 'Knowledge', module: 'Business Communication', progress: 100, status: 'complete', evidenceCount: 4 },
  { id: 'kb-05', apprentice: 'Daniel Clarke', initials: 'DC', abbreviation: 'S2', name: 'Stakeholder Management', category: 'Skill', module: 'Business Communication', progress: 90, status: 'in-progress', evidenceCount: 3 },
  { id: 'kb-06', apprentice: 'Daniel Clarke', initials: 'DC', abbreviation: 'B2', name: 'Team Working and Collaboration', category: 'Behaviour', module: 'Workplace Practice', progress: 75, status: 'in-progress', evidenceCount: 2 },
  { id: 'kb-07', apprentice: 'Mark Jensen', initials: 'MJ', abbreviation: 'K3', name: 'Digital Marketing Channels', category: 'Knowledge', module: 'Digital Channels', progress: 95, status: 'in-progress', evidenceCount: 4 },
  { id: 'kb-08', apprentice: 'Mark Jensen', initials: 'MJ', abbreviation: 'S3', name: 'Social Media Strategy', category: 'Skill', module: 'Digital Channels', progress: 70, status: 'in-progress', evidenceCount: 3 },
  { id: 'kb-09', apprentice: 'Tom Richards', initials: 'TR', abbreviation: 'K1', name: 'Marketing Principles and Theory', category: 'Knowledge', module: 'Marketing Principles', progress: 55, status: 'in-progress', evidenceCount: 2 },
  { id: 'kb-10', apprentice: 'Tom Richards', initials: 'TR', abbreviation: 'S1', name: 'Campaign Planning and Execution', category: 'Skill', module: 'Marketing Planning', progress: 40, status: 'in-progress', evidenceCount: 1 },
  { id: 'kb-11', apprentice: 'Rachel Thompson', initials: 'RT', abbreviation: 'K4', name: 'Data Analysis Methods', category: 'Knowledge', module: 'Data Visualisation', progress: 80, status: 'in-progress', evidenceCount: 3 },
  { id: 'kb-12', apprentice: 'Lucy Barnes', initials: 'LB', abbreviation: 'K5', name: 'HR Policy and Employment Law', category: 'Knowledge', module: 'HR Foundations', progress: 50, status: 'in-progress', evidenceCount: 2 },
];

export default function EmployerKSBProgress() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [apprenticeFilter, setApprenticeFilter] = useState<string>('all');

  const filtered = KSB_DATA.filter(k => {
    if (search && !k.name.toLowerCase().includes(search.toLowerCase()) && !k.apprentice.toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && k.category !== categoryFilter) return false;
    if (apprenticeFilter !== 'all' && k.apprentice !== apprenticeFilter) return false;
    return true;
  });

  const apprentices = [...new Set(KSB_DATA.map(k => k.apprentice))];
  const complete = KSB_DATA.filter(k => k.status === 'complete').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="KSB Progress" pageSubtitle="Track Knowledge, Skills and Behaviours development across your apprentices" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-bar-chart-2-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">KSB Progress</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{KSB_DATA.length} KSBs</strong> tracked · {complete} completed · across {apprentices.length} apprentices</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <div className="relative sm:max-w-xs">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search KSBs..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All KSBs' },{ key: 'Knowledge', label: 'Knowledge' },{ key: 'Skill', label: 'Skills' },{ key: 'Behaviour', label: 'Behaviours' }].map(f => (
              <button key={f.key} onClick={() => setCategoryFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
          <div className="relative">
            <select value={apprenticeFilter} onChange={e => setApprenticeFilter(e.target.value)} className="px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-900 focus:outline-none focus:border-primary-300 cursor-pointer">
              <option value="all">All Apprentices</option>
              {apprentices.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          {filtered.map(k => {
            const catColor = k.category === 'Knowledge' ? 'bg-primary-100 text-primary-700' : k.category === 'Skill' ? 'bg-accent-50 text-accent-700' : 'bg-secondary-100 text-secondary-700';
            return (
              <div key={k.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-1 text-[10px] font-bold ${k.status === 'complete' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : k.status === 'in-progress' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-background-100 text-foreground-400 ring-background-200'}`}>{k.initials}</div>
                  <span className="text-[11px] font-semibold text-foreground-700 min-w-[28px]">{k.abbreviation}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="text-[13px] font-semibold text-foreground-900">{k.name}</p>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${catColor}`}>{k.category}</span>
                    <span className="text-[10px] text-foreground-400">{k.apprentice}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 max-w-[200px]">
                      <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${k.progress >= 80 ? 'bg-emerald-500' : k.progress >= 50 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${k.progress}%` }}></div>
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground-600">{k.progress}%</span>
                    <span className="text-[10px] text-foreground-400">{k.evidenceCount} evidence</span>
                    <span className="text-[10px] text-foreground-400">{k.module}</span>
                  </div>
                </div>
                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${k.status === 'complete' ? 'bg-emerald-100 text-emerald-700' : k.status === 'in-progress' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{k.status === 'complete' ? 'Complete' : k.status === 'in-progress' ? 'In Progress' : 'Not Started'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}