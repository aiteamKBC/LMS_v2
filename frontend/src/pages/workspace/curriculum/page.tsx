import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
<<<<<<< HEAD
import { ListSkeleton, TableRowsSkeleton } from '@/components/feature/CurriculumSkeletons';
import { useCurriculumData } from '@/hooks/useCurriculumData';
=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

<<<<<<< HEAD
export default function CurriculumStudio() {
  const [tab, setTab] = useState<'programmes' | 'cohorts' | 'modules' | 'ksb'>('programmes');
  const { data, loading, error } = useCurriculumData();

  const programmes = data?.programmes ?? [];
  const modules = data?.modules ?? [];
  const ksbFrameworks = data?.ksbFrameworks ?? [];
  const cohorts = data?.cohorts ?? [];
  const groups = data?.groups ?? [];
  const activeProgrammes = programmes.filter(p => p.status === 'active').length;
  const draftProgrammes = programmes.filter(p => p.status === 'draft').length;
  const publishedModules = modules.filter(m => m.status === 'published').length;
=======
const PROGRAMMES = [
  { id: 'p-1', name: 'Business Administrator L3', standard: 'ST0070', status: 'active' as const, modules: 8, weeks: 72, ksbMapped: 45, ksbTotal: 45, lastUpdated: '5 Jun 2026' },
  { id: 'p-2', name: 'Data Analyst L4', standard: 'ST0118', status: 'active' as const, modules: 10, weeks: 78, ksbMapped: 52, ksbTotal: 52, lastUpdated: '3 Jun 2026' },
  { id: 'p-3', name: 'Marketing Executive L4', standard: 'ST0600', status: 'active' as const, modules: 9, weeks: 72, ksbMapped: 48, ksbTotal: 48, lastUpdated: '1 Jun 2026' },
  { id: 'p-4', name: 'Software Developer L4', standard: 'ST0120', status: 'draft' as const, modules: 12, weeks: 84, ksbMapped: 38, ksbTotal: 56, lastUpdated: '28 May 2026' },
  { id: 'p-5', name: 'Digital Marketer L3', standard: 'ST0330', status: 'active' as const, modules: 7, weeks: 66, ksbMapped: 40, ksbTotal: 40, lastUpdated: '2 Jun 2026' },
  { id: 'p-6', name: 'HR Consultant L5', standard: 'ST0470', status: 'draft' as const, modules: 11, weeks: 90, ksbMapped: 30, ksbTotal: 60, lastUpdated: '25 May 2026' },
];

const MODULES = [
  { id: 'm-1', name: 'Business Communication', programme: 'Business Admin L3', weeks: 12, ksbCount: 8, lessons: 24, quizzes: 6, assignments: 3, status: 'published' as const },
  { id: 'm-2', name: 'Organisational Culture', programme: 'Business Admin L3', weeks: 10, ksbCount: 6, lessons: 20, quizzes: 5, assignments: 2, status: 'published' as const },
  { id: 'm-3', name: 'Data Visualisation', programme: 'Data Analyst L4', weeks: 14, ksbCount: 10, lessons: 28, quizzes: 7, assignments: 4, status: 'published' as const },
  { id: 'm-4', name: 'Statistical Analysis', programme: 'Data Analyst L4', weeks: 16, ksbCount: 12, lessons: 32, quizzes: 8, assignments: 4, status: 'published' as const },
  { id: 'm-5', name: 'Marketing Planning', programme: 'Marketing Exec L4', weeks: 12, ksbCount: 9, lessons: 24, quizzes: 6, assignments: 3, status: 'published' as const },
  { id: 'm-6', name: 'Digital Channels', programme: 'Marketing Exec L4', weeks: 14, ksbCount: 10, lessons: 28, quizzes: 7, assignments: 3, status: 'published' as const },
  { id: 'm-7', name: 'Software Architecture', programme: 'Software Dev L4', weeks: 18, ksbCount: 14, lessons: 36, quizzes: 9, assignments: 5, status: 'draft' as const },
  { id: 'm-8', name: 'Agile Development', programme: 'Software Dev L4', weeks: 16, ksbCount: 12, lessons: 32, quizzes: 8, assignments: 4, status: 'draft' as const },
];

const KSB_FRAMEWORKS = [
  { standard: 'ST0070', level: 'L3', knowledge: 18, skills: 16, behaviours: 11, total: 45, mapped: 45, coverage: 100 },
  { standard: 'ST0118', level: 'L4', knowledge: 22, skills: 18, behaviours: 12, total: 52, mapped: 52, coverage: 100 },
  { standard: 'ST0600', level: 'L4', knowledge: 20, skills: 16, behaviours: 12, total: 48, mapped: 48, coverage: 100 },
  { standard: 'ST0120', level: 'L4', knowledge: 24, skills: 20, behaviours: 12, total: 56, mapped: 38, coverage: 68 },
  { standard: 'ST0330', level: 'L3', knowledge: 16, skills: 14, behaviours: 10, total: 40, mapped: 40, coverage: 100 },
  { standard: 'ST0470', level: 'L5', knowledge: 26, skills: 22, behaviours: 12, total: 60, mapped: 30, coverage: 50 },
];

export default function CurriculumStudio() {
  const [tab, setTab] = useState<'programmes' | 'modules' | 'ksb'>('programmes');

  const activeProgrammes = PROGRAMMES.filter(p => p.status === 'active').length;
  const draftProgrammes = PROGRAMMES.filter(p => p.status === 'draft').length;
  const totalModules = MODULES.length;
  const publishedModules = MODULES.filter(m => m.status === 'published').length;
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Curriculum Studio" pageSubtitle="Programme builder, module builder, week builder and KSB mapping" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
<<<<<<< HEAD
        <WorkspaceHeroBanner
          title="Curriculum Studio"
          description={loading ? 'Loading live curriculum data from LMS...' : `${activeProgrammes} active programmes, ${draftProgrammes} in draft. ${modules.length} modules (${publishedModules} published). ${ksbFrameworks.length} KSB frameworks ready for mapping.`}
=======
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Curriculum Studio"
          description={`${activeProgrammes} active programmes, ${draftProgrammes} in draft. ${totalModules} modules (${publishedModules} published). 6 KSB frameworks ready for mapping.`}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          icon="ri-stack-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20curriculum%20design%20module%20builder%20programme%20learning%20content%20editorial%20photography%20purple%20gold%20accent%20books%20frameworks%20clean%20modern%20minimalist%20workspace&width=400&height=160&seq=curriculum-hero-01&orientation=landscape"
          imageAlt="Curriculum Studio"
          stats={[
<<<<<<< HEAD
            { label: 'Programmes', value: String(programmes.length) },
            { label: 'Cohorts', value: String(data?.stats.cohorts ?? 0) },
            { label: 'Modules', value: String(modules.length) },
            { label: 'KSB Frames', value: String(ksbFrameworks.length) },
          ]}
        />

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setTab('programmes')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'programmes' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Programmes</button>
          <button onClick={() => setTab('cohorts')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'cohorts' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Cohorts & Groups</button>
=======
            { label: 'Programmes', value: String(PROGRAMMES.length) },
            { label: 'Modules', value: String(totalModules) },
            { label: 'KSB Frames', value: String(KSB_FRAMEWORKS.length) },
          ]}
        />

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setTab('programmes')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'programmes' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Programmes</button>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          <button onClick={() => setTab('modules')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'modules' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Modules</button>
          <button onClick={() => setTab('ksb')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'ksb' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>KSB Frameworks</button>
        </div>

<<<<<<< HEAD
=======
        {/* Programmes */}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        {tab === 'programmes' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
              <span>Programme</span>
              <span className="text-center">Standard</span>
              <span className="text-center">Status</span>
<<<<<<< HEAD
              <span className="text-center">Cohorts</span>
              <span className="text-center">Modules</span>
              <span className="text-center">Sessions</span>
              <span className="text-center">KSBs</span>
              <span className="text-center">Action</span>
            </div>
            <div className="divide-y divide-background-200/30">
              {loading ? (
                <TableRowsSkeleton rows={6} columns={8} gridClass="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr]" />
              ) : programmes.map(p => {
                const coverage = p.ksbTotal > 0 ? Math.round((p.ksbMapped / p.ksbTotal) * 100) : 0;
                return (
                  <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                    <span className="text-[12px] font-medium text-foreground-900">{p.name}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{p.standard}</span>
                    <div className="flex justify-center">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.status}</span>
                    </div>
                    <span className="text-[11px] text-foreground-500 text-center">{p.cohorts}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{p.modules}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{p.weeks}</span>
                    <span className={`text-[11px] font-semibold text-center ${coverage >= 100 ? 'text-emerald-600' : 'text-amber-600'}`}>{p.ksbMapped}/{p.ksbTotal}</span>
                    <div className="text-center">
                      <button onClick={() => window.REACT_APP_NAVIGATE(`/curriculum/programmes/${p.id}`)} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Open</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'cohorts' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1.4fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
              <span>Cohort</span>
              <span>Programme</span>
              <span className="text-center">Status</span>
              <span className="text-center">Groups</span>
              <span className="text-center">Modules</span>
              <span className="text-center">Sessions</span>
              <span className="text-center">Dates</span>
            </div>
            <div className="divide-y divide-background-200/30">
              {loading ? (
                <TableRowsSkeleton rows={6} columns={7} gridClass="grid grid-cols-[1.4fr_1.4fr_1fr_1fr_1fr_1fr_1fr]" />
              ) : cohorts.map(cohort => {
                const cohortGroups = groups.filter(group => group.cohortId === cohort.id);
                return (
                  <div key={cohort.id} className="px-4 py-3.5 hover:bg-background-100/30 transition-smooth">
                    <div className="grid grid-cols-[1.4fr_1.4fr_1fr_1fr_1fr_1fr_1fr] gap-3 items-center">
                      <span className="text-[12px] font-medium text-foreground-900">{cohort.name}</span>
                      <span className="text-[11px] text-foreground-500">{cohort.programme}</span>
                      <div className="flex justify-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${cohort.status === 'active' ? 'bg-emerald-100 text-emerald-700' : cohort.status === 'planned' ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}>{cohort.status}</span>
                      </div>
                      <span className="text-[11px] text-foreground-500 text-center">{cohortGroups.length}</span>
                      <span className="text-[11px] text-foreground-500 text-center">{cohort.modules.length}</span>
                      <span className="text-[11px] text-foreground-500 text-center">{cohort.sessions}</span>
                      <span className="text-[10px] text-foreground-400 text-center">{cohort.startDate || 'N/A'} - {cohort.endDate || 'N/A'}</span>
                    </div>
                    {cohortGroups.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {cohortGroups.map(group => (
                          <span key={group.id} className="text-[10px] font-medium px-2 py-1 rounded-full bg-background-100 text-foreground-600 border border-foreground-200/60">
                            {group.name} · {group.tutor} · {group.coach} · {group.sessions} sessions
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
=======
              <span className="text-center">Modules</span>
              <span className="text-center">Weeks</span>
              <span className="text-center">KSB Mapped</span>
              <span className="text-center">Coverage</span>
              <span className="text-center">Action</span>
            </div>
            <div className="divide-y divide-background-200/30">
              {PROGRAMMES.map(p => (
                <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                  <span className="text-[12px] font-medium text-foreground-900">{p.name}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{p.standard}</span>
                  <div className="flex justify-center">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.status}</span>
                  </div>
                  <span className="text-[11px] text-foreground-500 text-center">{p.modules}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{p.weeks}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{p.ksbMapped}/{p.ksbTotal}</span>
                  <span className={`text-[11px] font-semibold text-center ${p.ksbMapped === p.ksbTotal ? 'text-emerald-600' : 'text-amber-600'}`}>{Math.round(p.ksbMapped / p.ksbTotal * 100)}%</span>
                  <div className="text-center">
                    <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
                  </div>
                </div>
              ))}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            </div>
          </div>
        )}

<<<<<<< HEAD
=======
        {/* Modules */}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        {tab === 'modules' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
              <span>Module</span>
              <span>Programme</span>
<<<<<<< HEAD
              <span className="text-center">Sessions</span>
=======
              <span className="text-center">Weeks</span>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
              <span className="text-center">KSBs</span>
              <span className="text-center">Lessons</span>
              <span className="text-center">Quizzes</span>
              <span className="text-center">Assignments</span>
              <span className="text-center">Status</span>
              <span className="text-center">Action</span>
            </div>
            <div className="divide-y divide-background-200/30">
<<<<<<< HEAD
              {loading ? (
                <TableRowsSkeleton rows={7} columns={9} gridClass="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr]" />
              ) : modules.map(m => (
=======
              {MODULES.map(m => (
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                <div key={m.id} className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                  <span className="text-[12px] font-medium text-foreground-900">{m.name}</span>
                  <span className="text-[11px] text-foreground-500">{m.programme}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{m.weeks}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{m.ksbCount}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{m.lessons}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{m.quizzes}</span>
                  <span className="text-[11px] text-foreground-500 text-center">{m.assignments}</span>
                  <div className="flex justify-center">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{m.status}</span>
                  </div>
                  <div className="text-center">
<<<<<<< HEAD
                    <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/module-builder')} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
=======
                    <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

<<<<<<< HEAD
        {tab === 'ksb' && (
          <div className="space-y-3">
            {loading ? <ListSkeleton count={5} /> : ksbFrameworks.map(ksb => {
              const coverage = ksb.totalKsbs > 0 ? Math.round((ksb.mapped / ksb.totalKsbs) * 100) : 0;
              return (
                <div key={ksb.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center ring-2 ring-primary-200 shrink-0">
                      <span className="text-sm font-bold">{ksb.level ? `L${ksb.level}` : 'KSB'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{ksb.name}</p>
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{ksb.totalKsbs} KSBs</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">Knowledge: {ksb.knowledgeCount} · Skills: {ksb.skillCount} · Behaviours: {ksb.behaviourCount}</p>
                    </div>
                    <div className="hidden lg:flex items-center gap-4 shrink-0">
                      <div className="w-32 bg-background-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${coverage >= 100 ? 'bg-emerald-500' : coverage >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${coverage}%` }}></div>
                      </div>
                      <span className={`text-[11px] font-semibold w-10 text-right ${coverage >= 100 ? 'text-emerald-600' : coverage >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{coverage}%</span>
                    </div>
                  </div>
                  <div className="ml-14 mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-foreground-400">Mapped: {ksb.mapped}/{ksb.totalKsbs} KSBs</span>
                  </div>
                  <div className="ml-14 mt-3 flex items-center gap-2">
                    <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-mapping')} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-link mr-1"></i> Map KSBs</button>
                    <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-frameworks')} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-search-line mr-1"></i> View Framework</button>
                  </div>
                </div>
              );
            })}
=======
        {/* KSB Frameworks */}
        {tab === 'ksb' && (
          <div className="space-y-3">
            {KSB_FRAMEWORKS.map(ksb => (
              <div key={ksb.standard} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center ring-2 ring-primary-200 shrink-0">
                    <span className="text-sm font-bold">{ksb.standard}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{ksb.standard} — {ksb.level}</p>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{ksb.total} KSBs</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Knowledge: {ksb.knowledge} · Skills: {ksb.skills} · Behaviours: {ksb.behaviours}</p>
                  </div>
                  <div className="hidden lg:flex items-center gap-4 shrink-0">
                    <div className="w-32 bg-background-200 rounded-full h-2">
                      <div className={`h-2 rounded-full ${ksb.coverage >= 100 ? 'bg-emerald-500' : ksb.coverage >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${ksb.coverage}%` }}></div>
                    </div>
                    <span className={`text-[11px] font-semibold w-10 text-right ${ksb.coverage >= 100 ? 'text-emerald-600' : ksb.coverage >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{ksb.coverage}%</span>
                  </div>
                </div>
                <div className="ml-14 mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-foreground-400">Mapped: {ksb.mapped}/{ksb.total} KSBs</span>
                </div>
                <div className="ml-14 mt-3 flex items-center gap-2">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-link mr-1"></i> Map KSBs</button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-search-line mr-1"></i> View Framework</button>
                </div>
              </div>
            ))}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
