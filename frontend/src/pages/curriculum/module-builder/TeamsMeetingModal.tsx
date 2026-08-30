import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchCurriculumSessions, type CurriculumSession } from '@/lib/curriculumApi';
import { FormField, SelectControl, TextAreaControl, TextControl } from '../shared/entities/ui';
import { EmailChipsInput, emailList } from './EmailChipsInput';
import {
  createTeamsMeeting,
  fetchModuleMeetingInvitees,
  loadTeamsMeetingConfiguration,
  makeAuthoringId,
  zonedNaiveToUtcIso,
  type ModuleComponent,
  type TeamsMeetingInput,
  type TeamsMeetingResult,
} from './moduleAuthoringData';

// The Teams meeting the modal is created against belongs to a module, but the
// modal only ever needs its catalogue id (to load the planned session dates and
// key the series) and its title. Taking just those two lets both the Module
// Builder and the Week Builder open the modal without either importing the full
// ModuleCatalogueItem type.
export interface TeamsMeetingModuleContext {
  catalogueId?: string;
  title?: string;
}

function meetingSettingString(component: ModuleComponent, key: string, fallback = '') {
  return String(component.settings[key] ?? fallback);
}

/** `YYYY-MM-DDTHH:mm` for a stored session — the wall clock the group meets on. */
function sessionWallClock(session: CurriculumSession) {
  return `${String(session.date || '').trim()}T${String(session.startTime || '').trim().slice(0, 5) || '09:00'}`;
}

function sessionMinutes(session: CurriculumSession, fallback: number) {
  const [startHour, startMinute] = String(session.startTime || '').split(':').map(Number);
  const [endHour, endMinute] = String(session.endTime || '').split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(value => !Number.isFinite(value))) return fallback;
  const minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  return minutes > 0 ? minutes : fallback;
}

/** "1 hour 30 minutes" for a duration in minutes, matching the tab's labels. */
function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (rest || !hours) parts.push(`${rest} minute${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}

const LOBBY_OPTIONS = [
  { value: 'invited', label: 'People invited to this meeting' },
  { value: 'organization', label: 'People in my organization' },
  { value: 'organization-excluding-guests', label: 'Organization, excluding guests' },
  { value: 'everyone', label: 'Everyone' },
  { value: 'organizer', label: 'Only organizers' },
];
const RECORDING_OPTIONS = [
  { value: 'none', label: 'Do not start automatically' },
  { value: 'record', label: 'Record automatically' },
  { value: 'record-transcribe', label: 'Record and transcribe' },
];
const LANGUAGE_OPTIONS = [
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'ar-EG', label: 'Arabic (Egypt)' },
  { value: 'fr-FR', label: 'French' },
];

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
  const storedEmails = (key: string) => Array.isArray(component.settings[key])
    ? (component.settings[key] as string[]).join('\n')
    : '';
  const [organizerEmail, setOrganizerEmail] = useState(meetingSettingString(component, 'teamsOrganizerEmail'));
  const [attendees, setAttendees] = useState(storedEmails('teamsAttendees'));
  // Presenters are a separate list, not a subset of the attendee box: Teams only
  // gives the presenter role to people named here, and everyone else joins as an
  // attendee who cannot share.
  const [presenters, setPresenters] = useState(storedEmails('teamsPresenters'));
  const [durationMinutes, setDurationMinutes] = useState(Number(component.settings.durationMinutes || 60));
  // The Duration defaults to the length the group was created with — the gap
  // between its session start and end — so the meeting matches the schedule
  // without anyone re-picking it. Any duration already stored on the component is
  // just an earlier default (usually 60) and is meant to be overwritten; only a
  // duration the tutor changes here, in this modal, is kept.
  const durationTouchedRef = useRef(false);
  const [lobbyBypass, setLobbyBypass] = useState(meetingSettingString(component, 'teamsLobbyBypass', 'invited'));
  const [recording, setRecording] = useState(meetingSettingString(component, 'teamsRecording', 'record-transcribe'));
  const [spokenLanguage, setSpokenLanguage] = useState(meetingSettingString(component, 'teamsSpokenLanguage', 'en-GB'));
  const [details, setDetails] = useState(meetingSettingString(component, 'sessionPurpose', component.description));
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [organizerLocked, setOrganizerLocked] = useState(false);
  const [graphConfigured, setGraphConfigured] = useState(true);
  const [graphTimeZone, setGraphTimeZone] = useState('');
  const [invitedPrefilling, setInvitedPrefilling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<TeamsMeetingResult | null>(null);
  // A module's saved schedule already knows when it runs, holiday shifts and
  // all. Those dates are the ones the calendar has to sit on — exactly as the
  // Live Teams Meetings page builds the series — so the meeting is created on
  // them rather than on a start date and repeat typed in here.
  const [plannedSessions, setPlannedSessions] = useState<CurriculumSession[]>([]);
  // Until the fetch answers we don't yet know whether the module has dates, so
  // the "no stored session dates" warning must wait — otherwise it flashes on
  // every open before the sessions arrive and reads as a module with no schedule.
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const wanted = String(module.catalogueId || '').trim().toLowerCase();
    if (!wanted) { setSessionsLoading(false); return () => { active = false; }; }
    setSessionsLoading(true);
    // skipCache: the 45s "dynamic" cache tier can otherwise hand back a snapshot
    // taken before this module was scheduled, so the modal would claim it has no
    // dates until the TTL lapses or the page is refreshed.
    fetchCurriculumSessions(undefined, { skipCache: true })
      .then(all => {
        if (!active) return;
        const filtered = all
          .filter(session => String(session.moduleCatalogueId || session.moduleId || '').trim().toLowerCase() === wanted)
          .sort((left, right) => sessionWallClock(left).localeCompare(sessionWallClock(right)));
        setPlannedSessions(filtered);
        // Default the duration to the group's own session length, once, unless
        // the component already carried one or the tutor has picked another.
        if (!durationTouchedRef.current && filtered.length) {
          const groupMinutes = sessionMinutes(filtered[0], 0);
          if (groupMinutes > 0) setDurationMinutes(groupMinutes);
          durationTouchedRef.current = true;
        }
      })
      .catch(() => { if (active) setPlannedSessions([]); })
      .finally(() => { if (active) setSessionsLoading(false); });
    return () => { active = false; };
  }, [module.catalogueId]);

  // The standard lengths plus whatever the group was actually created with, so
  // a non-standard session duration still shows its own value rather than blank.
  const durationOptions = useMemo(() => {
    const minutes = Array.from(new Set([30, 45, 60, 90, 120, 180, durationMinutes]))
      .filter(value => value > 0)
      .sort((left, right) => left - right);
    return minutes.map(value => ({ value: String(value), label: durationLabel(value) }));
  }, [durationMinutes]);

  const plannedOccurrences = useMemo(() => plannedSessions.map((session, index) => ({
    sessionNumber: index + 1,
    localStartDateTime: sessionWallClock(session),
    startDateTimeUtc: zonedNaiveToUtcIso(sessionWallClock(session)),
    durationMinutes: sessionMinutes(session, durationMinutes),
  })), [durationMinutes, plannedSessions]);

  useEffect(() => {
    let active = true;
    loadTeamsMeetingConfiguration()
      .then(configuration => {
        if (!active) return;
        setGraphConfigured(configuration.configured);
        setGraphTimeZone(configuration.timeZone);
        setOrganizerLocked(Boolean(configuration.organizerLocked));
        // A pinned organizer overwrites whatever this component last saved. The
        // stored value may name a tutor who owned an earlier series, and creating
        // a new meeting on that mailbox is what silently loses the recording.
        setOrganizerEmail(current => (
          configuration.organizerLocked && configuration.defaultOrganizer
            ? configuration.defaultOrganizer
            : current || configuration.defaultOrganizer || ''
        ));
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to check Microsoft Teams configuration.');
      })
      .finally(() => {
        if (active) setConfigurationLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Presenters/Attendees derived from the module itself: its assigned tutor as
  // presenter, every learner whose training plan carries this module as
  // attendee. Only ever a starting point — the lists stay editable afterwards.
  const prefillInvitees = async () => {
    const id = String(module.catalogueId || '').trim();
    if (!id) return;
    setInvitedPrefilling(true);
    try {
      const result = await fetchModuleMeetingInvitees(id);
      setAttendees(result.attendees.join('\n'));
      setPresenters(result.presenters.join('\n'));
    } catch {
      // Best-effort: the form stays usable with people typed in by hand.
    } finally {
      setInvitedPrefilling(false);
    }
  };

  const submit = async () => {
    setError('');
    if (!organizerEmail.trim()) {
      return setError(organizerLocked
        ? 'The Microsoft 365 organizer is still loading. Try again in a moment.'
        : 'Enter the Microsoft 365 organizer email.');
    }
    if (!plannedOccurrences.length) {
      return setError('This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.');
    }
    const title = (component.title || module.title || 'Live session').trim();
    const duration = Math.max(15, Number(durationMinutes) || 60);
    // The chosen duration applies to every occurrence, exactly as the Live Teams
    // Meetings page does it.
    const occurrences = plannedOccurrences.map(occurrence => ({
      sessionNumber: occurrence.sessionNumber,
      startDateTimeUtc: occurrence.startDateTimeUtc,
      durationMinutes: duration,
    }));
    const input: TeamsMeetingInput = {
      title,
      organizerEmail: organizerEmail.trim(),
      attendees: emailList(attendees),
      presenters: emailList(presenters),
      // Named on creation so the series is keyed to this module from the start,
      // rather than only once the module structure is next saved.
      moduleCatalogueId: module.catalogueId,
      moduleTitle: module.title,
      localStartDateTime: plannedOccurrences[0].localStartDateTime,
      startDateTimeUtc: occurrences[0].startDateTimeUtc,
      durationMinutes: duration,
      repeat: occurrences.length > 1 ? 'weekly' : 'none',
      repeatOccurrences: occurrences.length,
      // Graph can only build an unbroken weekly series, so the shifted dates
      // travel with the create call and the backend moves each occurrence onto
      // the one the module actually planned.
      scheduledOccurrences: occurrences,
      lobbyBypass,
      recording,
      spokenLanguage,
      meetingType: 'live-session',
      details,
      requestResponses: true,
      allowNewTimeProposals: true,
      hideAttendees: false,
      transactionId: makeAuthoringId('TEAMS'),
    };
    setSubmitting(true);
    try {
      const result = await createTeamsMeeting(input);
      setCreated(result);
      onCreated(result, input);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microsoft Teams could not create the meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-5" onClick={submitting ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="teams-meeting-title" className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-4 bg-primary-950 px-5 py-4 text-white">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-cyan-300">
              <AppIcon className="ri-microsoft-teams-line text-xl"></AppIcon>
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Live session</p>
              <h3 id="teams-meeting-title" className="mt-0.5 text-base font-heading font-bold text-white">Create Microsoft Teams meeting</h3>
              <p className="mt-1 text-[11px] font-medium text-white/65">Set the calendar invitation and meeting preferences, then generate the join link.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-50" aria-label="Close">
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background-100/45 p-4 sm:p-5">
          {created ? (
            <div className="mx-auto max-w-2xl space-y-4 py-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600"><AppIcon className="ri-check-line text-3xl"></AppIcon></span>
                <h4 className="mt-3 text-base font-heading font-bold text-emerald-900">Teams meeting created</h4>
                <p className="mt-1 text-[12px] font-medium text-emerald-700">The join link is now attached to this Live Session component.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {(created.meeting.joinUrl || created.meeting.webLink) && (
                    <a href={created.meeting.joinUrl || created.meeting.webLink} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white hover:bg-primary-600">
                      <AppIcon className="ri-external-link-line"></AppIcon> Open Teams meeting
                    </a>
                  )}
                  {created.meeting.meetingOptionsUrl && (
                    <a href={created.meeting.meetingOptionsUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-4 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100">
                      <AppIcon className="ri-settings-3-line"></AppIcon> Teams Meeting options
                    </a>
                  )}
                </div>
              </div>
              {/* The calendar invitation is real work already done, so a failure
                  here is not an error on the create call -- but the meeting will
                  open with nothing recording and produce no transcript, and that
                  has to be unmissable rather than one line in a warning list. */}
              {!created.meeting.settingsApplied && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-[11px] font-bold text-red-800"><AppIcon className="ri-error-warning-line mr-1"></AppIcon>Recording and transcription are NOT switched on for this meeting.</p>
                  <p className="mt-1 text-[11px] font-semibold text-red-700">The invitation and join link are fine, but Microsoft Graph refused the meeting options, so this session will record nothing. Grant the Teams application access policy to {created.meeting.organizerEmail || 'the organizer'}, then re-apply the meeting options.</p>
                </div>
              )}
              {!!created.warnings.length && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  {created.warnings.map(warning => <p key={warning} className="text-[11px] font-semibold text-amber-800"><AppIcon className="ri-information-line mr-1"></AppIcon>{warning}</p>)}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
                  <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
                </span>
                <p className="text-[12px] text-foreground-600">
                  {plannedOccurrences.length
                    ? `Create puts one Teams meeting on each of the ${plannedOccurrences.length} session date${plannedOccurrences.length === 1 ? '' : 's'} below and writes the join link into this module’s live-session components. The dates come from the module, not from this form.`
                    : 'This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.'}
                </p>
              </div>

              {sessionsLoading ? (
                <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground-500">
                    <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
                    Loading this module's session dates…
                  </p>
                </div>
              ) : plannedOccurrences.length ? (
                <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
                  <div className="flex items-center justify-between gap-2 border-b border-background-200 bg-background-100/50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Dates the calendar will be created on</p>
                    <span className="rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-foreground-600">
                      {plannedOccurrences.length} session{plannedOccurrences.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="max-h-44 divide-y divide-background-100 overflow-y-auto">
                    {plannedOccurrences.map(occurrence => (
                      <li key={occurrence.sessionNumber} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
                        <span className="flex items-center font-semibold text-foreground-700">
                          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background-100 text-[10px] font-bold text-foreground-500">{occurrence.sessionNumber}</span>
                          {new Date(occurrence.startDateTimeUtc).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold text-foreground-400">{occurrence.durationMinutes} min</span>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-background-100 bg-background-100/40 px-3 py-2 text-[10px] font-semibold text-foreground-500">
                    One Teams meeting per stored session date, holiday shifts included. Change the dates on the module schedule, not here.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-semibold text-amber-800">
                    <AppIcon className="ri-error-warning-line mr-1"></AppIcon>
                    This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Organizer Microsoft 365 email"
                  required={!organizerLocked}
                  hint={organizerLocked
                    ? 'Set for this deployment. Recording and transcription only turn on for this mailbox, so tutors are invited as presenters instead.'
                    : 'The calendar this series is created in.'}
                >
                  <TextControl value={organizerEmail} onChange={setOrganizerEmail} disabled={organizerLocked} />
                </FormField>
                <FormField
                  label="Duration"
                  hint={plannedOccurrences.length
                    ? `First session ${new Date(plannedOccurrences[0].startDateTimeUtc).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`
                    : 'Defaults to the group session length.'}
                >
                  <SelectControl
                    value={String(durationMinutes)}
                    onChange={value => { durationTouchedRef.current = true; setDurationMinutes(Number(value)); }}
                    options={durationOptions}
                  />
                </FormField>
                <FormField label="Who can bypass the lobby?">
                  <SelectControl value={lobbyBypass} onChange={setLobbyBypass} options={LOBBY_OPTIONS} />
                </FormField>
                <FormField label="Recording">
                  <SelectControl value={recording} onChange={setRecording} options={RECORDING_OPTIONS} />
                </FormField>
                <FormField label="Spoken language">
                  <SelectControl value={spokenLanguage} onChange={setSpokenLanguage} options={LANGUAGE_OPTIONS} />
                </FormField>
                <FormField label="Details" hint="Optional. Included in the calendar invitation.">
                  <TextAreaControl value={details} onChange={setDetails} rows={2} />
                </FormField>
                <div className="sm:col-span-2 -mb-2 flex items-center justify-end">
                  <button
                    type="button"
                    disabled={invitedPrefilling || !module.catalogueId}
                    onClick={() => void prefillInvitees()}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:underline disabled:opacity-50"
                  >
                    <AppIcon className="ri-refresh-line text-sm"></AppIcon>
                    {invitedPrefilling ? 'Loading…' : "Prefill from the module's tutor and learner plans"}
                  </button>
                </div>
                <FormField label="Presenters" hint="These people can share and record. They are invited too, so there is no need to repeat them below.">
                  <EmailChipsInput value={presenters} onChange={setPresenters} />
                </FormField>
                <FormField label="Attendees" hint="Presenters are invited automatically.">
                  <EmailChipsInput value={attendees} onChange={setAttendees} />
                </FormField>
              </div>
              {graphTimeZone && <p className="text-[10px] font-semibold text-foreground-400"><AppIcon className="ri-time-line mr-1"></AppIcon>Microsoft calendar time zone: {graphTimeZone}</p>}
            </div>
          )}

          {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] font-semibold text-red-700"><AppIcon className="ri-error-warning-line mr-1"></AppIcon>{error}</p>}
          {!configurationLoading && !graphConfigured && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold text-amber-800">Microsoft Graph credentials are missing from the backend environment.</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-background-200 bg-background-50 px-5 py-4">
          <p className="text-[10px] font-semibold text-foreground-400">Creating sends calendar invitations to the attendee emails.</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="h-9 rounded-lg border border-background-200 bg-background-50 px-4 text-[11px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50">{created ? 'Done' : 'Cancel'}</button>
            {!created && (
              <button type="button" onClick={submit} disabled={submitting || configurationLoading || sessionsLoading || !graphConfigured || !plannedOccurrences.length} className="inline-flex h-9 min-w-[175px] items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">
                <AppIcon className={submitting ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'}></AppIcon>
                {submitting ? 'Creating meeting...' : 'Create with these options'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
