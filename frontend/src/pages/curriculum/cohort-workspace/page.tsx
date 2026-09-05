import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import type { CurriculumCohort, CurriculumGroup } from '@/lib/curriculumApi';
import {
  cleanText,
  cohortProgramme,
  findCohort,
  formatDateLabel,
  moduleIdentity,
  namedCurriculumWorkspacePath,
  normaliseKey,
  programmeIdentity,
  scheduleLabel,
  upsertById,
} from '../shared/entities/model';
import { CohortFormDrawer, GroupFormDrawer } from '../shared/entities/forms';
import { ScopeAchievementPanel } from '../shared/entities/scopeAchievement';
import {
  DetailRow,
  EntityEmptyState,
  EntityTable,
  InlineError,
  ParentBadge,
  PlainCell,
  StackedCell,
  WorkspaceHeader,
  WorkspacePanel,
  WorkspaceTabs,
} from '../shared/entities/ui';
import { AppIcon } from '@/components/feature/AppIcon';

// The contextual view of one Cohort: its groups, the modules delivered beneath
// them, and the holidays that shift their session dates. It reads the same
// entities and calls the same endpoints as the global pages — this is a lens on
// the data, not a second copy of it.

type Tab = 'overview' | 'groups' | 'modules' | 'learners' | 'holidays';

const GROUP_GRID = 'grid grid-cols-[minmax(170px,1.3fr)_minmax(130px,1fr)_minmax(150px,1fr)_80px]';
const MODULE_GRID = 'grid grid-cols-[minmax(190px,1.4fr)_minmax(140px,1fr)_minmax(130px,1fr)_70px_110px_110px]';

export default function CohortWorkspacePage() {
  const { id = '' } = useParams();
  const {
    programmes, cohorts, groups, modules, holidays, coaches,
    loading, loaded, refreshing, error, reload, applyLocal,
  } = useCurriculumEntities({ includeHolidays: true, includeStaff: true });

  const [tab, setTab] = useState<Tab>('overview');
  const [cohortDrawerOpen, setCohortDrawerOpen] = useState(false);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CurriculumGroup | null>(null);
  // The group a save just wrote, marked in the table below until it is seen.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  const cohort = useMemo(() => findCohort(cohorts, id), [cohorts, id]);
  const programme = useMemo(
    () => (cohort ? cohortProgramme(cohort, programmes) : undefined),
    [cohort, programmes],
  );

  const cohortGroups = useMemo(
    () => (cohort ? groups.filter(group => normaliseKey(group.cohortId) === normaliseKey(cohort.id)) : []),
    [cohort, groups],
  );
  // Modules reach the cohort through their group, never directly.
  const cohortModules = useMemo(() => {
    const groupIds = new Set(cohortGroups.map(group => normaliseKey(group.id)));
    return modules.filter(module => groupIds.has(normaliseKey(module.groupId)));
  }, [cohortGroups, modules]);

  const selectedHolidays = useMemo(() => {
    const ids = new Set((cohort?.holidayIds || []).map(holidayId => normaliseKey(holidayId)));
    return holidays.filter(holiday => ids.has(normaliseKey(holiday.id)));
  }, [cohort, holidays]);

  const coachNames = useMemo(() => {
    const names = new Set<string>();
    coaches.forEach(profile => {
      const name = cleanText(profile.name) || cleanText(profile.email);
      if (name) names.add(name);
    });
    groups.forEach(group => {
      const name = cleanText(group.coach);
      if (name && normaliseKey(name) !== 'unassigned') names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [coaches, groups]);

  if (!loading && loaded && !cohort) {
    return (
      <WorkspaceShell
        role="curriculum"
        roleLabel="Curriculum Designer"
        navItems={curriculumNavItems}
        workspaceLabel="Curriculum Studio"
        pageTitle="Cohort not found"
        userName="Rachel Myers"
        userRole="Curriculum Designer"
      >
        <div className="p-6">
          <EntityEmptyState
            icon="ri-folder-warning-line"
            title="Cohort not found"
            message={`No cohort matches "${id}". It may have been renamed or archived.`}
          />
        </div>
      </WorkspaceShell>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
    { key: 'groups', label: 'Groups', icon: 'ri-team-line', count: cohortGroups.length },
    { key: 'modules', label: 'Modules', icon: 'ri-stack-line', count: cohortModules.length },
    { key: 'learners', label: 'Learners', icon: 'ri-graduation-cap-line', count: cohort?.learners || undefined },
    { key: 'holidays', label: 'Holidays', icon: 'ri-calendar-close-line', count: selectedHolidays.length },
  ];

  // Both drawers hand back the record the endpoint stored, so this page shows
  // the edit before the background refresh returns — the same reason the
  // Cohorts and Groups lists do it. The refresh still runs straight behind.
  const saveCohortLocally = async (result?: { cohort: CurriculumCohort }) => {
    if (result?.cohort) {
      const saved = result.cohort;
      applyLocal(previous => ({ ...previous, cohorts: upsertById(previous.cohorts, saved) }));
    }
    await reload({ silent: true });
  };

  const saveGroupLocally = async (result?: { group: CurriculumGroup }) => {
    const saved = result?.group;
    if (saved) {
      applyLocal(previous => ({ ...previous, groups: upsertById(previous.groups, saved) }));
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
      pageTitle={cohort?.name || 'Cohort'}
      pageSubtitle={cohort ? `${cohort.programme} · ${formatDateLabel(cohort.startDate)} – ${formatDateLabel(cohort.apprenticeshipEndDate || cohort.endDate)}` : 'Loading cohort'}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <WorkspaceHeader
          breadcrumbs={[
            { label: 'Curriculum', href: '/workspace/curriculum' },
            { label: 'Cohorts', href: '/curriculum/cohorts' },
            { label: cohort?.name || id },
          ]}
          eyebrow="Cohort"
          title={cohort?.name || 'Loading…'}
          subtitle={programme ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-foreground-400">Part of</span>
              <ParentBadge
                tone="programme"
                label={programme.name}
                href={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(programme))}?tab=cohorts`}
              />
            </span>
          ) : cleanText(cohort?.programme, 'Unassigned programme')}
          accentColor={cohort?.color}
          dense
          stats={[
            { icon: 'ri-team-line', label: 'Groups', value: cohortGroups.length },
            { icon: 'ri-stack-line', label: 'Modules', value: cohortModules.length },
            { icon: 'ri-graduation-cap-line', label: 'Learners', value: cohort?.learners || 0 },
            { icon: 'ri-calendar-line', label: 'Start', value: formatDateLabel(cohort?.startDate) },
            { icon: 'ri-flag-line', label: 'Practical end', value: formatDateLabel(cohort?.practicalEndDate || cohort?.endDate) },
            { icon: 'ri-award-line', label: 'Apprenticeship end', value: formatDateLabel(cohort?.apprenticeshipEndDate) },
          ]}
          actions={(
            <>
              <button
                type="button"
                onClick={() => setCohortDrawerOpen(true)}
                disabled={!cohort}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:opacity-50"
              >
                <AppIcon className="ri-edit-line text-sm"></AppIcon>
                Edit cohort
              </button>
              <button
                type="button"
                onClick={() => { setEditingGroup(null); setGroupDrawerOpen(true); }}
                disabled={!cohort}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:opacity-50"
              >
                <AppIcon className="ri-add-line text-sm"></AppIcon>
                Add group
              </button>
            </>
          )}
        />

        <WorkspaceTabs tabs={tabs} active={tab} onChange={key => setTab(key as Tab)} />

        {tab === 'overview' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <WorkspacePanel title="Dates" description="Contract dates stay fixed; selected holidays only affect clashing module sessions.">
              <DetailRow label="Start" value={formatDateLabel(cohort?.startDate)} />
              <DetailRow label="Duration" value={cohort?.durationMonths ? `${cohort.durationMonths} months` : '-'} />
              <DetailRow label="Practical end" value={formatDateLabel(cohort?.practicalEndDate || cohort?.endDate)} />
              <DetailRow label="EPA period" value={cohort?.epaMonths == null ? 'Not recorded' : `${cohort.epaMonths} months`} />
              <DetailRow
                label="Apprenticeship end"
                value={(
                  <span>
                    {formatDateLabel(cohort?.apprenticeshipEndDate)}
                    {cohort?.apprenticeshipEndOverride && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-600">Manually set</span>
                    )}
                  </span>
                )}
              />
            </WorkspacePanel>
            <WorkspacePanel title="Context" description="Where this cohort sits in the curriculum.">
              {/* Delivery, not Overview: the reader came from a cohort, and
                  Delivery is the tab that lists this programme's cohorts. */}
              <DetailRow
                label="Programme"
                value={programme ? (
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(programme))}?tab=cohorts`} className="text-primary-700 hover:underline">
                    {programme.name}
                  </Link>
                ) : cleanText(cohort?.programme, '—')}
              />
              <DetailRow label="Cohort ID" value={<code className="text-[11px]">{cohort?.id || '—'}</code>} />
              <DetailRow label="Groups" value={cohortGroups.length} />
              <DetailRow label="Modules" value={cohortModules.length} />
              <DetailRow label="Holidays selected" value={selectedHolidays.length} />
            </WorkspacePanel>
          </div>
        )}

        {tab === 'groups' && (
          <EntityTable
            columns={[
              { label: 'Group' },
              { label: 'Coach' },
              { label: 'Delivery' },
              { label: 'Modules', align: 'center' },
            ]}
            gridClass={GROUP_GRID}
            rows={cohortGroups}
            rowKey={group => group.id}
            getRowHref={group => namedCurriculumWorkspacePath('groups', group.id, group.name)}
            loading={loading && !loaded}
            refreshing={refreshing}
            highlightKey={highlightId}
            empty={(
              <EntityEmptyState
                icon="ri-team-line"
                title="No groups in this cohort"
                message="Add a group to start scheduling delivery for these learners."
                action={{ label: 'Add group', onClick: () => { setEditingGroup(null); setGroupDrawerOpen(true); } }}
              />
            )}
            renderRow={group => (
              <>
                <StackedCell
                  href={namedCurriculumWorkspacePath('groups', group.id, group.name)}
                  primary={group.name}
                  secondary={group.id}
                />
                <PlainCell>{cleanText(group.coach, 'Unassigned')}</PlainCell>
                <PlainCell>{scheduleLabel(group)}</PlainCell>
                <PlainCell align="center">
                  {modules.filter(module => normaliseKey(module.groupId) === normaliseKey(group.id)).length}
                </PlainCell>
              </>
            )}
          />
        )}

        {tab === 'modules' && (
          <EntityTable
            columns={[
              { label: 'Module' },
              { label: 'Group' },
              { label: 'Tutor' },
              { label: 'Sessions', align: 'center' },
              { label: 'Start' },
              { label: 'End' },
            ]}
            gridClass={MODULE_GRID}
            rows={cohortModules}
            rowKey={module => moduleIdentity(module) || module.id}
            getRowHref={module => namedCurriculumWorkspacePath('modules', moduleIdentity(module), module.name)}
            loading={loading && !loaded}
            empty={(
              <EntityEmptyState
                icon="ri-stack-line"
                title="No modules under this cohort"
                message="Modules are attached to a group. Add one from the Modules page."
              />
            )}
            renderRow={module => (
              <>
                <StackedCell
                  href={namedCurriculumWorkspacePath('modules', moduleIdentity(module), module.name)}
                  primary={module.name}
                  secondary={`${module.weeks || 0} weeks · ${module.lessons || 0} lessons`}
                />
                <PlainCell>{cleanText(module.group, '—')}</PlainCell>
                <PlainCell>{cleanText(module.tutor, 'Unassigned')}</PlainCell>
                <PlainCell align="center">{module.sessionsNumber || 0}</PlainCell>
                <PlainCell>{formatDateLabel(module.startDate)}</PlainCell>
                <PlainCell>{formatDateLabel(module.endDate)}</PlainCell>
              </>
            )}
          />
        )}

        {/* Who enrolment placed in this cohort, and what they have actually
            achieved against this cohort's own components. The cohort is the
            level enrolment places learners into, so this is its own roster —
            not a slice of the programme's. */}
        {tab === 'learners' && (
          <ScopeAchievementPanel
            scope="cohort"
            identifier={cohort?.id || id}
            title={`Learners and achievement in ${cohort?.name || 'this cohort'}`}
            learnerStatus="all"
            active={tab === 'learners'}
          />
        )}

        {tab === 'holidays' && (
          <WorkspacePanel
            title="Holidays applied to this cohort"
            description="Session dates generated for this cohort's modules skip these dates."
            actions={(
              <Link
                to="/curriculum/holidays"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
              >
                <AppIcon className="ri-calendar-close-line text-sm"></AppIcon>
                Manage holidays
              </Link>
            )}
          >
            {selectedHolidays.length ? (
              <ul className="space-y-2">
                {selectedHolidays.map(holiday => (
                  <li key={String(holiday.id)} className="flex items-center gap-3 rounded-lg border border-background-200 px-3 py-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: holiday.color || '#dc2626' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-foreground-900">{holiday.label}</span>
                      <span className="block text-[11px] text-foreground-400">
                        {formatDateLabel(holiday.startDate)} – {formatDateLabel(holiday.endDate || holiday.startDate)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-foreground-500">{cleanText(holiday.type, '—')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-foreground-500">
                No holidays are selected for this cohort. Edit the cohort to choose which apply.
              </p>
            )}
          </WorkspacePanel>
        )}
      </div>

      <CohortFormDrawer
        open={cohortDrawerOpen}
        cohort={cohort}
        programmes={programmes}
        holidays={holidays}
        onClose={() => setCohortDrawerOpen(false)}
        onSaved={saveCohortLocally}
      />
      <GroupFormDrawer
        open={groupDrawerOpen}
        group={editingGroup}
        defaults={{ cohortId: cohort?.id }}
        programmes={programmes}
        cohorts={cohorts}
        coachNames={coachNames}
        lockCohort
        onClose={() => setGroupDrawerOpen(false)}
        onSaved={saveGroupLocally}
      />
    </WorkspaceShell>
  );
}
