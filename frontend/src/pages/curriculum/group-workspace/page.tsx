import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import { type CurriculumGroup } from '@/lib/curriculumApi';
import {
  cleanText,
  findGroup,
  formatDateLabel,
  moduleIdentity,
  namedCurriculumWorkspacePath,
  normaliseKey,
  programmeIdentity,
  resolveGroupContext,
  scheduleLabel,
  upsertById,
} from '../shared/entities/model';
import { GroupFormDrawer } from '../shared/entities/forms';
import { ModuleFormDrawer } from '../shared/entities/moduleForm';
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

// One Group: what it delivers, to whom, and when. Modules are listed rather than
// edited here — each one opens its own workspace, which is where the operational
// controls (schedule, Teams, components) live.

type Tab = 'overview' | 'modules' | 'learners';

const MODULE_GRID = 'grid grid-cols-[minmax(190px,1.5fr)_minmax(130px,1fr)_70px_110px_110px]';

export default function GroupWorkspacePage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const {
    programmes, cohorts, groups, modules, coaches, tutors, holidays,
    loading, loaded, refreshing, error, reload, applyLocal,
  } = useCurriculumEntities({ includeStaff: true, includeHolidays: true });

  const [tab, setTab] = useState<Tab>('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moduleDrawerOpen, setModuleDrawerOpen] = useState(false);
  const [moduleCreating, setModuleCreating] = useState(false);

  // This page is about one group, so a save shows on it immediately rather than
  // when the background refresh gets back. See the Cohorts list for the pattern.
  const saveGroupLocally = async (result?: { group: CurriculumGroup }) => {
    if (result?.group) {
      const saved = result.group;
      applyLocal(previous => ({ ...previous, groups: upsertById(previous.groups, saved) }));
    }
    await reload({ silent: true });
  };

  // The compact overview this list comes from is cached, and a create can land
  // on a different backend worker than the one that serves this page's very next
  // load — that worker's cache still predates the write. Rather than tell the
  // reader their new group does not exist, force one uncached reload before
  // believing it.
  const [retriedMissingGroup, setRetriedMissingGroup] = useState(false);
  useEffect(() => {
    setRetriedMissingGroup(false);
  }, [id]);

  const group = useMemo(() => findGroup(groups, id), [groups, id]);

  useEffect(() => {
    if (!loading && loaded && !group && !retriedMissingGroup) {
      setRetriedMissingGroup(true);
      void reload({ skipCache: true });
    }
  }, [group, loaded, loading, reload, retriedMissingGroup]);

  const groupDisplayName = cleanText(group?.name) || cleanText(searchParams.get('groupName')) || 'Group';
  const context = useMemo(
    () => (group ? resolveGroupContext(group, cohorts, programmes) : null),
    [cohorts, group, programmes],
  );

  const groupModules = useMemo(
    () => (group ? modules.filter(module => normaliseKey(module.groupId) === normaliseKey(group.id)) : []),
    [group, modules],
  );

  const coachNames = useMemo(() => {
    const names = new Set<string>();
    coaches.forEach(profile => {
      const name = cleanText(profile.name) || cleanText(profile.email);
      if (name) names.add(name);
    });
    groups.forEach(item => {
      const name = cleanText(item.coach);
      if (name && normaliseKey(name) !== 'unassigned') names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [coaches, groups]);

  const tutorNames = useMemo(() => {
    const names = new Set<string>();
    tutors.forEach(profile => {
      const name = cleanText(profile.name) || cleanText(profile.email);
      if (name) names.add(name);
    });
    modules.forEach(item => {
      const name = cleanText(item.tutor);
      if (name && normaliseKey(name) !== 'unassigned') names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [modules, tutors]);

  if (!loading && loaded && !group && retriedMissingGroup) {
    return (
      <WorkspaceShell
        role="curriculum"
        roleLabel="Curriculum Designer"
        navItems={curriculumNavItems}
        workspaceLabel="Curriculum Studio"
        pageTitle="Group not found"
        userName="Rachel Myers"
        userRole="Curriculum Designer"
      >
        <div className="p-6">
          <EntityEmptyState
            icon="ri-folder-warning-line"
            title="Group not found"
            message={`No group matches "${id}". It may have been renamed or archived.`}
          />
        </div>
      </WorkspaceShell>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
    { key: 'modules', label: 'Modules', icon: 'ri-stack-line', count: groupModules.length },
    { key: 'learners', label: 'Learners, Activity & KSBs', icon: 'ri-graduation-cap-line', count: group?.learners || undefined },
  ];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={groupDisplayName}
      pageSubtitle={context ? `${context.cohortName} · ${context.programmeName}` : 'Loading group'}
      breadcrumbCurrentLabel={`Groups — ${groupDisplayName}`}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <WorkspaceHeader
          breadcrumbs={[
            { label: 'Curriculum', href: '/workspace/curriculum' },
            { label: 'Groups', href: '/curriculum/groups' },
            ...(context?.cohortId
              ? [{ label: context.cohortName, href: `/curriculum/cohorts/${encodeURIComponent(context.cohortId)}` }]
              : []),
            { label: groupDisplayName },
          ]}
          eyebrow="Group"
          title={groupDisplayName}
          subtitle={context ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-foreground-400">in Cohort</span>
              <ParentBadge
                tone="cohort"
                label={context.cohortName}
                href={context.cohortId ? `/curriculum/cohorts/${encodeURIComponent(context.cohortId)}` : undefined}
              />
              <span className="text-foreground-400">in programme</span>
              <ParentBadge
                tone="programme"
                label={context.programmeName}
                href={context.programmeId
                  ? `/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}?tab=groups`
                  : undefined}
              />
            </span>
          ) : ''}
          accentColor={group?.color}
          dense
          stats={[
            { icon: 'ri-stack-line', label: 'Modules', value: groupModules.length },
            { icon: 'ri-graduation-cap-line', label: 'Learners', value: group?.learners || 0 },
            { icon: 'ri-user-star-line', label: 'Coach', value: cleanText(group?.coach, 'Unassigned') },
            { icon: 'ri-calendar-line', label: 'Delivery', value: group ? scheduleLabel(group) : '—' },
            // The same three dates the Cohort workspace carries, because they are
            // the same three dates: a group delivers inside its cohort's
            // contracted window and holds no dates of its own. Labelled as the
            // cohort's so the header cannot be read as a group-level date
            // somebody could edit here -- Edit group has no such field.
            {
              icon: 'ri-calendar-line',
              label: 'Cohort start',
              value: context?.cohort ? formatDateLabel(context.cohort.startDate) : 'No cohort linked',
            },
            {
              icon: 'ri-flag-line',
              label: 'Cohort practical end',
              value: context?.cohort
                ? formatDateLabel(context.cohort.practicalEndDate || context.cohort.endDate)
                : 'No cohort linked',
            },
            {
              icon: 'ri-award-line',
              label: 'Cohort apprenticeship end',
              value: context?.cohort ? formatDateLabel(context.cohort.apprenticeshipEndDate) : 'No cohort linked',
            },
          ]}
          actions={(
            <>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                disabled={!group}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:opacity-50"
              >
                <AppIcon className="ri-edit-line text-sm"></AppIcon>
                Edit group
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('modules');
                  setModuleDrawerOpen(true);
                }}
                disabled={!group || moduleCreating}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:opacity-50"
              >
                <AppIcon className={`${moduleCreating ? 'ri-loader-4-line animate-spin' : 'ri-add-line'} text-sm`}></AppIcon>
                {moduleCreating ? 'Creating module...' : 'Add module'}
              </button>
            </>
          )}
        />

        <WorkspaceTabs tabs={tabs} active={tab} onChange={key => setTab(key as Tab)} />

        {tab === 'overview' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <WorkspacePanel title="Delivery" description="When and how this group is taught.">
              <DetailRow label="Delivery days" value={cleanText(group?.weekDays, '—')} />
              <DetailRow label="Time" value={group?.startTime ? `${group.startTime} – ${cleanText(group.endTime, '—')}` : '—'} />
              <DetailRow label="Coach" value={cleanText(group?.coach, 'Unassigned')} />
            </WorkspacePanel>
            <WorkspacePanel title="Context" description="This group's place in the hierarchy.">
              {/* Delivery owns cohorts and the groups beneath them, which is the
                  level this group was reached from. */}
              <DetailRow
                label="Programme"
                value={context?.programme ? (
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}?tab=groups`} className="text-primary-700 hover:underline">
                    {context.programmeName}
                  </Link>
                ) : cleanText(context?.programmeName, '—')}
              />
              <DetailRow
                label="Cohort"
                value={context?.cohortId ? (
                  <Link to={`/curriculum/cohorts/${encodeURIComponent(context.cohortId)}`} className="text-primary-700 hover:underline">
                    {context.cohortName}
                  </Link>
                ) : cleanText(context?.cohortName, '—')}
              />
              <DetailRow label="Group ID" value={<code className="text-[11px]">{group?.id || '—'}</code>} />
              <DetailRow label="Modules" value={groupModules.length} />
            </WorkspacePanel>
          </div>
        )}

        {tab === 'modules' && (
          <EntityTable
            columns={[
              { label: 'Module' },
              { label: 'Tutor' },
              { label: 'Sessions', align: 'center' },
              { label: 'Start' },
              { label: 'End' },
            ]}
            gridClass={MODULE_GRID}
            rows={groupModules}
            rowKey={module => moduleIdentity(module) || module.id}
            getRowHref={module => namedCurriculumWorkspacePath('modules', moduleIdentity(module), module.name)}
            loading={loading && !loaded}
            refreshing={refreshing || moduleCreating}
            empty={(
              <EntityEmptyState
                icon="ri-stack-line"
                title="No modules for this group"
                message="Attach a module so this group has something to deliver."
              />
            )}
            renderRow={module => (
              <>
                <StackedCell
                  href={namedCurriculumWorkspacePath('modules', moduleIdentity(module), module.name)}
                  primary={module.name}
                  secondary={`${module.weeks || 0} weeks · ${module.lessons || 0} lessons`}
                />
                <PlainCell>{cleanText(module.tutor, 'Unassigned')}</PlainCell>
                <PlainCell align="center">{module.sessionsNumber || 0}</PlainCell>
                <PlainCell>{formatDateLabel(module.startDate)}</PlainCell>
                <PlainCell>{formatDateLabel(module.endDate)}</PlainCell>
              </>
            )}
          />
        )}

        {/* The group is the timetabled class, so it is the level enrolment
            places a learner into and the level a module borrows its roster
            from. Both questions — who is here, and what have they earned
            against this group's modules — are answered from this group alone. */}
        {tab === 'learners' && (
          <ScopeAchievementPanel
            scope="group"
            identifier={group?.id || id}
            title={`Learners, activity and KSBs in ${group?.name || 'this group'}`}
            learnerStatus="all"
            active={tab === 'learners'}
          />
        )}
      </div>

      <GroupFormDrawer
        open={drawerOpen}
        group={group}
        programmes={programmes}
        cohorts={cohorts}
        coachNames={coachNames}
        onClose={() => setDrawerOpen(false)}
        onSaved={saveGroupLocally}
      />

      {/* Same form the Module Builder opens, with this group's parents fixed.
          Authoring weeks and components stays behind the explicit Edit components action. */}
      <ModuleFormDrawer
        open={moduleDrawerOpen}
        defaults={{
          programmeId: context?.programme ? programmeIdentity(context.programme) : cleanText(group?.programmeId),
          cohortId: cleanText(group?.cohortId),
          groupId: cleanText(group?.id),
        }}
        programmes={programmes}
        cohorts={cohorts}
        groups={groups}
        holidays={holidays}
        tutorNames={tutorNames}
        lockGroup
        onSavingChange={setModuleCreating}
        onClose={() => setModuleDrawerOpen(false)}
        onSaved={async () => {
          await reload({ silent: true });
        }}
      />
    </WorkspaceShell>
  );
}
