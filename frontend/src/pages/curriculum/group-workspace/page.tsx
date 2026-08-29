import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import { fetchCurriculumSessions, type CurriculumGroup, type CurriculumSession } from '@/lib/curriculumApi';
import {
  cleanText,
  findGroup,
  formatDateLabel,
  moduleIdentity,
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

type Tab = 'overview' | 'modules' | 'sessions' | 'learners';

const MODULE_GRID = 'grid grid-cols-[minmax(190px,1.5fr)_minmax(130px,1fr)_70px_110px_110px]';
const SESSION_GRID = 'grid grid-cols-[110px_minmax(170px,1.4fr)_minmax(140px,1fr)_120px_120px]';

export default function GroupWorkspacePage() {
  const { id = '' } = useParams();
  const {
    programmes, cohorts, groups, modules, coaches, tutors, holidays,
    loading, loaded, refreshing, error, reload, applyLocal,
  } = useCurriculumEntities({ includeStaff: true, includeHolidays: true });

  const [tab, setTab] = useState<Tab>('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moduleDrawerOpen, setModuleDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<CurriculumSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // This page is about one group, so a save shows on it immediately rather than
  // when the background refresh gets back. See the Cohorts list for the pattern.
  const saveGroupLocally = async (result?: { group: CurriculumGroup }) => {
    if (result?.group) {
      const saved = result.group;
      applyLocal(previous => ({ ...previous, groups: upsertById(previous.groups, saved) }));
    }
    await reload({ silent: true });
  };

  const group = useMemo(() => findGroup(groups, id), [groups, id]);
  const context = useMemo(
    () => (group ? resolveGroupContext(group, cohorts, programmes) : null),
    [cohorts, group, programmes],
  );

  const groupModules = useMemo(
    () => (group ? modules.filter(module => normaliseKey(module.groupId) === normaliseKey(group.id)) : []),
    [group, modules],
  );

  // Sessions are the heaviest collection in the curriculum payload, so they are
  // only fetched once the user actually opens the Sessions tab.
  useEffect(() => {
    if (tab !== 'sessions' || !group || sessions.length || sessionsLoading) return undefined;
    const controller = new AbortController();
    setSessionsLoading(true);
    fetchCurriculumSessions(controller.signal)
      .then(result => setSessions(result))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
    return () => controller.abort();
  }, [group, sessions.length, sessionsLoading, tab]);

  const groupSessions = useMemo(() => {
    if (!group) return [];
    return sessions
      .filter(session => normaliseKey(session.groupId) === normaliseKey(group.id)
        || normaliseKey(session.group) === normaliseKey(group.name))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [group, sessions]);

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

  if (!loading && loaded && !group) {
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
    { key: 'sessions', label: 'Sessions', icon: 'ri-time-line', count: groupSessions.length || undefined },
    { key: 'learners', label: 'Learners', icon: 'ri-graduation-cap-line', count: group?.learners || undefined },
  ];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={group?.name || 'Group'}
      pageSubtitle={context ? `${context.cohortName} · ${context.programmeName}` : 'Loading group'}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <WorkspaceHeader
          breadcrumbs={[
            { label: 'Curriculum', href: '/workspace/curriculum' },
            { label: 'Groups', href: '/curriculum/groups' },
            ...(context?.cohortId
              ? [{ label: context.cohortName, href: `/curriculum/cohorts/${encodeURIComponent(context.cohortId)}` }]
              : []),
            { label: group?.name || id },
          ]}
          eyebrow="Group"
          title={group?.name || 'Loading…'}
          subtitle={context ? `${context.cohortName} · ${context.programmeName}` : ''}
          accentColor={group?.color}
          stats={[
            { icon: 'ri-stack-line', label: 'Modules', value: groupModules.length },
            { icon: 'ri-graduation-cap-line', label: 'Learners', value: group?.learners || 0 },
            { icon: 'ri-user-star-line', label: 'Coach', value: cleanText(group?.coach, 'Unassigned') },
            { icon: 'ri-calendar-line', label: 'Delivery', value: group ? scheduleLabel(group) : '—' },
            { icon: 'ri-play-circle-line', label: 'Start', value: formatDateLabel(group?.startDate) },
            { icon: 'ri-flag-line', label: 'End', value: formatDateLabel(group?.endDate) },
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
                onClick={() => setModuleDrawerOpen(true)}
                disabled={!group}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:opacity-50"
              >
                <AppIcon className="ri-add-line text-sm"></AppIcon>
                Add module
              </button>
            </>
          )}
        />

        <WorkspaceTabs tabs={tabs} active={tab} onChange={key => setTab(key as Tab)} />

        {tab === 'overview' && (
          <div className="grid gap-5 xl:grid-cols-2">
            <WorkspacePanel title="Delivery" description="When and how this group is taught.">
              <DetailRow label="Delivery days" value={cleanText(group?.weekDays, '—')} />
              <DetailRow label="Time" value={group?.startTime ? `${group.startTime} – ${cleanText(group.endTime, '—')}` : '—'} />
              <DetailRow label="Mode" value={cleanText(group?.mode, '—')} />
              <DetailRow label="Coach" value={cleanText(group?.coach, 'Unassigned')} />
            </WorkspacePanel>
            <WorkspacePanel title="Context" description="This group's place in the hierarchy.">
              <DetailRow
                label="Cohort"
                value={context?.cohortId ? (
                  <Link to={`/curriculum/cohorts/${encodeURIComponent(context.cohortId)}`} className="text-primary-700 hover:underline">
                    {context.cohortName}
                  </Link>
                ) : cleanText(context?.cohortName, '—')}
              />
              {/* Delivery owns cohorts and the groups beneath them, which is the
                  level this group was reached from. */}
              <DetailRow
                label="Programme"
                value={context?.programme ? (
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}?tab=delivery`} className="text-primary-700 hover:underline">
                    {context.programmeName}
                  </Link>
                ) : cleanText(context?.programmeName, '—')}
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
            rowHref={module => (moduleIdentity(module) ? `/curriculum/modules/${encodeURIComponent(moduleIdentity(module))}` : undefined)}
            loading={loading && !loaded}
            refreshing={refreshing}
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
                  href={`/curriculum/modules/${encodeURIComponent(moduleIdentity(module))}`}
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

        {tab === 'sessions' && (
          <EntityTable
            columns={[
              { label: 'Date' },
              { label: 'Session' },
              { label: 'Module' },
              { label: 'Time' },
              { label: 'Tutor' },
            ]}
            gridClass={SESSION_GRID}
            rows={groupSessions}
            rowKey={session => session.id}
            loading={sessionsLoading}
            empty={(
              <EntityEmptyState
                icon="ri-time-line"
                title="No sessions scheduled"
                message="Sessions are generated from each module's start date, session count and delivery days."
              />
            )}
            renderRow={session => (
              <>
                <PlainCell>{formatDateLabel(session.date)}</PlainCell>
                <StackedCell primary={session.title || 'Session'} secondary={session.day} />
                <PlainCell>{cleanText(session.module, '—')}</PlainCell>
                <PlainCell>{session.startTime ? `${session.startTime} – ${cleanText(session.endTime, '')}` : '—'}</PlainCell>
                <PlainCell>{cleanText(session.tutor, 'Unassigned')}</PlainCell>
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
            title={`Learners and achievement in ${group?.name || 'this group'}`}
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
        onClose={() => setModuleDrawerOpen(false)}
        onSaved={async () => {
          await reload({ silent: true });
        }}
      />
    </WorkspaceShell>
  );
}
