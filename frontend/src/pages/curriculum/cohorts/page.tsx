import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import { fetchArchivedCurriculumCohorts, type CurriculumArchivedCohort, type CurriculumCohort } from '@/lib/curriculumApi';
import {
  cohortsForProgramme,
  cohortYear,
  formatDateLabel,
  formatDateTimeLabel,
  matchesSearch,
  normaliseKey,
  programmeIdentity,
  recordsForProgramme,
  removeById,
  sameIdentifier,
  sortEntities,
  upsertById,
  COHORT_SORT_OPTIONS,
} from '../shared/entities/model';
import { CohortFormDrawer } from '../shared/entities/forms';
import {
  archiveCohortWithConfirm,
  permanentlyDeleteCohortWithConfirm,
  restoreCohortWithConfirm,
} from '../shared/entities/archive';
import { ArchiveNotice, ArchiveToggleButton, useCurriculumArchive } from '../shared/entities/archiveView';
import { CurriculumStructureWizard, withoutDiscardedRecords, type StructureWizardCreated } from '../shared/entities/structureWizard';
import {
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  HeroSecondaryButton,
  InlineError,
  NamedActions,
  PlainCell,
  StackedCell,
} from '../shared/entities/ui';

// Every Cohort in the Curriculum, managed on its own page rather than as step 2
// of the structure wizard. The parent Programme is chosen in the form; nothing
// forces the user on into Group or Module creation afterwards.

const GRID = 'grid grid-cols-[minmax(180px,1.3fr)_minmax(150px,1fr)_110px_110px_80px_130px_80px_175px]';

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

// The archive drops the planning columns nobody acts on in here and carries the
// two facts a restore or a delete actually turns on instead: when it was
// archived, and what still sits inside it. Its actions are named rather than
// glyphs -- "restore" and "delete for ever" are not the obvious edit/archive
// pair, and one of them cannot be undone.
const ARCHIVE_GRID = 'grid grid-cols-[minmax(180px,1.3fr)_minmax(150px,1fr)_120px_130px_90px_90px_210px]';

const ARCHIVE_COLUMNS = [
  { label: 'Cohort' },
  { label: 'Programme' },
  { label: 'Start' },
  { label: 'Archived' },
  { label: 'Groups', align: 'center' as const },
  { label: 'Learners', align: 'center' as const },
  { label: 'Actions', align: 'right' as const },
];

export default function CurriculumCohortsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    programmes, cohorts, groups, holidays, loading, loaded, refreshing, error, reload, applyLocal,
  } = useCurriculumEntities({ includeHolidays: true });

  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState(searchParams.get('programme') || '');
  const [yearFilter, setYearFilter] = useState('');
  const [sort, setSort] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CurriculumCohort | null>(null);
  // The guided run: this same cohort form, then the group and module ones, for a
  // cohort that is being stood up rather than added to a running programme.
  const [wizardOpen, setWizardOpen] = useState(false);
  // Which list this page is showing. Kept in the URL for the same reason the
  // programme scope is: the archive is somewhere a reader is sent ("it is in
  // the archive"), so the link has to be able to say so.
  const [showArchived, setShowArchived] = useState(() => searchParams.get('view') === 'archive');
  // The cohort a save just wrote, marked in the table until the eye has had a
  // chance to land on it.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  // Keep the programme scope and the archive view in the URL so a filtered list
  // can be linked to — the Programme workspace's Cohorts tab hands off here.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (programmeFilter) next.set('programme', programmeFilter);
    else next.delete('programme');
    if (showArchived) next.set('view', 'archive');
    else next.delete('view');
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [programmeFilter, searchParams, setSearchParams, showArchived]);

  // Nothing is read until the archive is actually opened; see useCurriculumArchive.
  const archived = useCurriculumArchive(fetchArchivedCurriculumCohorts, showArchived);

  // The same programme/year/search filters as the live list, applied to rows
  // that carry their own programme rather than resolving one through a parent —
  // an archived cohort's programme may itself be archived.
  const visibleArchivedCohorts = useMemo(() => {
    const scoped = recordsForProgramme(archived.records, programmes, programmeFilter);
    return scoped.filter(cohort => {
      if (yearFilter && cohortYear(cohort) !== yearFilter) return false;
      return matchesSearch(search, [cohort.name, cohort.programme, cohort.startDate, cohort.id]);
    });
  }, [archived.records, programmeFilter, programmes, search, yearFilter]);

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
    const matched = scoped.filter(cohort => {
      if (yearFilter && cohortYear(cohort) !== yearFilter) return false;
      return matchesSearch(search, [
        cohort.name, cohort.programme, cohort.startDate, cohort.endDate, cohort.id,
      ]);
    });
    return sortEntities(matched, COHORT_SORT_OPTIONS, sort);
  }, [cohorts, programmes, programmeFilter, search, sort, yearFilter]);

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
    await archiveCohortWithConfirm(cohort, groupCount, async () => {
      // Drop the row now, for the same reason a create paints one now: the
      // refresh behind this takes seconds, and a cohort still sitting in the
      // list after "Archive" reads as an archive that did not happen.
      applyLocal(previous => ({ ...previous, cohorts: removeById(previous.cohorts, cohort.id) }));
      await reload({ silent: true });
    });
  };

  /**
   * Coming back out of the archive puts a cohort into the live list, so both of
   * these refresh that list as well as the archive they were run from. The live
   * refresh is the slow one (the overview is rebuilt server-side), which is why
   * the archive is re-read on its own rather than waiting behind it.
   */
  const restore = async (cohort: CurriculumArchivedCohort) => {
    await restoreCohortWithConfirm(cohort, async () => {
      await archived.reload();
      await reload({ silent: true });
    });
  };

  const deletePermanently = async (cohort: CurriculumArchivedCohort) => {
    // Nothing to put back into the live list here, so only the archive moves.
    await permanentlyDeleteCohortWithConfirm(cohort, () => archived.reload());
  };

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );

  // A cohort is saved under whatever filters happen to be on screen, and a
  // filter that hides it reads as a save that did not work. Anything that would
  // keep the new record out of the list is dropped, so what the page shows is
  // the row the user just wrote.
  const revealCohort = (saved: CurriculumCohort) => {
    if (yearFilter && cohortYear(saved) !== yearFilter) setYearFilter('');
    if (programmeFilter && !cohortsForProgramme([saved], programmes, programmeFilter).length) setProgrammeFilter('');
    if (search && !matchesSearch(search, [saved.name, saved.programme, saved.startDate, saved.endDate, saved.id])) {
      setSearch('');
    }
  };

  /**
   * The drawer hands back the record the endpoint stored, so the row goes in
   * now rather than when the background refresh returns a few seconds later.
   * The refresh still runs straight behind it and replaces the whole list with
   * the server's copy — this only closes the gap the user was staring at.
   */
  const handleSaved = async (result?: { cohort: CurriculumCohort }) => {
    const saved = result?.cohort;
    if (saved) {
      applyLocal(previous => ({ ...previous, cohorts: upsertById(previous.cohorts, saved) }));
      revealCohort(saved);
      window.clearTimeout(highlightTimer.current);
      setHighlightId(saved.id);
    }
    await reload({ silent: true });
    // Held until the server's copy has replaced the optimistic row, so the mark
    // ends on the row that stays rather than the one that was swapped out.
    if (saved) highlightTimer.current = window.setTimeout(() => setHighlightId(null), 3000);
  };

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
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
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
          secondaryActions={(
            <>
              <HeroSecondaryButton
                icon="ri-route-line"
                label="Cohort + group + module"
                onClick={() => setWizardOpen(true)}
              />
              <ArchiveToggleButton
                active={showArchived}
                count={archived.loaded ? archived.records.length : null}
                onToggle={() => setShowArchived(previous => !previous)}
              />
            </>
          )}
        />

        {error && <InlineError message={error} onRetry={() => void reload()} />}
        {showArchived && archived.error && (
          <InlineError message={archived.error} onRetry={() => void archived.reload()} />
        )}

        {showArchived && (
          <ArchiveNotice>
            Archived cohorts are hidden from planning but still in the database. Restoring one puts it back in the
            active list along with the groups archived with it — their modules were detached and have to be attached
            again. Deleting one here removes it and those groups for good; module content, learner accounts and learner
            progress are never touched.
          </ArchiveNotice>
        )}

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
          sort={showArchived ? undefined : { value: sort, onChange: setSort, options: COHORT_SORT_OPTIONS }}
          onReset={() => { setSearch(''); setProgrammeFilter(''); setYearFilter(''); setSort(''); }}
          summary={showArchived
            ? (archived.loaded
              ? `Showing ${visibleArchivedCohorts.length} of ${archived.records.length} archived cohorts`
              : undefined)
            : (loaded
              ? `Showing ${visibleCohorts.length} of ${cohorts.length} cohorts${refreshing ? ' · updating…' : ''}`
              : undefined)}
        />

        {showArchived ? (
          <EntityTable
            columns={ARCHIVE_COLUMNS}
            gridClass={ARCHIVE_GRID}
            rows={visibleArchivedCohorts}
            rowKey={cohort => cohort.id}
            loading={archived.loading && !archived.loaded}
            empty={(
              <EntityEmptyState
                icon="ri-inbox-line"
                title={archived.records.length ? 'No archived cohorts match these filters' : 'Nothing in the archive'}
                message={archived.records.length
                  ? 'Clear a filter, or search for a different cohort.'
                  : 'Cohorts you archive are kept here until you restore them or delete them for good.'}
              />
            )}
            renderRow={cohort => (
              <>
                <StackedCell
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
                <PlainCell>
                  {formatDateTimeLabel(cohort.archivedAt)}
                  {/* Only when a parent's archive brought it here: that parent is
                      the record to restore, and this one's own Restore is refused
                      until it is back. */}
                  {cohort.archivedBy === 'programme-delete' && (
                    <span className="mt-0.5 block text-[11px] font-semibold text-amber-700">With its programme</span>
                  )}
                </PlainCell>
                <PlainCell align="center">{cohort.groups}</PlainCell>
                <PlainCell align="center">{cohort.learners}</PlainCell>
                <NamedActions
                  actions={[
                    {
                      icon: 'ri-arrow-go-back-line',
                      label: 'Restore',
                      title: 'Put this cohort back in the active list',
                      onClick: () => void restore(cohort),
                    },
                    {
                      icon: 'ri-delete-bin-line',
                      label: 'Delete',
                      // A cohort somebody is still enrolled in cannot be removed,
                      // and the button says so before the click rather than the
                      // endpoint saying it after.
                      title: cohort.learners
                        ? `${cohort.learners} learner${cohort.learners === 1 ? '' : 's'} are still placed here — move them first`
                        : 'Remove this cohort from the database for good',
                      disabled: Boolean(cohort.learners),
                      onClick: () => void deletePermanently(cohort),
                    },
                  ]}
                />
              </>
            )}
          />
        ) : (
          <EntityTable
            columns={COLUMNS}
            gridClass={GRID}
            rows={visibleCohorts}
            rowKey={cohort => cohort.id}
            getRowHref={cohort => `/curriculum/cohorts/${encodeURIComponent(cohort.id)}`}
            loading={loading && !loaded}
            refreshing={refreshing}
            highlightKey={highlightId}
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
                {/* Named rather than glyphs, matching the Groups table and the
                    archive view below: edit and archive are not tellable apart by
                    icon without hovering every row, and the column has the room.
                    The short word goes on the button, the whole sentence in its
                    title. */}
                <NamedActions
                  actions={[
                    {
                      icon: 'ri-edit-line',
                      label: 'Edit',
                      title: 'Edit this cohort, its dates, EPA window and holidays',
                      onClick: () => openEdit(cohort),
                    },
                    {
                      icon: 'ri-archive-line',
                      label: 'Archive',
                      title: 'Hide this cohort and its groups from the active list. Nothing is deleted, and it can be restored from the archive',
                      onClick: () => void archive(cohort),
                    },
                  ]}
                />
              </>
            )}
          />
        )}
      </div>

      <CohortFormDrawer
        open={drawerOpen}
        cohort={editing}
        defaults={{ programmeId: programmeFilter }}
        programmes={programmes}
        holidays={holidays}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
      />

      {/* The same cohort form as above, with the group and module ones chained
          behind it. Only the cohort step reaches this page's list; what the later
          steps create is picked up by the refresh that follows each one. */}
      <CurriculumStructureWizard
        open={wizardOpen}
        from="cohort"
        defaults={{ programmeId: programmeFilter }}
        onClose={() => setWizardOpen(false)}
        onStepSaved={async (created: StructureWizardCreated) => {
          if (created.cohort) await handleSaved({ cohort: created.cohort });
          else await reload({ silent: true });
        }}
        // The rows the run wrote are gone (or archived) by the time the discard
        // reports, and the refresh above lands seconds later. They come off the
        // list now, for the same reason a save paints its row now.
        onRunDiscarded={(discarded: StructureWizardCreated) => {
          applyLocal(previous => withoutDiscardedRecords(previous, discarded));
        }}
      />
    </WorkspaceShell>
  );
}
