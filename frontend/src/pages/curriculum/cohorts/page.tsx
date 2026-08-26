import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import { archiveCurriculumCohort, type CurriculumCohort } from '@/lib/curriculumApi';
import {
  cohortsForProgramme,
  cohortYear,
  formatDateLabel,
  matchesSearch,
  normaliseKey,
  programmeIdentity,
} from '../shared/entities/model';
import { CohortFormDrawer } from '../shared/entities/forms';
import {
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  InlineError,
  PlainCell,
  RowActions,
  StackedCell,
} from '../shared/entities/ui';
import { AppIcon } from '@/components/feature/AppIcon';

// Every Cohort in the Curriculum, managed on its own page rather than as step 2
// of the structure wizard. The parent Programme is chosen in the form; nothing
// forces the user on into Group or Module creation afterwards.

const GRID = 'grid grid-cols-[minmax(180px,1.3fr)_minmax(150px,1fr)_110px_110px_80px_130px_80px_92px]';

const COLUMNS = [
  { label: 'Cohort' },
  { label: 'Programme' },
  { label: 'Start' },
  { label: 'Practical end' },
  { label: 'EPA', align: 'center' as const },
  { label: 'Apprenticeship end' },
  { label: 'Groups', align: 'center' as const },
  { label: 'Actions', align: 'right' as const },
];

export default function CurriculumCohortsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    programmes, cohorts, groups, holidays, loading, loaded, error, reload,
  } = useCurriculumEntities({ includeHolidays: true });

  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState(searchParams.get('programme') || '');
  const [yearFilter, setYearFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CurriculumCohort | null>(null);

  // Keep the programme scope in the URL so a filtered list can be linked to —
  // the Programme workspace's Cohorts tab hands off here.
  useEffect(() => {
    const current = searchParams.get('programme') || '';
    if (current === programmeFilter) return;
    const next = new URLSearchParams(searchParams);
    if (programmeFilter) next.set('programme', programmeFilter);
    else next.delete('programme');
    setSearchParams(next, { replace: true });
  }, [programmeFilter, searchParams, setSearchParams]);

  const groupsByCohort = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach(group => {
      const key = normaliseKey(group.cohortId);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [groups]);

  const years = useMemo(
    () => Array.from(new Set(cohorts.map(cohortYear).filter(Boolean))).sort().reverse(),
    [cohorts],
  );

  const visibleCohorts = useMemo(() => {
    const scoped = cohortsForProgramme(cohorts, programmes, programmeFilter);
    return scoped.filter(cohort => {
      if (yearFilter && cohortYear(cohort) !== yearFilter) return false;
      return matchesSearch(search, [
        cohort.name, cohort.programme, cohort.startDate, cohort.endDate, cohort.id,
      ]);
    });
  }, [cohorts, programmes, programmeFilter, search, yearFilter]);

  const totals = useMemo(() => ({
    cohorts: cohorts.length,
    active: cohorts.filter(cohort => normaliseKey(cohort.status) === 'active').length,
    groups: groups.length,
    learners: cohorts.reduce((sum, cohort) => sum + (cohort.learners || 0), 0),
  }), [cohorts, groups]);

  const openCreate = () => { setEditing(null); setDrawerOpen(true); };
  const openEdit = (cohort: CurriculumCohort) => { setEditing(cohort); setDrawerOpen(true); };

  const archive = async (cohort: CurriculumCohort) => {
    const groupCount = groupsByCohort.get(normaliseKey(cohort.id)) || 0;
    await showCurriculumConfirm({
      title: 'Archive cohort?',
      text: groupCount
        ? `${cohort.name} has ${groupCount} group${groupCount === 1 ? '' : 's'}. Archiving hides the cohort and its groups; nothing is deleted.`
        : `${cohort.name} will be hidden from the active list. Nothing is deleted.`,
      icon: 'warning',
      confirmButtonText: 'Archive cohort',
      onConfirm: async () => {
        await archiveCurriculumCohort(cohort.id);
        await reload({ silent: true });
      },
      successTitle: 'Cohort archived',
    });
  };

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Cohorts"
      pageSubtitle="Every cohort across the curriculum, with its programme, dates and groups"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
        <EntityHero
          eyebrow="Curriculum Studio"
          title="Cohorts"
          description="Add a cohort against its programme and manage its dates, EPA window and holidays here. Groups and modules have their own pages."
          loading={loading && !loaded}
          stats={[
            { icon: 'ri-calendar-event-line', label: 'Cohorts', value: totals.cohorts, detail: `${totals.active} active` },
            { icon: 'ri-team-line', label: 'Groups', value: totals.groups },
            { icon: 'ri-stack-line', label: 'Programmes', value: programmes.length },
            { icon: 'ri-graduation-cap-line', label: 'Learners', value: totals.learners },
          ]}
          primaryAction={{ label: 'Add Cohort', onClick: openCreate }}
        />

        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search cohorts, programmes, dates..."
          selects={[
            {
              label: 'Programme',
              value: programmeFilter,
              onChange: setProgrammeFilter,
              options: [{ value: '', label: 'All programmes' }, ...programmeOptions],
            },
            {
              label: 'Year',
              value: yearFilter,
              onChange: setYearFilter,
              options: [{ value: '', label: 'All years' }, ...years.map(year => ({ value: year, label: year }))],
            },
          ]}
          onReset={() => { setSearch(''); setProgrammeFilter(''); setYearFilter(''); }}
          summary={loaded ? `Showing ${visibleCohorts.length} of ${cohorts.length} cohorts` : undefined}
        />

        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={visibleCohorts}
          rowKey={cohort => cohort.id}
          loading={loading && !loaded}
          empty={(
            <EntityEmptyState
              icon="ri-calendar-event-line"
              title={cohorts.length ? 'No cohorts match these filters' : 'No cohorts yet'}
              message={cohorts.length
                ? 'Clear a filter, or search for a different cohort.'
                : 'Add a cohort against a programme to start planning delivery.'}
              action={cohorts.length ? undefined : { label: 'Add Cohort', onClick: openCreate }}
            />
          )}
          renderRow={cohort => (
            <>
              <StackedCell
                href={`/curriculum/cohorts/${encodeURIComponent(cohort.id)}`}
                primary={(
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cohort.color || '#6d28d9' }} />
                    {cohort.name}
                  </span>
                )}
                secondary={cohort.id}
              />
              <StackedCell
                primary={cohort.programme || 'Unassigned programme'}
                secondary={cohort.durationMonths ? `${cohort.durationMonths} months` : undefined}
              />
              <PlainCell>{formatDateLabel(cohort.startDate)}</PlainCell>
              <PlainCell>{formatDateLabel(cohort.practicalEndDate || cohort.endDate)}</PlainCell>
              <PlainCell align="center">{cohort.epaMonths == null ? '—' : `${cohort.epaMonths}m`}</PlainCell>
              <PlainCell>
                {formatDateLabel(cohort.apprenticeshipEndDate)}
                {cohort.apprenticeshipEndOverride ? (
                  <span className="ml-1 text-[10px] font-bold uppercase text-amber-600" title="Manually authored">set</span>
                ) : null}
              </PlainCell>
              <PlainCell align="center">{groupsByCohort.get(normaliseKey(cohort.id)) || 0}</PlainCell>
              <RowActions
                actions={[
                  { icon: 'ri-edit-line', label: 'Edit cohort', onClick: () => openEdit(cohort) },
                  { icon: 'ri-archive-line', label: 'Archive cohort', tone: 'danger', onClick: () => void archive(cohort) },
                ]}
              />
            </>
          )}
        />
      </div>

      <CohortFormDrawer
        open={drawerOpen}
        cohort={editing}
        defaults={{ programmeId: programmeFilter }}
        programmes={programmes}
        holidays={holidays}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => reload({ silent: true })}
      />
    </WorkspaceShell>
  );
}
