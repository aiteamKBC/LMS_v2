import { useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EntraPeopleInput } from '../teams-meetings/EntraPeopleInput';
import {
  calendarLabel,
  TeamsMeetingOptionFields,
  TeamsPeopleFields,
  type TeamsCalendarForm,
} from '../teams-meetings/createCalendarForm';
import { emailList } from './EmailChipsInput';
import { cleanText, formatDateLabel } from '../shared/entities/model';
import {
  FormField,
  InlineError,
  SelectControl,
  TextAreaControl,
  TextControl,
} from '../shared/entities/ui';
import {
  cancelWeekTeamsMeeting,
  createWeekTeamsMeeting,
  updateWeekTeamsMeeting,
  utcIsoToCalendarParts,
  zonedNaiveToUtcIso,
  type ComponentSettings,
  type ModuleCatalogueItem,
  type ModuleWeek,
} from './moduleAuthoringData';

// ============================================================================
// An additional Teams meeting on one week — the second door of the Teams
// dialog, and a different record from the first.
//
// The module's own calendar (the other tab) is one series over every live
// session the module delivers, with one organiser and one invitation list. This
// books a single meeting on a single week for the case that has neither: a
// guest speaker, an employer panel, a resit briefing. It has its own organiser,
// its own co-organisers and its own guests, and it is created, stored and read
// back entirely separately — nothing here creates, updates, reuses, redirects
// to or cancels the module's own meeting, in either direction.
//
// The fields are deliberately the module calendar's own fields, rendered from
// the same components (`TeamsMeetingOptionFields`, `TeamsPeopleFields`,
// `EntraPeopleInput`), so an author books this the way they book that one. What
// is different is only what genuinely differs: a week to attach it to and one
// date of its own, instead of the module's stored session dates.
// ============================================================================

/** The form, in the shape the shared Teams field components already read. */
export interface WeekTeamsMeetingForm extends Pick<TeamsCalendarForm,
  'lobbyBypass' | 'recording' | 'spokenLanguage' | 'presenters' | 'coOrganizers' | 'attendees'> {
  weekId: string;
  title: string;
  organizerEmail: string;
  date: string;
  startTime: string;
  durationMinutes: string;
  details: string;
  scheduleTimeZone: 'Africa/Cairo' | 'Europe/London';
}

export function emptyWeekTeamsMeetingForm(weekId = ''): WeekTeamsMeetingForm {
  return {
    weekId,
    title: '',
    organizerEmail: '',
    date: '',
    startTime: '09:00',
    durationMinutes: '60',
    details: '',
    // England, for the same reason the module calendar defaults to it: the
    // people invited read the hour in their own invitation and turn up for it.
    scheduleTimeZone: 'Europe/London',
    lobbyBypass: 'everyone',
    recording: 'record-transcribe',
    spokenLanguage: 'en-GB',
    presenters: '',
    coOrganizers: '',
    attendees: '',
  };
}

const DURATION_CHOICES = [15, 30, 45, 60, 90, 120, 150, 180, 240];

/** The live-session components of a week, in the order the week runs them. */
function liveSessionsOf(week: ModuleWeek | undefined) {
  return (week?.components || []).filter(component => component.type === 'live-session');
}

/**
 * The ADDITIONAL meeting a live session already holds, if any.
 *
 * Deliberately not `liveSessionUrl`/`teamsMeetingUrl`: those two are the
 * MODULE's calendar, and `attach_teams_meeting_to_module_weeks` stamps them
 * onto every live-session component each time a module with a calendar is
 * saved. Reading them here would mean that the moment the module's own Teams
 * calendar exists — the normal case — every week reported itself as taken and
 * no additional meeting could ever be booked. The module's link is inherited
 * context; it is not an additional meeting and never blocks one.
 */
export function heldAdditionalMeeting(settings: ComponentSettings | undefined): string {
  return cleanText(settings?.extraTeamsMeetingUrl);
}

/**
 * Whether the module's own calendar has already BOOKED this live session.
 *
 * `teamsOccurrenceId`/`teamsSessionNumber` are written only when a real Graph
 * occurrence was paired to the component, unlike `liveSessionUrl`, which the
 * series stamps on every live session regardless. An additional meeting takes
 * the week out of the module series, so a session Microsoft already holds
 * cannot take one — that would strand the occurrence or cancel a meeting people
 * are invited to. The server refuses it too.
 */
export function bookedOnModuleCalendar(settings: ComponentSettings | undefined): boolean {
  return Boolean(cleanText(settings?.teamsOccurrenceId) || Number(settings?.teamsSessionNumber || 0) > 0);
}

/**
 * The additional meeting already booked on a week, as it was created.
 *
 * Everything the author typed on this form is stored on the component and comes
 * straight back, so choosing a week that already has one shows the meeting
 * rather than a dead end. The backend keeps these values across module saves
 * (`preserve_additional_meeting_settings`), so they survive a builder tab that
 * never saw the booking.
 */
export function existingWeekMeeting(week: ModuleWeek | undefined): ComponentSettings | undefined {
  return liveSessionsOf(week).map(component => component.settings)
    .find(settings => heldAdditionalMeeting(settings));
}

/** A stored people list, whichever way it was written. */
function peopleList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => cleanText(item)).filter(Boolean);
  return cleanText(value).split(/[\s,;]+/).map(item => item.trim()).filter(Boolean);
}

/** The day a week runs, which is the date an additional meeting starts from. */
function weekSessionDate(week: ModuleWeek | undefined): string {
  return cleanText(week?.sessionDate).slice(0, 10);
}

/**
 * Why this week cannot take an additional meeting, in the author's words.
 *
 * Both of these are refusals, not warnings, and the backend enforces the same
 * two before it calls Microsoft — this is the message shown before the click,
 * not the check that protects the data.
 *
 * 1. No live-session component: the link has nowhere to live. A meeting must
 *    never author a component to hold itself; adding live sessions is the
 *    builder's job.
 * 2. Every live session in the week already has an ADDITIONAL meeting of its
 *    own. Nothing here may replace one of those. A week whose live sessions
 *    carry the module's own calendar link is still free: that link belongs to
 *    the other tab and is left exactly as it is.
 */
export function weekMeetingBlock(week: ModuleWeek | undefined): { reason: string; componentId: string } {
  if (!week) return { reason: 'Choose the week this meeting belongs to.', componentId: '' };
  const label = `Week ${week.weekNumber}`;
  const liveSessions = liveSessionsOf(week);
  if (!liveSessions.length) {
    return {
      componentId: '',
      reason: `${label} has no Live Teams Session component, so there is nowhere to keep this meeting’s link. `
        + 'Add a live session to the week and save the module, then book the meeting here.',
    };
  }
  const free = liveSessions.find(component => !heldAdditionalMeeting(component.settings)
    && !bookedOnModuleCalendar(component.settings));
  if (!free) {
    const spare = liveSessions.filter(component => !heldAdditionalMeeting(component.settings));
    if (!spare.length) {
      const held = liveSessions.length === 1
        ? `${label}’s live session already has an additional meeting.`
        : `Every live session in ${label} already has an additional meeting.`;
      return {
        componentId: '',
        reason: `${held} A live session can hold one, so that no additional meeting is ever replaced. Choose another `
          + 'week, or add another live session to this one. This module’s own Teams calendar is unaffected either way.',
      };
    }
    const booked = spare.length === 1
      ? `${label}’s live session is already booked on this module’s own Teams calendar.`
      : `Every remaining live session in ${label} is already booked on this module’s own Teams calendar.`;
    return {
      componentId: '',
      reason: `${booked} An additional meeting replaces the week’s module session rather than running alongside it, `
        + 'so it can only be added to a live session that has not been sent to Teams yet. Cancel that session on the '
        + 'Module Teams calendar tab first, or choose another week.',
    };
  }
  return { reason: '', componentId: free.id };
}

/** Monday to Sunday around the day a week actually runs, when it has one. */
function weekDateRange(week: ModuleWeek | undefined): { first: string; last: string } {
  const anchor = cleanText(week?.sessionDate).slice(0, 10);
  if (!anchor) return { first: '', last: '' };
  const day = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return { first: '', last: '' };
  // getUTCDay: 0 is Sunday, and the delivery week runs Monday to Sunday.
  const back = (day.getUTCDay() + 6) % 7;
  const monday = new Date(day.getTime() - back * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return { first: monday.toISOString().slice(0, 10), last: sunday.toISOString().slice(0, 10) };
}

function weekOptionLabel(week: ModuleWeek): string {
  const name = cleanText(week.title);
  const when = cleanText(week.sessionDate) ? ` · ${formatDateLabel(week.sessionDate)}` : '';
  const liveSessions = liveSessionsOf(week);
  // Never "already linked": the module's own calendar links every week, and
  // saying so here would read as though every week were taken.
  const state = !liveSessions.length
    ? ' · no live session'
    : liveSessions.every(component => heldAdditionalMeeting(component.settings))
      ? ' · has an additional meeting'
      : liveSessions.every(component => heldAdditionalMeeting(component.settings)
        || bookedOnModuleCalendar(component.settings))
        ? ' · already on the module calendar'
        : '';
  return `Week ${week.weekNumber}${name ? ` — ${name}` : ''}${when}${state}`;
}

/**
 * The meeting a week already has, shown exactly as it was created.
 *
 * Read-only on purpose. Every value here is a real Microsoft booking: changing
 * the title, the time or the guest list has to reach Graph to mean anything,
 * and a form that saved only to the LMS would show an edit that nobody invited
 * ever sees. Until there is an endpoint that sends the change, this states what
 * is booked and where to change it.
 */
function SavedWeekMeeting({
  settings, weekNumber, saving, disabled, confirmCancel,
  onEdit, onAskCancel, onKeepCancel, onCancelMeeting,
}: {
  settings: ComponentSettings;
  weekNumber?: number;
  saving: boolean;
  disabled: boolean;
  confirmCancel: boolean;
  onEdit: () => void;
  onAskCancel: () => void;
  onKeepCancel: () => void;
  onCancelMeeting: () => void;
}) {
  const read = (key: string) => cleanText(settings[key]);
  const start = read('extraTeamsStartDateTimeUtc');
  const duration = Number(settings.extraTeamsDurationMinutes || 0);
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Title', value: read('extraTeamsSubject') },
    { label: 'When', value: [start ? calendarLabel(start) : '', duration ? `${duration} minutes` : ''].filter(Boolean).join(' · ') },
    { label: 'Organizer', value: read('extraTeamsOrganizerEmail') },
    { label: 'Co-organisers', value: peopleList(settings.extraTeamsCoOrganizers).join(', ') },
    { label: 'Presenters', value: peopleList(settings.extraTeamsPresenters).join(', ') },
    { label: 'Attendees', value: peopleList(settings.extraTeamsAttendees).join(', ') },
  ];
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">
        Week {weekNumber} already has an additional meeting
      </p>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {rows.map(row => (
          <div key={row.label} className="min-w-0">
            <dt className="text-[10px] font-bold uppercase text-foreground-400">{row.label}</dt>
            {/* Never blank: a field nobody filled in says so, rather than
                leaving the reader to wonder whether it failed to load. */}
            <dd className={`break-words text-[12px] font-semibold ${row.value ? 'text-foreground-700' : 'text-foreground-400'}`}>
              {row.value || 'Nobody was named'}
            </dd>
          </div>
        ))}
      </dl>
      {read('extraTeamsMeetingUrl') && (
        <a href={read('extraTeamsMeetingUrl')} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[12px] font-bold text-primary-700 hover:underline">
          <AppIcon className="ri-microsoft-teams-line mr-1"></AppIcon>
          Open the meeting link
        </a>
      )}
      <p className="mt-2 text-[11px] font-semibold text-foreground-500">
        A live session holds one additional meeting, so this week cannot take another until this one is cancelled.
        This module&rsquo;s own Teams calendar is unaffected either way.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={saving || disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon className="ri-edit-line text-sm"></AppIcon>
          Edit this meeting
        </button>
        {/* Cancelling emails everyone invited and cannot be undone, so it asks
            once rather than firing on the first click. */}
        {confirmCancel ? (
          <>
            <button
              type="button"
              onClick={onCancelMeeting}
              disabled={saving || disabled}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon className={saving ? 'ri-loader-4-line animate-spin text-sm' : 'ri-close-circle-line text-sm'}></AppIcon>
              Yes, cancel it and tell the people invited
            </button>
            <button
              type="button"
              onClick={onKeepCancel}
              disabled={saving}
              className="inline-flex h-9 items-center rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onAskCancel}
            disabled={saving || disabled}
            title="Cancels the meeting in Microsoft, tells the people invited, and frees this week to take another."
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-[12px] font-bold text-red-700 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon className="ri-close-circle-line text-sm"></AppIcon>
            Cancel this meeting
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The tab itself.
 *
 * It owns its own state and its own Create button rather than borrowing the
 * dialog's footer: the footer belongs to the module calendar, and an additional
 * meeting must not be reachable from any control that also drives that one.
 */
export function WeekTeamsMeetingPanel({
  module,
  initialWeekId = '',
  blockedReason = '',
  graphConfigured = true,
  onCreated,
}: {
  module: ModuleCatalogueItem;
  /** Opened from a live session's own editor: start on that week. */
  initialWeekId?: string;
  /** Unsaved builder work, which blocks every write for the same reason it does on the other tab. */
  blockedReason?: string;
  graphConfigured?: boolean;
  onCreated?: (joinUrl: string) => void;
}) {
  const weeks = useMemo(() => module.weekStructure || [], [module.weekStructure]);
  const [form, setForm] = useState<WeekTeamsMeetingForm>(() => {
    const startOn = weeks.find(item => item.id === initialWeekId) || weeks[0];
    // The week's own day is the date this meeting runs on unless the author
    // moves it. Typing it out again, from a date already stated in the picker
    // right above, is work the form can do — and the commonest answer.
    return { ...emptyWeekTeamsMeetingForm(cleanText(startOn?.id)), date: weekSessionDate(startOn) };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ joinUrl: string; invited: string[]; warnings: string[]; edited?: boolean } | null>(null);
  // Editing the meeting a week already has, rather than booking a new one. The
  // form is the same one: an author changes a meeting where they created it.
  const [editing, setEditing] = useState('');
  const [notifyExisting, setNotifyExisting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const patch = (value: Partial<WeekTeamsMeetingForm>) => {
    setForm(current => ({ ...current, ...value }));
    setError('');
  };

  const week = weeks.find(item => item.id === form.weekId);
  const booked = existingWeekMeeting(week);
  const block = weekMeetingBlock(week);
  const range = weekDateRange(week);
  const outsideWeek = Boolean(range.first && form.date && (form.date < range.first || form.date > range.last));
  const ready = Boolean(
    (editing || !block.reason) && !outsideWeek && form.date && form.startTime
    && cleanText(form.title) && cleanText(form.organizerEmail),
  );

  /** Open the booked meeting in this form, filled in with what was saved. */
  const startEditing = (settings: ComponentSettings) => {
    const start = cleanText(settings.extraTeamsStartDateTimeUtc);
    const zone = 'Europe/London' as const;
    const parts = start ? utcIsoToCalendarParts(start, zone) : { date: '', time: '' };
    setForm(current => ({
      ...current,
      title: cleanText(settings.extraTeamsSubject),
      organizerEmail: cleanText(settings.extraTeamsOrganizerEmail),
      date: parts.date || current.date,
      startTime: parts.time || current.startTime,
      durationMinutes: String(Number(settings.extraTeamsDurationMinutes) || 60),
      scheduleTimeZone: zone,
      presenters: peopleList(settings.extraTeamsPresenters).join(', '),
      coOrganizers: peopleList(settings.extraTeamsCoOrganizers).join(', '),
      attendees: peopleList(settings.extraTeamsAttendees).join(', '),
    }));
    setEditing(cleanText(settings.extraTeamsLiveSessionId));
    setNotifyExisting(false);
    setError('');
  };

  const cancelMeeting = async (liveSessionId: string) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await cancelWeekTeamsMeeting(module.catalogueId, liveSessionId);
      setEditing('');
      setConfirmCancel(false);
      onCreated?.('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The meeting could not be cancelled.');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      const naive = `${form.date}T${form.startTime}`;
      const result = await updateWeekTeamsMeeting(module.catalogueId, editing, {
        title: cleanText(form.title),
        attendees: emailList(form.attendees),
        presenters: emailList(form.presenters),
        coOrganizers: emailList(form.coOrganizers),
        localStartDateTime: naive,
        startDateTimeUtc: zonedNaiveToUtcIso(naive, form.scheduleTimeZone),
        durationMinutes: Math.max(15, Number(form.durationMinutes) || 60),
        lobbyBypass: form.lobbyBypass,
        recording: form.recording,
        spokenLanguage: form.spokenLanguage,
        details: form.details,
        requestResponses: true,
        allowNewTimeProposals: true,
        scheduleTimeZone: form.scheduleTimeZone,
        notifyAttendees: notifyExisting,
      });
      setCreated({
        joinUrl: result.meeting.joinUrl,
        // Who this save actually reached on its own: the people it ADDED, each
        // forwarded the meeting individually. Everyone already invited was
        // emailed only if the author ticked the box.
        invited: result.forwardedTo || [],
        warnings: result.warnings || [],
        edited: true,
      });
      setEditing('');
      onCreated?.(result.meeting.joinUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The meeting could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      const naive = `${form.date}T${form.startTime}`;
      const result = await createWeekTeamsMeeting(module.catalogueId, {
        weekId: form.weekId,
        componentId: block.componentId,
        title: cleanText(form.title),
        organizerEmail: cleanText(form.organizerEmail),
        attendees: emailList(form.attendees),
        presenters: emailList(form.presenters),
        coOrganizers: emailList(form.coOrganizers),
        localStartDateTime: naive,
        startDateTimeUtc: zonedNaiveToUtcIso(naive, form.scheduleTimeZone),
        durationMinutes: Math.max(15, Number(form.durationMinutes) || 60),
        lobbyBypass: form.lobbyBypass,
        recording: form.recording,
        spokenLanguage: form.spokenLanguage,
        details: form.details,
        requestResponses: true,
        allowNewTimeProposals: true,
        scheduleTimeZone: form.scheduleTimeZone,
        // Makes a double-click idempotent at Graph, as the module create's does.
        transactionId: `TEAMS-WEEK-${form.weekId}-${naive}`.slice(0, 255),
      });
      setCreated({ joinUrl: result.meeting.joinUrl, invited: result.invited || [], warnings: result.warnings || [] });
      onCreated?.(result.meeting.joinUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The additional Teams meeting could not be created.');
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white">
            <AppIcon className="ri-check-line text-base"></AppIcon>
          </span>
          <div className="min-w-0 text-[12px] text-foreground-700">
            <p className="font-bold text-emerald-800">
              {created.edited ? 'The additional meeting is updated.' : 'The additional meeting is booked.'}
            </p>
            <p className="mt-1">
              {created.edited
                ? (created.invited.length
                  ? `Microsoft has the changes, and the ${created.invited.length} ${created.invited.length === 1 ? 'person' : 'people'} this save added ${created.invited.length === 1 ? 'was' : 'were'} sent the meeting.`
                  : 'Microsoft has the changes. Nobody new was added, so no invitation was forwarded.')
                : created.invited.length
                // The count comes back from Microsoft's own read of the meeting,
                // not from what was typed, so this says what was actually sent.
                ? `Microsoft has confirmed and emailed an invitation to ${created.invited.length} ${created.invited.length === 1 ? 'person' : 'people'} — those named on this form and nobody else.`
                  : 'Nobody was named on this form, so no invitation was sent. Add people in Outlook, or book another meeting with them listed.'}
              {' '}It is Week {week?.weekNumber}’s live session, and is not on this module’s own Teams calendar.
            </p>
            {Boolean(created.invited.length) && (
              <p className="mt-1 break-words text-[11px] font-semibold text-foreground-500">
                {created.edited ? 'Sent to' : 'Invited'}: {created.invited.join(', ')}
              </p>
            )}
            {created.joinUrl && (
              <a href={created.joinUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate font-bold text-primary-700 hover:underline">
                <AppIcon className="ri-microsoft-teams-line mr-1"></AppIcon>
                Open the meeting link
              </a>
            )}
          </div>
        </div>
        {created.warnings.map(warning => (
          <p key={warning} role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] font-semibold text-amber-800">{warning}</p>
        ))}
        <button
          type="button"
          onClick={() => { setCreated(null); setForm(emptyWeekTeamsMeetingForm(form.weekId)); }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
        >
          <AppIcon className="ri-add-line text-sm"></AppIcon>
          Book another one
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-600 text-white">
          <AppIcon className="ri-calendar-2-line text-base"></AppIcon>
        </span>
        <p className="text-[12px] text-foreground-600">
          A separate Teams meeting on one week of this module, with its own organiser, co-organisers and guests —
          a different link from the module’s own calendar, which this never changes. Only the people named below are
          invited: it is not added to learner calendars and is not part of this module’s attendance.
        </p>
      </div>

      <FormField label="Week" required hint="The meeting’s link is kept with this week’s live session.">
        <SelectControl
          value={form.weekId}
          onChange={value => patch({ weekId: value, date: weekSessionDate(weeks.find(item => item.id === value)) })}
          placeholder="Choose a week"
          options={weeks.map(item => ({ value: item.id, label: weekOptionLabel(item) }))}
        />
      </FormField>

      {/* A week that already has one shows what was booked, read back from the
          component it was saved on — not an error with the answers thrown away. */}
      {booked && !editing && (
        <SavedWeekMeeting
          settings={booked}
          weekNumber={week?.weekNumber}
          saving={saving}
          disabled={Boolean(blockedReason) || !graphConfigured}
          confirmCancel={confirmCancel}
          onEdit={() => startEditing(booked)}
          onAskCancel={() => setConfirmCancel(true)}
          onKeepCancel={() => setConfirmCancel(false)}
          onCancelMeeting={() => void cancelMeeting(cleanText(booked.extraTeamsLiveSessionId))}
        />
      )}

      {block.reason && !editing ? (
        !booked && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
            <AppIcon className="ri-error-warning-line mt-0.5 text-sm"></AppIcon>
            <span className="min-w-0 flex-1">{block.reason}</span>
          </p>
        )
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Meeting title" required hint="What the invited people see in their calendar.">
              <TextControl value={form.title} onChange={value => patch({ title: value })} placeholder="Guest speaker — industry panel" />
            </FormField>
            <FormField
              label="Organizer Microsoft 365 email"
              required
              hint={editing
                // Graph owns the event on this mailbox and cannot move it to
                // another, which is why the module calendar locks it too.
                ? 'The organiser cannot be changed after the meeting is created. Cancel it and book another to move it to a different host.'
                : 'This meeting’s own host. The selected account must allow this app to manage Teams meetings.'}
            >
              {editing ? (
                <input
                  aria-label="Organizer"
                  readOnly
                  value={form.organizerEmail}
                  className="h-11 w-full rounded-lg border border-background-200 bg-background-100 px-3 text-[13px]"
                />
              ) : (
                <EntraPeopleInput single label="Organizer" value={form.organizerEmail} onChange={value => patch({ organizerEmail: value })} />
              )}
            </FormField>
            <FormField
              label="Date"
              required
              error={outsideWeek ? `Week ${week?.weekNumber} runs ${formatDateLabel(range.first)} to ${formatDateLabel(range.last)}. Choose a date inside it.` : ''}
              hint={weekSessionDate(week)
                ? `Taken from Week ${week?.weekNumber}’s own day, ${formatDateLabel(weekSessionDate(week))}. Change it to any day from ${formatDateLabel(range.first)} to ${formatDateLabel(range.last)}.`
                : 'This week has no scheduled date yet, so any date is accepted. Weekends and closure dates are refused.'}
            >
              <TextControl type="date" value={form.date} onChange={value => patch({ date: value })} min={range.first || undefined} max={range.last || undefined} />
            </FormField>
            <FormField label="Start time" required hint="The wall clock in the schedule time zone below.">
              <TextControl type="time" value={form.startTime} onChange={value => patch({ startTime: value })} />
            </FormField>
            <FormField label="Duration">
              <SelectControl
                value={form.durationMinutes}
                onChange={value => patch({ durationMinutes: value })}
                options={DURATION_CHOICES.map(minutes => ({
                  value: String(minutes),
                  label: minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`,
                }))}
              />
            </FormField>
            <FormField label="Schedule time zone" hint="The date and time above are read in this zone, daylight saving included.">
              <SelectControl
                value={form.scheduleTimeZone}
                onChange={value => patch({ scheduleTimeZone: value as WeekTeamsMeetingForm['scheduleTimeZone'] })}
                options={[{ value: 'Africa/Cairo', label: 'Egypt (Africa/Cairo)' }, { value: 'Europe/London', label: 'England (Europe/London)' }]}
              />
            </FormField>
            <TeamsMeetingOptionFields form={form} patch={patch} />
            <FormField label="Details" hint="Optional. Included in the calendar invitation.">
              <TextAreaControl value={form.details} onChange={value => patch({ details: value })} rows={2} />
            </FormField>
            {/* No roster prefill here on purpose: this meeting's guests are
                chosen for it, and offering the module's learners in one click
                is how a private meeting quietly becomes the whole cohort's. */}
            <TeamsPeopleFields form={form} patch={patch} />
          </div>
          <p className="text-[10px] font-semibold text-foreground-400">
            <AppIcon className="ri-time-line mr-1"></AppIcon>
            Schedule time zone: {form.scheduleTimeZone === 'Africa/Cairo' ? 'Egypt (Africa/Cairo)' : 'England (Europe/London)'}
            {' · '}Business calendar: weekends and closure dates are refused.
          </p>
        </>
      )}

      {blockedReason && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">{blockedReason}</p>
      )}
      {error && <InlineError message={error} />}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && (
          /* Exactly the module calendar's rule, in its own words: this decides
             only whether people ALREADY invited hear about the change. Anyone
             this save adds is sent the meeting either way, because Microsoft
             puts it on their calendar only when something is sent to them. */
          <label className="mr-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-700">
            <input
              type="checkbox"
              aria-label="Email existing invitees about this change"
              checked={notifyExisting}
              onChange={event => setNotifyExisting(event.target.checked)}
              disabled={saving}
              className="h-4 w-4 accent-primary-600"
            />
            <span>
              Email existing invitees
              <span className="ml-1 font-normal text-foreground-500">(people added now are always sent it)</span>
            </span>
          </label>
        )}
        {editing && (
          <button
            type="button"
            onClick={() => { setEditing(''); setError(''); }}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
          >
            Discard changes
          </button>
        )}
        <button
          type="button"
          onClick={() => void (editing ? saveEdit() : submit())}
          disabled={!ready || saving || Boolean(blockedReason) || !graphConfigured}
          title={!graphConfigured
            ? 'Microsoft Graph is not configured, so no meeting can be created.'
            : editing
              ? 'Send these changes to Microsoft. The module’s own Teams calendar is not touched.'
              : 'Create this one meeting and invite the people named above. The module’s own Teams calendar is not touched.'}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon className={saving ? 'ri-loader-4-line animate-spin text-sm' : 'ri-calendar-event-line text-sm'}></AppIcon>
          {saving
            ? (editing ? 'Saving…' : 'Creating…')
            : editing ? 'Save changes' : 'Create additional meeting'}
        </button>
      </div>
    </div>
  );
}
