import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import {
  fetchCurriculumModuleKsbCoverage,
  previewModuleSessionPlan,
  type CurriculumKsbCoverageResponse,
  type CurriculumModule,
  type CurriculumSessionPlanPreview,
} from '@/lib/curriculumApi';
import {
  formatCalendarDateTime,
  liveSessionNamesByNumber,
  loadModuleStructure,
  loadTeamsMeetingArtifacts,
  teamsMeetingArtifactPreviewUrl,
  weekHeadingTitle,
  weekPlacementLabel,
  zonedNaiveToUtcIso,
  type KsbMapping,
  type ModuleCatalogueItem,
  type TeamsAttendanceRecord,
  type TeamsMeetingArtifact,
  type TeamsMeetingArtifactsResult,
} from '../module-builder/moduleAuthoringData';
import { getComponentDefinition } from '../module-builder/componentAuthoringModel';
import {
  cleanText,
  findModule,
  formatDateLabel,
  formatDateTimeLabel,
  moduleIdentity,
  namedCurriculumWorkspacePath,
  normaliseKey,
  programmeIdentity,
  resolveModuleContext,
  scheduleLabel,
  visibleNotes,
} from '../shared/entities/model';
import { ModuleFormDrawer } from '../shared/entities/moduleForm';
import { ScopeAchievementPanel } from '../shared/entities/scopeAchievement';
import { buildHolidayShiftPlan, CompactSchedulePreview } from '../shared/entities/sessionShiftPreview';
import {
  DetailRow,
  EntityEmptyState,
  InlineError,
  ParentBadge,
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

type Tab = 'overview' | 'schedule' | 'components' | 'ksbs' | 'achievement';

// The same categorical palette the Week Builder authors components with
// (driven by each type's own `tone` in the authoring model) — a component
// reads as the same kind of learning here as it does where it was built,
// instead of every type collapsing into one grey "TYPE" tag.
const COMPONENT_TONE: Record<string, { chip: string; icon: string; accent: string }> = {
  violet: { chip: 'bg-violet-50 text-violet-700', icon: 'text-violet-500', accent: 'border-l-violet-400' },
  slate: { chip: 'bg-slate-50 text-slate-700', icon: 'text-slate-500', accent: 'border-l-slate-300' },
  rose: { chip: 'bg-rose-50 text-rose-700', icon: 'text-rose-500', accent: 'border-l-rose-400' },
  amber: { chip: 'bg-amber-50 text-amber-700', icon: 'text-amber-500', accent: 'border-l-amber-400' },
  emerald: { chip: 'bg-emerald-50 text-emerald-700', icon: 'text-emerald-500', accent: 'border-l-emerald-400' },
  orange: { chip: 'bg-orange-50 text-orange-700', icon: 'text-orange-500', accent: 'border-l-orange-400' },
  sky: { chip: 'bg-sky-50 text-sky-700', icon: 'text-sky-500', accent: 'border-l-sky-400' },
  purple: { chip: 'bg-purple-50 text-purple-700', icon: 'text-purple-500', accent: 'border-l-purple-400' },
  teal: { chip: 'bg-teal-50 text-teal-700', icon: 'text-teal-500', accent: 'border-l-teal-400' },
  blue: { chip: 'bg-blue-50 text-blue-700', icon: 'text-blue-500', accent: 'border-l-blue-400' },
  pink: { chip: 'bg-pink-50 text-pink-700', icon: 'text-pink-500', accent: 'border-l-pink-400' },
};
function componentTone(type: string) {
  return COMPONENT_TONE[getComponentDefinition(type).tone] || COMPONENT_TONE.slate;
}

function moduleBuilderUrl(catalogueId: string, programmeId: string, programmeName = '') {
  const params = new URLSearchParams();
  if (catalogueId) params.set('module', catalogueId);
  if (programmeId) params.set('programme', programmeId);
  if (programmeName) params.set('programmeName', programmeName);
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

  // 'teams' was folded into 'schedule' — old links and bookmarks may still carry it.
  const rawInitialTab = searchParams.get('tab');
  const initialTab = (rawInitialTab === 'teams' ? 'schedule' : (rawInitialTab as Tab)) || 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [structure, setStructure] = useState<ModuleCatalogueItem | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureLoading, setStructureLoading] = useState(true);
  // Weeks start collapsed — the page opens as a scannable list of week
  // headers, and a reader opts into a week's detail rather than scrolling past
  // every component to find it.
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(() => new Set());
  // Applied once per module load, not on every structure refetch — so
  // re-authoring a component and coming back does not re-collapse a week the
  // reader had deliberately opened.
  const collapsedWeeksInitRef = useRef('');

  // Editing a module is the shared module form's job, here as everywhere else:
  // this page opens it, it does not hold a second copy of those fields.
  const [moduleDrawerOpen, setModuleDrawerOpen] = useState(false);
  const overviewModule = useMemo(() => findModule(modules, id), [id, modules]);
  /**
   * The overview carries only the modules a delivery row uses, so a module that
   * is authored but not attached to a group yet is not in it — and this page
   * answered "module not found" for one whose structure it had already loaded
   * and was about to draw. The structure endpoint resolves the catalogue id on
   * its own, so it stands in as the record when the overview has none: the
   * module reads as unlinked, which is what it is, rather than as missing.
   */
  const structureModule = useMemo<CurriculumModule | undefined>(() => {
    if (!structure) return undefined;
    if (structure.sourceModule) return structure.sourceModule;
    const catalogueId = cleanText(structure.catalogueId) || cleanText(structure.id);
    return {
      id: catalogueId,
      moduleCatalogueId: catalogueId,
      catalogueId,
      sourceId: cleanText(structure.sourceId) || catalogueId,
      name: cleanText(structure.title),
      programmeId: cleanText(structure.programmeId),
      programme: cleanText(structure.programmeName),
      cohortId: cleanText(structure.cohortId),
      cohort: cleanText(structure.cohort),
      groupId: cleanText(structure.groupId),
      group: cleanText(structure.group),
      isProgrammeDeleted: structure.isProgrammeDeleted,
      weeks: structure.weeks || 0,
      sessionsNumber: structure.sessionsNumber,
      startDate: cleanText(structure.startDate),
      endDate: cleanText(structure.endDate),
      ksbCount: structure.ksbCount || 0,
      ksbProfileSourceId: structure.ksbProfileSourceId,
      lessons: structure.lessonCount || 0,
      quizzes: structure.quizCount || 0,
      assignments: 0,
      status: structure.status,
      authoringStatus: structure.authoringStatus,
      tutor: cleanText(structure.tutor),
      coach: cleanText(structure.coach),
      author: '',
      lastUpdated: '',
      color: cleanText(structure.color),
      notes: '',
      sessionNames: [],
      ksbCodes: [],
    };
  }, [structure]);
  const module = overviewModule || structureModule;
  const moduleDisplayName = cleanText(module?.name)
    || cleanText(structure?.title)
    || cleanText(searchParams.get('moduleName'))
    || 'Module';
  const catalogueId = useMemo(
    () => (module ? moduleIdentity(module) : cleanText(id)),
    [id, module],
  );
  const context = useMemo(
    () => (module ? resolveModuleContext(module, groups, cohorts, programmes) : null),
    [cohorts, groups, module, programmes],
  );
  const cohort = context?.cohort;

  // The compact overview `groups` comes from is cached, and a create can land on
  // a different backend worker than the one that serves this page's very next
  // load — that worker's cache still predates the write, so the group the module
  // was just attached to fails to resolve here. Before believing the module is
  // really unattached, force one uncached reload — the module's own groupId
  // (read straight off the record, not the cache) says whether that is worth doing.
  const [retriedUnlinkedModule, setRetriedUnlinkedModule] = useState(false);
  useEffect(() => {
    setRetriedUnlinkedModule(false);
  }, [id]);
  useEffect(() => {
    if (loading || !loaded || retriedUnlinkedModule) return;
    if (context && !context.linked && cleanText(module?.groupId)) {
      setRetriedUnlinkedModule(true);
      void reload({ skipCache: true });
    }
  }, [context, loaded, loading, module, reload, retriedUnlinkedModule]);

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
  // Which meeting rows have their attendance and recording opened. Folded away
  // by default: most dates have neither, and a block per date saying so twice
  // was the bulk of what this tab used to print.
  const [openMeetings, setOpenMeetings] = useState<Set<string>>(() => new Set());
  const toggleMeeting = useCallback((key: string) => {
    setOpenMeetings(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

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

  useEffect(() => {
    if (tab !== 'schedule') return undefined;
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

  // -------------------------------------------------------- Teams meeting

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

  useEffect(() => {
    const liveSessionId = teamsSummary?.liveSessionId || '';
    if (tab !== 'schedule' || !liveSessionId || teamsRequestedRef.current === liveSessionId) return;
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
  // One row per session, and the date printed once. The Teams calendar's own
  // copy of that date said the same thing underneath it, and the attendance
  // list further down said it a third time; what the calendar actually adds to
  // a row is its status, how many people turned up, and — folded away until
  // asked for — who they were and what was recorded.
  // What is taught on each of those dates, from the weeks this page has already
  // read for its Components tab. The plan preview supplies the dates and knows
  // nothing about this module, so the names are matched to it by session number.
  const sessionNames = useMemo(() => liveSessionNamesByNumber(structure), [structure]);
  const scheduleOccurrences = useMemo(() => (plan?.sessions || []).map((session, index) => {
    const sessionNumber = session.sessionNumber || index + 1;
    const occurrence = teamsOccurrenceFor(sessionNumber, index);
    const attendance = occurrence?.attendance || [];
    const artifacts = occurrence?.artifacts || [];
    const attended = occurrence ? (occurrence.participant_count || attendance.length || 0) : 0;
    const detailKey = cleanText(occurrence?.id);
    const hasDetail = Boolean(detailKey && (attendance.length || artifacts.length));
    const open = hasDetail && openMeetings.has(detailKey);
    return {
      session,
      name: sessionNames[sessionNumber - 1] || '',
      plannedUtc: plannedOccurrences[index]?.startDateTimeUtc || '',
      durationMinutes: sessionDurationMinutes,
      shift: scheduleShiftPlan.shifts[index],
      actions: teamsSummary ? (
        <>
          {occurrence ? (
            <MeetingChip status={cleanText(occurrence.status, 'scheduled')} attended={attended} />
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              {teamsLoading ? 'Loading…' : 'Not on the calendar'}
            </span>
          )}
          {hasDetail && (
            <button
              type="button"
              onClick={() => toggleMeeting(detailKey)}
              aria-expanded={open}
              className="inline-flex h-6 items-center gap-1 rounded-lg border border-background-200 bg-background-0 px-2 text-[10px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
            >
              <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xs`}></AppIcon>
              {open ? 'Hide detail' : 'Attendance & recording'}
            </button>
          )}
        </>
      ) : undefined,
      extra: open ? (
        <MeetingRecord
          liveSessionId={cleanText(teamsSummary?.liveSessionId)}
          attendance={attendance}
          artifacts={artifacts}
        />
      ) : undefined,
    };
  }), [openMeetings, plan, plannedOccurrences, scheduleShiftPlan, sessionDurationMinutes, sessionNames, teamsLoading, teamsOccurrenceFor, teamsSummary, toggleMeeting]);

  // Not found only once both readings have come back empty: the overview knows
  // nothing about an unattached module, and the structure is what settles it.
  if (!loading && loaded && !structureLoading && !module) {
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

  useEffect(() => {
    if (!catalogueId || !weekStructure.length || collapsedWeeksInitRef.current === catalogueId) return;
    collapsedWeeksInitRef.current = catalogueId;
    setCollapsedWeeks(new Set(weekStructure.map(week => week.id)));
  }, [catalogueId, weekStructure]);
  const componentCount = weekStructure.reduce((sum, week) => sum + (week.components?.length || 0), 0);
  const totalOtjh = structure?.totalOtjh ?? 0;

  // Each week runs its own live session, one per session number -- so the plan
  // preview built for the Schedule tab is also where a week's date lives. See
  // "Every week gets its own live session" for why that pairing holds.
  const weekDateByNumber = new Map<number, string>();
  (plan?.sessions || []).forEach(session => {
    if (session.sessionNumber) weekDateByNumber.set(session.sessionNumber, session.date);
  });
  const weekMonthGroups: Array<{ key: string; label: string; weeks: typeof weekStructure }> = [];
  weekStructure.forEach(week => {
    const date = weekDateByNumber.get(week.weekNumber) || '';
    const key = date ? date.slice(0, 7) : '';
    const current = weekMonthGroups[weekMonthGroups.length - 1];
    if (current && current.key === key) { current.weeks.push(week); return; }
    const label = key
      ? new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : 'Date not yet scheduled';
    weekMonthGroups.push({ key, label, weeks: [week] });
  });
  const allKsbMappings = structure ? allStructureKsbMappings(structure) : [];
  const ksbMappingCount = allKsbMappings.length || structure?.ksbCount || module?.ksbCount || 0;

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
    { key: 'schedule', label: 'Schedule & Teams meeting', icon: 'ri-calendar-line' },
    { key: 'components', label: 'Weeks & Components', icon: 'ri-layout-4-line', count: componentCount },
    { key: 'ksbs', label: 'KSBs', icon: 'ri-node-tree', count: ksbMappingCount },
    { key: 'achievement', label: 'Achievement KSBs', icon: 'ri-medal-line' },
  ];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={moduleDisplayName}
      pageSubtitle={context ? `${context.programmeName} / ${context.cohortName} / ${context.groupName}` : 'Loading module'}
      breadcrumbCurrentLabel={`Modules — ${moduleDisplayName}`}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <WorkspaceHeader
          breadcrumbs={[
            { label: 'Curriculum', href: '/workspace/curriculum' },
            { label: 'Module Builder', href: '/curriculum/module-builder' },
            ...(context?.groupId ? [{ label: context.groupName, href: namedCurriculumWorkspacePath('groups', context.groupId, context.groupName) }] : []),
            { label: moduleDisplayName },
          ]}
          eyebrow="Module"
          title={moduleDisplayName}
          subtitle={context ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-foreground-400">in Group</span>
              <ParentBadge
                tone="group"
                label={context.groupName}
                href={context.groupId
                  ? namedCurriculumWorkspacePath('groups', context.groupId, context.groupName)
                  : undefined}
              />
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
                href={context.programme
                  ? `/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}?tab=modules`
                  : undefined}
              />
            </span>
          ) : ''}
          accentColor={module?.color}
          dense
          stats={[
            { icon: 'ri-presentation-line', label: 'Tutor', value: cleanText(module?.tutor, 'Unassigned') },
            // Weeks and Sessions are different numbers: a group delivering Mon
            // and Thu runs two sessions a week, so sessions is weeks times the
            // delivery days. Shown together because Weeks is what the Components
            // tab is organised by, and one figure standing alone was being read
            // as both. Counted off the authored weeks when they have loaded, and
            // off the module row until then.
            { icon: 'ri-calendar-2-line', label: 'Weeks', value: weekStructure.length || module?.weeks || 0 },
            { icon: 'ri-broadcast-line', label: 'Sessions', value: module?.sessionsNumber || 0 },
            // Why every date below is a Tuesday. The slot belongs to the group,
            // so this is the group's -- the same label the Group workspace shows
            // -- and it is read-only here, as Edit module has no such field.
            {
              icon: 'ri-calendar-schedule-line',
              label: 'Delivery',
              value: context?.group ? scheduleLabel(context.group) : 'No group linked',
            },
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

        {context && !context.linked && (!cleanText(module?.groupId) || retriedUnlinkedModule) && (
          <InlineError message="This module is not attached to a group, so it will not appear under a programme or cohort. Attach it from the Modules page." />
        )}

        <WorkspaceTabs tabs={tabs} active={tab} onChange={key => setTab(key as Tab)} />

        {/* ------------------------------------------------------- Overview */}
        {tab === 'overview' && (
          <div className="grid gap-5 xl:grid-cols-2">
            <WorkspacePanel title="Delivery context" description="Derived through this module's group — the only parent it has.">
              {/* Modules, not Overview: this link is walked back up from a
                  module, so the tab that lists the programme's modules is where
                  the reader was. */}
              <DetailRow
                label="Programme"
                value={context?.programme ? (
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}?tab=modules`} className="text-primary-700 hover:underline">
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
                  <Link to={namedCurriculumWorkspacePath('groups', context.groupId, context.groupName)} className="text-primary-700 hover:underline">
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

        {/* ---------------------------------------------- Schedule & Teams */}
        {/* One list of dates, and one card about the calendar those dates are
            on. The tab used to print every date three times — once on the
            session row, again as the Teams calendar's copy of it underneath,
            and a third time as a per-meeting attendance block — plus a join
            link on every row that opened the same meeting. */}
        {tab === 'schedule' && (
          <div className="space-y-5">
            {teamsError && <InlineError message={teamsError} />}

            {/* The series, stated once: only what is true of the whole
                calendar — who runs it, how it repeats, where the next one is
                and whether it still sits on the plan's dates. Every date it
                holds is a row of the schedule below. */}
            <div className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50">
                    <AppIcon className="ri-microsoft-teams-line text-lg text-violet-600"></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-heading font-bold text-foreground-900">
                      Teams meeting
                      {teamsSummary && <StatusBadge status={teamsSummary.status} />}
                    </p>
                    <p className="truncate text-[11px] font-semibold text-foreground-500">
                      {teamsSummary
                        ? `${cleanText(teamsSummary.repeatPattern, 'One meeting')} · ${cleanText(teamsSummary.organizerEmail, 'no organizer recorded')}`
                        : 'Read-only here — the Teams Meetings page owns every calendar action.'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {teamsSummary?.joinUrl && (
                    <a
                      href={teamsSummary.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 transition-smooth hover:bg-primary-100"
                    >
                      <AppIcon className="ri-external-link-line text-sm"></AppIcon>
                      Open in Teams
                    </a>
                  )}
                  <Link
                    to={`/curriculum/teams-meetings?module=${encodeURIComponent(catalogueId)}`}
                    title="Open this module on the Teams Meetings page, where the calendar is created, sent the session dates and synced."
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                  >
                    <AppIcon className="ri-settings-3-line text-sm"></AppIcon>
                    Manage on Teams Meetings
                  </Link>
                </div>
              </div>
              <div className="border-t border-background-200 bg-background-100/40 px-4 py-2.5">
                {teamsSummary ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <TeamsFact
                      label="Next meeting"
                      value={teamsSummary.nextOccurrence ? formatDateTimeLabel(teamsSummary.nextOccurrence) : 'None upcoming'}
                    />
                    <TeamsFact
                      label="On the plan's dates"
                      value={teamsLoading ? 'Checking…' : teamsDatesMatch ? 'Yes' : 'No'}
                      tone={teamsLoading ? undefined : teamsDatesMatch ? 'emerald' : 'rose'}
                    />
                    {!teamsLoading && !teamsDatesMatch && (
                      <span className="text-[11px] font-semibold text-rose-700">
                        The Teams calendar is not on these dates yet — send them from the Teams Meetings page.
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-foreground-500">
                    {planLoading && !plannedOccurrences.length && 'Reading this module’s generated session dates…'}
                    {!planLoading && !plannedOccurrences.length && 'No Teams calendar yet, and no session dates to put on one. Set the start date, the weeks and the delivery day with Edit module first.'}
                    {Boolean(plannedOccurrences.length) && `No Teams calendar yet. Create one on the Teams Meetings page: it puts a meeting on each of the ${plannedOccurrences.length} session date${plannedOccurrences.length === 1 ? '' : 's'} below, holiday shifts included, and writes the join link into this module’s live-session components.`}
                  </p>
                )}
              </div>
            </div>

            <WorkspacePanel
              title="Session schedule"
              description={`Generated from the module's saved plan — ${scheduleSessions} session${scheduleSessions === 1 ? '' : 's'} from ${scheduleStartDate ? formatDateLabel(scheduleStartDate) : 'a start date that is not set yet'}${scheduleWeekDays ? ` on ${scheduleWeekDays}` : ''}. Change the dates with Edit module.`}
            >
              {planLoading && <p className="text-[12px] text-foreground-400">Recalculating…</p>}
              {!planLoading && !plan && (
                <p className="text-[12px] text-foreground-500">
                  This module has no start date or delivery day yet, so there are no session dates to generate. Set them with Edit module.
                </p>
              )}
              {plan && (
                <>
                  {/* Session length is stated here rather than on every row:
                      every generated session runs for the group's own delivery
                      window, so "120 min" repeated down twenty rows is not a
                      fact anyone reads. */}
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ScheduleStat icon="ri-calendar-check-line" tone="blue" label="Sessions" value={plan.sessions.length} />
                    <ScheduleStat icon="ri-time-line" tone="teal" label="Each session" value={`${sessionDurationMinutes} min`} />
                    <ScheduleStat icon="ri-flag-line" tone="violet" label="Final session" value={formatDateLabel(plan.finalEndDate)} />
                    <ScheduleStat icon="ri-sun-line" tone="amber" label="Holidays skipped" value={plan.skippedHolidays.length} />
                  </div>
                  {plan.warnings?.map(warning => (
                    <p key={warning} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
                      {warning}
                    </p>
                  ))}

                  {/* The same month-grouped timeline as the Teams Meetings
                      page: a red "shifted to replacement" card next to the
                      green delivered date, and — while a Teams calendar
                      exists — that meeting's own status on the row itself. */}
                  <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
                    <CompactSchedulePreview
                      occurrences={scheduleOccurrences}
                      formatLabel={(plannedUtc, date) => (plannedUtc ? formatCalendarDateTime(plannedUtc) : formatDateLabel(date))}
                      showDuration={false}
                    />
                  </div>
                  {teamsSummary && (
                    <p className="mt-3 text-[11px] text-foreground-400">
                      Attendance and a recording open on a session once its meeting has run and been fetched from the Teams Meetings page.
                    </p>
                  )}
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
              <>
                <button
                  type="button"
                  onClick={() => setCollapsedWeeks(new Set())}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-expand-up-down-line text-sm"></AppIcon>
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsedWeeks(new Set(weekStructure.map(week => week.id)))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-contract-up-down-line text-sm"></AppIcon>
                  Collapse all
                </button>
                <Link
                  to={moduleBuilderUrl(catalogueId, context?.programmeId || '', context?.programmeName || '')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-edit-line text-sm"></AppIcon>
                  Edit components
                </Link>
              </>
            )}
          >
            {structureLoading && <p className="text-[12px] text-foreground-400">Loading module structure…</p>}
            {!structureLoading && structureError && <InlineError message={structureError} onRetry={() => void loadStructure()} />}
            {!structureLoading && !structureError && !weekStructure.length && (
              <p className="text-[12px] text-foreground-500">No weeks have been authored for this module yet.</p>
            )}
            <div className="space-y-8">
              {weekMonthGroups.map(group => (
                <div key={group.key || 'unscheduled'}>
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-foreground-400">
                    {group.label}
                  </p>
                  <div className="space-y-6">
                    {group.weeks.map(week => {
                      const components = week.components || [];
                      const weekOtjh = components.reduce((sum, component) => sum + (component.expectedOtjh || 0), 0);
                      const isCollapsed = collapsedWeeks.has(week.id);
                      const weekDate = weekDateByNumber.get(week.weekNumber);
                      return (
                        <div key={week.id} className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
                          <button
                            type="button"
                            onClick={() => setCollapsedWeeks(previous => {
                              const next = new Set(previous);
                              if (next.has(week.id)) next.delete(week.id); else next.add(week.id);
                              return next;
                            })}
                            aria-expanded={!isCollapsed}
                            className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-background-200 bg-gradient-to-r from-primary-50/70 to-transparent px-6 py-5 text-left transition-smooth hover:from-primary-50"
                          >
                            <div className="flex min-w-0 items-center gap-3.5">
                              <AppIcon className={`ri-arrow-right-s-line shrink-0 text-base text-foreground-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}></AppIcon>
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[12px] font-extrabold text-white">
                                {week.weekNumber}
                              </span>
                              {/* The title the Module Builder holds, named the
                                  way its own rail names it: the number lives in
                                  the badge to the left, so repeating "Week N"
                                  here printed it twice -- "Week 1 · Week 1" for
                                  every week of a module nobody had retitled. */}
                              <span className="min-w-0 truncate text-[13px] font-bold text-foreground-900">
                                {weekHeadingTitle(week)}
                              </span>
                              {weekDate && (
                                <span className="shrink-0 text-[11px] font-semibold text-foreground-400">
                                  {formatDateLabel(weekDate)}
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-background-100 px-3.5 py-1.5 text-[11px] font-bold text-foreground-600">
                                <AppIcon className="ri-stack-line text-[13px] text-foreground-400"></AppIcon>
                                {components.length} component{components.length === 1 ? '' : 's'}
                              </span>
                              {weekOtjh > 0 && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3.5 py-1.5 text-[11px] font-bold text-primary-700">
                                  <AppIcon className="ri-time-line text-[13px]"></AppIcon>
                                  {weekOtjh}h OTJH
                                </span>
                              )}
                            </div>
                          </button>
                          {!isCollapsed && (
                            components.length ? (
                              // Each component is its own card with air around it,
                              // rather than a row in a hairline-divided stack: a week
                              // of twenty reads as twenty things instead of one wall.
                              <ul className="space-y-2.5 p-4">
                                {components.map(component => {
                                  const definition = getComponentDefinition(component.type);
                                  const tone = componentTone(component.type);
                                  return (
                                    <li
                                      key={component.id}
                                      className={`flex items-center gap-4 rounded-xl border border-background-200 border-l-4 bg-background-0 px-4 py-3.5 ${tone.accent}`}
                                    >
                                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}>
                                        <AppIcon className={`${definition.icon} text-[15px] ${tone.icon}`}></AppIcon>
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-semibold text-foreground-900">
                                          {component.title || 'Untitled component'}
                                        </p>
                                        <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.chip}`}>
                                          {definition.label}
                                        </span>
                                      </div>
                                      {/* KSBs and OTJH sit together, right-aligned: both are
                                          what this component counts toward, read at a glance
                                          as one group rather than one tucked under the title
                                          and the other pinned to the far edge. */}
                                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                        {(component.ksbMappings || []).length ? (
                                          component.ksbMappings.map(mapping => (
                                            <span
                                              key={mapping.id}
                                              title={mapping.description}
                                              className="inline-flex rounded-full border border-primary-100 bg-primary-50 px-1.5 py-0.5 text-[10px] font-bold text-primary-700"
                                            >
                                              {mapping.code}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-[10px] font-semibold italic text-foreground-400">No KSBs mapped</span>
                                        )}
                                        <span className="rounded-full bg-background-100 px-2.5 py-1.5 text-[11px] font-bold text-foreground-500">
                                          {component.expectedOtjh || 0}h
                                        </span>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="px-6 py-5 text-[12px] text-foreground-400">No components in this week.</p>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
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
                  to={moduleBuilderUrl(catalogueId, context?.programmeId || '', context?.programmeName || '')}
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

// A stat tile that carries the same tone identity as a component chip
// (COMPONENT_TONE), so "this is going well" / "this needs attention" reads
// as color the moment the tab opens, not just in a line of text underneath.
function ScheduleStat({ icon, tone, label, value }: { icon: string; tone: string; label: string; value: string | number }) {
  const t = COMPONENT_TONE[tone] || COMPONENT_TONE.slate;
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.chip}`}>
          <AppIcon className={`${icon} text-sm ${t.icon}`}></AppIcon>
        </span>
        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</p>
      </div>
      <p className="mt-1.5 text-lg font-heading font-bold text-foreground-950">{value}</p>
    </div>
  );
}

// One fact about the Teams series, inline. A grid of six bordered tiles for
// six short strings was most of the old card's height, and half of what it
// held — the first meeting, the number of dates — is the schedule below.
function TeamsFact({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : 'text-foreground-900';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</span>
      <span className={`text-[12px] font-semibold ${toneClass}`}>{value}</span>
    </span>
  );
}

// What the calendar has to say about one session, in one chip: its status, and
// the turnout when there was any. A meeting nobody has attended yet says
// nothing about attendance rather than "0 attended" on every future date.
function MeetingChip({ status, attended }: { status: string; attended: number }) {
  const key = normaliseKey(status);
  const tone = key === 'completed'
    ? 'bg-emerald-50 text-emerald-700'
    : key === 'cancelled'
      ? 'bg-rose-50 text-rose-700'
      : 'bg-background-100 text-foreground-600';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {status}
      {attended > 0 && (
        <span className="inline-flex items-center gap-1">
          <AppIcon className="ri-team-line text-[11px]"></AppIcon>
          {attended}
        </span>
      )}
    </span>
  );
}

// Who turned up to one meeting and what Teams kept of it, opened from that
// meeting's own row. Only ever rendered for a meeting that has one or the
// other: a block per date saying "no attendance reported yet" and "no
// transcript or recording yet" is the boilerplate this replaced.
function MeetingRecord({
  liveSessionId,
  attendance,
  artifacts,
}: {
  liveSessionId: string;
  attendance: TeamsAttendanceRecord[];
  artifacts: TeamsMeetingArtifact[];
}) {
  return (
    <div className="grid gap-4 py-1 sm:grid-cols-2">
      {attendance.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
            Attended ({attendance.length})
          </p>
          <ul className="space-y-1">
            {attendance.slice(0, 8).map(record => (
              <li key={record.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-foreground-800">{record.display_name || record.email}</span>
                <span className="shrink-0 text-foreground-400">
                  {Math.round((record.total_attendance_seconds || 0) / 60)} min
                </span>
              </li>
            ))}
          </ul>
          {attendance.length > 8 && (
            <p className="mt-1 text-foreground-400">and {attendance.length - 8} more</p>
          )}
        </div>
      )}
      {artifacts.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">Transcript &amp; recording</p>
          <ul className="space-y-1">
            {artifacts.map(artifact => (
              <li key={artifact.id}>
                <a
                  href={teamsMeetingArtifactPreviewUrl(liveSessionId, artifact.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                >
                  <AppIcon className="ri-film-line text-[12px]"></AppIcon>
                  {teamsArtifactLabel(artifact.artifact_type)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function allStructureKsbMappings(module: ModuleCatalogueItem): Array<{ mapping: KsbMapping; placement: string }> {
  const rows: Array<{ mapping: KsbMapping; placement: string }> = [];
  (module.moduleKsbMappings || []).forEach(mapping => rows.push({ mapping, placement: 'Module level' }));
  (module.weekStructure || []).forEach(week => {
    // Running text with no number badge beside it, so the number is spelled out
    // here -- and the title only appended when it says more than the number.
    const weekLabel = weekPlacementLabel(week);
    (week.ksbMappings || []).forEach(mapping => rows.push({ mapping, placement: weekLabel }));
    (week.components || []).forEach(component => {
      const componentLabel = component.title || 'Untitled component';
      (component.ksbMappings || []).forEach(mapping => rows.push({ mapping, placement: `${weekLabel} / ${componentLabel}` }));
    });
  });
  return rows;
}
