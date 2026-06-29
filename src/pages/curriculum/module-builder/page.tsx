import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

interface ModuleDef {
  id: string;
  name: string;
  programme: string;
  weeks: number;
  ksbCount: number;
  lessons: number;
  quizzes: number;
  assignments: number;
  status: 'published' | 'draft' | 'review';
  author: string;
  lastUpdated: string;
}

const MODULES: ModuleDef[] = [
  { id: 'm-1', name: 'Business Communication', programme: 'Business Admin L3', weeks: 12, ksbCount: 8, lessons: 24, quizzes: 6, assignments: 3, status: 'published', author: 'Rachel Myers', lastUpdated: '5 Jun 2026' },
  { id: 'm-2', name: 'Organisational Culture', programme: 'Business Admin L3', weeks: 10, ksbCount: 6, lessons: 20, quizzes: 5, assignments: 2, status: 'published', author: 'Rachel Myers', lastUpdated: '2 Jun 2026' },
  { id: 'm-3', name: 'Data Visualisation', programme: 'Data Analyst L4', weeks: 14, ksbCount: 10, lessons: 28, quizzes: 7, assignments: 4, status: 'published', author: 'Crispin Jones', lastUpdated: '1 Jun 2026' },
  { id: 'm-4', name: 'Statistical Analysis', programme: 'Data Analyst L4', weeks: 16, ksbCount: 12, lessons: 32, quizzes: 8, assignments: 4, status: 'published', author: 'Crispin Jones', lastUpdated: '28 May 2026' },
  { id: 'm-5', name: 'Marketing Planning', programme: 'Marketing Exec L4', weeks: 12, ksbCount: 9, lessons: 24, quizzes: 6, assignments: 3, status: 'published', author: 'Crispin Jones', lastUpdated: '1 Jun 2026' },
  { id: 'm-6', name: 'Digital Channels', programme: 'Marketing Exec L4', weeks: 14, ksbCount: 10, lessons: 28, quizzes: 7, assignments: 3, status: 'draft', author: 'Crispin Jones', lastUpdated: '3 Jun 2026' },
  { id: 'm-7', name: 'Software Architecture', programme: 'Software Dev L4', weeks: 18, ksbCount: 14, lessons: 36, quizzes: 9, assignments: 5, status: 'draft', author: 'Rachel Myers', lastUpdated: '25 May 2026' },
  { id: 'm-8', name: 'Agile Development', programme: 'Software Dev L4', weeks: 16, ksbCount: 12, lessons: 32, quizzes: 8, assignments: 4, status: 'draft', author: 'Rachel Myers', lastUpdated: '22 May 2026' },
  { id: 'm-9', name: 'Marketing Principles', programme: 'Marketing Exec L4', weeks: 10, ksbCount: 7, lessons: 20, quizzes: 5, assignments: 2, status: 'published', author: 'Crispin Jones', lastUpdated: '30 May 2026' },
  { id: 'm-10', name: 'Professional Practice', programme: 'Business Admin L3', weeks: 8, ksbCount: 5, lessons: 16, quizzes: 4, assignments: 2, status: 'review', author: 'Rachel Myers', lastUpdated: '8 Jun 2026' },
  { id: 'm-11', name: 'Campaign Management', programme: 'Digital Marketer L3', weeks: 12, ksbCount: 8, lessons: 24, quizzes: 6, assignments: 3, status: 'published', author: 'Crispin Jones', lastUpdated: '4 Jun 2026' },
  { id: 'm-12', name: 'Employment Law', programme: 'HR Consultant L5', weeks: 14, ksbCount: 11, lessons: 28, quizzes: 7, assignments: 4, status: 'draft', author: 'Rachel Myers', lastUpdated: '20 May 2026' },
];

const PROGRAMME_OPTIONS = ['All', 'Business Admin L3', 'Data Analyst L4', 'Marketing Exec L4', 'Software Dev L4', 'Digital Marketer L3', 'HR Consultant L5'];

export default function ModuleBuilder() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [programmeFilter, setProgrammeFilter] = useState<string>('All');
  const [selectedModule, setSelectedModule] = useState<ModuleDef | null>(null);

  const filtered = MODULES.filter(m => {
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (programmeFilter !== 'All' && m.programme !== programmeFilter) return false;
    return true;
  });

  const published = MODULES.filter(m => m.status === 'published').length;
  const draftCount = MODULES.filter(m => m.status === 'draft').length;
  const totalLessons = MODULES.reduce((a, b) => a + b.lessons, 0);

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Module Builder" pageSubtitle={`${MODULES.length} modules · ${published} published · ${draftCount} draft · ${totalLessons} lessons`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-layout-4-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Module Builder</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Design and manage learning modules with lessons, quizzes, and KSB mapping
              </p>
            </div>
            <button className="px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-[12px] font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> New Module
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search modules..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <select value={programmeFilter} onChange={e => setProgrammeFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
            {PROGRAMME_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' },{ key: 'published', label: 'Published' },{ key: 'draft', label: 'Draft' },{ key: 'review', label: 'In Review' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatsCard label="Total Modules" value={MODULES.length.toString()} icon="ri-stack-line" color="primary" />
          <StatsCard label="Published" value={published.toString()} icon="ri-check-double-line" color="emerald" />
          <StatsCard label="Total Lessons" value={totalLessons.toString()} icon="ri-book-open-line" color="accent" />
          <StatsCard label="Programmes" value={[...new Set(MODULES.map(m => m.programme))].length.toString()} icon="ri-book-2-line" color="secondary" />
        </div>

        {/* Modules List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[2fr_1.2fr_80px_80px_80px_80px_100px_80px] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Module</span>
            <span>Programme</span>
            <span className="text-center">Weeks</span>
            <span className="text-center">KSBs</span>
            <span className="text-center">Lessons</span>
            <span className="text-center">Quizzes</span>
            <span className="text-center">Status</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(m => (
              <div key={m.id} className="grid grid-cols-[2fr_1.2fr_80px_80px_80px_80px_100px_80px] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div>
                  <p className="text-[12px] font-medium text-foreground-900">{m.name}</p>
                  <p className="text-[9px] text-foreground-400">{m.author} · {m.lastUpdated}</p>
                </div>
                <span className="text-[11px] text-foreground-500">{m.programme}</span>
                <span className="text-[11px] text-foreground-500 text-center">{m.weeks}</span>
                <span className="text-[11px] text-foreground-500 text-center">{m.ksbCount}</span>
                <span className="text-[11px] text-foreground-500 text-center">{m.lessons}</span>
                <span className="text-[11px] text-foreground-500 text-center">{m.quizzes}</span>
                <div className="flex justify-center">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'published' ? 'bg-emerald-100 text-emerald-700' : m.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{m.status}</span>
                </div>
                <div className="flex items-center gap-1 justify-center">
                  <button onClick={() => setSelectedModule(m)} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Detail Modal */}
        {selectedModule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedModule(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-foreground-400/50 flex items-center justify-between">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedModule.name}</h3>
                <button onClick={() => setSelectedModule(null)} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-foreground-500 text-sm"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {[{ l: 'Programme', v: selectedModule.programme },{ l: 'Duration', v: `${selectedModule.weeks} weeks` },{ l: 'KSBs', v: selectedModule.ksbCount.toString() },{ l: 'Lessons', v: selectedModule.lessons.toString() },{ l: 'Quizzes', v: selectedModule.quizzes.toString() },{ l: 'Assignments', v: selectedModule.assignments.toString() },{ l: 'Author', v: selectedModule.author },{ l: 'Updated', v: selectedModule.lastUpdated }].map((r, i) => (
                    <div key={i} className="bg-background-100 rounded-lg p-2.5">
                      <p className="text-[9px] text-foreground-400 uppercase">{r.l}</p>
                      <p className="text-sm font-semibold text-foreground-900">{r.v}</p>
                    </div>
                  ))}
                </div>
                <button className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer">
                  <i className="ri-edit-line mr-1.5"></i> Open in Module Builder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function StatsCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const bgMap: Record<string, string> = { primary: 'bg-primary-100 text-primary-600', emerald: 'bg-emerald-100 text-emerald-600', accent: 'bg-accent-100 text-accent-600', secondary: 'bg-secondary-100 text-secondary-600' };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-md ${bgMap[color]} flex items-center justify-center`}>
          <i className={`${icon} text-xs`}></i>
        </span>
        <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
    </div>
  );
}