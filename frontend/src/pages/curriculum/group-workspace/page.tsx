import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import { fetchCurriculumSessions, type CurriculumGroup, type CurriculumSession } from '@/lib/curriculumApi';
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
  PlainCell,
  StackedCell,
  StatusBadge,
  WorkspaceHeader,
  WorkspacePanel,
  WorkspaceTabs,
} from '../shared/entities/ui';
import { AppIcon } from '@/components/feature/AppIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';

// One Group: what it delivers, to whom, and when. Modules are listed rather than
// edited here — each one opens its own workspace, which is where the operational
// controls (schedule, Teams, components) live.

type Tab = 'overview' | 'modules' | 'sessions' | 'learners';

const MODULE_GRID = 'grid grid-cols-[minmax(190px,1.5fr)_minmax(130px,1fr)_70px_110px_110px]';

/** Month bucket for a session, from its date. Undated sessions collapse into
 *  one "Unscheduled" bucket that always sorts last — same grouping the
 *  Programme workspace's own Sessions tab reads its tree by. */
function sessionMonthBucket(dateIso: string): { key: string; label: string; order: number } {
  const trimmed = (dateIso || '').trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}/.test(trimmed);
  const date = trimmed ? new Date(dateOnly ? `${trimmed.slice(0, 10)}T12:00:00Z` : trimmed) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { key: 'unscheduled', label: 'Unscheduled', order: Number.MAX_SAFE_INTEGER };
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label, order: year * 12 + month };
}

interface GroupSessionWeek {
  key: string;
  week: number;
  sessions: CurriculumSession[];
}
interface GroupSessionMonth {
  key: string;
  label: string;
  order: number;
  count: number;
  weeks: GroupSessionWeek[];
}

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
  const groupDisplayName = cleanText(group?.name) || cleanText(searchParams.get('groupName')) || 'Group';
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
  //
  // Depends on the group's *id*, never on this effect's own state. It used to
  // list `sessionsLoading` and `sessions.length` as dependencies while also
  // setting them, which made it cancel its own request: setting the loading
  // flag re-ran the effect, whose cleanup aborted the fetch it had just
  // started; the aborted request then cleared the flag, which re-ran the
  // effect, which started another one. That was the flashing — skeleton,
  // empty, skeleton, empty — not the loading UI or the abort handling.
  // `group` is out too: it is a fresh object every time the shared
  // collections reload, and a new identity for the same group is not a reason
  // to throw away a request already in flight for it.
  const groupId = group?.id || '';
  useEffect(() => {
    if (tab !== 'sessions' || !groupId) return undefined;
    const controller = new AbortController();
    setSessionsLoading(true);
    fetchCurriculumSessions(controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setSessions(result);
        setSessionsLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSessions([]);
        setSessionsLoading(false);
      });
    return () => controller.abort();
  }, [groupId, tab]);

  const groupSessions = useMemo(() => {
    if (!group) return [];
    return sessions
      .filter(session => normaliseKey(session.groupId) === normaliseKey(group.id)
        || normaliseKey(session.group) === normaliseKey(group.name))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [group, sessions]);

  // One flat list read fine at a dozen rows; a group running a full year of
  // weekly sessions does not. Grouped Month -> Week, the same tree the
  // Programme workspace's own Sessions tab reads by, so a long-running group
  // reads as a handful of collapsible months rather than a scroll of
  // identical weekday rows.
  const sessionMonths = useMemo<GroupSessionMonth[]>(() => {
    const months = new Map<string, GroupSessionMonth>();
    groupSessions.forEach(session => {
      const bucket = sessionMonthBucket(session.date);
      let month = months.get(bucket.key);
      if (!month) {
        month = { key: bucket.key, label: bucket.label, order: bucket.order, count: 0, weeks: [] };
        months.set(bucket.key, month);
      }
      month.count += 1;
      const weekKey = String(session.week);
      let week = month.weeks.find(item => item.key === weekKey);
      if (!week) {
        week = { key: weekKey, week: session.week, sessions: [] };
        month.weeks.push(week);
      }
      week.sessions.push(session);
    });
    const result = [...months.values()].sort((a, b) => a.order - b.order);
    result.forEach(month => month.weeks.sort((a, b) => a.week - b.week));
    return result;
  }, [groupSessions]);

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
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}?tab=groups`} className="text-primary-700 hover:underline">
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

        {tab === 'sessions' && (
          sessionsLoading && !groupSessions.length ? (
            // The one loading pattern this app uses is the pulsing skeleton,
            // not a spinner — a spinner reads as a different, competing kind
            // of wait next to every other list on this page.
            <div className="space-y-2 overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
              {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-14 w-full" />)}
            </div>
          ) : !groupSessions.length ? (
            <EntityEmptyState
              icon="ri-time-line"
              title="No sessions scheduled"
              message="Sessions are generated from each module's start date, session count and delivery days."
            />
          ) : (
            <div className="space-y-3">
              {sessionMonths.map(month => (
                <GroupSessionMonthBlock key={month.key} group={month} />
              ))}
            </div>
          )
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

// --------------------------------------------------------- sessions tree
// Month -> Week -> session, cloned from the Programme workspace's own Sessions
// tab (SessionsTree.tsx). That tree also groups by Module and reads real Teams
// occurrence data (live/recorded kind, attendance, recordings) this page never
// fetches; a group's sessions are the generated weekly schedule instead, one
// module deep already, so the tree here stops at Week -> session.

function GroupSessionMonthBlock({ group }: { group: GroupSessionMonth }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm text-foreground-400`}></AppIcon>
        <AppIcon className="ri-calendar-2-line text-sm text-foreground-400"></AppIcon>
        <span className="text-[12px] font-bold uppercase tracking-wide text-foreground-600">{group.label}</span>
        <span className="ml-auto rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">{group.count}</span>
      </button>
      {open && (
        <div className="space-y-2 pl-4">
          {group.weeks.map(week => (
            <GroupSessionWeekBlock key={week.key} group={week} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupSessionWeekBlock({ group }: { group: GroupSessionWeek }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-background-200 bg-background-50">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm text-foreground-400`}></AppIcon>
        <span className="text-[12px] font-bold text-foreground-700">Week {group.week}</span>
        <span className="ml-auto rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">{group.sessions.length}</span>
      </button>
      {open && (
        <div>
          {group.sessions.map(session => (
            <GroupSessionRow key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupSessionRow({ session }: { session: CurriculumSession }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-background-200 px-4 py-2.5 first:border-t-0">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
        <AppIcon className="ri-time-line text-[11px]"></AppIcon>
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground-800">{session.title || 'Session'}</span>
      <span className="text-[11px] text-foreground-500">
        {formatDateLabel(session.date)}{session.day ? ` · ${session.day}` : ''}
      </span>
      <span className="text-[11px] text-foreground-500">
        {session.startTime ? `${session.startTime} – ${cleanText(session.endTime, '')}` : '—'}
      </span>
      <span className="text-[11px] text-foreground-500">{cleanText(session.tutor, 'Unassigned')}</span>
      <StatusBadge status={session.status} />
    </div>
  );
}
