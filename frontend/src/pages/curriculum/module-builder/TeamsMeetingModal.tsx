import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchCurriculumSessions, type CurriculumSession } from '@/lib/curriculumApi';
import { Checkbox, NumberInput, ReadOnlyInput, SelectInput, TextArea, TextInput } from './formInputs';
import {
  createTeamsMeeting,
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

function localDateTimeValue(value?: string) {
  const parsed = value ? new Date(value) : new Date(Date.now() + 30 * 60 * 1000);
  const date = Number.isNaN(parsed.getTime()) ? new Date(Date.now() + 30 * 60 * 1000) : parsed;
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function meetingSettingString(component: ModuleComponent, key: string, fallback = '') {
  return String(component.settings[key] ?? fallback);
}

function meetingSettingBool(component: ModuleComponent, key: string, fallback: boolean) {
  const value = component.settings[key];
  return typeof value === 'boolean' ? value : fallback;
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
  const [title, setTitle] = useState(component.title || 'Live session');
  const [organizerEmail, setOrganizerEmail] = useState(meetingSettingString(component, 'teamsOrganizerEmail'));
  const [attendees, setAttendees] = useState(storedEmails('teamsAttendees'));
  // Presenters are a separate list, not a subset of the attendee box: Teams only
  // gives the presenter role to people named here, and everyone else joins as an
  // attendee who cannot share.
  const [presenters, setPresenters] = useState(storedEmails('teamsPresenters'));
  const [startDateTime, setStartDateTime] = useState(localDateTimeValue(meetingSettingString(component, 'sessionDateTimeUtc')));
  const [durationMinutes, setDurationMinutes] = useState(Number(component.settings.durationMinutes || 60));
  const [repeat, setRepeat] = useState<TeamsMeetingInput['repeat']>(meetingSettingString(component, 'teamsRepeat', 'none') as TeamsMeetingInput['repeat']);
  const [repeatOccurrences, setRepeatOccurrences] = useState(Number(component.settings.teamsRepeatOccurrences || 12));
  const [lobbyBypass, setLobbyBypass] = useState(meetingSettingString(component, 'teamsLobbyBypass', 'invited'));
  const [recording, setRecording] = useState(meetingSettingString(component, 'teamsRecording', 'record-transcribe'));
  const [spokenLanguage, setSpokenLanguage] = useState(meetingSettingString(component, 'teamsSpokenLanguage', 'en-GB'));
  const [meetingType, setMeetingType] = useState(meetingSettingString(component, 'teamsMeetingType', 'live-session'));
  const [details, setDetails] = useState(meetingSettingString(component, 'sessionPurpose', component.description));
  const [requestResponses, setRequestResponses] = useState(meetingSettingBool(component, 'teamsRequestResponses', true));
  const [allowNewTimeProposals, setAllowNewTimeProposals] = useState(meetingSettingBool(component, 'teamsAllowTimeProposals', true));
  const [hideAttendees, setHideAttendees] = useState(meetingSettingBool(component, 'teamsHideAttendees', false));
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [organizerLocked, setOrganizerLocked] = useState(false);
  const [graphConfigured, setGraphConfigured] = useState(true);
  const [graphTimeZone, setGraphTimeZone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<TeamsMeetingResult | null>(null);
  // A module that has a saved schedule already knows when it runs, holiday
  // shifts and all. Those dates are the ones the calendar has to sit on, so the
  // form reports them instead of offering a start date and a weekly repeat that
  // would disagree with the module from the moment it is created.
  const [plannedSessions, setPlannedSessions] = useState<CurriculumSession[]>([]);

  useEffect(() => {
    let active = true;
    const wanted = String(module.catalogueId || '').trim().toLowerCase();
    if (!wanted) return () => { active = false; };
    fetchCurriculumSessions()
      .then(all => {
        if (!active) return;
        setPlannedSessions(all
          .filter(session => String(session.moduleCatalogueId || session.moduleId || '').trim().toLowerCase() === wanted)
          .sort((left, right) => sessionWallClock(left).localeCompare(sessionWallClock(right))));
      })
      .catch(() => { if (active) setPlannedSessions([]); });
    return () => { active = false; };
  }, [module.catalogueId]);

  const plannedOccurrences = useMemo(() => plannedSessions.map((session, index) => ({
    sessionNumber: index + 1,
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

  const submit = async () => {
    setError('');
    if (!title.trim()) return setError('Meeting title is required.');
    if (!organizerEmail.trim()) {
      return setError(organizerLocked
        ? 'The Microsoft 365 organizer is still loading. Try again in a moment.'
        : 'Enter the Microsoft 365 organizer email.');
    }
    const usePlan = plannedOccurrences.length > 0;
    const localStart = usePlan ? sessionWallClock(plannedSessions[0]) : startDateTime;
    // The wall clock belongs to the Microsoft calendar's timezone, not to this
    // browser's: reading it as local time puts a Cairo designer's session an
    // hour or two off the slot the group actually meets in.
    const startIso = usePlan ? plannedOccurrences[0].startDateTimeUtc : zonedNaiveToUtcIso(startDateTime);
    if (Number.isNaN(new Date(startIso).getTime())) return setError('Choose a valid meeting start date and time.');
    const input: TeamsMeetingInput = {
      title: title.trim(),
      organizerEmail: organizerEmail.trim(),
      attendees: attendees.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean),
      presenters: presenters.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean),
      // Named on creation so the series is keyed to this module from the start,
      // rather than only once the module structure is next saved.
      moduleCatalogueId: module.catalogueId,
      moduleTitle: module.title,
      localStartDateTime: localStart,
      startDateTimeUtc: startIso,
      durationMinutes: usePlan ? plannedOccurrences[0].durationMinutes : durationMinutes,
      repeat: usePlan ? (plannedOccurrences.length > 1 ? 'weekly' : 'none') : repeat,
      repeatOccurrences: usePlan ? plannedOccurrences.length : repeatOccurrences,
      // Graph can only build an unbroken weekly series, so the shifted dates
      // travel with the create call and the backend moves each occurrence onto
      // the one the module actually planned.
      scheduledOccurrences: usePlan ? plannedOccurrences : undefined,
      lobbyBypass,
      recording,
      spokenLanguage,
      meetingType,
      details,
      requestResponses,
      allowNewTimeProposals,
      hideAttendees,
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
      <div role="dialog" aria-modal="true" aria-labelledby="teams-meeting-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
              <section className="space-y-4 rounded-2xl border border-background-200 bg-background-50 p-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Meeting details</p>
                  <h4 className="mt-1 text-[13px] font-heading font-bold text-foreground-900">Calendar invitation</h4>
                </div>
                <TextInput label="Title" value={title} onChange={setTitle} required />
                {organizerLocked ? (
                  <div>
                    <ReadOnlyInput label="Organizer Microsoft 365 email" value={organizerEmail} />
                    <p className="mt-1 text-[10px] font-semibold text-foreground-400">Set for this deployment. Recording and transcription only turn on for this mailbox, so the series is always created here; tutors are invited as presenters below.</p>
                  </div>
                ) : (
                  <TextInput label="Organizer Microsoft 365 email" value={organizerEmail} onChange={setOrganizerEmail} required />
                )}
                <div>
                  <TextArea label="Attendees" value={attendees} onChange={setAttendees} rows={4} />
                  <p className="mt-1 text-[10px] font-semibold text-foreground-400">One email per line, or separate emails with commas or semicolons.</p>
                </div>
                <div>
                  <TextArea label="Presenters" value={presenters} onChange={setPresenters} rows={3} />
                  <p className="mt-1 text-[10px] font-semibold text-foreground-400">These people can share and record. They are invited too, so there is no need to repeat them above.</p>
                </div>
                {plannedOccurrences.length ? (
                  <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Dates come from this module</p>
                    <p className="mt-1 text-[11px] font-semibold text-foreground-700">
                      {plannedOccurrences.length} session{plannedOccurrences.length === 1 ? '' : 's'}, first on {new Date(plannedOccurrences[0].startDateTimeUtc).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
                    </p>
                    <p className="mt-1 text-[10px] font-semibold text-foreground-500">
                      One Teams meeting per stored session date, holiday shifts included. Change the dates on the module schedule, not here.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-[10px] font-semibold uppercase text-foreground-400">Start</span>
                        <input type="datetime-local" value={startDateTime} onChange={event => setStartDateTime(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-[13px] text-foreground-900 focus:border-primary-300 focus:outline-none" />
                      </label>
                      <SelectInput label="Duration" value={String(durationMinutes)} options={['30', '45', '60', '90', '120', '180']} labels={{ '30': '30 minutes', '45': '45 minutes', '60': '1 hour', '90': '1 hour 30 minutes', '120': '2 hours', '180': '3 hours' }} onChange={value => setDurationMinutes(Number(value))} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <SelectInput label="Repeat" value={repeat} options={['none', 'daily', 'weekdays', 'weekly']} labels={{ none: 'Does not repeat', daily: 'Daily', weekdays: 'Every weekday', weekly: 'Weekly' }} onChange={value => setRepeat(value as TeamsMeetingInput['repeat'])} />
                      {repeat !== 'none' && <NumberInput label="Number of sessions" value={repeatOccurrences} min={2} max={52} step={1} onChange={setRepeatOccurrences} />}
                    </div>
                  </>
                )}
                <TextArea label="Details" value={details} onChange={setDetails} rows={5} />
              </section>

              <section className="space-y-4 rounded-2xl border border-primary-100 bg-primary-50/40 p-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Advanced options</p>
                  <p className="mt-1 text-[11px] font-semibold text-foreground-500">Saved with the component. Microsoft 365 policy can override some options.</p>
                </div>
                <SelectInput label="Who can bypass the lobby?" value={lobbyBypass} options={['invited', 'organization', 'organization-excluding-guests', 'everyone', 'organizer']} labels={{ invited: 'People invited to this meeting', organization: 'People in my organization', 'organization-excluding-guests': 'Organization, excluding guests', everyone: 'Everyone', organizer: 'Only organizers' }} onChange={setLobbyBypass} />
                <SelectInput label="Recording" value={recording} options={['none', 'record', 'record-transcribe']} labels={{ none: 'Do not start automatically', record: 'Record automatically', 'record-transcribe': 'Record and transcribe' }} onChange={setRecording} />
                <SelectInput label="Spoken language" value={spokenLanguage} options={['en-GB', 'en-US', 'ar-EG', 'fr-FR']} labels={{ 'en-GB': 'English (UK)', 'en-US': 'English (US)', 'ar-EG': 'Arabic (Egypt)', 'fr-FR': 'French' }} onChange={setSpokenLanguage} />
                <SelectInput label="Type" value={meetingType} options={['teams-meeting', 'live-session']} labels={{ 'teams-meeting': 'Teams meeting', 'live-session': 'Teams meeting / live session' }} onChange={setMeetingType} />
                <div className="space-y-2 rounded-xl border border-dashed border-primary-200 bg-background-50/80 p-3">
                  <Checkbox label="Request responses" checked={requestResponses} onChange={setRequestResponses} />
                  <Checkbox label="Allow time proposals" checked={allowNewTimeProposals} onChange={setAllowNewTimeProposals} />
                  <Checkbox label="Hide attendee list" checked={hideAttendees} onChange={setHideAttendees} />
                </div>
                {graphTimeZone && <p className="text-[10px] font-semibold text-foreground-400"><AppIcon className="ri-time-line mr-1"></AppIcon>Microsoft calendar time zone: {graphTimeZone}</p>}
              </section>
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
              <button type="button" onClick={submit} disabled={submitting || configurationLoading || !graphConfigured} className="inline-flex h-9 min-w-[175px] items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">
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
