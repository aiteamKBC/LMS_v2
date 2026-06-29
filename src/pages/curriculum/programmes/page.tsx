import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

interface Programme {
  id: string;
  name: string;
  standard: string;
  level: string;
  status: 'active' | 'draft' | 'archived';
  modules: number;
  weeks: number;
  ksbMapped: number;
  ksbTotal: number;
  learners: number;
  lastUpdated: string;
  owner: string;
}

const PROGRAMMES: Programme[] = [
  { id: 'p-1', name: 'Business Administrator', standard: 'ST0070', level: 'L3', status: 'active', modules: 8, weeks: 72, ksbMapped: 45, ksbTotal: 45, learners: 4, lastUpdated: '5 Jun 2026', owner: 'Rachel Myers' },
  { id: 'p-2', name: 'Data Analyst', standard: 'ST0118', level: 'L4', status: 'active', modules: 10, weeks: 78, ksbMapped: 52, ksbTotal: 52, learners: 2, lastUpdated: '3 Jun 2026', owner: 'Rachel Myers' },
  { id: 'p-3', name: 'Marketing Executive', standard: 'ST0803', level: 'L4', status: 'active', modules: 9, weeks: 72, ksbMapped: 48, ksbTotal: 48, learners: 3, lastUpdated: '1 Jun 2026', owner: 'Crispin Jones' },
  { id: 'p-4', name: 'Software Developer', standard: 'ST0120', level: 'L4', status: 'draft', modules: 12, weeks: 84, ksbMapped: 38, ksbTotal: 56, learners: 0, lastUpdated: '28 May 2026', owner: 'Rachel Myers' },
  { id: 'p-5', name: 'Digital Marketer', standard: 'ST0330', level: 'L3', status: 'active', modules: 7, weeks: 66, ksbMapped: 40, ksbTotal: 40, learners: 1, lastUpdated: '2 Jun 2026', owner: 'Crispin Jones' },
  { id: 'p-6', name: 'HR Consultant', standard: 'ST0470', level: 'L5', status: 'draft', modules: 11, weeks: 90, ksbMapped: 30, ksbTotal: 60, learners: 0, lastUpdated: '25 May 2026', owner: 'Rachel Myers' },
  { id: 'p-7', name: 'Project Manager', standard: 'ST0388', level: 'L4', status: 'draft', modules: 10, weeks: 84, ksbMapped: 20, ksbTotal: 55, learners: 0, lastUpdated: '20 May 2026', owner: 'Crispin Jones' },
  { id: 'p-8', name: 'Operations Manager', standard: 'ST0609', level: 'L5', status: 'archived', modules: 12, weeks: 96, ksbMapped: 58, ksbTotal: 58, learners: 2, lastUpdated: '10 Jan 2026', owner: 'Rachel Myers' },
];

export default function CurriculumProgrammes() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedProgramme, setSelectedProgramme] = useState<Programme | null>(null);

  const filtered = PROGRAMMES.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.standard.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const active = PROGRAMMES.filter(p => p.status === 'active').length;
  const draft = PROGRAMMES.filter(p => p.status === 'draft').length;
  const totalLearners = PROGRAMMES.reduce((a, b) => a + b.learners, 0);

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programmes" pageSubtitle={`${PROGRAMMES.length} programmes · ${active} active · ${draft} draft · ${totalLearners} learners`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-stack-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Programmes</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{PROGRAMMES.length} programmes</strong> · {active} active · {draft} in draft · {totalLearners} learners enrolled
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button className="px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-[12px] font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-add-line mr-1"></i> New Programme
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search programmes..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' },{ key: 'active', label: 'Active' },{ key: 'draft', label: 'Draft' },{ key: 'archived', label: 'Archived' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        {/* Programmes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(prog => (
            <div key={prog.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth cursor-pointer" onClick={() => window.REACT_APP_NAVIGATE(`/curriculum/programmes/${prog.id}`)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center ring-2 ring-primary-200">
                    <i className="ri-book-2-line text-sm"></i>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{prog.name}</p>
                    <p className="text-[11px] text-foreground-400">{prog.standard} · {prog.level}</p>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${prog.status === 'active' ? 'bg-emerald-100 text-emerald-700' : prog.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{prog.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><p className="text-[9px] text-foreground-400 uppercase">Modules</p><p className="text-sm font-semibold text-foreground-900">{prog.modules}</p></div>
                <div><p className="text-[9px] text-foreground-400 uppercase">Duration</p><p className="text-sm font-semibold text-foreground-900">{prog.weeks} weeks</p></div>
                <div><p className="text-[9px] text-foreground-400 uppercase">KSB Mapping</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${prog.ksbMapped === prog.ksbTotal ? 'bg-emerald-500' : prog.ksbMapped >= prog.ksbTotal * 0.7 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.round((prog.ksbMapped / prog.ksbTotal) * 100)}%` }}></div>
                    </div>
                    <span className="text-[10px] font-semibold">{Math.round((prog.ksbMapped / prog.ksbTotal) * 100)}%</span>
                  </div>
                </div>
                <div><p className="text-[9px] text-foreground-400 uppercase">Learners</p><p className="text-sm font-semibold text-foreground-900">{prog.learners}</p></div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-background-100">
                <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap text-center" onClick={e => { e.stopPropagation(); window.REACT_APP_NAVIGATE(`/curriculum/programmes/${prog.id}`); }}>View</button>
                <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Clone</button>
              </div>
            </div>
          ))}
        </div>

        {/* Detail Modal */}
        {selectedProgramme && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedProgramme(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedProgramme.name}</h3>
                <button onClick={() => setSelectedProgramme(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-foreground-500"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <DetailBlock label="Standard" value={selectedProgramme.standard} />
                  <DetailBlock label="Level" value={selectedProgramme.level} />
                  <DetailBlock label="Modules" value={selectedProgramme.modules.toString()} />
                  <DetailBlock label="Duration" value={`${selectedProgramme.weeks} weeks`} />
                  <DetailBlock label="KSB Mapped" value={`${selectedProgramme.ksbMapped}/${selectedProgramme.ksbTotal}`} />
                  <DetailBlock label="Learners" value={selectedProgramme.learners.toString()} />
                  <DetailBlock label="Owner" value={selectedProgramme.owner} />
                  <DetailBlock label="Updated" value={selectedProgramme.lastUpdated} />
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer">Edit Programme</button>
                  <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">Close</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background-100 rounded-lg p-3">
      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-foreground-900 mt-0.5">{value}</p>
    </div>
  );
}