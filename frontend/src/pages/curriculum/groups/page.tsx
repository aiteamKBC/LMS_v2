import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import {
  fetchArchivedCurriculumGroups,
  type CurriculumArchivedGroup,
  type CurriculumGroup,
  type CurriculumStaffProfile,
} from '@/lib/curriculumApi';
import {
  cleanText,
  cohortsForProgramme,
  formatDateLabel,
  formatDateTimeLabel,
  groupsForScope,
  matchesSearch,
  namedCurriculumWorkspacePath,
  normaliseKey,
  programmeIdentity,
  recordsForProgramme,
  removeById,
  resolveGroupContext,
  sameIdentifier,
  scheduleLabel,
  sortEntities,
  upsertById,
  GROUP_SORT_OPTIONS,
} from '../shared/entities/model';
import { GroupFormDrawer } from '../shared/entities/forms';
import {
  archiveGroupWithConfirm,
  permanentlyDeleteGroupWithConfirm,
  restoreGroupWithConfirm,
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

// Every Group in the Curriculum. Programme is offered in the filters and the
// form purely to narrow the Cohort list — the persisted parent is the Cohort.

const GRID = 'grid grid-cols-[minmax(170px,1.2fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(120px,.9fr)_minmax(150px,1fr)_80px_175px]';

const COLUMNS = [
  { label: 'Group' },
  { label: 'Cohort' },
  { label: 'Programme' },
  { label: 'Coach' },
  { label: 'Delivery' },
  { label: 'Modules', align: 'center' as const },
  { label: 'Actions', align: 'right' as const },
];

// The archive trades the planning columns for the two facts a restore or a
// delete turns on: when it was archived, and who is still in it. Module count is
// gone because there is never one -- archiving a group detaches its modules --
// and the actions are named because "restore" and "delete for ever" are not the
// obvious edit/archive pair.
const ARCHIVE_GRID = 'grid grid-cols-[minmax(170px,1.2fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(120px,.9fr)_130px_90px_210px]';

const ARCHIVE_COLUMNS = [
  { label: 'Group' },
  { label: 'Cohort' },
  { label: 'Programme' },
  { label: 'Coach' },
  { label: 'Archived' },
  { label: 'Learners', align: 'center' as const },
  { label: 'Actions', align: 'right' as const },
];

function staffProfileName(profile: CurriculumStaffProfile) {
  return cleanText(profile.name) || cleanText(profile.email);
}

export default function CurriculumGroupsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    programmes, cohorts, groups, modules, coaches, loading, loaded, refreshing, error, reload, applyLocal,
  } = useCurriculumEntities({ includeStaff: true });

  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState(searchParams.get('programme') || '');
  const [cohortFilter, setCohortFilter] = useState(searchParams.get('cohort') || '');
  const [coachFilter, setCoachFilter] = useState('');
  const [sort, setSort] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CurriculumGroup | null>(null);
  // The guided run: the same group form, followed straight on by the module one,
  // for a group that is being set up rather than added to a finished cohort.
  const [wizardOpen, setWizardOpen] = useState(false);
  // Which list this page is showing. Kept in the URL for the same reason the
  // programme and cohort scopes are: the archive is somewhere a reader is sent
  // ("it is in the archive"), so the link has to be able to say so.
  const [showArchived, setShowArchived] = useState(() => searchParams.get('view') === 'archive');
  // The group a save just wrote, marked in the table until it has been seen.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (programmeFilter) next.set('programme', programmeFilter); else next.delete('programme');
    if (cohortFilter) next.set('cohort', cohortFilter); else next.delete('cohort');
    if (showArchived) next.set('view', 'archive'); else next.delete('view');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [cohortFilter, programmeFilter, searchParams, setSearchParams, showArchived]);

  // Nothing is read until the archive is actually opened; see useCurriculumArchive.
  const archived = useCurriculumArchive(fetchArchivedCurriculumGroups, showArchived);

  // Choosing a programme narrows the cohort list; a cohort outside the new
  // programme is dropped rather than left as a contradictory filter.
  const scopedCohorts = useMemo(
    () => cohortsForProgramme(cohorts, programmes, programmeFilter),
    [cohorts, programmes, programmeFilter],
  );
  useEffect(() => {
    if (!cohortFilter) return;
    if (scopedCohorts.some(cohort => normaliseKey(cohort.id) === normaliseKey(cohortFilter))) return;
    setCohortFilter('');
  }, [cohortFilter, scopedCohorts]);

  const modulesByGroup = useMemo(() => {
    const map = new Map<string, number>();
    modules.forEach(module => {
      const key = normaliseKey(module.groupId);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [modules]);

  const coachNames = useMemo(() => {
    const names = new Set<string>();
    coaches.forEach(profile => { const name = staffProfileName(profile); if (name) names.add(name); });
    groups.forEach(group => {
      const name = cleanText(group.coach);
      if (name && normaliseKey(name) !== 'unassigned') names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [coaches, groups]);

  const visibleGroups = useMemo(() => {
    const scoped = groupsForScope(groups, cohorts, programmes, {
      programmeId: programmeFilter,
      cohortId: cohortFilter,
    });
    const matched = scoped.filter(group => {
      if (coachFilter && normaliseKey(group.coach) !== normaliseKey(coachFilter)) return false;
      const context = resolveGroupContext(group, cohorts, programmes);
      return matchesSearch(search, [
        group.name, group.id, context.cohortName, context.programmeName,
        group.coach, group.tutor, scheduleLabel(group),
      ]);
    });
    return sortEntities(matched, GROUP_SORT_OPTIONS, sort);
  }, [cohortFilter, coachFilter, cohorts, groups, programmeFilter, programmes, search, sort]);

  // The same programme/cohort/coach/search filters as the live list, applied to
  // rows that carry their own programme and cohort rather than resolving them
  // through a parent — an archived group's cohort is usually archived too, so it
  // is not in the live cohort list to resolve against.
  const visibleArchivedGroups = useMemo(() => {
    const scoped = recordsForProgramme(archived.records, programmes, programmeFilter);
    return scoped.filter(group => {
      if (cohortFilter && !sameIdentifier(group.cohortId, cohortFilter)) return false;
      if (coachFilter && normaliseKey(group.coach) !== normaliseKey(coachFilter)) return false;
      return matchesSearch(search, [
        group.name, group.id, group.cohort, group.programme, group.coach, scheduleLabel(group),
      ]);
    });
  }, [archived.records, coachFilter, cohortFilter, programmeFilter, programmes, search]);

  const archive = async (group: CurriculumGroup) => {
    const moduleCount = modulesByGroup.get(normaliseKey(group.id)) || 0;
    await archiveGroupWithConfirm(group, moduleCount, async () => {
      // Drop the row now; the refresh behind this takes seconds and a group
      // still listed after "Archive" reads as an archive that did not happen.
      applyLocal(previous => ({ ...previous, groups: removeById(previous.groups, group.id) }));
      await reload({ silent: true });
    });
  };

  /**
   * Coming back out of the archive puts a group into the live list, so the
   * restore refreshes that list as well as the archive it was run from. The live
   * refresh is the slow one (the overview is rebuilt server-side), which is why
   * the archive is re-read on its own rather than waiting behind it.
   */
  const restore = async (group: CurriculumArchivedGroup) => {
    await restoreGroupWithConfirm(group, async () => {
      await archived.reload();
      await reload({ silent: true });
    });
  };

  const deletePermanently = async (group: CurriculumArchivedGroup) => {
    // Nothing to put back into the live list here, so only the archive moves.
    await permanentlyDeleteGroupWithConfirm(group, () => archived.reload());
  };

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );

  // A filter that hides the group just saved reads as a save that did nothing,
  // so whatever would keep it out of the list is cleared.
  const revealGroup = (saved: CurriculumGroup) => {
    if (coachFilter && normaliseKey(saved.coach) !== normaliseKey(coachFilter)) setCoachFilter('');
    if (cohortFilter && !sameIdentifier(saved.cohortId, cohortFilter)) setCohortFilter('');
    if (programmeFilter && !groupsForScope([saved], cohorts, programmes, { programmeId: programmeFilter }).length) {
      setProgrammeFilter('');
    }
    if (search) {
      const context = resolveGroupContext(saved, cohorts, programmes);
      const hit = matchesSearch(search, [
        saved.name, saved.id, context.cohortName, context.programmeName,
        saved.coach, saved.tutor, scheduleLabel(saved),
      ]);
      if (!hit) setSearch('');
    }
  };

  /**
   * Paint the record the endpoint stored straight away; the background refresh
   * behind it still replaces the list with the server's copy. Same handler as
   * the one on the Cohorts page.
   */
  const handleSaved = async (result?: { group: CurriculumGroup }) => {
    const saved = result?.group;
    if (saved) {
      applyLocal(previous => ({ ...previous, groups: upsertById(previous.groups, saved) }));
      revealGroup(saved);
      window.clearTimeout(highlightTimer.current);
      setHighlightId(saved.id);
    }
    await reload({ silent: true });
    if (saved) highlightTimer.current = window.setTimeout(() => setHighlightId(null), 3000);
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Groups"
      pageSubtitle="Every delivery group, its cohort, coach and timetable"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Curriculum Studio"
          title="Groups"
          description="Groups belong to a cohort. Pick a programme first to narrow the cohort list — the stored parent is always the cohort."
          loading={loading && !loaded}
          stats={[
            { icon: 'ri-team-line', label: 'Groups', value: groups.length },
            { icon: 'ri-calendar-event-line', label: 'Cohorts', value: cohorts.length },
            { icon: 'ri-user-star-line', label: 'Coaches', value: coachNames.length },
            { icon: 'ri-stack-line', label: 'Modules', value: modules.length },
          ]}
          primaryAction={{ label: 'Add Group', onClick: () => { setEditing(null); setDrawerOpen(true); } }}
          secondaryActions={(
            <>
              <HeroSecondaryButton
                icon="ri-route-line"
                label="Group + module"
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
            Archived groups are hidden from planning but still in the database. Restoring one puts it back under its
            cohort — its modules were detached when it was archived and have to be attached again. Deleting one here
            removes it for good; module content, learner accounts and learner progress are never touched. A group whose
            cohort is archived too has to wait for that cohort to be restored first.
          </ArchiveNotice>
        )}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search groups, cohorts, coaches..."
          selects={[
            {
              label: 'Programme',
              value: programmeFilter,
              onChange: setProgrammeFilter,
              options: [{ value: '', label: 'All programmes' }, ...programmeOptions],
            },
            {
              label: 'Cohort',
              value: cohortFilter,
              onChange: setCohortFilter,
              options: [
                { value: '', label: 'All cohorts' },
                ...scopedCohorts.map(cohort => ({ value: cohort.id, label: cohort.name })),
              ],
            },
            {
              label: 'Coach',
              value: coachFilter,
              onChange: setCoachFilter,
              options: [{ value: '', label: 'All coaches' }, ...coachNames.map(name => ({ value: name, label: name }))],
            },
          ]}
          sort={showArchived ? undefined : { value: sort, onChange: setSort, options: GROUP_SORT_OPTIONS }}
          onReset={() => { setSearch(''); setProgrammeFilter(''); setCohortFilter(''); setCoachFilter(''); setSort(''); }}
          summary={showArchived
            ? (archived.loaded
              ? `Showing ${visibleArchivedGroups.length} of ${archived.records.length} archived groups`
              : undefined)
            : (loaded
              ? `Showing ${visibleGroups.length} of ${groups.length} groups${refreshing ? ' · updating…' : ''}`
              : undefined)}
        />

        {showArchived ? (
          <EntityTable
            columns={ARCHIVE_COLUMNS}
            gridClass={ARCHIVE_GRID}
            rows={visibleArchivedGroups}
            rowKey={group => group.id}
            loading={archived.loading && !archived.loaded}
            empty={(
              <EntityEmptyState
                icon="ri-inbox-line"
                title={archived.records.length ? 'No archived groups match these filters' : 'Nothing in the archive'}
                message={archived.records.length
                  ? 'Clear a filter, or search for a different group.'
                  : 'Groups you archive are kept here until you restore them or delete them for good.'}
              />
            )}
            renderRow={group => (
              <>
                <StackedCell
                  primary={(
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color || '#2563eb' }} />
                      {group.name}
                    </span>
                  )}
                  secondary={group.id}
                />
                <StackedCell
                  primary={cleanText(group.cohort, 'Unassigned cohort')}
                  // Says why Restore is off on this row, next to the cohort it is
                  // waiting on rather than only inside the disabled button.
                  secondary={group.cohortArchived ? 'Archived too' : scheduleLabel(group)}
                />
                <PlainCell>{cleanText(group.programme, 'Unassigned programme')}</PlainCell>
                <PlainCell>{cleanText(group.coach, 'Unassigned')}</PlainCell>
                <PlainCell>
                  {formatDateTimeLabel(group.archivedAt)}
                  {/* Only when a parent's archive brought it here: that parent is
                      the record to restore. */}
                  {group.archivedBy === 'programme-delete' && (
                    <span className="mt-0.5 block text-[11px] font-semibold text-amber-700">With its programme</span>
                  )}
                  {group.archivedBy === 'cohort-delete' && (
                    <span className="mt-0.5 block text-[11px] font-semibold text-amber-700">With its cohort</span>
                  )}
                </PlainCell>
                <PlainCell align="center">{group.learners}</PlainCell>
                <NamedActions
                  actions={[
                    {
                      icon: 'ri-arrow-go-back-line',
                      label: 'Restore',
                      // A group cannot come back into a cohort that is not in the
                      // list; the endpoint refuses it, so the button says so first.
                      title: group.cohortArchived
                        ? `${cleanText(group.cohort, 'Its cohort')} is archived too — restore the cohort and this group comes back with it`
                        : 'Put this group back in the active list',
                      disabled: group.cohortArchived,
                      onClick: () => void restore(group),
                    },
                    {
                      icon: 'ri-delete-bin-line',
                      label: 'Delete',
                      title: group.learners
                        ? `${group.learners} learner${group.learners === 1 ? '' : 's'} are still placed here — move them first`
                        : 'Remove this group from the database for good',
                      disabled: Boolean(group.learners),
                      onClick: () => void deletePermanently(group),
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
            rows={visibleGroups}
            rowKey={group => group.id}
            getRowHref={group => namedCurriculumWorkspacePath('groups', group.id, group.name)}
            loading={loading && !loaded}
            refreshing={refreshing}
            highlightKey={highlightId}
            empty={(
              <EntityEmptyState
                icon="ri-team-line"
                title={groups.length ? 'No groups match these filters' : 'No groups yet'}
                message={groups.length
                  ? 'Clear a filter, or search for a different group.'
                  : 'Add a group against a cohort to start scheduling delivery.'}
                action={groups.length ? undefined : { label: 'Add Group', onClick: () => { setEditing(null); setDrawerOpen(true); } }}
              />
            )}
            renderRow={group => {
              const context = resolveGroupContext(group, cohorts, programmes);
              return (
                <>
                  <StackedCell
                    href={namedCurriculumWorkspacePath('groups', group.id, group.name)}
                    primary={(
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color || '#2563eb' }} />
                        {group.name}
                      </span>
                    )}
                    secondary={group.id}
                  />
                  <StackedCell
                    href={context.cohortId ? `/curriculum/cohorts/${encodeURIComponent(context.cohortId)}` : undefined}
                    primary={context.cohortName}
                    // The group's own start date is only set once a module has
                    // actually been scheduled against it; until then this fell
                    // back to a blank dash even though the cohort itself has a
                    // start date. Falling back to the cohort's keeps every row
                    // showing a date under a column literally labelled "Cohort".
                    secondary={formatDateLabel(group.startDate || context.cohort?.startDate)}
                  />
                  <PlainCell>{context.programmeName}</PlainCell>
                  <PlainCell>{cleanText(group.coach, 'Unassigned')}</PlainCell>
                  <PlainCell>{scheduleLabel(group)}</PlainCell>
                  <PlainCell align="center">{modulesByGroup.get(normaliseKey(group.id)) || 0}</PlainCell>
                  {/* Named, like the archive view's pair below: two glyphs in a
                      row of 105 is a hover away from telling edit from archive,
                      and the column has the room. The short word goes on the
                      button, the whole sentence in its title. */}
                  <NamedActions
                    actions={[
                      {
                        icon: 'ri-edit-line',
                        label: 'Edit',
                        title: 'Edit this group, its coach and its delivery slot',
                        onClick: () => { setEditing(group); setDrawerOpen(true); },
                      },
                      {
                        icon: 'ri-archive-line',
                        label: 'Archive',
                        title: 'Hide this group from the active list. Its modules are detached, nothing is deleted, and it can be restored from the archive',
                        onClick: () => void archive(group),
                      },
                    ]}
                  />
                </>
              );
            }}
          />
        )}
      </div>

      <GroupFormDrawer
        open={drawerOpen}
        group={editing}
        defaults={{ programmeId: programmeFilter, cohortId: cohortFilter }}
        programmes={programmes}
        cohorts={cohorts}
        coachNames={coachNames}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
      />

      {/* The same group form as above, with the module form chained behind it.
          Only the group step reaches this page's list; the module it creates is
          counted by the refresh that follows. */}
      <CurriculumStructureWizard
        open={wizardOpen}
        from="group"
        defaults={{ programmeId: programmeFilter, cohortId: cohortFilter }}
        onClose={() => setWizardOpen(false)}
        onStepSaved={async (created: StructureWizardCreated) => {
          if (created.group) await handleSaved({ group: created.group });
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
