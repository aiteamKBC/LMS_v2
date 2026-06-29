import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface ProgressEntry {
  id: string;
  apprentice: string;
  initials: string;
  programme: string;
  level: string;
  module: string;
  moduleProgress: number;
  overallProgress: number;
  ksbCompleted: number;
  ksbTotal: number;
  otjhThisModule: number;
  lastActivity: string;
  status: 'on-track' | 'behind' | 'ahead';
}

const PROGRESS_DATA: ProgressEntry[] = [
  { id: 'pr-01', apprentice: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive', level: 'L4', module: 'Marketing Planning', moduleProgress: 65, overallProgress: 42, ksbCompleted: 8, ksbTotal: 22, otjhThisModule: 24, lastActivity: '8 Jun 2026', status: 'on-track' },
  { id: 'pr-02', apprentice: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive', level: 'L4', module: 'Marketing Planning', moduleProgress: 52, overallProgress: 38, ksbCompleted: 6, ksbTotal: 22, otjhThisModule: 18, lastActivity: '5 Jun 2026', status: 'behind' },
  { id: 'pr-03', apprentice: 'Daniel Clarke', initials: 'DC', programme: 'Business Administrator', level: 'L3', module: 'Business Communication', moduleProgress: 85, overallProgress: 68, ksbCompleted: 18, ksbTotal: 24, otjhThisModule: 32, lastActivity: '9 Jun 2026', status: 'ahead' },
  { id: 'pr-04', apprentice: 'Rachel Thompson', initials: 'RT', programme: 'Data Analyst', level: 'L4', module: 'Data Visualisation', moduleProgress: 70, overallProgress: 55, ksbCompleted: 14, ksbTotal: 23, otjhThisModule: 28, lastActivity: '7 Jun 2026', status: 'on-track' },
  { id: 'pr-05', apprentice: 'Mark Jensen', initials: 'MJ', programme: 'Digital Marketer', level: 'L3', module: 'Digital Channels', moduleProgress: 78, overallProgress: 72, ksbCompleted: 20, ksbTotal: 28, otjhThisModule: 30, lastActivity: '8 Jun 2026', status: 'on-track' },
  { id: 'pr-06', apprentice: 'Lucy Barnes', initials: 'LB', programme: 'HR Consultant', level: 'L5', module: 'HR Foundations', moduleProgress: 42, overallProgress: 30, ksbCompleted: 7, ksbTotal: 25, otjhThisModule: 16, lastActivity: '4 Jun 2026', status: 'on-track' },
  { id: 'pr-07', apprentice: 'Priya Sharma', initials: 'PS', programme: 'Business Administrator', level: 'L3', module: 'Business Communication', moduleProgress: 75, overallProgress: 62, ksbCompleted: 16, ksbTotal: 24, otjhThisModule: 26, lastActivity: '6 Jun 2026', status: 'on-track' },
  { id: 'pr-08', apprentice: 'Alex Morgan', initials: 'AM', programme: 'Software Developer', level: 'L4', module: 'Programming Fundamentals', moduleProgress: 60, overallProgress: 48, ksbCompleted: 12, ksbTotal: 24, otjhThisModule: 22, lastActivity: '7 Jun 2026', status: 'on-track' },
];

export default function EmployerApprenticeProgress() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<ProgressEntry | null>(null);

  const filtered = PROGRESS_DATA.filter(p => {
    if (search && !p.apprentice.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const behind = PROGRESS_DATA.filter(p => p.status === 'behind').length;
  const ahead = PROGRESS_DATA.filter(p => p.status === 'ahead').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Apprentice Progress" pageSubtitle="Detailed progress tracking across all modules and KSBs" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-bar-chart-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Apprentice Progress</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{PROGRESS_DATA.length} apprentices</strong> · {behind} behind target · {ahead} ahead of target
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apprentices..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' },{ key: 'ahead', label: 'Ahead' },{ key: 'on-track', label: 'On Track' },{ key: 'behind', label: 'Behind' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium cursor-pointer hover:border-primary-200/50 transition-smooth" onClick={() => setSelected(p)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${p.status === 'behind' ? 'bg-red-100 text-red-700 ring-red-200' : p.status === 'ahead' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                    <span className="text-sm font-bold">{p.initials}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{p.apprentice}</p>
                    <p className="text-[11px] text-foreground-400">{p.programme} {p.level}</p>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${p.status === 'behind' ? 'bg-red-100 text-red-700' : p.status === 'ahead' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>
                  {p.status === 'behind' ? 'Behind' : p.status === 'ahead' ? 'Ahead' : 'On Track'}
                </span>
              </div>
              <div className="space-y-2 mb-3">
                <div>
                  <div className="flex items-center justify-between mb-0.5"><span className="text-[10px] text-foreground-400">Overall Progress</span><span className="text-[10px] font-semibold text-foreground-700">{p.overallProgress}%</span></div>
                  <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden"><div className={`h-full rounded-full ${p.overallProgress >= 60 ? 'bg-emerald-500' : p.overallProgress >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.overallProgress}%` }}></div></div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5"><span className="text-[10px] text-foreground-400">{p.module}</span><span className="text-[10px] font-semibold text-foreground-700">{p.moduleProgress}%</span></div>
                  <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden"><div className="h-full rounded-full bg-primary-500" style={{ width: `${p.moduleProgress}%` }}></div></div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px] text-foreground-400">
                <span>KSB: {p.ksbCompleted}/{p.ksbTotal}</span>
                <span>OTJH: {p.otjhThisModule}h</span>
                <span>{p.lastActivity}</span>
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ${selected.status === 'behind' ? 'bg-red-100 text-red-700 ring-red-200' : selected.status === 'ahead' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                    <span className="text-xs font-bold">{selected.initials}</span>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{selected.apprentice}</h3>
                </div>
                <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer"><i className="ri-close-line text-foreground-500"></i></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.overallProgress}%</p><p className="text-[10px] text-foreground-400">Overall</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.moduleProgress}%</p><p className="text-[10px] text-foreground-400">Module</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.ksbCompleted}/{selected.ksbTotal}</p><p className="text-[10px] text-foreground-400">KSBs</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.otjhThisModule}h</p><p className="text-[10px] text-foreground-400">OTJH</p></div>
                </div>
                <div className="bg-background-100 rounded-xl p-4">
                  <p className="text-[12px] font-semibold text-foreground-600 mb-1">Current Module</p>
                  <p className="text-[13px] text-foreground-900">{selected.module}</p>
                </div>
                <button className="w-full px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-file-chart-line mr-1"></i> View Full Progress Report
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}