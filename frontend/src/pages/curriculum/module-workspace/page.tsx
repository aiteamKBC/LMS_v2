import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import { TutorClashNotice } from '@/components/feature/TutorClashNotice';
import { useTutorAvailability } from '@/hooks/useTutorAvailability';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import {
  archiveCurriculumModule,
  fetchCurriculumModuleKsbCoverage,
  fetchCurriculumSessions,
  previewModuleSessionPlan,
  updateCurriculumModule,
  type CurriculumKsbCoverageResponse,
  type CurriculumSession,
  type CurriculumSessionPlanPreview,
  tutorConflictMessage,
} from '@/lib/curriculumApi';
import {
  loadModuleStructure,
  loadTeamsMeetingArtifacts,
  restoreModuleTeamsMeeting,
  syncTeamsMeetingArtifacts,
  teamsMeetingArtifactPreviewUrl,
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
} from '../shared/entities/model';
import {
  DetailRow,
  EntityDrawer,
  EntityEmptyState,
  EntityTable,
  FormField,
  InlineError,
  PlainCell,
  SelectControl,
  StackedCell,
  StatusBadge,
  TextControl,
  WeekdayControl,
  WorkspaceHeader,
  WorkspacePanel,
  WorkspaceTabs,
} from '../shared/entities/ui';
import { useDrawerState } from '../shared/entities/useDrawerState';
import { AppIcon } from '@/components/feature/AppIcon';

// ============================================================================
// The Module workspace.
//
// Module management was the reason the wizard stopped scaling: one step held
// scheduling, tutors, Teams meetings, holidays, sessions, linked modules and
// attendance sync. Here each of those is a tab of a full page instead.
//
// None of that logic is reimplemented. The schedule preview is the backend's own
// session-plan calculation, the Teams panel drives the existing live-session
// endpoints through `moduleAuthoringData`, component authoring stays in the
// Module Builder, and every save goes through the canonical module endpoint —
// which is what keeps the tutor-assignment notification firing.
// ============================================================================

type Tab = 'overview' | 'schedule' | 'components' | 'ksbs' | 'teams' | 'sessions';

const SESSION_GRID = 'grid grid-cols-[70px_120px_120px_minmax(160px,1fr)]';

interface DetailsForm {
  name: string;
  status: string;
  tutor: string;
  notes: string;
}

interface ScheduleForm {
  startDate: string;
  sessionsNumber: string;
  weekDays: string;
}

function moduleBuilderUrl(catalogueId: string, programmeId: string) {
  const params = new URLSearchParams();
  if (catalogueId) params.set('module', catalogueId);
  if (programmeId) params.set('programme', programmeId);
  const query = params.toString();
  return `/curriculum/module-builder${query ? `?${query}` : ''}`;
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
  const navigate = useNavigate();
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

  const detailsDrawer = useDrawerState<DetailsForm>({ name: '', status: 'draft', tutor: '', notes: '' });
  // Answered while the drawer is open, so a tutor who cannot take this module's
  // slot is marked in the picker rather than discovered from a refused save.
  const tutorAvailability = useTutorAvailability(
    detailsDrawer.open && catalogueId ? { moduleCatalogueId: catalogueId } : null,
  );
  const tutorVerdict = tutorAvailability.verdictFor(detailsDrawer.form.tutor);

  const [schedule, setSchedule] = useState<ScheduleForm>({ startDate: '', sessionsNumber: '1', weekDays: '' });
  const [plan, setPlan] = useState<CurriculumSessionPlanPreview | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleDirty, setScheduleDirty] = useState(false);

  const [coverage, setCoverage] = useState<CurriculumKsbCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const [teams, setTeams] = useState<TeamsMeetingArtifactsResult | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsBusy, setTeamsBusy] = useState('');
  const [teamsError, setTeamsError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<CurriculumSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Which module each tab has already fetched for. These are refs and not state
  // on purpose: an effect that both sets and watches its own `loading` flag
  // re-runs the moment it sets it, tears down the request it just started and
  // starts another -- a render loop that made the page visibly shake.
  const coverageRequestedRef = useRef('');
  const teamsRequestedRef = useRef('');
  const sessionsRequestedRef = useRef('');

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

  // Seed the schedule editor once, from whichever source has the values.
  useEffect(() => {
    if (scheduleDirty || !module) return;
    setSchedule({
      startDate: cleanText(module.startDate) || cleanText(structure?.startDate),
      sessionsNumber: String(module.sessionsNumber || structure?.sessionsNumber || 1),
      weekDays: cleanText(context?.group?.weekDays),
    });
  }, [context?.group?.weekDays, module, scheduleDirty, structure]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, tab]);

  // ------------------------------------------------------- session preview

  useEffect(() => {
    if (tab !== 'schedule' && tab !== 'sessions') return undefined;
    if (!schedule.startDate) { setPlan(null); return undefined; }
    let active = true;
    setPlanLoading(true);
    const timer = setTimeout(() => {
      previewModuleSessionPlan({
        startDate: schedule.startDate,
        numberOfSessions: Number(schedule.sessionsNumber) || 1,
        weekDays: schedule.weekDays,
        holidays: cohortHolidays,
      })
        .then(result => { if (active) setPlan(result); })
        .catch(() => { if (active) setPlan(null); })
        .finally(() => { if (active) setPlanLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [cohortHolidays, schedule.sessionsNumber, schedule.startDate, schedule.weekDays, tab]);

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

  useEffect(() => {
    const liveSessionId = teamsSummary?.liveSessionId || '';
    if (tab !== 'teams' || !liveSessionId || teamsRequestedRef.current === liveSessionId) return;
    teamsRequestedRef.current = liveSessionId;
    void loadTeams(liveSessionId);
  }, [loadTeams, tab, teamsSummary]);

  // --------------------------------------------------------- Sessions tab

  useEffect(() => {
    if (tab !== 'sessions' || !catalogueId || sessionsRequestedRef.current === catalogueId) return;
    sessionsRequestedRef.current = catalogueId;
    setSessionsLoading(true);
    fetchCurriculumSessions()
      .then(result => setSessions(result))
      .catch(() => { sessionsRequestedRef.current = ''; setSessions([]); })
      .finally(() => setSessionsLoading(false));
  }, [catalogueId, tab]);

  const moduleSessions = useMemo(() => {
    if (!catalogueId) return [];
    return sessions
      .filter(session => normaliseKey(session.moduleCatalogueId) === normaliseKey(catalogueId)
        || normaliseKey(session.moduleId) === normaliseKey(catalogueId))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [catalogueId, sessions]);

  // ------------------------------------------------------------------ save

  const saveDetails = async () => {
    const form = detailsDrawer.form;
    if (!form.name.trim()) { detailsDrawer.setError('Give the module a name.'); return; }
    detailsDrawer.setSaving(true);
    detailsDrawer.setError(null);
    try {
      await updateCurriculumModule(catalogueId, {
        name: form.name.trim(),
        status: form.status,
        tutor: form.tutor,
        notes: form.notes,
      });
      detailsDrawer.close();
      await Promise.all([reload({ silent: true }), loadStructure()]);
      await showCurriculumAlert({ title: 'Module updated', text: `${form.name.trim()} is saved.`, timer: 1800 });
    } catch (err) {
      // The tutor field on this drawer can collide with the tutor's existing
      // diary, which the backend reports as a sentence worth showing verbatim.
      detailsDrawer.setError(
        tutorConflictMessage(err) || (err instanceof Error ? err.message : 'The module could not be saved.'),
      );
    } finally {
      detailsDrawer.setSaving(false);
    }
  };

  const saveSchedule = async () => {
    setScheduleSaving(true);
    setScheduleError(null);
    try {
      await updateCurriculumModule(catalogueId, {
        startDate: schedule.startDate,
        // The end date is the backend's own holiday-adjusted final session date,
        // not a date this page worked out for itself.
        endDate: plan?.finalEndDate || undefined,
        sessionsNumber: Number(schedule.sessionsNumber) || 1,
        weekDays: schedule.weekDays,
      });
      setScheduleDirty(false);
      // Saving a schedule regenerates the stored sessions, so drop what is on
      // screen and let the Sessions tab ask for the new dates.
      sessionsRequestedRef.current = '';
      setSessions([]);
      await Promise.all([reload({ silent: true }), loadStructure()]);
      await showCurriculumAlert({
        title: 'Schedule saved',
        text: plan?.finalEndDate
          ? `Sessions run to ${formatDateLabel(plan.finalEndDate)}.`
          : 'The module schedule is saved.',
        timer: 1800,
      });
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'The schedule could not be saved.');
    } finally {
      setScheduleSaving(false);
    }
  };

  const syncTeams = async () => {
    if (!teamsSummary?.liveSessionId) return;
    setTeamsBusy('sync');
    setTeamsError(null);
    try {
      const result = await syncTeamsMeetingArtifacts(teamsSummary.liveSessionId);
      await loadTeams(teamsSummary.liveSessionId);
      await showCurriculumAlert({
        title: result.partial ? 'Some Teams data could not be fetched' : 'Attendance and recordings updated',
        text: `Saved ${result.synced.attendanceRecords} attendance records, ${result.synced.transcripts} transcripts and ${result.synced.recordings} recordings.`,
        icon: result.partial ? 'warning' : 'success',
      });
    } catch (err) {
      setTeamsError(err instanceof Error ? err.message : 'The Teams sync failed.');
    } finally {
      setTeamsBusy('');
    }
  };

  const restoreTeams = async () => {
    setTeamsBusy('restore');
    setTeamsError(null);
    try {
      const result = await restoreModuleTeamsMeeting(catalogueId);
      await Promise.all([reload({ silent: true }), loadStructure()]);
      await showCurriculumAlert({
        title: 'Meeting re-attached',
        text: `${result.updatedComponents} live-session component${result.updatedComponents === 1 ? '' : 's'} now use this meeting's join link.`,
      });
    } catch (err) {
      setTeamsError(err instanceof Error ? err.message : 'The Teams meeting could not be restored.');
    } finally {
      setTeamsBusy('');
    }
  };

  const archive = async () => {
    await showCurriculumConfirm({
      title: 'Archive module?',
      text: `${cleanText(module?.name, 'This module')} will be removed from the active curriculum. Its authored content is kept.`,
      icon: 'warning',
      confirmButtonText: 'Archive module',
      onConfirm: async () => {
        await archiveCurriculumModule(catalogueId);
        navigate('/curriculum/module-builder');
      },
    });
  };

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
  const moduleKsbs = structure?.moduleKsbMappings || [];

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
    { key: 'schedule', label: 'Schedule', icon: 'ri-calendar-line' },
    { key: 'components', label: 'Components', icon: 'ri-layout-4-line', count: componentCount },
    { key: 'ksbs', label: 'KSBs', icon: 'ri-node-tree', count: moduleKsbs.length || module?.ksbCount },
    { key: 'teams', label: 'Teams meeting', icon: 'ri-vidicon-line', count: teamsSummary?.occurrenceCount },
    { key: 'sessions', label: 'Sessions', icon: 'ri-time-line', count: moduleSessions.length || module?.sessionsNumber },
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
          stats={[
            { icon: 'ri-presentation-line', label: 'Tutor', value: cleanText(module?.tutor, 'Unassigned') },
            { icon: 'ri-broadcast-line', label: 'Sessions', value: module?.sessionsNumber || 0 },
            { icon: 'ri-calendar-line', label: 'Start', value: formatDateLabel(module?.startDate) },
            { icon: 'ri-flag-line', label: 'End', value: formatDateLabel(module?.endDate) },
            { icon: 'ri-time-line', label: 'Expected OTJH', value: `${totalOtjh}h` },
            { icon: 'ri-layout-4-line', label: 'Components', value: componentCount },
          ]}
          actions={(
            <>
              <button
                type="button"
                onClick={() => detailsDrawer.openWith({
                  name: cleanText(module?.name),
                  status: cleanText(module?.status) || 'draft',
                  tutor: normaliseKey(module?.tutor) === 'unassigned' ? '' : cleanText(module?.tutor),
                  notes: cleanText(module?.notes),
                })}
                disabled={!module}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:opacity-50"
              >
                <AppIcon className="ri-edit-line text-sm"></AppIcon>
                Edit module
              </button>
              <Link
                to={moduleBuilderUrl(catalogueId, context?.programmeId || '')}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
              >
                <AppIcon className="ri-layout-4-line text-sm"></AppIcon>
                Open in Module Builder
              </Link>
              <button
                type="button"
                onClick={() => void archive()}
                disabled={!module}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 text-[12px] font-bold text-red-600 transition-smooth hover:bg-red-100 disabled:opacity-50"
              >
                <AppIcon className="ri-archive-line text-sm"></AppIcon>
                Archive
              </button>
            </>
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
                label="Group"
                value={context?.groupId ? (
                  <Link to={`/curriculum/groups/${encodeURIComponent(context.groupId)}`} className="text-primary-700 hover:underline">
                    {context.groupName}
                  </Link>
                ) : cleanText(context?.groupName, '—')}
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
                label="Programme"
                value={context?.programme ? (
                  <Link to={`/curriculum/programmes/${encodeURIComponent(programmeIdentity(context.programme))}`} className="text-primary-700 hover:underline">
                    {context.programmeName}
                  </Link>
                ) : cleanText(context?.programmeName, '—')}
              />
              <DetailRow label="Tutor" value={cleanText(module?.tutor, 'Unassigned')} />
              <DetailRow label="Coach" value={cleanText(module?.coach) || cleanText(context?.group?.coach, 'Unassigned')} />
              <DetailRow label="Status" value={<StatusBadge status={module?.status} />} />
            </WorkspacePanel>

            <WorkspacePanel title="Content" description="Authored in the Module Builder; summarised here.">
              <DetailRow label="Module ID" value={<code className="text-[11px]">{catalogueId || '—'}</code>} />
              <DetailRow label="Weeks" value={weekStructure.length || module?.weeks || 0} />
              <DetailRow label="Components" value={componentCount} />
              <DetailRow label="Expected OTJH" value={`${totalOtjh}h`} />
              <DetailRow label="KSB mappings" value={moduleKsbs.length || module?.ksbCount || 0} />
              <DetailRow label="Quality score" value={structure ? `${structure.qualityScore}%` : '—'} />
              {module?.notes && <DetailRow label="Notes" value={module.notes} />}
            </WorkspacePanel>
          </div>
        )}

        {/* ------------------------------------------------------- Schedule */}
        {tab === 'schedule' && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
            <WorkspacePanel title="Delivery plan" description="Sessions are generated from these three values.">
              {scheduleError && <div className="mb-3"><InlineError message={scheduleError} /></div>}
              <div className="space-y-4">
                <FormField
                  label="Start date"
                  required
                  hint={cohort?.startDate ? `Cohort starts ${formatDateLabel(cohort.startDate)}` : undefined}
                >
                  <TextControl
                    type="date"
                    value={schedule.startDate}
                    onChange={value => { setScheduleDirty(true); setSchedule(prev => ({ ...prev, startDate: value })); }}
                  />
                </FormField>
                <FormField label="Number of sessions" required>
                  <TextControl
                    type="number"
                    min={1}
                    max={52}
                    value={schedule.sessionsNumber}
                    onChange={value => { setScheduleDirty(true); setSchedule(prev => ({ ...prev, sessionsNumber: value })); }}
                  />
                </FormField>
                <FormField label="Delivery days" hint="Defaults to the group's timetable.">
                  <WeekdayControl
                    value={schedule.weekDays}
                    onChange={value => { setScheduleDirty(true); setSchedule(prev => ({ ...prev, weekDays: value })); }}
                  />
                </FormField>
                <button
                  type="button"
                  onClick={() => void saveSchedule()}
                  disabled={scheduleSaving || !schedule.startDate}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {scheduleSaving && <AppIcon className="ri-loader-4-line animate-spin text-sm"></AppIcon>}
                  Save schedule
                </button>
              </div>
            </WorkspacePanel>

            <WorkspacePanel
              title="Generated session dates"
              description="Calculated by the backend, with this cohort's holidays skipped."
            >
              {planLoading && <p className="text-[12px] text-foreground-400">Recalculating…</p>}
              {!planLoading && !plan && (
                <p className="text-[12px] text-foreground-500">Set a start date and delivery days to preview the session dates.</p>
              )}
              {plan && (
                <>
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <MiniStat label="Sessions" value={plan.sessions.length} />
                    <MiniStat label="Final session" value={formatDateLabel(plan.finalEndDate)} />
                    <MiniStat label="Holidays skipped" value={plan.skippedHolidays.length} />
                  </div>
                  {plan.warnings?.map(warning => (
                    <p key={warning} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
                      {warning}
                    </p>
                  ))}
                  <ol className="space-y-1.5">
                    {plan.sessions.map(session => (
                      <li key={session.sessionNumber} className="flex items-center gap-3 rounded-lg border border-background-200 px-3 py-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background-100 text-[11px] font-bold text-foreground-600">
                          {session.sessionNumber}
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] font-semibold text-foreground-900">
                          {formatDateLabel(session.date)}
                          <span className="ml-2 text-[11px] font-medium text-foreground-400">{session.day}</span>
                        </span>
                        {session.skippedHolidays?.length ? (
                          <span className="shrink-0 text-[11px] font-semibold text-amber-700" title={session.skippedHolidays.join(', ')}>
                            moved past {session.skippedHolidays.length} holiday{session.skippedHolidays.length === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
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
              {moduleKsbs.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {moduleKsbs.map(mapping => (
                    <span
                      key={mapping.id || `${mapping.code}-${mapping.weight}`}
                      title={mapping.description}
                      className="rounded-lg border border-primary-100 bg-primary-50 px-2 py-1 text-[11px] font-bold text-primary-700"
                    >
                      {mapping.code}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-foreground-500">No KSBs mapped at module level yet.</p>
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
        {tab === 'teams' && (
          <div className="space-y-5">
            {teamsError && <InlineError message={teamsError} />}
            <WorkspacePanel
              title="Teams meeting"
              description="The recurring Teams meeting for this module. Attendance, transcripts and recordings are pulled back from Teams once a meeting has run."
              actions={(
                <>
                  <button
                    type="button"
                    onClick={() => void syncTeams()}
                    disabled={!teamsSummary?.liveSessionId || Boolean(teamsBusy)}
                    title="Ask Microsoft Teams for the attendance, transcripts and recordings of every meeting that has already run, and save them below."
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {teamsBusy === 'sync'
                      ? <AppIcon className="ri-loader-4-line animate-spin text-sm"></AppIcon>
                      : <AppIcon className="ri-refresh-line text-sm"></AppIcon>}
                    Fetch attendance &amp; recordings
                  </button>
                  <button
                    type="button"
                    onClick={() => void restoreTeams()}
                    disabled={Boolean(teamsBusy)}
                    title="Write this meeting's join link back into the module's live-session components, for when they have lost it."
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-50"
                  >
                    {teamsBusy === 'restore'
                      ? <AppIcon className="ri-loader-4-line animate-spin text-sm"></AppIcon>
                      : <AppIcon className="ri-history-line text-sm"></AppIcon>}
                    Re-attach meeting to components
                  </button>
                </>
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
                  No Teams meeting is tracked for this module yet, so there is nothing to fetch. Create one from the
                  module&apos;s live-session component in the Module Builder and it will appear here.
                </p>
              )}
            </WorkspacePanel>

            {teamsSummary?.liveSessionId && (
              <WorkspacePanel
                title="Attendance and recordings per meeting"
                description="One block per meeting date. Teams only fills these in after a meeting has run — use Fetch attendance and recordings to pull the latest."
              >
                {teamsLoading && <p className="text-[12px] text-foreground-400">Loading meeting history…</p>}
                {!teamsLoading && !teams?.occurrences?.length && (
                  <p className="text-[12px] text-foreground-500">
                    Nothing has been fetched yet. Attendance and recordings only exist once a meeting has actually run.
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

        {/* ------------------------------------------------------- Sessions */}
        {tab === 'sessions' && (
          <div className="space-y-5">
            <EntityTable
              columns={[
                { label: '#', align: 'center' },
                { label: 'Date' },
                { label: 'Time' },
                { label: 'Tutor' },
              ]}
              gridClass={SESSION_GRID}
              rows={moduleSessions}
              rowKey={session => session.id}
              loading={sessionsLoading}
              empty={(
                <EntityEmptyState
                  icon="ri-time-line"
                  title="No scheduled sessions stored"
                  message="The Schedule tab shows the dates this module's sessions will fall on."
                />
              )}
              renderRow={session => (
                <>
                  <PlainCell align="center">{session.week || '—'}</PlainCell>
                  <PlainCell>{formatDateLabel(session.date)}</PlainCell>
                  <PlainCell>{session.startTime ? `${session.startTime} – ${cleanText(session.endTime, '')}` : '—'}</PlainCell>
                  <StackedCell
                    primary={cleanText(session.tutor, 'Unassigned')}
                    secondary={session.skippedHolidays?.length ? `Skipped: ${session.skippedHolidays.join(', ')}` : undefined}
                  />
                </>
              )}
            />
          </div>
        )}
      </div>

      <EntityDrawer
        open={detailsDrawer.open}
        title="Edit module"
        subtitle="Changing the tutor here updates their profile and raises the assignment notification, exactly as the wizard did."
        onClose={detailsDrawer.close}
        onSubmit={saveDetails}
        submitLabel="Save module"
        saving={detailsDrawer.saving}
        error={detailsDrawer.error}
        dirty={detailsDrawer.dirty}
      >
        <FormField label="Module name" required>
          <TextControl value={detailsDrawer.form.name} onChange={value => detailsDrawer.patch({ name: value })} />
        </FormField>
        <FormField
          label="Tutor"
          hint={tutorAvailability.loading
            ? 'Checking who is free in this slot...'
            : tutorAvailability.bookable
              ? `${tutorAvailability.sessionDates.length} session${tutorAvailability.sessionDates.length === 1 ? '' : 's'} in this slot. Busy tutors are marked.`
              : undefined}
        >
          {/* Busy names stay selectable: the save is still the authority, and a
              clash can be deliberate. Marking beats hiding. */}
          <SelectControl
            value={detailsDrawer.form.tutor}
            onChange={value => detailsDrawer.patch({ tutor: value })}
            options={tutorNames.map(name => ({
              value: name,
              label: tutorAvailability.verdictFor(name)?.available === false ? `${name} — busy in this slot` : name,
            }))}
            placeholder="Unassigned"
          />
        </FormField>
        {tutorVerdict && !tutorVerdict.available && <TutorClashNotice verdict={tutorVerdict} />}
        <FormField label="Status">
          <SelectControl
            value={detailsDrawer.form.status}
            onChange={value => detailsDrawer.patch({ status: value })}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'review', label: 'Review' },
              { value: 'published', label: 'Published' },
            ]}
          />
        </FormField>
        <FormField label="Notes">
          <TextControl value={detailsDrawer.form.notes} onChange={value => detailsDrawer.patch({ notes: value })} placeholder="Optional delivery notes" />
        </FormField>
      </EntityDrawer>
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
