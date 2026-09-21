import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isTeamsReviewCancelled } from '../teams-meetings/calendarReview';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { finishTeamsCreation } from '../teams-meetings/creationResult';
import {
  fetchCurriculumHolidays,
  type CurriculumHoliday,
} from '@/lib/curriculumApi';
import { cleanText, formatDateLabel } from '../shared/entities/model';
import { InlineError } from '../shared/entities/ui';
import {
  buildTeamsCalendarInput,
  DEFAULT_DURATION_MINUTES,
  emptyTeamsCalendarForm,
  minutesBetween,
  sessionNaiveLocal,
  TeamsCalendarFormBody,
  type TeamsCalendarForm,
  type TeamsCalendarTarget,
} from '../teams-meetings/createCalendarForm';
import {
  createTeamsMeeting,
  ApiError,
  CurriculumRequestTimeout,
  readModuleTeamsMeeting,
  fetchModuleMeetingInvitees,
  fetchModuleSessionPlan,
  loadTeamsMeetingConfiguration,
  moduleLiveSessionDateDrift,
  moduleTeamsPlannedSessions,
  restoreModuleTeamsMeeting,
  updateTeamsMeetingSchedule,
  utcIsoToCalendarParts,
  zonedNaiveToUtcIso,
  type LiveSessionDateDrift,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleTeamsPlannedSession,
  type SavedModuleTeamsMeeting,
  type TeamsMeetingInput,
  type TeamsMeetingResult,
} from './moduleAuthoringData';

// The module the meeting is created against. Its catalogue id keys the series
// and asks for the plan, its title and placement name the dialog, and its
// authored weeks are where the session dates come from — the backend stamps each
// live-session component with its own date and clock when it serves the
// structure, so the module the builder is already holding IS the schedule.
export type TeamsMeetingModuleContext = ModuleCatalogueItem & {
  /** Placement, for the dialog's subtitle. Optional: shown when the caller has it. */
  programmeName?: string;
  cohort?: string;
  group?: string;
};

/**
 * Create or update a module's Teams calendar, from a live-session component or from the
 * module itself.
 *
 * The form itself is the Teams Meetings page's form — same dates preview, same
 * fields, same payload — because this is the same record reached from a second
 * place, not a second feature. What stays here is only what is genuinely this
 * door's own: the component that opened it, and writing the join link back into
 * that component once the meeting exists.
 *
 * `component` is optional because the Course structure rail opens the same
 * dialog for the whole module. Either way one calendar is created, on the
 * module's own dates — a component only decides which settings seed the form and
 * which day's link is handed back.
 */
export function TeamsMeetingModal({
  component,
  module,
  unsavedChanges = false,
  onClose,
  onCreated,
  onRestored,
}: {
  component?: ModuleComponent;
  module: TeamsMeetingModuleContext;
  /**
   * The module has edits that are not stored yet.
   *
   * The dates below are read off the structure on screen, so an unsaved live
   * session is listed — the dialog must not show a different module from the one
   * the reader is looking at. Creating on them is refused all the same: the
   * meetings are real, they invite real people, and the backend links each join
   * link to the module's STORED components afterwards. A session that exists
   * only in this tab cannot be linked, so Teams would end up holding a date the
   * module does not have, which is exactly the state the Teams Meetings page
   * reports as out of sync — and if the tab is closed without saving, that
   * meeting stays in real calendars with nothing behind it.
   */
  unsavedChanges?: boolean;
  onClose: () => void;
  onCreated: (result: TeamsMeetingResult, input: TeamsMeetingInput) => void;
  onRestored?: (module: ModuleCatalogueItem) => void;
}) {
  const settings = component?.settings ?? {};
  const storedEmails = (key: string) => (Array.isArray(settings[key])
    ? (settings[key] as string[]).join('\n')
    : '');
  const [form, setForm] = useState<TeamsCalendarForm>(() => ({
    ...emptyTeamsCalendarForm(),
    title: cleanText(component?.title) || cleanText(module.title) || 'Live session',
    organizerEmail: String(settings.teamsOrganizerEmail ?? ''),
    attendees: storedEmails('teamsAttendees'),
    // Presenters are a separate list, not a subset of the attendee box: Teams
    // only gives the presenter role to people named here, and everyone else
    // joins as an attendee who cannot share.
    presenters: storedEmails('teamsPresenters'),
    coOrganizers: storedEmails('teamsCoOrganizers'),
    details: String(settings.sessionPurpose ?? component?.description ?? ''),
    lobbyBypass: String(settings.teamsLobbyBypass ?? 'invited'),
    recording: String(settings.teamsRecording ?? 'record-transcribe'),
    spokenLanguage: String(settings.teamsSpokenLanguage ?? 'en-GB'),
  }));
  const patch = useCallback((value: Partial<TeamsCalendarForm>) => {
    setForm(current => ({ ...current, ...value }));
  }, []);

  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [graphConfigured, setGraphConfigured] = useState(true);
  const [graphTimeZone, setGraphTimeZone] = useState('');
  const [invitedPrefilling, setInvitedPrefilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [existingCalendar, setExistingCalendar] = useState<SavedModuleTeamsMeeting | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarLoadError, setCalendarLoadError] = useState('');
  const [calendarReadAttempt, setCalendarReadAttempt] = useState(0);
  // A module's saved schedule already knows when it runs, holiday shifts and
  // all. Those dates are the ones the calendar has to sit on — exactly as the
  // Teams Meetings page builds the series — so the meeting is created on them
  // rather than on a start date and repeat typed in here.
  const [sessions, setSessions] = useState<ModuleTeamsPlannedSession[]>([]);
  const [holidays, setHolidays] = useState<CurriculumHoliday[]>([]);
  // Until the plan answers we don't yet know whether the module has dates, so
  // the "no stored session dates" warning must wait — otherwise it flashes on
  // every open before the sessions arrive and reads as a module with no schedule.
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // Live sessions whose own date is no longer one their week delivers on. The
  // list above is built from those stored dates, so this is the last screen
  // before a meeting is booked on one — said here, and corrected on the rail.
  const [drifted, setDrifted] = useState<LiveSessionDateDrift[]>([]);

  // The module as it stood when this dialog opened. The dialog is mounted fresh
  // each time, so this is the structure the reader pressed the button on, and
  // reading it from a ref keeps a keystroke in the builder behind the dialog
  // from re-planning the dates under them.
  const openedWith = useRef(module);

  useEffect(() => {
    let active = true;
    setCalendarLoading(true);
    setCalendarLoadError('');
    readModuleTeamsMeeting(module.catalogueId).then(saved => {
      if (!active) return;
      const held = saved.meeting;
      if (!held?.teamsLiveSessionId || !held.teamsOrganizerEmail || !saved.calendar) {
        throw new Error('The saved calendar details are incomplete. Reload them before updating.');
      }
      const zone = held.sessionTimeZone;
      if (zone !== 'Africa/Cairo' && zone !== 'Europe/London') {
        throw new Error('The saved calendar time zone could not be loaded. Review it in Teams Meetings.');
      }
      if (!Array.isArray(saved.calendar.occurrences) || saved.calendar.occurrences.some(item => (
        !Number.isFinite(Date.parse(item.startDateTimeUtc)) || !Number.isInteger(item.sessionNumber) || item.sessionNumber < 1
        || !Number.isFinite(item.durationMinutes) || item.durationMinutes <= 0
      )) || (!saved.verificationPending && !saved.calendar.occurrences.length)) {
        throw new Error('The saved calendar dates could not be loaded. Review them in Teams Meetings.');
      }
      const emails = (key: string) => {
        if (!Array.isArray(held[key])) throw new Error('The saved invitation lists could not be loaded.');
        return (held[key] as string[]).join('\n');
      };
      const attendeeFields = { attendees: emails('teamsAttendees'), presenters: emails('teamsPresenters'), coOrganizers: emails('teamsCoOrganizers') };
      setExistingCalendar(saved);
      setForm(current => ({ ...current, ...attendeeFields,
        title: saved.calendar.title || module.title,
        organizerEmail: String(held.teamsOrganizerEmail),
        scheduleTimeZone: zone, seriesMode: saved.calendar.seriesMode,
        durationMinutes: '', details: '',
        lobbyBypass: String(held.teamsLobbyBypass || 'invited'),
        recording: String(held.teamsRecording || 'none'),
        spokenLanguage: String(held.teamsSpokenLanguage || 'en-GB'),
        meetingType: String(held.teamsMeetingType || 'live-session'),
      }));
    }).catch(failure => {
      if (!active) return;
      // Only a confirmed absence allows Create. A failed read must never offer
      // another calendar for a module whose saved meeting is still unknown.
      if (failure instanceof ApiError && failure.status === 404 && !component?.settings.teamsLiveSessionId) return;
      setCalendarLoadError(failure instanceof Error ? failure.message : 'Unable to load the saved Teams calendar.');
    }).finally(() => { if (active) setCalendarLoading(false); });
    return () => { active = false; };
  }, [module.catalogueId, module.title, component?.settings.teamsLiveSessionId, calendarReadAttempt]);

  useEffect(() => {
    let active = true;
    const opened = openedWith.current;
    const catalogueId = cleanText(module.catalogueId);
    if (!catalogueId) { setSessionsLoading(false); return () => { active = false; }; }
    setSessionsLoading(true);
    // This module's own plan, not the whole curriculum's session collection.
    // The collection is one row per session in every module, and reading it past
    // the cache forces the backend to rebuild the entire curriculum payload —
    // seconds of Neon round trips to find the two dates this dialog needs, with
    // no timeout, so a slow backend left this spinner up indefinitely.
    //
    // The dates themselves are unchanged: the plan is what the backend dates the
    // session collection and the Teams occurrences from, and it is the same
    // source `pushModulePlanToTeams` sends when the calendar is updated later.
    fetchModuleSessionPlan(catalogueId, opened.weekStructure?.length, { timeoutMs: 30000 })
      .then(plan => {
        if (!active) return;
        setSessions(moduleTeamsPlannedSessions(opened, plan));
        setDrifted(Array.from(moduleLiveSessionDateDrift(opened, plan).values()));
      })
      // A module the backend has never stored has no plan to read. Its authored
      // components still carry their own dates, so fall back to those rather
      // than reporting a module with a visible schedule as having none.
      .catch(() => { if (active) setSessions(moduleTeamsPlannedSessions(opened, null)); })
      .finally(() => { if (active) setSessionsLoading(false); });
    return () => { active = false; };
  }, [module.catalogueId]);

  // The holidays are only ever read to name the closure that moved a date, so a
  // failed load costs the labels and nothing else.
  useEffect(() => {
    let active = true;
    fetchCurriculumHolidays()
      .then(rows => { if (active) setHolidays(rows); })
      .catch(() => { if (active) setHolidays([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadTeamsMeetingConfiguration()
      .then(configuration => {
        if (!active) return;
        setGraphConfigured(configuration.configured);
        setGraphTimeZone(configuration.timeZone);
        // The deployment value is a starting point only. Keep a component's
        // saved organizer when present and let the user choose another mailbox.
        setForm(current => (current.organizerEmail
          ? current
          : { ...current, organizerEmail: configuration.defaultOrganizer || '' }));
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to check Microsoft Teams configuration.');
      })
      .finally(() => { if (active) setConfigurationLoading(false); });
    return () => { active = false; };
  }, []);

  /**
   * The holiday that closed one skipped date.
   *
   * A session's `skippedHolidays` are bare ISO dates, and a date alone does not
   * explain itself. The dates only ever come from a cohort's own ticked
   * selection, so any stored holiday covering one is the holiday that moved it.
   */
  const holidayLabelFor = useCallback((date: string) => {
    const day = cleanText(date);
    if (!day) return '';
    const match = holidays.find(holiday => (
      String(holiday.startDate) <= day && day <= String(holiday.endDate || holiday.startDate)
    ));
    return cleanText(match?.label);
  }, [holidays]);

  const liveComponents = (openedWith.current.weekStructure || []).flatMap(week => week.components || [])
    .filter(item => item.type === 'live-session');
  const componentTitles = new Map(liveComponents.map(item => [item.id, item.title]));
  const savedLiveComponents = (existingCalendar?.module.weekStructure || []).flatMap(week => week.components || [])
    .filter(item => item.type === 'live-session');
  const displayedSessions = existingCalendar ? existingCalendar.calendar.occurrences.map(occurrence => {
    const start = utcIsoToCalendarParts(occurrence.startDateTimeUtc, form.scheduleTimeZone);
    const end = utcIsoToCalendarParts(new Date(Date.parse(occurrence.startDateTimeUtc) + occurrence.durationMinutes * 60000).toISOString(), form.scheduleTimeZone);
    // Cancelled occurrences leave gaps in numbering. Match the saved identity,
    // never the row index, then use the title currently shown in the builder.
    const matchesOccurrence = (item: ModuleComponent) => (
      item.settings?.teamsLiveSessionId === existingCalendar.meeting.teamsLiveSessionId
      && Number(item.settings?.teamsSessionNumber) === occurrence.sessionNumber
    );
    const linked = liveComponents.find(matchesOccurrence) || savedLiveComponents.find(matchesOccurrence);
    const componentTitle = linked ? componentTitles.get(linked.id) ?? linked.title : undefined;
    return { ...occurrence, componentTitle, date: start.date, startTime: start.time, endTime: end.time, timeZone: form.scheduleTimeZone };
  }) : sessions.map(session => ({ ...session, componentTitle: componentTitles.get(session.componentId) }));
  const row: TeamsCalendarTarget = {
    catalogueId: cleanText(module.catalogueId),
    name: cleanText(component?.title) || cleanText(module.title) || 'Live session',
    sessions: displayedSessions,
    plannedStarts: existingCalendar ? existingCalendar.calendar.occurrences.map(item => item.startDateTimeUtc)
      : sessions.map(session => zonedNaiveToUtcIso(sessionNaiveLocal(session), form.scheduleTimeZone)),
    teamsStarts: existingCalendar?.calendar.occurrences.map(item => item.startDateTimeUtc) || [],
    // The module's own length, not the form's. Duration is an override applied
    // on top of these rows, so reading it back in here made the fallback follow
    // whatever the reader had just picked and the preview could never disagree
    // with the payload -- or agree with the module.
    durationMinutes: Math.max(
      15,
      existingCalendar?.calendar.occurrences[0]?.durationMinutes || minutesBetween(sessions[0]?.startTime || '', sessions[0]?.endTime || '') || DEFAULT_DURATION_MINUTES,
    ),
  };

  // Presenters/Attendees derived from the module itself: its assigned tutor as
  // presenter, every learner whose training plan carries this module as
  // attendee. Only ever a starting point — the lists stay editable afterwards.
  const prefillInvitees = async () => {
    if (!row.catalogueId) return;
    setInvitedPrefilling(true);
    try {
      const result = await fetchModuleMeetingInvitees(row.catalogueId);
      patch({ attendees: result.attendees.join('\n'), presenters: result.presenters.join('\n') });
    } catch {
      // Best-effort: the form stays usable with people typed in by hand.
    } finally {
      setInvitedPrefilling(false);
    }
  };

  const recoverLinks = async () => {
    const saved = await readModuleTeamsMeeting(row.catalogueId);
    if (saved.verificationPending) {
      throw new Error('The calendar is saved, but verification is still incomplete. Review the existing calendar in Teams Meetings, then check its links again.');
    }
    const restored = await restoreModuleTeamsMeeting(row.catalogueId);
    if (!restored.module) throw new Error('The saved component links could not be loaded.');
    onRestored?.(restored.module);
    onClose();
  };

  const submit = async () => {
    setError('');
    if (calendarLoading || calendarLoadError || existingCalendar?.verificationPending) return;
    // The button is already disabled for this, but the refusal lives here too:
    // creating the calendar writes to real calendars, so it must not depend on
    // one piece of UI state being right.
    if (unsavedChanges) {
      setError('Save the module before saving its Teams calendar. These dates are not stored yet.');
      return;
    }
    if (!form.organizerEmail.trim()) {
      setError('Enter the Microsoft 365 organizer email.');
      return;
    }
    if (!row.sessions.length) {
      setError('This module has no dated live sessions, so there is nothing to put on a calendar. A meeting is created for each live-session component in the Course structure, on that component’s own date — add them, or give the ones it has a date, and save.');
      return;
    }
    setSaving(true);
    try {
      if (creationUncertain) {
        await recoverLinks();
        return;
      }
      const input = buildTeamsCalendarInput(row, form);
      if (existingCalendar) {
        const held = existingCalendar.meeting;
        const peopleOnly = input.scheduledOccurrences?.every((item, index) => item.durationMinutes === existingCalendar.calendar.occurrences[index].durationMinutes);
        const result = await updateTeamsMeetingSchedule(String(held.teamsLiveSessionId), {
          title: input.title, organizerEmail: String(held.teamsOrganizerEmail), eventId: String(held.teamsEventId || ''),
          localStartDateTime: input.localStartDateTime, startDateTimeUtc: input.startDateTimeUtc,
          durationMinutes: input.durationMinutes, repeat: (held.teamsRepeat || input.repeat) as TeamsMeetingInput['repeat'],
          repeatOccurrences: input.repeatOccurrences, scheduledOccurrences: input.scheduledOccurrences,
          seriesMode: existingCalendar.calendar.seriesMode, peopleOnly,
          attendees: input.attendees, presenters: input.presenters, coOrganizers: input.coOrganizers,
          lobbyBypass: input.lobbyBypass, recording: input.recording, spokenLanguage: input.spokenLanguage,
        });
        if (!result.updated) throw new Error('Microsoft did not confirm the calendar update.');
        if (result.warnings?.length) throw new Error(result.warnings.map(item => item.message).join(' '));
        try {
          const restored = await restoreModuleTeamsMeeting(row.catalogueId);
          if (!restored.module) throw new Error('Missing component links.');
          onRestored?.(restored.module);
        } catch {
          throw new Error('The calendar was updated, but its component links could not be refreshed. Use Restore Teams sessions & links.');
        }
        onClose();
        return;
      }
      const result = await createTeamsMeeting(input);
      let attachmentWarning = '';
      let restoredModule: ModuleCatalogueItem | undefined;
      try {
        restoredModule = (await restoreModuleTeamsMeeting(row.catalogueId)).module;
      } catch {
        attachmentWarning = 'The calendar was created, but its component links could not be refreshed. Use Restore Teams sessions & links.';
      }
      // Narrowed to the day the opening component runs on, because that is the
      // link and the instant that component keeps. Opened from the module itself
      // there is no one day to pick, so the whole series is handed back intact
      // and the caller places each day's link on the session that runs it.
      const selectedIndex = component
        ? sessions.findIndex(session => session.componentId === component.id || session.date === component.settings.sessionDate)
        : -1;
      const scheduled = component ? input.scheduledOccurrences?.[Math.max(0, selectedIndex)] : undefined;
      const selectedDate = scheduled ? utcIsoToCalendarParts(scheduled.startDateTimeUtc, input.scheduleTimeZone).date : '';
      const day = selectedDate ? new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${selectedDate}T12:00:00Z`)) : '';
      const daySeries = result.meeting.calendarSeries?.find(series => series.day === day);
      onCreated({ ...result, meeting: {
        ...result.meeting,
        ...(daySeries ? { joinUrl: daySeries.joinUrl, eventId: daySeries.eventId, onlineMeetingId: daySeries.onlineMeetingId || '' } : {}),
        ...(scheduled ? { startDateTimeUtc: scheduled.startDateTimeUtc, durationMinutes: scheduled.durationMinutes } : {}),
      } }, input);
      if (restoredModule) onRestored?.(restoredModule);
      onClose();
      await finishTeamsCreation(result, input, attachmentWarning);
    } catch (err) {
      if (isTeamsReviewCancelled(err)) return;
      if (!existingCalendar && (err instanceof CurriculumRequestTimeout || (err instanceof ApiError && (
        err.data?.code === 'teams_calendar_already_exists' || err.data?.meetingCreated || err.data?.partial
      )))) {
        setCreationUncertain(true);
        try {
          await recoverLinks();
          return;
        } catch (recoveryError) {
          setError(recoveryError instanceof Error ? recoveryError.message : 'The saved calendar could not be checked.');
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Microsoft Teams could not save the meeting.');
    } finally {
      setSaving(false);
    }
  };

  const placement = [module.cohort, module.group, module.programmeName].map(value => cleanText(value)).filter(Boolean).join(' · ');

  return (
    <Modal
      /* Two lines rather than one long "name — Teams meeting" string: the
         module is the subject, its cohort and group are the context. */
      title={(
        <span className="block min-w-0">
          <span className="block truncate">{row.name}</span>
          <span className="mt-1 block truncate text-[11px] font-semibold text-foreground-400">
            {placement || 'Teams meeting'}
          </span>
        </span>
      )}
      size="max-w-3xl"
      onClose={saving ? () => {} : onClose}
      footer={(
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || configurationLoading || sessionsLoading || calendarLoading || Boolean(calendarLoadError) || existingCalendar?.verificationPending || !graphConfigured || !row.sessions.length || unsavedChanges}
          title={unsavedChanges
            ? 'Save the module first. These dates are not stored yet, so Teams would be given a date the module does not have.'
            : existingCalendar ? 'Update the existing Teams calendar.' : "Create one Teams meeting on each of this module's stored session dates."}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon className={saving ? 'ri-loader-4-line animate-spin text-sm' : 'ri-calendar-check-line text-sm'}></AppIcon>
          {calendarLoading ? 'Loading calendar…' : creationUncertain ? 'Check saved calendar & restore links' : existingCalendar ? 'Update' : calendarLoadError ? 'Calendar unavailable' : 'Create'}
        </button>
      )}
    >
      {!graphConfigured && !configurationLoading && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          Microsoft Graph credentials are missing from the backend, so nothing here can reach the Teams calendar.
        </p>
      )}
      {/* Named before the dates rather than only on the disabled button: the
          reader is looking at a list that includes their unsaved work, and the
          honest thing is to say why it cannot be sent yet. */}
      {unsavedChanges && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm text-amber-700"></AppIcon>
          <p className="text-[11px] leading-relaxed text-amber-900">
            <span className="font-bold">This module has unsaved changes. </span>
            The dates below include them, but a Teams meeting invites real people and is linked back to the
            module&rsquo;s saved sessions — so a session that only exists in this tab would leave Teams holding
            a date the module does not have. Close this, press <span className="font-bold">Save</span>, then reopen the calendar.
          </p>
        </div>
      )}
      {/* The dates below are the sessions' own, which is what a meeting gets
          booked on. Where one no longer matches the week it sits in, say so
          here — this is the last screen before real invitations go out, and a
          date nobody meant is not something to discover from the calendar. */}
      {Boolean(drifted.length) && !sessionsLoading && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AppIcon className="ri-calendar-schedule-line mt-0.5 shrink-0 text-sm text-amber-700"></AppIcon>
          <div className="text-[11px] leading-relaxed text-amber-900">
            <p>
              <span className="font-bold">
                {drifted.length === 1
                  ? 'One of these dates is a meeting Teams already has booked, on a day its week no longer runs. '
                  : `${drifted.length} of these dates are meetings Teams already has booked, on days their weeks no longer run. `}
              </span>
              Every other live session followed its week automatically; {drifted.length === 1 ? 'this one was' : 'these were'} left
              alone because real attendees were invited to the booked date.
            </p>
            <ul className="mt-1 space-y-0.5 tabular-nums">
              {drifted.map(session => (
                <li key={session.componentId}>
                  {formatDateLabel(session.storedDate)} — its week now runs {session.weekDates.map(formatDateLabel).join(' and ')}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Moving {drifted.length === 1 ? 'it' : 'them'} asks Microsoft and mails the attendees, so it is done from
              the <span className="font-bold">Teams Meetings</span> page, not here.
            </p>
          </div>
        </div>
      )}
      {existingCalendar?.verificationPending && <p role="alert" className="mb-4 text-sm text-amber-800">
        This calendar exists, but verification is incomplete. <Link className="underline" to={`/curriculum/teams-meetings?module=${encodeURIComponent(row.catalogueId)}`}>Review it in Teams Meetings</Link> before updating its saved bookings.
      </p>}
      {calendarLoadError ? <div role="alert" className="space-y-2 text-sm text-red-700">
        <p>{calendarLoadError}</p>
        <button type="button" className="font-semibold underline" onClick={() => setCalendarReadAttempt(value => value + 1)}>Retry loading calendar</button>
      </div> : sessionsLoading || calendarLoading ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-background-200 bg-background-100/60 p-3 text-[11px] font-semibold text-foreground-500">
          <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
          Loading this module's calendar and session dates…
        </p>
      ) : (
        <TeamsCalendarFormBody
          row={row}
          form={form}
          patch={patch}
          holidayLabelFor={holidayLabelFor}
          prefilling={invitedPrefilling}
          onPrefill={() => void prefillInvitees()}
          timeZoneLabel={graphTimeZone}
          existingCalendar={Boolean(existingCalendar)}
          showAlternateTimeZones={false}
        />
      )}
      {error && <div className="mt-4"><InlineError message={error} /></div>}
    </Modal>
  );
}
