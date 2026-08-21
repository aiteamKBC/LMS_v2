import { useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ListSkeleton, TableRowsSkeleton } from '@/components/feature/Skeletons';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { roleNavMap } from '@/mocks/navigation';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumKsbFramework,
  CurriculumModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';

const curriculumNav = roleNavMap.curriculum;

type RecordTab = 'cohorts' | 'groups' | 'frameworks';
type ProgrammeFilter = 'all' | 'ready' | 'attention' | 'draft' | 'missing-ksb';
type SortKey = 'priority' | 'programme' | 'cohorts' | 'modules' | 'sessions';
type KsbDisplayState = 'no-profile' | 'no-modules' | 'missing' | 'partial' | 'mapped';
type ProgrammeStatus = 'Ready' | 'Needs Mapping' | 'Draft' | 'Incomplete' | 'At Risk';

interface ProgrammeRow {
  programme: CurriculumProgramme;
  modules: CurriculumModule[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  sessions: number;
  moduleMappings: {
    mapped: number;
    total: number;
  };
  ksb: {
    state: KsbDisplayState;
    label: string;
    detail: string;
  };
  status: ProgrammeStatus;
  priority: number;
}

interface AttentionIssue {
  key: string;
  label: string;
  count: number;
  action: string;
  href: string;
  detail: string;
}

const recordTabs: Array<{ id: RecordTab; label: string; icon: string }> = [
  { id: 'cohorts', label: 'Cohorts', icon: 'ri-group-line' },
  { id: 'groups', label: 'Groups', icon: 'ri-team-line' },
  { id: 'frameworks', label: 'KSB profiles', icon: 'ri-node-tree' },
];

const programmeFilters: Array<{ id: ProgrammeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs Attention' },
  { id: 'ready', label: 'Ready' },
  { id: 'draft', label: 'Draft' },
  { id: 'missing-ksb', label: 'Missing KSB Mapping' },
];

const primaryActions = [
  { label: 'Create Programme', href: '/curriculum/programmes', icon: 'ri-add-circle-line', primary: true },
  { label: 'Create Module', href: '/curriculum/module-builder', icon: 'ri-add-box-line', primary: false },
];

const quickActions = [
  { label: 'Programme Builder', href: '/curriculum/programmes', icon: 'ri-layout-masonry-line' },
  { label: 'Module Builder', href: '/curriculum/module-builder', icon: 'ri-tools-line' },
  { label: 'KSB Mapping', href: '/curriculum/ksb-mapping', icon: 'ri-node-tree' },
];

export default function CurriculumStudio() {
  const [recordTab, setRecordTab] = useState<RecordTab>('cohorts');
  const [programmeSearch, setProgrammeSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [actionQueueExpanded, setActionQueueExpanded] = useState(true);
  const [readinessSnapshotExpanded, setReadinessSnapshotExpanded] = useState(true);
  const { data, loading: dataLoading, error: dataError } = useCurriculumData({ compact: true });
  const { programmes: programmeRecords, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();

  const programmes = programmeRecords;
  const modules = useMemo(() => data?.modules ?? [], [data?.modules]);
  const ksbFrameworks = useMemo(() => data?.ksbFrameworks ?? [], [data?.ksbFrameworks]);
  const cohorts = useMemo(() => data?.cohorts ?? [], [data?.cohorts]);
  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const loading = dataLoading || programmesLoading;
  const error = dataError || programmesError;

  const programmeRows = useMemo(
    () => programmes.map(programme => buildProgrammeRow(programme, modules, cohorts, groups)),
    [cohorts, groups, modules, programmes],
  );

  const draftModules = modules.filter(module => module.status !== 'published');
  const modulesWithoutKsb = modules.filter(module => Number(module.ksbCount || 0) === 0);
  const activeCohorts = cohorts.filter(cohort => cohort.status === 'active').length;
  const attentionProgrammeCount = programmeRows.filter(row => row.priority > 0).length;
  const totalSessions = programmeRows.reduce((sum, row) => sum + row.sessions, 0);
  const mappedModules = modules.filter(module => Number(module.ksbCount || 0) > 0).length;
  const mappingRate = percentage(mappedModules, modules.length);
  const readyProgrammeCount = programmeRows.filter(row => row.status === 'Ready').length;
  const readyRate = percentage(readyProgrammeCount, programmeRows.length);
  const staffingGaps = groups.filter(group => isMissingAssignment(group.coach)).length + modules.filter(module => isMissingAssignment(module.tutor)).length;

  const attentionIssues = useMemo(
    () => buildAttentionIssues(programmeRows, modules, groups, cohorts),
    [cohorts, groups, modules, programmeRows],
  );
  const criticalIssues = attentionIssues.slice(0, 3);

  const visibleProgrammes = useMemo(() => {
    const query = normalise(programmeSearch);
    return programmeRows
      .filter(row => {
        if (query) {
          const haystack = normalise(`${row.programme.name} ${row.programme.standard} ${row.programme.id} ${row.programme.sourceId}`);
          if (!haystack.includes(query)) return false;
        }
        if (programmeFilter === 'ready') return row.status === 'Ready';
        if (programmeFilter === 'attention') return row.priority > 0;
        if (programmeFilter === 'draft') return row.status === 'Draft';
        if (programmeFilter === 'missing-ksb') return row.ksb.state === 'missing' || row.ksb.state === 'no-profile';
        return true;
      })
      .sort((a, b) => sortProgrammeRows(a, b, sortKey))
      .slice(0, 12);
  }, [programmeFilter, programmeRows, programmeSearch, sortKey]);

  const authoringModules = useMemo(() => {
    const important = [...modules].filter(module => {
      const status = module.status.toLowerCase();
      return status !== 'published' || Number(module.ksbCount || 0) === 0;
    });
    const fallback = [...modules].sort((a, b) => dateValue(b.lastUpdated) - dateValue(a.lastUpdated));
    return (important.length ? important : fallback).sort(compareAuthoringModules).slice(0, 6);
  }, [modules]);

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel={curriculumNav.label}
      navItems={curriculumNav.items}
      workspaceLabel={curriculumNav.workspaceLabel}
      pageTitle="Curriculum Studio"
      pageSubtitle="Curriculum health, authoring progress and KSB readiness"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="space-y-5 bg-background-100 p-4 md:p-6">
        <section className="overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-primary-700 via-primary-900 to-primary-950 text-white shadow-xl">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="p-4 text-white md:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase text-white/75">
                  <AppIcon className="ri-dashboard-3-line" />
                  LMS command centre
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold shadow-sm ${loading ? 'border border-amber-300/30 bg-amber-300/10 text-amber-100' : 'border border-red-300/60 bg-red-500/25 text-red-50 shadow-red-950/30'}`}>
                  <AppIcon className={loading ? 'ri-loader-4-line animate-spin' : 'ri-error-warning-fill'} />
                  {loading ? 'Syncing data' : `${attentionProgrammeCount} programmes need action`}
                </span>
              </div>
              <div className="mt-4 max-w-4xl">
                <h1 className="font-heading text-3xl font-bold text-white md:text-[2.35rem]">Curriculum Studio</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70 lg:max-w-none lg:overflow-hidden lg:text-ellipsis lg:whitespace-nowrap">
                  Monitor programme health, KSB coverage, cohort structure and authoring work from one operational LMS dashboard.
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <HeroMetric label="Readiness" value={`${readyRate}%`} detail={`${readyProgrammeCount}/${programmeRows.length || 0} programmes ready`} loading={loading} progress={readyRate} tone="accent" />
                <HeroMetric label="KSB mapped" value={`${mappingRate}%`} detail={`${mappedModules}/${modules.length || 0} modules mapped`} loading={loading} progress={mappingRate} tone="primary" />
                <HeroMetric label="Staffing gaps" value={staffingGaps} detail="Coach and tutor assignments" loading={loading} progress={percentage(staffingGaps, groups.length + modules.length)} tone="secondary" />
              </div>
            </div>
            <div className="border-t border-white/10 bg-primary-900/65 p-4 xl:border-l xl:border-t-0">
              <div className="rounded-lg border border-white/10 bg-primary-800/45 p-4">
                <p className="text-xs font-bold uppercase text-white/50">Quick launch</p>
                <div className="mt-3 grid gap-2">
                  {primaryActions.map(action => (
                    <button
                      key={action.label}
                      onClick={() => window.REACT_APP_NAVIGATE(action.href)}
                      className={`inline-flex h-11 items-center justify-between rounded-lg px-3 text-xs font-bold transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                        action.primary
                          ? 'bg-white text-foreground-950 hover:bg-primary-50'
                          : 'border border-white/15 bg-white/10 text-white hover:bg-white/15'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2"><AppIcon className={action.icon} />{action.label}</span>
                      <AppIcon className="ri-arrow-right-line" />
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {quickActions.map(action => (
                    <button
                      key={action.href}
                      onClick={() => window.REACT_APP_NAVIGATE(action.href)}
                      className="flex min-h-20 flex-col items-start justify-between rounded-lg border border-white/10 bg-white/[0.07] p-3 text-left text-[11px] font-bold text-white/80 transition-smooth hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-primary-300"
                      title={action.label}
                    >
                      <AppIcon className={`${action.icon} text-lg text-amber-100`} />
                      <span className="leading-4">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard icon="ri-stack-line" label="Programmes" value={programmes.length} detail={`${attentionProgrammeCount} need attention`} loading={loading} progress={readyRate} />
          <KpiCard icon="ri-group-line" label="Active Cohorts" value={activeCohorts} detail={`${cohorts.length} cohorts total`} loading={loading} progress={percentage(activeCohorts, cohorts.length)} />
          <KpiCard icon="ri-book-open-line" label="Modules" value={modules.length} detail={`${totalSessions} sessions planned`} loading={loading} progress={mappingRate} />
          <KpiCard icon="ri-alert-line" label="Attention Queue" value={attentionProgrammeCount} detail="Programmes with blocking signals" loading={loading} tone="warning" progress={percentage(attentionProgrammeCount, programmes.length)} />
          <KpiCard icon="ri-draft-line" label="Draft Modules" value={draftModules.length} detail={`${modulesWithoutKsb.length} without KSB mappings`} loading={loading} tone="info" progress={percentage(modules.length - draftModules.length, modules.length)} />
        </section>

        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="self-start h-fit rounded-lg border border-foreground-200 bg-background-50 shadow-sm">
            <SectionHeader
              title="Action Queue"
              detail="Prioritised blockers from programme, module, cohort and staffing data."
              action={actionQueueExpanded ? 'Collapse all' : 'Expand all'}
              onAction={() => setActionQueueExpanded(value => !value)}
              actionExpanded={actionQueueExpanded}
              actionControls="action-queue-items"
            />
            {actionQueueExpanded && (
              <div id="action-queue-items" className="grid gap-3 p-3 lg:grid-cols-3">
                {loading ? (
                  <ListSkeleton count={3} />
                ) : attentionIssues.length ? (
                  attentionIssues.map(issue => <AttentionCard key={issue.key} issue={issue} />)
                ) : (
                  <EmptyState icon="ri-checkbox-circle-line" title="No curriculum issues require attention." detail="The current dashboard data does not show missing KSB mappings, draft modules, unassigned staff or incomplete structures." />
                )}
              </div>
            )}
          </div>
          <aside className="rounded-lg border border-foreground-200 bg-background-50 p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setReadinessSnapshotExpanded(value => !value)}
              aria-expanded={readinessSnapshotExpanded}
              aria-controls="readiness-snapshot-details"
              className="flex w-full items-start justify-between gap-3 text-left focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"
            >
              <div>
                <h2 className="text-sm font-bold text-foreground-950">Readiness Snapshot</h2>
                <p className="mt-1 text-xs leading-5 text-foreground-500">A quick view of what blocks clean delivery.</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-700">{loading ? '-' : `${readyRate}%`}</span>
                <AppIcon className={readinessSnapshotExpanded ? 'ri-arrow-up-s-line text-lg text-primary-700' : 'ri-arrow-down-s-line text-lg text-primary-700'} />
              </span>
            </button>
            {readinessSnapshotExpanded && (
              <div id="readiness-snapshot-details">
                <div className="mt-4 space-y-4">
                  <ReadinessBar label="Programme readiness" value={readyRate} detail={`${readyProgrammeCount} ready`} />
                  <ReadinessBar label="Module KSB coverage" value={mappingRate} detail={`${modulesWithoutKsb.length} gaps`} tone="emerald" />
                  <ReadinessBar label="Published modules" value={percentage(modules.length - draftModules.length, modules.length)} detail={`${draftModules.length} in draft/review`} tone="amber" />
                </div>
                <div className="mt-5 rounded-lg border border-foreground-200 bg-background-100/70 p-3">
                  <p className="text-xs font-bold text-foreground-900">Next best actions</p>
                  <div className="mt-3 space-y-2">
                    {loading ? (
                      <p className="text-xs text-foreground-500">Loading actions...</p>
                    ) : criticalIssues.length ? (
                      criticalIssues.map(issue => (
                        <button key={issue.key} onClick={() => window.REACT_APP_NAVIGATE(issue.href)} className="flex w-full items-center justify-between gap-3 rounded-md bg-background-50 px-3 py-2 text-left text-xs font-semibold text-foreground-700 hover:text-primary-700">
                          <span className="truncate">{issue.action}</span>
                          <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{issue.count}</span>
                        </button>
                      ))
                    ) : (
                      <p className="text-xs text-foreground-500">No priority actions right now.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </section>

        <section className="rounded-lg border border-foreground-200 bg-background-50 shadow-sm">
          <div className="border-b border-foreground-200 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-sm font-bold text-foreground-950">Programme Health</h2>
                <p className="mt-1 text-xs text-foreground-500">One row per canonical programme ID. KSB states avoid misleading 0/0 percentages.</p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <label className="relative block md:w-72">
                  <span className="sr-only">Search programmes</span>
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
                  <input
                    value={programmeSearch}
                    onChange={event => setProgrammeSearch(event.target.value)}
                    placeholder="Search programme, standard or ID"
                    className="h-9 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-3 text-xs font-semibold text-foreground-800 outline-none transition-smooth placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  />
                </label>
                <label className="sr-only" htmlFor="programme-sort">Sort programmes</label>
                <select
                  id="programme-sort"
                  value={sortKey}
                  onChange={event => setSortKey(event.target.value as SortKey)}
                  className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-semibold text-foreground-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                >
                  <option value="priority">Sort by attention</option>
                  <option value="programme">Sort by programme</option>
                  <option value="cohorts">Sort by cohorts</option>
                  <option value="modules">Sort by modules</option>
                  <option value="sessions">Sort by sessions</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
              {programmeFilters.map(filter => (
                <button
                  key={filter.id}
                  onClick={() => setProgrammeFilter(filter.id)}
                  className={`h-8 shrink-0 rounded-md px-3 text-xs font-bold transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                    programmeFilter === filter.id ? 'bg-background-50 text-foreground-950 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <ProgrammeHealthTable loading={loading} rows={visibleProgrammes} hasFilters={Boolean(programmeSearch || programmeFilter !== 'all')} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-lg border border-foreground-200 bg-background-50 shadow-sm">
            <SectionHeader title="Authoring Pipeline" detail="Limited to draft, review, recently edited, and modules missing KSB mappings." action="View all modules" href="/curriculum/module-builder" />
            <div className="divide-y divide-foreground-100">
              {loading ? (
                <TableRowsSkeleton rows={5} columns={1} gridClass="grid grid-cols-1" />
              ) : authoringModules.length ? (
                authoringModules.map(module => <ModulePipelineRow key={moduleIdentity(module)} module={module} />)
              ) : (
                <EmptyState icon="ri-book-open-line" title="No modules to show." detail="Create a module to begin authoring curriculum content." />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-foreground-200 bg-background-50 shadow-sm">
            <SectionHeader title="Curriculum Records" detail="Secondary records are available without duplicating programme health." />
            <div className="flex gap-1 overflow-x-auto border-b border-foreground-200 bg-background-100/60 p-2">
              {recordTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setRecordTab(tab.id)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-bold transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                    recordTab === tab.id ? 'bg-background-50 text-foreground-950 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'
                  }`}
                >
                  <AppIcon className={tab.icon} />
                  {tab.label}
                </button>
              ))}
            </div>
            {recordTab === 'cohorts' && <CohortsTable loading={loading} cohorts={cohorts} groups={groups} />}
            {recordTab === 'groups' && <GroupsTable loading={loading} groups={groups} />}
            {recordTab === 'frameworks' && <KsbFrameworksPanel loading={loading} frameworks={ksbFrameworks} />}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}

function buildProgrammeRow(programme: CurriculumProgramme, modules: CurriculumModule[], cohorts: CurriculumCohort[], groups: CurriculumGroup[]): ProgrammeRow {
  const programmeModules = modules.filter(module => matchesProgramme(programme, module.programmeId) || matchesProgramme(programme, module.programme));
  const programmeCohorts = cohorts.filter(cohort => matchesProgramme(programme, cohort.programmeId) || matchesProgramme(programme, cohort.programme));
  const cohortIds = new Set(programmeCohorts.map(cohort => normalise(cohort.id)));
  const programmeGroups = groups.filter(group => cohortIds.has(normalise(group.cohortId)) || matchesProgramme(programme, group.programmeId) || matchesProgramme(programme, group.programme));
  const mappedModules = programmeModules.filter(module => Number(module.ksbCount || 0) > 0).length;
  const totalModules = programmeModules.length || Number(programme.modules || 0);
  const ksb = getKsbDisplay(programme, mappedModules, totalModules);
  const status = getProgrammeStatus(programme, programmeCohorts.length, totalModules, ksb.state);
  const sessions = programmeModules.reduce((sum, module) => sum + Number(module.weeks || module.sessionsNumber || 0), 0) || Number(programme.weeks || 0);
  const priority = getProgrammePriority(status, ksb.state, programmeGroups);

  return {
    programme,
    modules: programmeModules,
    cohorts: programmeCohorts,
    groups: programmeGroups,
    sessions,
    moduleMappings: { mapped: mappedModules, total: totalModules },
    ksb,
    status,
    priority,
  };
}

function getKsbDisplay(programme: CurriculumProgramme, mappedModules: number, totalModules: number): ProgrammeRow['ksb'] {
  if (Number(programme.ksbTotal || 0) === 0) {
    return { state: 'no-profile', label: 'No KSB profile', detail: '0 profile KSBs assigned' };
  }
  if (totalModules === 0) {
    return { state: 'no-modules', label: 'No modules', detail: `${programme.ksbTotal} profile KSBs` };
  }
  if (mappedModules === 0) {
    return { state: 'missing', label: 'Missing coverage', detail: `0/${totalModules} modules mapped` };
  }
  if (mappedModules < totalModules) {
    return { state: 'partial', label: 'Partially covered', detail: `${mappedModules}/${totalModules} modules mapped` };
  }
  return { state: 'mapped', label: 'Mapped', detail: `${mappedModules}/${totalModules} modules mapped` };
}

function getProgrammeStatus(programme: CurriculumProgramme, cohorts: number, modules: number, ksbState: KsbDisplayState): ProgrammeStatus {
  if (programme.structureType === 'free' && modules === 0) return 'Draft';
  if (modules === 0 || cohorts === 0) return 'Incomplete';
  if (ksbState === 'no-profile' || ksbState === 'missing') return 'Needs Mapping';
  if (ksbState === 'partial') return 'At Risk';
  return 'Ready';
}

function getProgrammePriority(status: ProgrammeStatus, ksbState: KsbDisplayState, groups: CurriculumGroup[]) {
  const missingCoach = groups.some(group => isMissingAssignment(group.coach));
  if (status === 'Needs Mapping' || ksbState === 'missing' || ksbState === 'no-profile') return 4;
  if (status === 'At Risk' || ksbState === 'partial') return 3;
  if (status === 'Incomplete' || missingCoach) return 2;
  if (status === 'Draft') return 1;
  return 0;
}

function buildAttentionIssues(rows: ProgrammeRow[], modules: CurriculumModule[], groups: CurriculumGroup[], cohorts: CurriculumCohort[]): AttentionIssue[] {
  const programmesWithoutProfile = rows.filter(row => row.ksb.state === 'no-profile').length;
  const programmesWithMissingModuleMappings = rows.filter(row => row.ksb.state === 'missing' || row.ksb.state === 'partial').length;
  const draftModules = modules.filter(module => module.status !== 'published').length;
  const modulesWithoutKsb = modules.filter(module => Number(module.ksbCount || 0) === 0).length;
  const groupsWithoutCoach = groups.filter(group => isMissingAssignment(group.coach)).length;
  const modulesWithoutTutor = modules.filter(module => isMissingAssignment(module.tutor)).length;
  const incompleteCohorts = cohorts.filter(cohort => !cohort.groups.length || !cohort.modules.length || Number(cohort.sessions || 0) === 0).length;

  return [
    programmesWithoutProfile && {
      key: 'programme-profile',
      label: 'Programmes have no KSB profile',
      count: programmesWithoutProfile,
      action: 'Open KSB frameworks',
      href: '/curriculum/ksb-frameworks',
      detail: 'A 0/0 profile is shown as no profile, not as complete coverage.',
    },
    programmesWithMissingModuleMappings && {
      key: 'programme-module-mapping',
      label: 'Programmes have modules needing KSB mapping',
      count: programmesWithMissingModuleMappings,
      action: 'Review programmes',
      href: '/curriculum/programmes',
      detail: 'At least one module in the programme has no mapped KSBs.',
    },
    modulesWithoutKsb && {
      key: 'module-ksb',
      label: 'Modules have no KSB mappings',
      count: modulesWithoutKsb,
      action: 'Map modules',
      href: '/curriculum/module-builder',
      detail: 'Uses each module row and its canonical module catalogue ID when present.',
    },
    draftModules && {
      key: 'draft-modules',
      label: 'Modules are still draft or review',
      count: draftModules,
      action: 'Continue authoring',
      href: '/curriculum/module-builder',
      detail: 'Published modules are not repeated here unless they still need mapping.',
    },
    groupsWithoutCoach && {
      key: 'groups-coach',
      label: 'Groups have no coach',
      count: groupsWithoutCoach,
      action: 'Assign coach',
      href: '/curriculum/staff-profiles',
      detail: 'Derived from group coach assignment fields.',
    },
    modulesWithoutTutor && {
      key: 'modules-tutor',
      label: 'Module assignments have no tutor',
      count: modulesWithoutTutor,
      action: 'Assign tutor',
      href: '/curriculum/staff-profiles',
      detail: 'Derived from module tutor assignment fields.',
    },
    incompleteCohorts && {
      key: 'cohort-structure',
      label: 'Cohorts have incomplete structures',
      count: incompleteCohorts,
      action: 'Open builder',
      href: '/curriculum/programmes',
      detail: 'Cohorts need groups, modules and scheduled sessions.',
    },
  ].filter(Boolean) as AttentionIssue[];
}

function ProgressRing({ value, loading, tone = 'primary', surface = 'light' }: { value: number; loading: boolean; tone?: 'primary' | 'accent' | 'secondary'; surface?: 'light' | 'dark' }) {
  const toneClass = tone === 'accent' ? 'text-accent-500' : tone === 'secondary' ? 'text-secondary-500' : 'text-primary-500';
  const progress = loading ? 0 : clamp(value);
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="21" cy="21" r="16" pathLength="100" fill="none" stroke="currentColor" strokeWidth="4" className={surface === 'dark' ? 'text-white/20' : 'text-foreground-200'} />
        <circle cx="21" cy="21" r="16" pathLength="100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100 - progress} className={toneClass} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-extrabold ${surface === 'dark' ? 'text-white' : 'text-foreground-700'}`}>{loading ? '-' : `${Math.round(progress)}%`}</span>
    </div>
  );
}

function HeroMetric({ label, value, detail, loading, progress, tone }: { label: string; value: string | number; detail: string; loading: boolean; progress: number; tone: 'primary' | 'accent' | 'secondary' }) {
  return (
    <div className="curriculum-progress-card flex min-h-[96px] items-center gap-3 rounded-xl border border-white/15 bg-white/10 p-3 shadow-lg shadow-primary-950/20 transition-smooth hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/15">
      <ProgressRing value={progress} loading={loading} tone={tone} surface="dark" />
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-white/60">{label}</p>
        <p className="mt-1 text-xl font-extrabold tracking-tight text-white">{loading ? '-' : value}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-white/65">{loading ? 'Loading curriculum data' : detail}</p>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, detail, loading, progress, tone = 'default' }: { icon: string; label: string; value: number; detail: string; loading: boolean; progress?: number; tone?: 'default' | 'warning' | 'info' }) {
  const toneClass = tone === 'warning' ? 'bg-amber-50 text-amber-700' : tone === 'info' ? 'bg-blue-50 text-blue-700' : 'bg-primary-50 text-primary-700';
  const ringTone = tone === 'warning' ? 'accent' : tone === 'info' ? 'secondary' : 'primary';
  return (
    <div className="rounded-xl border border-foreground-200 bg-background-50 p-4 shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary-200">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}><AppIcon className={icon} /></span>
        <ProgressRing value={progress ?? 0} loading={loading} tone={ringTone} />
      </div>
      <p className="mt-2 text-xs font-bold text-foreground-800">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground-950">{loading ? '-' : value}</p>
      <p className="mt-1 text-[11px] text-foreground-500">{loading ? 'Loading curriculum data' : detail}</p>
    </div>
  );
}

function AttentionCard({ issue }: { issue: AttentionIssue }) {
  return (
    <article className="flex min-h-[148px] flex-col justify-between rounded-lg border border-foreground-200 bg-background-100/50 p-3 transition-smooth hover:border-primary-200 hover:bg-background-50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-bold text-foreground-950">{issue.count}</p>
          <h3 className="mt-1 text-sm font-bold text-foreground-900">{issue.label}</h3>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
          <AppIcon className="ri-error-warning-line" />
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-foreground-500">{issue.detail}</p>
      <button onClick={() => window.REACT_APP_NAVIGATE(issue.href)} className="mt-3 inline-flex h-8 w-fit items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-bold text-white transition-smooth hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
        {issue.action}
        <AppIcon className="ri-arrow-right-line" />
      </button>
    </article>
  );
}

function ReadinessBar({ label, value, detail, tone = 'primary' }: { label: string; value: number; detail: string; tone?: 'primary' | 'emerald' | 'amber' }) {
  const barClass = tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-primary-600';
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-foreground-800">{label}</p>
        <p className="text-[11px] font-semibold text-foreground-500">{detail}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background-200">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${clamp(value)}%` }} />
      </div>
    </div>
  );
}

function ProgrammeHealthTable({ loading, rows, hasFilters }: { loading: boolean; rows: ProgrammeRow[]; hasFilters: boolean }) {
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="min-w-[1120px] w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background-100 text-[10px] font-bold uppercase text-foreground-500 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
          <tr>
            {['Programme', 'Standard / Framework', 'Cohorts', 'Groups', 'Modules', 'Sessions', 'KSB Coverage', 'Status', 'Action'].map(column => (
              <th key={column} className="border-b border-foreground-200 px-3 py-3 first:pl-4 last:pr-4">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground-100">
          {loading ? (
            <tr><td colSpan={9}><TableRowsSkeleton rows={6} columns={9} gridClass="grid grid-cols-9" /></td></tr>
          ) : rows.length ? (
            rows.map(row => (
              <tr key={row.programme.id} className="h-16 transition-smooth hover:bg-primary-50/35">
                <td className="max-w-[240px] px-3 py-3 pl-4">
                  <button onClick={() => window.REACT_APP_NAVIGATE(`/curriculum/programmes/${row.programme.id}`)} className="block max-w-full truncate text-left text-sm font-bold text-foreground-950 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
                    {row.programme.name}
                  </button>
                  <span className="mt-0.5 block truncate text-[10px] font-semibold text-foreground-400">ID: {row.programme.id}</span>
                </td>
                <td className="max-w-[220px] px-3 py-3 text-xs text-foreground-600"><span className="line-clamp-2">{row.programme.standard || 'Standard not set'}</span></td>
                <NumberCell value={row.cohorts.length || row.programme.cohorts} />
                <NumberCell value={row.groups.length || row.programme.groups || 0} />
                <NumberCell value={row.moduleMappings.total} />
                <NumberCell value={row.sessions} />
                <td className="px-3 py-3">
                  <KsbCoverageBadge state={row.ksb.state} label={row.ksb.label} detail={row.ksb.detail} />
                </td>
                <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-3 pr-4">
                  <button onClick={() => window.REACT_APP_NAVIGATE(`/curriculum/programmes/${row.programme.id}`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
                    Open
                    <AppIcon className="ri-arrow-right-line" />
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={9}>
                <EmptyState icon="ri-search-line" title={hasFilters ? 'No programmes match the current view.' : 'No programmes created yet.'} detail={hasFilters ? 'Adjust search or filters to widen the table.' : 'Create a programme to start building curriculum structure.'} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ModulePipelineRow({ module }: { module: CurriculumModule }) {
  const sessions = module.weeks || module.sessionsNumber || 0;
  const moduleId = module.moduleCatalogueId || module.catalogueId || module.moduleId || module.id;
  const needsKsb = Number(module.ksbCount || 0) === 0;
  const status = needsKsb ? 'Missing KSB' : module.status === 'published' ? 'Ready to publish' : titleCase(module.status || 'draft');
  return (
    <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 transition-smooth hover:bg-primary-50/30">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="max-w-full truncate text-sm font-bold text-foreground-950">{module.name}</p>
          <StatusBadge status={status} compact />
        </div>
        <p className="mt-1 truncate text-xs text-foreground-500">{module.programme || 'Unassigned programme'} - {sessions} sessions - {Number(module.ksbCount || 0)} KSB mappings</p>
      </div>
      <button onClick={() => window.REACT_APP_NAVIGATE(`/curriculum/module-builder?module=${encodeURIComponent(String(moduleId))}`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-bold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
        Edit
        <AppIcon className="ri-arrow-right-line" />
      </button>
    </div>
  );
}

function CohortsTable({ loading, cohorts, groups }: { loading: boolean; cohorts: CurriculumCohort[]; groups: CurriculumGroup[] }) {
  return (
    <CompactTable
      loading={loading}
      headers={['Cohort', 'Programme', 'Status', 'Groups', 'Modules']}
      rows={cohorts.slice(0, 8).map(cohort => [
        cohort.name,
        cohort.programme,
        cohort.status,
        String(groups.filter(group => group.cohortId === cohort.id).length),
        String(cohort.modules.length),
      ])}
      empty="No cohorts available."
    />
  );
}

function GroupsTable({ loading, groups }: { loading: boolean; groups: CurriculumGroup[] }) {
  return (
    <CompactTable
      loading={loading}
      headers={['Group', 'Programme', 'Coach', 'Tutor', 'Sessions']}
      rows={groups.slice(0, 8).map(group => [
        group.name,
        group.programme,
        isMissingAssignment(group.coach) ? 'Unassigned' : group.coach,
        isMissingAssignment(group.tutor) ? 'Unassigned' : group.tutor,
        String(group.sessions || 0),
      ])}
      empty="No groups available."
    />
  );
}

function KsbFrameworksPanel({ loading, frameworks }: { loading: boolean; frameworks: CurriculumKsbFramework[] }) {
  return (
    <CompactTable
      loading={loading}
      headers={['Profile', 'Standard', 'KSBs', 'Status']}
      rows={frameworks.slice(0, 8).map(framework => [
        framework.name,
        framework.standard,
        String(framework.totalKsbs || 0),
        framework.status,
      ])}
      empty="No KSB profiles available."
    />
  );
}

function CompactTable({ loading, headers, rows, empty }: { loading: boolean; headers: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="min-w-[620px] w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-background-100 text-[10px] font-bold uppercase text-foreground-500">
          <tr>{headers.map(header => <th key={header} className="border-b border-foreground-200 px-3 py-3">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-foreground-100 text-xs text-foreground-600">
          {loading ? (
            <tr><td colSpan={headers.length}><TableRowsSkeleton rows={5} columns={headers.length} gridClass={`grid grid-cols-${headers.length}`} /></td></tr>
          ) : rows.length ? (
            rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`} className="h-14 transition-smooth hover:bg-primary-50/30">
                {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className="max-w-[180px] truncate px-3 py-3 first:font-bold first:text-foreground-900">{cell || 'Not set'}</td>)}
              </tr>
            ))
          ) : (
            <tr><td colSpan={headers.length}><EmptyState icon="ri-inbox-line" title={empty} detail="Records will appear here when they are returned by the Curriculum API." /></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SectionHeader({ title, detail, action, href, onAction, actionExpanded, actionControls }: {
  title: string;
  detail: string;
  action?: string;
  href?: string;
  onAction?: () => void;
  actionExpanded?: boolean;
  actionControls?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-foreground-200 p-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-sm font-bold text-foreground-950">{title}</h2>
        <p className="mt-1 text-xs text-foreground-500">{detail}</p>
      </div>
      {action && (href || onAction) && (
        <button
          onClick={onAction ?? (() => href && window.REACT_APP_NAVIGATE(href))}
          aria-expanded={onAction ? actionExpanded : undefined}
          aria-controls={onAction ? actionControls : undefined}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-300"
        >
          {action}
          <AppIcon className={onAction ? (actionExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-arrow-right-line'} />
        </button>
      )}
    </div>
  );
}

function NumberCell({ value }: { value: number }) {
  return <td className="px-3 py-3 text-center text-xs font-bold text-foreground-800">{value}</td>;
}

function KsbCoverageBadge({ state, label, detail }: { state: KsbDisplayState; label: string; detail: string }) {
  const className = {
    'no-profile': 'border-red-200 bg-red-50 text-red-700',
    'no-modules': 'border-foreground-200 bg-background-100 text-foreground-600',
    missing: 'border-red-200 bg-red-50 text-red-700',
    partial: 'border-amber-200 bg-amber-50 text-amber-700',
    mapped: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }[state];
  return (
    <div className={`inline-flex min-w-[150px] flex-col rounded-lg border px-2.5 py-1.5 ${className}`} title="0/0 is treated as no KSB profile. Module mapping is derived from module KSB counts.">
      <span className="text-[11px] font-bold">{label}</span>
      <span className="text-[10px] font-semibold opacity-75">{detail}</span>
    </div>
  );
}

function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const key = normalise(status);
  const className = key.includes('ready') || key.includes('mapped') || key.includes('published')
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : key.includes('risk') || key.includes('mapping') || key.includes('missing')
      ? 'bg-red-50 text-red-700 border-red-200'
      : key.includes('draft') || key.includes('incomplete') || key.includes('review')
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-background-100 text-foreground-600 border-foreground-200';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-bold ${compact ? 'text-[10px]' : 'text-[11px]'} ${className}`}>{status}</span>;
}

function EmptyState({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="p-6 text-center">
      <AppIcon className={`${icon} text-2xl text-foreground-300`} />
      <p className="mt-2 text-sm font-bold text-foreground-800">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-foreground-500">{detail}</p>
    </div>
  );
}

function sortProgrammeRows(a: ProgrammeRow, b: ProgrammeRow, sortKey: SortKey) {
  if (sortKey === 'programme') return a.programme.name.localeCompare(b.programme.name);
  if (sortKey === 'cohorts') return b.cohorts.length - a.cohorts.length;
  if (sortKey === 'modules') return b.moduleMappings.total - a.moduleMappings.total;
  if (sortKey === 'sessions') return b.sessions - a.sessions;
  return b.priority - a.priority || a.programme.name.localeCompare(b.programme.name);
}

function compareAuthoringModules(a: CurriculumModule, b: CurriculumModule) {
  const score = (module: CurriculumModule) => (Number(module.ksbCount || 0) === 0 ? 4 : 0) + (module.status === 'review' ? 3 : 0) + (module.status !== 'published' ? 2 : 0);
  return score(b) - score(a) || dateValue(b.lastUpdated) - dateValue(a.lastUpdated);
}

function matchesProgramme(programme: CurriculumProgramme, value: unknown) {
  const key = normalise(value);
  if (!key) return false;
  return [programme.id, programme.sourceId, programme.name, programme.standard].some(candidate => normalise(candidate) === key);
}

function moduleIdentity(module: CurriculumModule) {
  return String(module.moduleCatalogueId || module.catalogueId || module.moduleId || module.id);
}

function isMissingAssignment(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  return !text || text === 'unassigned' || text === 'n/a' || text === 'not set';
}

function normalise(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function dateValue(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function percentage(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function titleCase(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
