import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import { archiveCurriculumGroup, type CurriculumGroup, type CurriculumStaffProfile } from '@/lib/curriculumApi';
import {
  cleanText,
  cohortsForProgramme,
  formatDateLabel,
  groupsForScope,
  matchesSearch,
  normaliseKey,
  programmeIdentity,
  removeById,
  resolveGroupContext,
  sameIdentifier,
  scheduleLabel,
  upsertById,
} from '../shared/entities/model';
import { GroupFormDrawer } from '../shared/entities/forms';
import { CurriculumStructureWizard, type StructureWizardCreated } from '../shared/entities/structureWizard';
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

// Every Group in the Curriculum. Programme is offered in the filters and the
// form purely to narrow the Cohort list — the persisted parent is the Cohort.

const GRID = 'grid grid-cols-[minmax(170px,1.2fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(120px,.9fr)_minmax(150px,1fr)_80px_92px]';

const COLUMNS = [
  { label: 'Group' },
  { label: 'Cohort' },
  { label: 'Programme' },
  { label: 'Coach' },
  { label: 'Delivery' },
  { label: 'Modules', align: 'center' as const },
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CurriculumGroup | null>(null);
  // The guided run: the same group form, followed straight on by the module one,
  // for a group that is being set up rather than added to a finished cohort.
  const [wizardOpen, setWizardOpen] = useState(false);
  // The group a save just wrote, marked in the table until it has been seen.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (programmeFilter) next.set('programme', programmeFilter); else next.delete('programme');
    if (cohortFilter) next.set('cohort', cohortFilter); else next.delete('cohort');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [cohortFilter, programmeFilter, searchParams, setSearchParams]);

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
    return scoped.filter(group => {
      if (coachFilter && normaliseKey(group.coach) !== normaliseKey(coachFilter)) return false;
      const context = resolveGroupContext(group, cohorts, programmes);
      return matchesSearch(search, [
        group.name, group.id, context.cohortName, context.programmeName,
        group.coach, group.tutor, scheduleLabel(group),
      ]);
    });
  }, [cohortFilter, coachFilter, cohorts, groups, programmeFilter, programmes, search]);

  const archive = async (group: CurriculumGroup) => {
    const moduleCount = modulesByGroup.get(normaliseKey(group.id)) || 0;
    await showCurriculumConfirm({
      title: 'Archive group?',
      text: moduleCount
        ? `${group.name} has ${moduleCount} module${moduleCount === 1 ? '' : 's'}. Archiving detaches them from the group; the module content is kept.`
        : `${group.name} will be hidden from the active list. Nothing is deleted.`,
      icon: 'warning',
      confirmButtonText: 'Archive group',
      onConfirm: async () => {
        await archiveCurriculumGroup(group.id);
        // Drop the row now; the refresh behind this takes seconds and a group
        // still listed after "Archive" reads as an archive that did not happen.
        applyLocal(previous => ({ ...previous, groups: removeById(previous.groups, group.id) }));
        await reload({ silent: true });
      },
      successTitle: 'Group archived',
    });
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
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
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
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-white/15"
            >
              <AppIcon className="ri-route-line text-base"></AppIcon>
              Group + module
            </button>
          )}
        />

        {error && <InlineError message={error} onRetry={() => void reload()} />}

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
          onReset={() => { setSearch(''); setProgrammeFilter(''); setCohortFilter(''); setCoachFilter(''); }}
          summary={loaded
            ? `Showing ${visibleGroups.length} of ${groups.length} groups${refreshing ? ' · updating…' : ''}`
            : undefined}
        />

        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={visibleGroups}
          rowKey={group => group.id}
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
                  href={`/curriculum/groups/${encodeURIComponent(group.id)}`}
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
                <RowActions
                  actions={[
                    { icon: 'ri-edit-line', label: 'Edit group', onClick: () => { setEditing(group); setDrawerOpen(true); } },
                    { icon: 'ri-archive-line', label: 'Archive group', tone: 'danger', onClick: () => void archive(group) },
                  ]}
                />
              </>
            );
          }}
        />
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
      />
    </WorkspaceShell>
  );
}
