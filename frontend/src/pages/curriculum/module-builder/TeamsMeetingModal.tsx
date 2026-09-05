import { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import {
  fetchCurriculumHolidays,
  fetchCurriculumSessions,
  type CurriculumHoliday,
  type CurriculumSession,
} from '@/lib/curriculumApi';
import { cleanText } from '../shared/entities/model';
import { InlineError } from '../shared/entities/ui';
import {
  buildTeamsCalendarInput,
  emptyTeamsCalendarForm,
  minutesBetween,
  sessionNaiveLocal,
  TeamsCalendarFormBody,
  type TeamsCalendarForm,
  type TeamsCalendarTarget,
} from '../teams-meetings/createCalendarForm';
import {
  createTeamsMeeting,
  fetchModuleMeetingInvitees,
  loadTeamsMeetingConfiguration,
  zonedNaiveToUtcIso,
  type ModuleComponent,
  type TeamsMeetingInput,
  type TeamsMeetingResult,
} from './moduleAuthoringData';

// The Teams meeting the modal is created against belongs to a module, but the
// modal only ever needs its catalogue id (to load the planned session dates and
// key the series), its title, and where it sits. Taking just those lets both the
// Module Builder and the Week Builder open the modal without either importing
// the full ModuleCatalogueItem type.
export interface TeamsMeetingModuleContext {
  catalogueId?: string;
  title?: string;
  /** Placement, for the dialog's subtitle. Optional: shown when the caller has it. */
  programmeName?: string;
  cohort?: string;
  group?: string;
}

/**
 * Create a module's Teams calendar from a live-session component.
 *
 * The form itself is the Teams Meetings page's form — same dates preview, same
 * fields, same payload — because this is the same record reached from a second
 * place, not a second feature. What stays here is only what is genuinely this
 * door's own: the component that opened it, and writing the join link back into
 * that component once the meeting exists.
 */
export function TeamsMeetingModal({
  component,
  module,
  onClose,
  onCreated,
}: {
  component: ModuleComponent;
  module: TeamsMeetingModuleContext;
  onClose: () => void;
  onCreated: (result: TeamsMeetingResult, input: TeamsMeetingInput) => void;
}) {
  const storedEmails = (key: string) => (Array.isArray(component.settings[key])
    ? (component.settings[key] as string[]).join('\n')
    : '');
  const [form, setForm] = useState<TeamsCalendarForm>(() => ({
    ...emptyTeamsCalendarForm(),
    title: cleanText(component.title) || cleanText(module.title) || 'Live session',
    organizerEmail: String(component.settings.teamsOrganizerEmail ?? ''),
    attendees: storedEmails('teamsAttendees'),
    // Presenters are a separate list, not a subset of the attendee box: Teams
    // only gives the presenter role to people named here, and everyone else
    // joins as an attendee who cannot share.
    presenters: storedEmails('teamsPresenters'),
    coOrganizers: storedEmails('teamsCoOrganizers'),
    details: String(component.settings.sessionPurpose ?? component.description ?? ''),
    lobbyBypass: String(component.settings.teamsLobbyBypass ?? 'invited'),
    recording: String(component.settings.teamsRecording ?? 'record-transcribe'),
    spokenLanguage: String(component.settings.teamsSpokenLanguage ?? 'en-GB'),
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
  // A module's saved schedule already knows when it runs, holiday shifts and
  // all. Those dates are the ones the calendar has to sit on — exactly as the
  // Teams Meetings page builds the series — so the meeting is created on them
  // rather than on a start date and repeat typed in here.
  const [sessions, setSessions] = useState<CurriculumSession[]>([]);
  const [holidays, setHolidays] = useState<CurriculumHoliday[]>([]);
  // Until the fetch answers we don't yet know whether the module has dates, so
  // the "no stored session dates" warning must wait — otherwise it flashes on
  // every open before the sessions arrive and reads as a module with no schedule.
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // The Duration defaults to the length the group was created with — the gap
  // between its session start and end — so the meeting matches the schedule
  // without anyone re-picking it. Only a duration changed here, in this form,
  // survives that default.
  const durationTouched = useRef(false);

  useEffect(() => {
    let active = true;
    const wanted = cleanText(module.catalogueId).toLowerCase();
    if (!wanted) { setSessionsLoading(false); return () => { active = false; }; }
    setSessionsLoading(true);
    // skipCache: the 45s "dynamic" cache tier can otherwise hand back a snapshot
    // taken before this module was scheduled, so the modal would claim it has no
    // dates until the TTL lapses or the page is refreshed.
    fetchCurriculumSessions(undefined, { skipCache: true })
      .then(all => {
        if (!active) return;
        const filtered = all
          .filter(session => cleanText(session.moduleCatalogueId || session.moduleId).toLowerCase() === wanted)
          .sort((left, right) => sessionNaiveLocal(left).localeCompare(sessionNaiveLocal(right)));
        setSessions(filtered);
        if (!durationTouched.current && filtered.length) {
          const groupMinutes = minutesBetween(filtered[0].startTime, filtered[0].endTime);
          if (groupMinutes > 0) patch({ durationMinutes: String(groupMinutes) });
          durationTouched.current = true;
        }
      })
      .catch(() => { if (active) setSessions([]); })
      .finally(() => { if (active) setSessionsLoading(false); });
    return () => { active = false; };
  }, [module.catalogueId, patch]);

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

  const row: TeamsCalendarTarget = {
    catalogueId: cleanText(module.catalogueId),
    name: cleanText(component.title) || cleanText(module.title) || 'Live session',
    sessions,
    plannedStarts: sessions.map(session => zonedNaiveToUtcIso(sessionNaiveLocal(session))),
    // Nothing is on the Teams calendar yet — this dialog only ever opens for a
    // module that has no series.
    teamsStarts: [],
    durationMinutes: Math.max(15, Number(form.durationMinutes) || 60),
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

  const submit = async () => {
    setError('');
    if (!form.organizerEmail.trim()) {
      setError('Enter the Microsoft 365 organizer email.');
      return;
    }
    if (!sessions.length) {
      setError('This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.');
      return;
    }
    const input = buildTeamsCalendarInput(row, form);
    setSaving(true);
    try {
      const result = await createTeamsMeeting(input);
      onCreated(result, input);
      onClose();
      // `settingsApplied` false means the calendar is right and the recording is
      // not: Graph refused the meeting options, so the session opens recording
      // nothing. It reads as success otherwise, which is how it went unnoticed.
      const optionsRefused = !result.meeting.settingsApplied;
      const occurrences = input.scheduledOccurrences || [];
      await showCurriculumAlert({
        title: optionsRefused
          ? 'Created, but NOT recording'
          : result.warnings.length ? 'Created with warnings' : 'Session dates sent to Teams',
        text: optionsRefused
          ? `The invitations and join links are in place, but Microsoft Graph refused the recording, transcription and lobby options, so these sessions will record nothing. Organizer: ${result.meeting.organizerEmail || 'unknown'}. ${result.warnings[0] || 'Check the backend log for the exact Graph status, code and request-id.'}`
          : result.warnings.length
            ? result.warnings[0]
            : `${occurrences.length} session date${occurrences.length === 1 ? '' : 's'} sent to Teams.`,
        timer: optionsRefused || result.warnings.length ? undefined : 2400,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microsoft Teams could not create the meeting.');
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
          disabled={saving || configurationLoading || sessionsLoading || !graphConfigured || !sessions.length}
          title="Create one Teams meeting on each of this module's stored session dates."
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon className={saving ? 'ri-loader-4-line animate-spin text-sm' : 'ri-calendar-check-line text-sm'}></AppIcon>
          Create
        </button>
      )}
    >
      {!graphConfigured && !configurationLoading && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          Microsoft Graph credentials are missing from the backend, so nothing here can reach the Teams calendar.
        </p>
      )}
      {sessionsLoading ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-background-200 bg-background-100/60 p-3 text-[11px] font-semibold text-foreground-500">
          <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
          Loading this module's session dates…
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
        />
      )}
      {error && <div className="mt-4"><InlineError message={error} /></div>}
    </Modal>
  );
}
