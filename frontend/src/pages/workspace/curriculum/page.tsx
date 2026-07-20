import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { ListSkeleton, TableRowsSkeleton } from '@/components/feature/CurriculumSkeletons';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

export default function CurriculumStudio() {
  const [tab, setTab] = useState<'programmes' | 'cohorts' | 'modules' | 'ksb'>('programmes');
  const { data, loading: dataLoading, error: dataError } = useCurriculumData({ compact: true });
  const { programmes: programmeRecords, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();

  const programmes = programmeRecords;
  const modules = data?.modules ?? [];
  const ksbFrameworks = data?.ksbFrameworks ?? [];
  const cohorts = data?.cohorts ?? [];
  const groups = data?.groups ?? [];
  const loading = dataLoading || programmesLoading;
  const error = dataError || programmesError;
  const publishedModules = modules.filter(m => m.status === 'published').length;

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Curriculum Studio" pageSubtitle="Programme builder, module builder, week builder and KSB mapping" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Curriculum Studio"
          description={loading ? 'Loading live curriculum data from LMS...' : `${programmes.length} programmes. ${modules.length} modules (${publishedModules} published). ${ksbFrameworks.length} KSB frameworks ready for mapping.`}
          icon="ri-stack-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20curriculum%20design%20module%20builder%20programme%20learning%20content%20editorial%20photography%20purple%20gold%20accent%20books%20frameworks%20clean%20modern%20minimalist%20workspace&width=400&height=160&seq=curriculum-hero-01&orientation=landscape"
          imageAlt="Curriculum Studio"
          stats={[
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
          <button onClick={() => setTab('modules')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'modules' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Modules</button>
          <button onClick={() => setTab('ksb')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'ksb' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>KSB Frameworks</button>
        </div>

        {tab === 'programmes' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
              <span>Programme</span>
              <span className="text-center">Standard</span>
              <span className="text-center">Cohorts</span>
              <span className="text-center">Modules</span>
              <span className="text-center">Sessions</span>
              <span className="text-center">KSBs</span>
              <span className="text-center">Action</span>
            </div>
            <div className="divide-y divide-background-200/30">
              {loading ? (
                <TableRowsSkeleton rows={6} columns={7} gridClass="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr]" />
              ) : programmes.map(p => {
                const coverage = p.ksbTotal > 0 ? Math.round((p.ksbMapped / p.ksbTotal) * 100) : 0;
                return (
                  <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                    <span className="text-[12px] font-medium text-foreground-900">{p.name}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{p.standard}</span>
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
            </div>
          </div>
        )}

        {tab === 'modules' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
              <span>Module</span>
              <span>Programme</span>
              <span className="text-center">Sessions</span>
              <span className="text-center">KSBs</span>
              <span className="text-center">Lessons</span>
              <span className="text-center">Quizzes</span>
              <span className="text-center">Assignments</span>
              <span className="text-center">Status</span>
              <span className="text-center">Action</span>
            </div>
            <div className="divide-y divide-background-200/30">
              {loading ? (
                <TableRowsSkeleton rows={7} columns={9} gridClass="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr]" />
              ) : modules.map(m => (
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
                    <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/module-builder')} className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
