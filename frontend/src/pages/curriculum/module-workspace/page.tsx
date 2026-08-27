import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import {
  fetchCurriculumModuleKsbCoverage,
  previewModuleSessionPlan,
  type CurriculumKsbCoverageResponse,
  type CurriculumSessionPlanPreview,
} from '@/lib/curriculumApi';
import {
  formatCalendarDateTime,
  loadModuleStructure,
  loadTeamsMeetingArtifacts,
  teamsMeetingArtifactPreviewUrl,
  zonedNaiveToUtcIso,
  type KsbMapping,
  type ModuleCatalogueItem,
  type TeamsMeetingArtifactsResult,
} from '../module-builder/moduleAuthoringData';
import {
  cleanText,
  findModule,
  formatDateLabel,
  formatDateTimeLabel,
  moduleIdentity,
  normaliseKey,
  programmeIdentity,
  resolveModuleContext,
  visibleNotes,
} from '../shared/entities/model';
import { ModuleFormDrawer } from '../shared/entities/moduleForm';
import { ScopeAchievementPanel } from '../shared/entities/scopeAchievement';
import { buildHolidayShiftPlan, CompactSchedulePreview } from '../shared/entities/sessionShiftPreview';
import {
  DetailRow,
  EntityEmptyState,
  InlineError,
  StatusBadge,
  WorkspaceHeader,
  WorkspacePanel,
  WorkspaceTabs,
} from '../shared/entities/ui';
import { AppIcon } from '@/components/feature/AppIcon';

// ============================================================================
// The Module workspace.
//
// Module management was the reason the wizard stopped scaling: one step held
// scheduling, tutors, Teams meetings, holidays, sessions, linked modules and
// attendance sync. Here each of those is a tab of a full page instead.
//
// None of that logic is reimplemented. The schedule preview is the backend's own
// session-plan calculation, the Teams panel reads the live-session endpoints
// through `moduleAuthoringData` and nothing more — the Teams Meetings page owns
// every calendar action — component authoring stays in the Module Builder, and
// every save goes through the canonical module endpoint, which is what keeps the
// tutor-assignment notification firing.
// ============================================================================

type Tab = 'overview' | 'schedule' | 'components' | 'ksbs' | 'achievement' | 'teams';

function moduleBuilderUrl(catalogueId: string, programmeId: string) {
  const params = new URLSearchParams();
  if (catalogueId) params.set('module', catalogueId);
  if (programmeId) params.set('programme', programmeId);
  const query = params.toString();
  return `/curriculum/module-builder${query ? `?${query}` : ''}`;
}

const DEFAULT_START_TIME = '09:00';
const DEFAULT_DURATION_MINUTES = 60;

/** `HH:mm`, with anything the group stored past the minute dropped. */
function clockTime(value: unknown, fallback = ''): string {
  const text = cleanText(value).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

/** The minute a UTC instant falls on, for comparing two dates for equality. */
function minuteKey(value: unknown): string {
  const instant = new Date(String(value ?? ''));
  return Number.isNaN(instant.getTime()) ? '' : instant.toISOString().slice(0, 16);
}

function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = clockTime(startTime).split(':').map(Number);
  const [endHour, endMinute] = clockTime(endTime).split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(value => !Number.isFinite(value))) return 0;
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

// Graph calls these `transcript` and `recording`; the panel spells out what the
// reader actually gets when they open the link.
function teamsArtifactLabel(artifactType: string) {
  if (artifactType === 'transcript') return 'Transcript (VTT)';
  if (artifactType === 'recording') return 'Recording (MP4)';
  return artifactType;
}

export default function ModuleWorkspacePage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    programmes, cohorts, groups, modules, tutors, holidays, teamsMeetings,
    loading, loaded, error, reload,
  } = useCurriculumEntities({ includeStaff: true, includeHolidays: true, includeTeams: true });

  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [structure, setStructure] = useState<ModuleCatalogueItem | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureLoading, setStructureLoading] = useState(true);

  // Editing a module is the shared module form's job, here as everywhere else:
  // this page opens it, it does not hold a second copy of those fields.
  const [moduleDrawerOpen, setModuleDrawerOpen] = useState(false);
  const module = useMemo(() => findModule(modules, id), [id, modules]);
  const catalogueId = useMemo(
    () => (module ? moduleIdentity(module) : cleanText(id)),
    [id, module],
  );
  const context = useMemo(
    () => (module ? resolveModuleContext(module, groups, cohorts, programmes) : null),
    [cohorts, groups, module, programmes],
  );
  const cohort = context?.cohort;

  // The three values the session dates are generated from. They are read from
  // the saved module (and its group's timetable) rather than typed here: the
  // module form is the one place they are edited.
  const scheduleStartDate = cleanText(module?.startDate) || cleanText(structure?.startDate);
  const scheduleSessions = Number(module?.sessionsNumber || structure?.sessionsNumber || 1) || 1;
  const scheduleWeekDays = cleanText(context?.group?.weekDays);

  const [plan, setPlan] = useState<CurriculumSessionPlanPreview | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [coverage, setCoverage] = useState<CurriculumKsbCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const [teams, setTeams] = useState<TeamsMeetingArtifactsResult | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  // Which module each tab has already fetched for. These are refs and not state
  // on purpose: an effect that both sets and watches its own `loading` flag
  // re-runs the moment it sets it, tears down the request it just started and
  // starts another -- a render loop that made the page visibly shake.
  const coverageRequestedRef = useRef('');
  const teamsRequestedRef = useRef('');

  const teamsSummary = useMemo(
    () => teamsMeetings.find(summary => normaliseKey(summary.moduleCatalogueId) === normaliseKey(catalogueId)),
    [catalogueId, teamsMeetings],
  );

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

  // The holidays that apply here are the ones the parent cohort selected — the
  // same set the backend uses when it generates this module's session dates.
  const cohortHolidays = useMemo(() => {
    const ids = new Set((cohort?.holidayIds || []).map(holidayId => normaliseKey(holidayId)));
    return holidays.filter(holiday => ids.has(normaliseKey(holiday.id)));
  }, [cohort, holidays]);

  // ------------------------------------------------------------- structure

  const loadStructure = useCallback(async () => {
    if (!catalogueId) return;
    setStructureLoading(true);
    try {
      const result = await loadModuleStructure(catalogueId);
      setStructure(result);
      setStructureError(result ? null : 'This module has no authored structure yet.');
    } catch (err) {
      setStructureError(err instanceof Error ? err.message : 'Unable to load the module structure.');
    } finally {
      setStructureLoading(false);
    }
  }, [catalogueId]);

  useEffect(() => { void loadStructure(); }, [loadStructure]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, tab]);

  // ------------------------------------------------------- session preview

  // The Teams tab needs the plan as much as the Schedule tab does: the generated
  // dates are exactly what its Create Teams calendar button sends.
  useEffect(() => {
    if (tab !== 'schedule' && tab !== 'teams') return undefined;
    if (!scheduleStartDate) { setPlan(null); return undefined; }
    let active = true;
    setPlanLoading(true);
    const timer = setTimeout(() => {
      previewModuleSessionPlan({
        startDate: scheduleStartDate,
        numberOfSessions: scheduleSessions,
        weekDays: scheduleWeekDays,
        holidays: cohortHolidays,
      })
        .then(result => { if (active) setPlan(result); })
        .catch(() => { if (active) setPlan(null); })
        .finally(() => { if (active) setPlanLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [cohortHolidays, scheduleSessions, scheduleStartDate, scheduleWeekDays, tab]);

  // ------------------------------------------------------------- KSBs tab

  useEffect(() => {
    if (tab !== 'ksbs' || !catalogueId || coverageRequestedRef.current === catalogueId) return;
    coverageRequestedRef.current = catalogueId;
    setCoverageLoading(true);
    fetchCurriculumModuleKsbCoverage(catalogueId, {})
      .then(result => setCoverage(result))
      // A failed request clears the marker so opening the tab again retries it,
      // rather than leaving the module stuck on an empty coverage view.
      .catch(() => { coverageRequestedRef.current = ''; setCoverage(null); })
      .finally(() => setCoverageLoading(false));
  }, [catalogueId, tab]);

  // ------------------------------------------------------------ Teams tab

  const loadTeams = useCallback(async (liveSessionId: string) => {
    if (!liveSessionId) return;
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      setTeams(await loadTeamsMeetingArtifacts(liveSessionId));
    } catch (err) {
      teamsRequestedRef.current = '';
      setTeamsError(err instanceof Error ? err.message : 'Unable to load the Teams meeting.');
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  // The Schedule tab needs the occurrences too: they are the dates Teams is
  // holding today, shown next to the dates this module generates.
  useEffect(() => {
    const liveSessionId = teamsSummary?.liveSessionId || '';
    if ((tab !== 'teams' && tab !== 'schedule') || !liveSessionId || teamsRequestedRef.current === liveSessionId) return;
    teamsRequestedRef.current = liveSessionId;
    void loadTeams(liveSessionId);
  }, [loadTeams, tab, teamsSummary]);

  // -------------------------------------------- the schedule Teams reads

  // The group owns the clock: its delivery window is the time every generated
  // session runs at, and the length of the Teams meeting put on that date.
  const sessionStartTime = clockTime(context?.group?.startTime, DEFAULT_START_TIME);
  const sessionDurationMinutes = Math.max(
    15,
    minutesBetween(context?.group?.startTime as string, context?.group?.endTime as string)
      || teamsSummary?.durationMinutes
      || DEFAULT_DURATION_MINUTES,
  );

  /** The generated dates as the UTC instants a Teams calendar would hold them at. */
  const plannedOccurrences = useMemo(
    () => (plan?.sessions || []).map((session, index) => ({
      sessionNumber: session.sessionNumber || index + 1,
      startDateTimeUtc: zonedNaiveToUtcIso(`${session.date}T${sessionStartTime}`),
      durationMinutes: sessionDurationMinutes,
    })),
    [plan, sessionDurationMinutes, sessionStartTime],
  );

  /** What Teams holds today, session number first and position as the fallback. */
  const teamsOccurrenceFor = useCallback((sessionNumber: number, index: number) => {
    const occurrences = teams?.occurrences || [];
    return occurrences.find(occurrence => Number(occurrence.session_number) === sessionNumber) || occurrences[index];
  }, [teams]);

  // A preview session carries the ISO dates it stepped over, not their names.
  const holidayLabelFor = useCallback((date: string) => {
    const match = cohortHolidays.find(holiday => (
      String(holiday.startDate) <= date && date <= String(holiday.endDate || holiday.startDate)
    ));
    return cleanText(match?.label);
  }, [cohortHolidays]);

  const teamsDatesMatch = useMemo(() => {
    if (!teamsSummary || !plannedOccurrences.length) return false;
    const held = teams?.occurrences || [];
    if (held.length !== plannedOccurrences.length) return false;
    return plannedOccurrences.every((occurrence, index) => (
      minuteKey(occurrence.startDateTimeUtc) === minuteKey(held[index]?.scheduled_start)
    ));
  }, [plannedOccurrences, teams, teamsSummary]);

  // The same month-grouped "shifted to replacement" / "replacement delivered"
  // timeline the Teams Meetings page uses, so a holiday-moved date reads the
  // same way in both places.
  const scheduleShiftPlan = useMemo(
    () => buildHolidayShiftPlan(plan?.sessions || [], holidayLabelFor),
    [plan, holidayLabelFor],
  );
  const scheduleOccurrences = useMemo(() => (plan?.sessions || []).map((session, index) => {
    const sessionNumber = session.sessionNumber || index + 1;
    const occurrence = teamsOccurrenceFor(sessionNumber, index);
    return {
      session,
      plannedUtc: plannedOccurrences[index]?.startDateTimeUtc || '',
      durationMinutes: sessionDurationMinutes,
      shift: scheduleShiftPlan.shifts[index],
      extra: teamsSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {occurrence ? (
            <span>
              {formatCalendarDateTime(occurrence.scheduled_start)} · {cleanText(occurrence.status, 'scheduled')} · {occurrence.participant_count || occurrence.attendance?.length || 0} attended
            </span>
          ) : (
            <span className="text-amber-700">{teamsLoading ? 'Loading…' : 'Not on the Teams calendar'}</span>
          )}
          {teamsSummary.joinUrl && (
            <a
              href={teamsSummary.joinUrl}
              target="_blank"
              rel="noreferrer"
              className="meeting-join-action inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[10px] font-bold transition-smooth"
            >
              <AppIcon className="ri-microsoft-teams-line text-xs"></AppIcon>
              Open
            </a>
          )}
        </div>
      ) : undefined,
    };
  }), [plan, plannedOccurrences, scheduleShiftPlan, sessionDurationMinutes, teamsLoading, teamsOccurrenceFor, teamsSummary]);

  if (!loading && loaded && !module) {
    return (
      <WorkspaceShell
        role="curriculum"
        roleLabel="Curriculum Designer"
        navItems={curriculumNavItems}
        workspaceLabel="Curriculum Studio"
        pageTitle="Module not found"
        userName="Rachel Myers"
        userRole="Curriculum Designer"
      >
        <div className="p-6">
          <EntityEmptyState
            icon="ri-folder-warning-line"
            title="Module not found"
            message={`No module matches "${id}". It may have been renamed or archived.`}
          />
        </div>
      </WorkspaceShell>
    );
  }

  const weekStructure = structure?.weekStructure || [];
  const componentCount = weekStructure.reduce((sum, week) => sum + (week.components?.length || 0), 0);
  const totalOtjh = structure?.totalOtjh ?? 0;
  const allKsbMappings = structure ? allStructureKsbMappings(structure) : [];
  const ksbMappingCount = allKsbMappings.length || structure?.ksbCount || module?.ksbCount || 0;

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
    { key: 'schedule', label: 'Schedule', icon: 'ri-calendar-line' },
    { key: 'components', label: 'Components', icon: 'ri-layout-4-line', count: componentCount },
    { key: 'ksbs', label: 'KSBs', icon: 'ri-node-tree', count: ksbMappingCount },
    { key: 'achievement', label: 'Achievement', icon: 'ri-medal-line' },
    { key: 'teams', label: 'Teams meeting', icon: 'ri-vidicon-line', count: teamsSummary?.occurrenceCount },
  ];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={module?.name || 'Module'}
      pageSubtitle={context ? `${context.programmeName} / ${context.cohortName} / ${context.groupName}` : 'Loading module'}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <WorkspaceHeader
          breadcrumbs={[
            { label: 'Curriculum', href: '/workspace/curriculum' },
            { label: 'Module Builder', href: '/curriculum/module-builder' },
            ...(context?.groupId ? [{ label: context.groupName, href: `/curriculum/groups/${encodeURIComponent(context.groupId)}` }] : []),
            { label: module?.name || id },
          ]}
          eyebrow="Module"
          title={module?.name || 'Loading…'}
          subtitle={context ? `${context.programmeName} / ${context.cohortName} / ${context.groupName}` : ''}
          accentColor={module?.color}
          dense
          stats={[
            { icon: 'ri-presentation-line', label: 'Tutor', value: cleanText(module?.tutor, 'Unassigned') },
            { icon: 'ri-broadcast-line', label: 'Sessions', value: module?.sessionsNumber || 0 },
            { icon: 'ri-calendar-line', label: 'Start', value: formatDateLabel(module?.startDate) },
            { icon: 'ri-flag-line', label: 'End', value: formatDateLabel(module?.endDate) },
            { icon: 'ri-time-line', label: 'Expected OTJH', value: `${totalOtjh}h` },
            { icon: 'ri-layout-4-line', label: 'Components', value: componentCount },
          ]}
          actions={(
            <button
              type="button"
              onClick={() => setModuleDrawerOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-edit-line text-sm"></AppIcon>
              Edit module
            </button>
          )}
        />

        {context && !context.linked && (
          <InlineError message="This module is not attached to a group, so it will not appear under a programme or cohort. Attach it from the Modules page." />
        )}

        <WorkspaceTabs tabs={tabs} active={tab} onChange={key => setTab(key as Tab)} />

        {/* ------------------------------------------------------- Overview */}
        {tab === 'overview' && (
          <div className="grid gap-5 xl:grid-cols-2">
            <WorkspacePanel title="Delivery context" description="Derived through this module's group — the only parent it has.">
              <DetailRow
                label="Programme"
                value={context?.programme ? (
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}`} className="text-primary-700 hover:underline">
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
              <DetailRow
                label="Group"
                value={context?.groupId ? (
                  <Link to={`/curriculum/groups/${encodeURIComponent(context.groupId)}`} className="text-primary-700 hover:underline">
                    {context.groupName}
                  </Link>
                ) : cleanText(context?.groupName, '—')}
              />
              <DetailRow label="Coach" value={cleanText(module?.coach) || cleanText(context?.group?.coach, 'Unassigned')} />
              <DetailRow label="Tutor" value={cleanText(module?.tutor, 'Unassigned')} />
            </WorkspacePanel>

            <WorkspacePanel title="Content" description="Authored in the Module Builder; summarised here.">
              <DetailRow label="Module ID" value={<code className="text-[11px]">{catalogueId || '—'}</code>} />
              <DetailRow label="Weeks" value={weekStructure.length || module?.weeks || 0} />
              <DetailRow label="Components" value={componentCount} />
              <DetailRow label="Expected OTJH" value={`${totalOtjh}h`} />
              <DetailRow label="KSB mappings" value={ksbMappingCount} />
              <DetailRow label="Quality score" value={structure ? `${structure.qualityScore}%` : '—'} />
              {visibleNotes(module?.notes) && <DetailRow label="Notes" value={visibleNotes(module?.notes)} />}
            </WorkspacePanel>
          </div>
        )}

        {/* ------------------------------------------------------- Schedule */}
        {tab === 'schedule' && (
          <div className="space-y-5">
            <WorkspacePanel
              title="Generated session dates"
              description={`Generated from the module's saved plan — ${scheduleSessions} session${scheduleSessions === 1 ? '' : 's'} from ${scheduleStartDate ? formatDateLabel(scheduleStartDate) : 'a start date that is not set yet'}${scheduleWeekDays ? ` on ${scheduleWeekDays}` : ''} — with this cohort's holidays skipped. Change any of it with Edit module.`}
            >
              {planLoading && <p className="text-[12px] text-foreground-400">Recalculating…</p>}
              {!planLoading && !plan && (
                <p className="text-[12px] text-foreground-500">
                  This module has no start date or delivery day yet, so there are no session dates to generate. Set them with Edit module.
                </p>
              )}
              {plan && (
                <>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat label="Sessions" value={plan.sessions.length} />
                    <MiniStat label="Final session" value={formatDateLabel(plan.finalEndDate)} />
                    <MiniStat label="Holidays skipped" value={plan.skippedHolidays.length} />
                    <MiniStat
                      label="Teams calendar"
                      value={teamsSummary ? `${teams?.occurrences?.length ?? teamsSummary.occurrenceCount} meetings` : 'Not created'}
                    />
                  </div>
                  {plan.warnings?.map(warning => (
                    <p key={warning} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
                      {warning}
                    </p>
                  ))}

                  {/* What the Teams calendar holds against these dates. Every
                      Teams action lives on the Teams Meetings page, so this
                      strip only says whether the calendar is in step, and
                      points there. */}
                  <div className="mb-4 rounded-xl border border-primary-100 bg-primary-50/60 p-3">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
                          <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
                        </span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold text-foreground-900">Microsoft Teams live sessions</p>
                          {teamsSummary ? (
                            <>
                              <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground-500">
                                {cleanText(teamsSummary.organizerEmail, 'No organizer')} · {teamsSummary.occurrenceCount} meeting{teamsSummary.occurrenceCount === 1 ? '' : 's'} tracked
                              </p>
                              <p className={`mt-0.5 text-[11px] font-semibold ${teamsDatesMatch ? 'text-emerald-700' : 'text-amber-700'}`}>
                                {teamsLoading
                                  ? 'Reading the dates Teams holds…'
                                  : teamsDatesMatch
                                    ? 'The Teams calendar is on these dates.'
                                    : 'The Teams calendar is not on these dates yet — send them from the Teams Meetings page.'}
                              </p>
                            </>
                          ) : (
                            <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">
                              No Teams calendar yet. Create one on the Teams Meetings page: it puts a meeting on each date below and writes the join link into this module&apos;s live-session components.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTab('teams')}
                          title="Open the Teams meeting tab, which lists what this calendar holds."
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-background-50 px-3 text-[12px] font-bold text-primary-700 transition-smooth hover:bg-primary-50"
                        >
                          <AppIcon className="ri-vidicon-line text-sm"></AppIcon>
                          Teams meeting tab
                        </button>
                        <Link
                          to={`/curriculum/teams-meetings?module=${encodeURIComponent(catalogueId)}`}
                          title="Open this module on the Teams Meetings page, where the calendar is created, sent these dates and synced."
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                        >
                          <AppIcon className="ri-external-link-line text-sm"></AppIcon>
                          Manage on Teams Meetings
                        </Link>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-foreground-400">
                      Sending these dates, who is invited, who can present and fetching attendance all live on the{' '}
                      <Link to={`/curriculum/teams-meetings?module=${encodeURIComponent(catalogueId)}`} className="text-primary-700 hover:underline">
                        Teams Meetings page
                      </Link>. The Teams meeting tab here is read-only.
                    </p>
                  </div>

                  {/* The same month-grouped session timeline as the Teams
                      Meetings page: a red "shifted to replacement" card next
                      to the green delivered date, and — while a Teams
                      calendar exists — its status and join link underneath. */}
                  <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
                    <CompactSchedulePreview
                      occurrences={scheduleOccurrences}
                      formatLabel={(plannedUtc, date) => (plannedUtc ? formatCalendarDateTime(plannedUtc) : formatDateLabel(date))}
                    />
                  </div>
                </>
              )}
              {!cohortHolidays.length && cohort && (
                <p className="mt-4 text-[11px] text-foreground-400">
                  This cohort has no holidays selected, so no dates are skipped.
                </p>
              )}
            </WorkspacePanel>
          </div>
        )}

        {/* ----------------------------------------------------- Components */}
        {tab === 'components' && (
          <WorkspacePanel
            title="Weeks and components"
            description="Component authoring lives in the Module Builder — this is the same content, read-only."
            actions={(
              <Link
                to={moduleBuilderUrl(catalogueId, context?.programmeId || '')}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
              >
                <AppIcon className="ri-edit-line text-sm"></AppIcon>
                Edit components
              </Link>
            )}
          >
            {structureLoading && <p className="text-[12px] text-foreground-400">Loading module structure…</p>}
            {!structureLoading && structureError && <InlineError message={structureError} onRetry={() => void loadStructure()} />}
            {!structureLoading && !structureError && !weekStructure.length && (
              <p className="text-[12px] text-foreground-500">No weeks have been authored for this module yet.</p>
            )}
            <div className="space-y-3">
              {weekStructure.map(week => (
                <div key={week.id} className="overflow-hidden rounded-xl border border-background-200">
                  <div className="flex items-center justify-between gap-3 border-b border-background-200 bg-background-100/60 px-4 py-2.5">
                    <span className="min-w-0 truncate text-[13px] font-bold text-foreground-900">
                      Week {week.weekNumber}
                      {week.title ? ` · ${week.title}` : ''}
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-foreground-500">
                      {(week.components || []).length} component{(week.components || []).length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {(week.components || []).length ? (
                    <ul className="divide-y divide-background-200/70">
                      {(week.components || []).map(component => (
                        <li key={component.id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="rounded-md bg-background-100 px-2 py-1 text-[10px] font-bold uppercase text-foreground-500">
                            {String(component.type || '').replace(/[-_]/g, ' ')}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground-900">
                            {component.title || 'Untitled component'}
                          </span>
                          <span className="shrink-0 text-[11px] text-foreground-400">{component.expectedOtjh || 0}h</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-3 text-[12px] text-foreground-400">No components in this week.</p>
                  )}
                </div>
              ))}
            </div>
          </WorkspacePanel>
        )}

        {/* ----------------------------------------------------------- KSBs */}
        {tab === 'ksbs' && (
          <div className="grid gap-5 xl:grid-cols-2">
            <WorkspacePanel
              title="Module KSB mappings"
              description="Mapped in the Module Builder against the programme's KSB source."
              actions={(
                <Link
                  to={moduleBuilderUrl(catalogueId, context?.programmeId || '')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-edit-line text-sm"></AppIcon>
                  Edit mappings
                </Link>
              )}
            >
              {allKsbMappings.length ? (
                <div className="space-y-3">
                  {allKsbMappings.map(({ mapping, placement }, index) => (
                    <div key={mapping.id || `${mapping.code}-${placement}-${index}`} className="rounded-xl border border-background-200 bg-background-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          title={mapping.description}
                          className="rounded-lg border border-primary-100 bg-primary-50 px-2 py-1 text-[11px] font-bold text-primary-700"
                        >
                          {mapping.code}
                        </span>
                        <span className="text-[11px] font-semibold text-foreground-500">{placement}</span>
                        <span className="ml-auto rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">
                          {mapping.weight || 0}% {mapping.weightClass || mapping.weight_class || ''}
                        </span>
                      </div>
                      {mapping.description && <p className="mt-1 text-[11px] text-foreground-500">{mapping.description}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-foreground-500">No KSBs mapped to this module, its weeks or its components yet.</p>
              )}
            </WorkspacePanel>

            <WorkspacePanel title="Coverage" description="How much of the standard this module reaches.">
              {coverageLoading && <p className="text-[12px] text-foreground-400">Loading coverage…</p>}
              {!coverageLoading && !coverage && <p className="text-[12px] text-foreground-500">No coverage data available.</p>}
              {coverage && (
                <>
                  <DetailRow label="KSBs in source" value={coverage.summary.overall.required} />
                  <DetailRow label="Mapped by this module" value={coverage.summary.overall.mapped} />
                  <DetailRow label="Unmapped" value={coverage.summary.overall.unmapped} />
                  <DetailRow label="Knowledge" value={`${coverage.summary.knowledge.mapped} / ${coverage.summary.knowledge.required}`} />
                  <DetailRow label="Skills" value={`${coverage.summary.skills.mapped} / ${coverage.summary.skills.required}`} />
                  <DetailRow label="Behaviours" value={`${coverage.summary.behaviours.mapped} / ${coverage.summary.behaviours.required}`} />
                </>
              )}
            </WorkspacePanel>
          </div>
        )}

        {/* ---------------------------------------------------------- Teams */}
        {/* The KSBs tab above is what this module *plans*. This is what the
            learners actually earned against it. A module has no roster of its
            own: these are the learners in the group that delivers it, which the
            panel states rather than leaving to be inferred. */}
        {tab === 'achievement' && (
          <ScopeAchievementPanel
            scope="module"
            identifier={catalogueId}
            title={`Achievement in ${cleanText(module?.name, 'this module')}`}
            learnerStatus="all"
            active={tab === 'achievement'}
          />
        )}

        {tab === 'teams' && (
          <div className="space-y-5">
            {teamsError && <InlineError message={teamsError} />}
            <WorkspacePanel
              title="Teams meeting"
              description="What the Microsoft Teams calendar holds for this module, read-only: the series, its meeting dates, and the attendance, transcripts and recordings Teams has returned. Creating the calendar, sending session dates, invitations and fetching results are all done on the Teams Meetings page."
              actions={(
                <Link
                  to={`/curriculum/teams-meetings?module=${encodeURIComponent(catalogueId)}`}
                  title="Open this module on the Teams Meetings page, where the calendar is created, sent the session dates and synced."
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-external-link-line text-sm"></AppIcon>
                  Manage on Teams Meetings
                </Link>
              )}
            >
              {teamsSummary ? (
                <>
                  <DetailRow label="Status" value={<StatusBadge status={teamsSummary.status} />} />
                  <DetailRow label="Organizer" value={teamsSummary.organizerEmail || '—'} />
                  <DetailRow label="Repeats" value={teamsSummary.repeatPattern} />
                  <DetailRow label="First meeting" value={formatDateTimeLabel(teamsSummary.startDateTime)} />
                  <DetailRow label="Next meeting" value={teamsSummary.nextOccurrence ? formatDateTimeLabel(teamsSummary.nextOccurrence) : 'None upcoming'} />
                  <DetailRow label="Meeting dates" value={`${teamsSummary.occurrenceCount} (${teamsSummary.upcomingCount} upcoming)`} />
                  <DetailRow
                    label="Join link"
                    value={teamsSummary.joinUrl ? (
                      <a href={teamsSummary.joinUrl} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">Open in Teams</a>
                    ) : '—'}
                  />
                </>
              ) : (
                <p className="text-[12px] text-foreground-500">
                  {planLoading && !plannedOccurrences.length && 'Reading this module’s generated session dates…'}
                  {!planLoading && !plannedOccurrences.length && 'No Teams calendar for this module yet, and no session dates to put on one. Set the start date, the weeks and the delivery day with Edit module first — the Schedule tab lists the dates a calendar would be built from.'}
                  {Boolean(plannedOccurrences.length) && `No Teams calendar for this module yet. Create one on the Teams Meetings page: it puts a meeting on each of the ${plannedOccurrences.length} generated session date${plannedOccurrences.length === 1 ? '' : 's'}, holiday shifts included, and writes the join link into this module’s live-session components.`}
                </p>
              )}
            </WorkspacePanel>

            {teamsSummary?.liveSessionId && (
              <WorkspacePanel
                title="Attendance and recordings per meeting"
                description="One block per meeting date. Teams only fills these in after a meeting has run — fetch the latest from the Teams Meetings page."
              >
                {teamsLoading && <p className="text-[12px] text-foreground-400">Loading meeting history…</p>}
                {!teamsLoading && !teams?.occurrences?.length && (
                  <p className="text-[12px] text-foreground-500">
                    Nothing has been fetched yet. Attendance and recordings only exist once a meeting has actually run, and are pulled in from the Teams Meetings page.
                  </p>
                )}
                <div className="space-y-3">
                  {(teams?.occurrences || []).map(occurrence => (
                    <div key={occurrence.id} className="overflow-hidden rounded-xl border border-background-200">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 bg-background-100/60 px-4 py-2.5">
                        <span className="text-[13px] font-bold text-foreground-900">
                          Meeting {occurrence.session_number} · {formatDateTimeLabel(occurrence.scheduled_start)}
                        </span>
                        <span className="text-[11px] font-semibold text-foreground-500">
                          {occurrence.participant_count} participant{occurrence.participant_count === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="grid gap-4 p-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">Who attended</p>
                          {occurrence.attendance?.length ? (
                            <ul className="space-y-1">
                              {occurrence.attendance.slice(0, 8).map(record => (
                                <li key={record.id} className="flex items-center justify-between gap-2 text-[12px]">
                                  <span className="min-w-0 truncate text-foreground-800">{record.display_name || record.email}</span>
                                  <span className="shrink-0 text-foreground-400">
                                    {Math.round((record.total_attendance_seconds || 0) / 60)} min
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[12px] text-foreground-400">No attendance reported yet.</p>
                          )}
                        </div>
                        <div>
                          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">Transcript &amp; recording</p>
                          {occurrence.artifacts?.length ? (
                            <ul className="space-y-1">
                              {occurrence.artifacts.map(artifact => (
                                <li key={artifact.id} className="text-[12px]">
                                  <a
                                    href={teamsMeetingArtifactPreviewUrl(teamsSummary.liveSessionId, artifact.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary-700 hover:underline"
                                  >
                                    {teamsArtifactLabel(artifact.artifact_type)}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[12px] text-foreground-400">No transcript or recording yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </WorkspacePanel>
            )}
          </div>
        )}
      </div>

      {/* The one module form: same fields, same conflict check and same tutor
          notification as the Module Builder and the Group workspace. */}
      <ModuleFormDrawer
        open={moduleDrawerOpen}
        module={{
          id: catalogueId,
          name: cleanText(module?.name),
          programmeId: context?.programmeId || cleanText(module?.programmeId),
          programme: cleanText(context?.programmeName),
          cohortId: context?.cohortId || cleanText(module?.cohortId),
          groupId: context?.groupId || cleanText(module?.groupId),
          sessionsNumber: module?.sessionsNumber,
          weeks: module?.weeks,
          startDate: cleanText(module?.startDate),
          endDate: cleanText(module?.endDate),
          tutor: cleanText(module?.tutor),
          status: cleanText(module?.status),
          notes: visibleNotes(module?.notes),
          color: cleanText(module?.color),
        }}
        programmes={programmes}
        cohorts={cohorts}
        groups={groups}
        holidays={holidays}
        tutorNames={tutorNames}
        onClose={() => setModuleDrawerOpen(false)}
        onSaved={async () => { await Promise.all([reload({ silent: true }), loadStructure()]); }}
      />
    </WorkspaceShell>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</p>
      <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{value}</p>
    </div>
  );
}

function allStructureKsbMappings(module: ModuleCatalogueItem): Array<{ mapping: KsbMapping; placement: string }> {
  const rows: Array<{ mapping: KsbMapping; placement: string }> = [];
  (module.moduleKsbMappings || []).forEach(mapping => rows.push({ mapping, placement: 'Module level' }));
  (module.weekStructure || []).forEach(week => {
    const weekLabel = `Week ${week.weekNumber}${week.title ? ` - ${week.title}` : ''}`;
    (week.ksbMappings || []).forEach(mapping => rows.push({ mapping, placement: weekLabel }));
    (week.components || []).forEach(component => {
      const componentLabel = component.title || 'Untitled component';
      (component.ksbMappings || []).forEach(mapping => rows.push({ mapping, placement: `${weekLabel} / ${componentLabel}` }));
    });
  });
  return rows;
}
