import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  formatCalendarDateTime,
  getCalendarTimeZone,
  parseUtcInstant,
  zonedNaiveToUtcIso,
  type TeamsMeetingInput,
} from '../module-builder/moduleAuthoringData';
import { emailList } from '../module-builder/EmailChipsInput';
import { EntraPeopleInput } from './EntraPeopleInput';
import { cleanText, formatDateLabel } from '../shared/entities/model';
import {
  buildHolidayShiftPlan,
  CompactSchedulePreview,
  type HolidayShiftPlan,
} from '../shared/entities/sessionShiftPreview';
import { FormField, SelectControl, TextAreaControl, TextControl } from '../shared/entities/ui';
import { calendarInputError, normalizedClock, clockLabel, durationLabel, reviewDateLabel } from './calendarTime';

// ============================================================================
// The one create form for a module's Teams calendar.
//
// A module can be sent to Teams from the Teams Meetings page or from a live
// session inside the Module Builder. Those are two doors onto the same record,
// not two features: the dates, the settings Graph needs and the invitation
// lists are identical, so they are written once here and both callers render
// it. Each caller keeps only what is genuinely its own -- the dialog it sits in
// and what it does after the meeting exists.
// ============================================================================

export const DEFAULT_START_TIME = '09:00';
export const DEFAULT_DURATION_MINUTES = 60;

/**
 * The minute a UTC instant falls on, for comparing two dates for equality.
 *
 * Instants, never wall clocks: the module's plan and the Teams calendar are
 * compared as the same absolute moment, so a reader in another zone can never
 * turn a matching date into "will be moved".
 */
export function minuteKey(value: unknown): string {
  const instant = parseUtcInstant(value);
  return Number.isNaN(instant.getTime()) ? '' : instant.toISOString().slice(0, 16);
}

/**
 * The little a session has to say for a calendar to be built on it.
 *
 * `CurriculumSession` satisfies this, so the Teams Meetings page passes its own
 * rows unchanged. It is stated separately because the Module Builder reads the
 * same dates off the structure it is already holding -- the backend stamps them
 * onto each live-session component from the same planner -- rather than reading
 * the whole curriculum's session collection back to find one module's.
 */
export interface TeamsPlannedSession {
  /** Existing bookings retain their exact instant, number and elapsed duration. */
  startDateTimeUtc?: string;
  sessionNumber?: number;
  durationMinutes?: number;
  timeZone?: string;
  /** `YYYY-MM-DD` in the business zone. */
  date: string;
  startTime: string;
  endTime: string;
  /** Dates a ticked cohort holiday lands on, named above the list. */
  skippedHolidays?: string[];
  /** The live-session component this date belongs to, when the caller knows it. */
  componentId?: string;
}

/** `YYYY-MM-DDTHH:mm` for a stored session — the wall clock the group meets on. */
export function sessionNaiveLocal(session: TeamsPlannedSession): string {
  // Keep incomplete legacy rows renderable. Creation validates the original
  // values before any request, so this display fallback can never be sent.
  let time = DEFAULT_START_TIME;
  try { time = normalizedClock(session.startTime); } catch { /* Shown by calendarInputError. */ }
  return `${cleanText(session.date)}T${time}`;
}

export function minutesBetween(startTime: string, endTime: string): number {
  if (!cleanText(startTime) || !cleanText(endTime)) return 0;
  let start: string, end: string;
  try { start = normalizedClock(startTime); end = normalizedClock(endTime); } catch { return 0; }
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(value => !Number.isFinite(value))) return 0;
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

/** The same wall clock a UTC instant shows on the Microsoft calendar. */
export function naiveLocalFromUtc(value: unknown, timeZone = getCalendarTimeZone()): string {
  const instant = parseUtcInstant(value);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant).reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  if (!parts.year || !parts.day) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

/** A date and time as the Microsoft calendar shows it, not as this reader's PC does. */
export const calendarLabel = (value: string, timeZone = getCalendarTimeZone()) => {
  const [date, time] = formatCalendarDateTime(value, timeZone).split(', ');
  return time ? `${date}, ${clockLabel(time)}` : date;
};

export function teamsGapNote(plannedUtc: string, teamsUtc: string, hasCalendar: boolean): { matches: boolean; note: string } {
  if (!plannedUtc) return { matches: true, note: '' };
  // Before the calendar exists there is nothing to reconcile: every date is
  // new, which the create panel says once rather than per session.
  if (!hasCalendar) return { matches: true, note: '' };
  if (!teamsUtc) return { matches: false, note: 'Not on the Teams calendar yet — sending adds it.' };
  if (minuteKey(plannedUtc) === minuteKey(teamsUtc)) return { matches: true, note: '' };
  const planned = calendarLabel(plannedUtc);
  const held = calendarLabel(teamsUtc);
  const [plannedDay] = planned.split(', ');
  const [heldDay, heldTime] = held.split(', ');
  return {
    matches: false,
    note: plannedDay === heldDay
      ? `Right day, wrong time — Teams still holds ${heldTime || held}; sending moves it here.`
      : `Teams still holds ${held}; sending moves it here.`,
  };
}

/**
 * The holidays inside this module's dates, named above the dates themselves.
 *
 * A warning and nothing else. The cascade it used to describe -- a session
 * landing on a closed date moving to the next delivery day and dragging the
 * whole tail of the run with it -- is parked: no session moves, none is
 * dropped, and the module still ends where its own delivery pattern says it
 * ends. What to do about these dates is the author's call, made on the week.
 *
 * Parked with that rule, alongside the cascade paragraph itself:
 *   const endMoved = Boolean(plan.originalEndDate) && Boolean(plan.shiftedEndDate)
 *     && plan.originalEndDate !== plan.shiftedEndDate;
 *   {Boolean(plan.movedCount) && (
 *     <p>{plan.movedRangeLabel} {plan.movedCount === 1 ? 'runs' : 'run'} later
 *       {endMoved && <>, so the module now ends {plan.shiftedEndDate} instead of
 *       {plan.originalEndDate}</>}.</p>
 *   )}
 */
function HolidayWarningNote({ plan }: { plan: HolidayShiftPlan }) {
  if (!plan.closures.length) return null;
  const names = Array.from(new Set(plan.closures.map(closure => closure.label).filter(Boolean)));
  // One holiday named twice reads as two, so the dates only carry their own
  // label when more than one holiday falls on them.
  const closureList = plan.closures
    .map(closure => (names.length > 1 && closure.label
      ? `${formatDateLabel(closure.date)} (${closure.label})`
      : formatDateLabel(closure.date)))
    .join(', ');
  return (
    <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50/70 px-3 py-2.5">
      <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm text-amber-700"></AppIcon>
      <div className="space-y-1 text-[11px] leading-relaxed text-amber-900">
        <p>
          <span className="font-bold">Heads up: </span>
          <span className="font-bold">{names.length ? names.join(', ') : 'A cohort holiday'}</span>
          {' falls on '}
          <span className="font-semibold">{closureList}</span>
          {' inside this module’s dates.'}
        </p>
        <p>
          Nothing is changed by that. Every session keeps its own date, none is moved or dropped, and
          the module ends where its delivery pattern says it ends — whether these sessions run is
          yours to decide on the week itself.
        </p>
      </div>
    </div>
  );
}

/**
 * What the preview needs to know about a module. Deliberately narrower than the
 * Teams Meetings page's own row: the Module Builder has a module and its dates,
 * not a table row, and asking it for one would be asking it to become a second
 * copy of that page.
 */
export interface TeamsSchedulePreviewRow {
  timeZone?: string;
  name: string;
  sessions: TeamsPlannedSession[];
  /** The module's own session dates, as the UTC instants Teams would hold. */
  plannedStarts: string[];
  /** What Teams holds today, in order, when it has been asked for. */
  teamsStarts: string[];
  durationMinutes: number;
  /** Present once the module has a Teams calendar; only its existence matters here. */
  summary?: unknown;
  /**
   * The weekly slot the module's group runs to, when the caller knows it.
   *
   * The length of a session is the group's to state -- "Friday 12:00 PM to 2:00
   * PM" is two hours -- and a module inherits it. It is shown here so the reader
   * can see where 60 or 120 minutes came from, and so a session whose stored
   * clock no longer agrees with its group is visible before the invitations go
   * out. Optional: the Module Builder door has the group's name but not its
   * times, and an absent pattern says nothing rather than guessing one.
   */
  groupPattern?: GroupDeliveryPattern;
}

/** A group's weekly slot: the day it meets on and the clock it occupies. */
export interface GroupDeliveryPattern {
  /** The group's own name, so the line can say who it is about. */
  name: string;
  /** "Thursday" or "Monday, Wednesday" -- empty when the group names no day. */
  days: string;
  /** `HH:MM`, normalised. Empty when the group has no readable time. */
  startTime: string;
  endTime: string;
  /** The span between them, or 0 when either is missing. */
  durationMinutes: number;
}

/**
 * How long Create will book every session for, or 0 when each keeps its own.
 *
 * The Duration field is an override, not a display: leaving it on "Use
 * scheduled duration for each session" sends each session's own length. Both
 * the preview and the payload read it from here so the dates on screen are the
 * dates that get booked.
 */
function overrideDurationMinutes(form: TeamsCalendarForm, row: { durationMinutes: number }): number {
  if (!form.durationMinutes) return 0;
  return Math.max(15, Number(form.durationMinutes) || row.durationMinutes || DEFAULT_DURATION_MINUTES);
}

/**
 * Where the session length on these rows came from.
 *
 * The group owns the weekly slot, so it owns the length: a group that meets
 * Friday 12:00 PM to 2:00 PM delivers two-hour sessions, and a module under it
 * inherits that unless one of its own sessions was saved with a different clock.
 * This says the group's slot out loud and counts the sessions that disagree with
 * it, because a list of 60s with a single 120 in the middle is otherwise
 * unexplainable from this screen. It reports; it never rewrites a stored time.
 */
function GroupPatternNote({ pattern, lengths, overrideDuration }: {
  pattern?: GroupDeliveryPattern;
  lengths: number[];
  overrideDuration: number;
}) {
  if (!pattern) return null;
  const slot = pattern.startTime && pattern.endTime
    ? `${clockLabel(pattern.startTime)} - ${clockLabel(pattern.endTime)}`
    : '';
  const differing = pattern.durationMinutes && !overrideDuration
    ? lengths.filter(value => value !== pattern.durationMinutes).length
    : 0;
  return (
    <div className="border-b border-background-200 bg-background-100/40 px-3 py-2.5 text-[11px] leading-relaxed text-foreground-600">
      <p>
        <span className="font-bold text-foreground-700">{pattern.name}</span>
        {pattern.days ? ` delivers ${pattern.days}` : ' has no delivery day set'}
        {slot ? `, ${slot}` : ', and no session times'}
        {pattern.durationMinutes ? ` — ${durationLabel(pattern.durationMinutes)} a session.` : '.'}
      </p>
      {Boolean(differing) && (
        <p className="mt-1 font-semibold text-amber-700">
          {differing === 1 ? '1 session below keeps' : `${differing} sessions below keep`} a different length.
          Each is booked at its own stored time — correct those on the module, not here.
        </p>
      )}
      {Boolean(overrideDuration) && (
        <p className="mt-1 font-semibold text-amber-700">
          Duration is set to {durationLabel(overrideDuration)}, so every session below is booked at that
          length whatever the module stored.
        </p>
      )}
    </div>
  );
}

export function ModuleSessionSchedulePreview({
  row,
  title = 'Module session plan',
  calendarDates,
  holidayLabelFor,
  renderActions,
  renderFacts,
  overrideDuration = 0,
}: {
  row: TeamsSchedulePreviewRow;
  title?: string;
  calendarDates?: string[];
  holidayLabelFor?: (date: string) => string;
  /** The way into one meeting, shown on the session's own row. */
  renderActions?: (index: number, durationMinutes: number) => ReactNode;
  /** What one meeting left behind — attendance, transcript, recording. */
  renderFacts?: (index: number, durationMinutes: number) => ReactNode;
  /**
   * One length for every session, when the form is overriding them.
   *
   * The preview is a promise about what will be booked, so an override has to
   * be visible on the rows it changes. Without it the list went on showing each
   * session's stored length while Create sent a different one.
   */
  overrideDuration?: number;
}) {
  const plan = buildHolidayShiftPlan(row.sessions, holidayLabelFor);
  const hasCalendar = Boolean(row.summary);
  // A meeting can outlive the module's stored dates. When that happens the
  // calendar entries are still the rows worth showing, so they are listed
  // against the date Teams holds rather than dropped for an empty state.
  const sessionRows: Array<TeamsPlannedSession | undefined> = row.sessions.length
    ? row.sessions
    : row.teamsStarts.map(() => undefined);
  const occurrences = sessionRows.map((session, index) => {
    const teamsUtc = calendarDates?.[index] || row.teamsStarts[index] || '';
    const plannedUtc = session
      ? row.plannedStarts[index] || zonedNaiveToUtcIso(sessionNaiveLocal(session), session.timeZone || row.timeZone)
      : '';
    const durationMinutes = overrideDuration || (session
      ? session.durationMinutes || Math.max(15, minutesBetween(session.startTime, session.endTime) || row.durationMinutes)
      : row.durationMinutes);
    const gap = teamsGapNote(plannedUtc, teamsUtc, hasCalendar);
    const facts = renderFacts?.(index, durationMinutes);
    return {
      session,
      plannedUtc: plannedUtc || teamsUtc,
      teamsUtc,
      durationMinutes,
      shift: plan.shifts[index] && { ...plan.shifts[index], sessionNumber: session?.sessionNumber ?? plan.shifts[index].sessionNumber },
      matches: gap.matches,
      actions: renderActions?.(index, durationMinutes),
      extra: (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Egypt: {reviewDateLabel(plannedUtc || teamsUtc, 'Africa/Cairo')}</span>
          <span>England: {reviewDateLabel(plannedUtc || teamsUtc, 'Europe/London')}</span>
          {!session && <span className="font-semibold text-amber-700">Held on Teams, but the module has no session on this date.</span>}
          {facts}
          {gap.note && <span className="font-semibold text-amber-700">{gap.note}</span>}
        </span>
      ),
    };
  });
  // Stated once when they all agree, and per row when they do not: a length
  // repeated down twenty rows is read as decoration, not as a fact.
  const durations = Array.from(new Set(occurrences.map(item => item.durationMinutes)));
  const uniformDuration = durations.length === 1 ? durations[0] : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
      {calendarInputError(row) && <p role="alert" className="p-3 text-sm text-red-700">{calendarInputError(row)}</p>}
      <div className="flex flex-col gap-2 border-b border-background-200 bg-background-100/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">{title}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-foreground-900">
            {row.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          <span className="rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-foreground-600">
            {occurrences.length} session{occurrences.length === 1 ? '' : 's'}
          </span>
          {Boolean(uniformDuration) && (
            <span className="rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-foreground-600">
              {uniformDuration} min each
            </span>
          )}
          {/* Counts the dates a holiday lands on, not dates a holiday moved:
              nothing moves. Parked with the clash rule:
                {plan.movedCount ? `${plan.movedCount} moved by holidays` : 'No holiday shifts'} */}
          <span className={`rounded-full border px-2.5 py-1 ${plan.closures.length ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {plan.closures.length
              ? `${plan.closures.length} session${plan.closures.length === 1 ? '' : 's'} on a holiday`
              : 'No holiday clashes'}
          </span>
        </div>
      </div>
      <GroupPatternNote
        pattern={row.groupPattern}
        lengths={occurrences.map(item => item.durationMinutes)}
        overrideDuration={overrideDuration}
      />
      <HolidayWarningNote plan={plan} />
      {occurrences.length ? (
        <>
          <CompactSchedulePreview
            occurrences={occurrences}
            showDuration={!uniformDuration}
            formatLabel={(plannedUtc, date) => calendarLabel(plannedUtc || date, row.timeZone)}
          />
          {/* A note about a pending change is only useful next to the thing
              that makes it happen. */}
          {occurrences.some(item => !item.matches) && (
            <p className="border-t border-background-200 px-3 py-2 text-[11px] font-semibold text-foreground-500">
              Nothing on the Teams calendar changes until you press
              {' '}
              <span className="font-bold text-foreground-700">Update Teams calendar</span>.
            </p>
          )}
        </>
      ) : (
        <div className="border-t border-amber-200 bg-amber-50/70 px-3 py-3.5">
          {/* Names the missing work rather than implying a saved schedule is
              all that is needed: a meeting exists per live-session component,
              so a module with none has nothing to put on a calendar. */}
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-amber-900">
            <AppIcon className="ri-error-warning-line shrink-0 text-sm text-amber-600"></AppIcon>
            This module has no dated live sessions
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-900">
            One live-session component in the Course structure is one meeting, on that component&rsquo;s own
            date. Add them in the Module Builder, or give the ones it already has a date, and save.
          </p>
        </div>
      )}
    </div>
  );
}

/** Everything the create form holds, and nothing a caller has to reproduce. */
export interface TeamsCalendarForm {
  scheduleTimeZone?: 'Africa/Cairo' | 'Europe/London';
  seriesMode?: 'auto' | 'shared' | 'per_day';
  title: string;
  organizerEmail: string;
  attendees: string;
  presenters: string;
  coOrganizers: string;
  details: string;
  durationMinutes: string;
  lobbyBypass: string;
  recording: string;
  spokenLanguage: string;
  meetingType: string;
}

export function emptyTeamsCalendarForm(): TeamsCalendarForm {
  return {
    scheduleTimeZone: 'Africa/Cairo',
    title: '',
    organizerEmail: '',
    attendees: '',
    presenters: '',
    coOrganizers: '',
    details: '',
    durationMinutes: '',
    seriesMode: 'auto',
    lobbyBypass: 'invited',
    recording: 'record-transcribe',
    spokenLanguage: 'en-GB',
    meetingType: 'live-session',
  };
}

/** The module a calendar is being created for: its identity and its dates. */
export interface TeamsCalendarTarget extends TeamsSchedulePreviewRow {
  catalogueId: string;
}

/** The module's own session dates, in the shape the Teams endpoints take. */
export function teamsCalendarOccurrences(row: TeamsCalendarTarget, timeZone?: string) {
  return row.sessions.map((session, index) => ({
    sessionNumber: session.sessionNumber ?? index + 1,
    startDateTimeUtc: session.startDateTimeUtc || zonedNaiveToUtcIso(sessionNaiveLocal(session), timeZone || session.timeZone || row.timeZone),
    durationMinutes: session.durationMinutes || Math.max(15, minutesBetween(session.startTime, session.endTime) || row.durationMinutes),
  }));
}

/**
 * The create payload, built the same way from either door.
 *
 * Durations follow each session unless explicitly overridden. The dates are the
 * module's own — a holiday-shifted plan included, which is what the backend
 * moves each Graph instance onto.
 */
export function buildTeamsCalendarInput(row: TeamsCalendarTarget, form: TeamsCalendarForm): TeamsMeetingInput {
  const invalid = calendarInputError(row);
  if (invalid) throw new Error(invalid);
  const meetingTitle = cleanText(row.name) || 'Live session';
  const duration = Math.max(15, Number(form.durationMinutes) || row.durationMinutes || DEFAULT_DURATION_MINUTES);
  // Read through the same helper the preview reads, so the lengths on screen
  // are the lengths that get booked.
  const override = overrideDurationMinutes(form, row);
  const occurrences = teamsCalendarOccurrences(row, form.scheduleTimeZone).map(occurrence => (override ? { ...occurrence, durationMinutes: override } : occurrence));
  return {
    ...(form.scheduleTimeZone ? { scheduleTimeZone: form.scheduleTimeZone } : {}),
    title: meetingTitle,
    organizerEmail: form.organizerEmail.trim(),
    attendees: emailList(form.attendees),
    presenters: emailList(form.presenters),
    coOrganizers: emailList(form.coOrganizers),
    moduleCatalogueId: row.catalogueId,
    moduleTitle: meetingTitle,
    localStartDateTime: sessionNaiveLocal(row.sessions[0]),
    startDateTimeUtc: occurrences[0].startDateTimeUtc,
    durationMinutes: occurrences[0]?.durationMinutes || duration,
    seriesMode: form.seriesMode || 'auto',
    repeat: occurrences.length > 1 ? 'weekly' : 'none',
    repeatOccurrences: occurrences.length,
    scheduledOccurrences: occurrences,
    lobbyBypass: form.lobbyBypass,
    recording: form.recording,
    spokenLanguage: form.spokenLanguage,
    meetingType: form.meetingType,
    details: form.details,
    requestResponses: true,
    allowNewTimeProposals: true,
    hideAttendees: true,
    // Keeps retries and double-clicks for the same module idempotent at Graph
    // as well as at our own API and database boundary.
    transactionId: `TEAMS-${row.catalogueId}`,
  };
}

const DURATION_OPTIONS = [30, 45, 60, 90, 120, 180];

/**
 * The standard lengths plus whatever the group was actually created with, so a
 * non-standard session duration still shows its own value rather than blank.
 */
function durationOptions(picked: string, ...groupMinutes: number[]) {
  const minutes = Array.from(new Set([...DURATION_OPTIONS, ...groupMinutes, Number(picked) || 0]))
    .filter(value => value > 0)
    .sort((left, right) => left - right);
  return minutes.map(value => {
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    const parts = [];
    if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (rest || !hours) parts.push(`${rest} minute${rest === 1 ? '' : 's'}`);
    return { value: String(value), label: parts.join(' ') };
  });
}

/**
 * Every choice the Duration field offers, leading with "leave them alone".
 *
 * A list that omits the empty option is a one-way door: the form opens with no
 * override, the select shows its first length instead, and the reader cannot
 * get back to "each session keeps its own" once they have touched it. That is
 * what the Teams Meetings page's own copy of this field had become.
 */
function durationSelectOptions(form: TeamsCalendarForm, row: TeamsSchedulePreviewRow) {
  return [
    { value: '', label: 'Use scheduled duration for each session' },
    ...durationOptions(form.durationMinutes, row.durationMinutes, row.groupPattern?.durationMinutes || 0),
  ];
}

/** Where the offered default comes from, and what choosing one does. */
function durationFieldHint(row: TeamsSchedulePreviewRow, firstPlannedUtc: string): string {
  return [
    row.groupPattern?.durationMinutes
      ? `${row.groupPattern.name} runs ${durationLabel(row.groupPattern.durationMinutes)} sessions.`
      : '',
    firstPlannedUtc ? `First session ${calendarLabel(firstPlannedUtc, row.timeZone)}.` : '',
    'Choosing a length here books every session above at it.',
  ].filter(Boolean).join(' ');
}

/**
 * The form itself: what the calendar is built on, then what Teams needs.
 *
 * Controlled on purpose — both callers already own a form state with dirty
 * tracking and a Save button in their own dialog footer, so this renders their
 * value and reports edits rather than keeping a third copy of it.
 */
export function TeamsCalendarFormBody({
  row,
  form,
  patch,
  holidayLabelFor,
  prefilling,
  onPrefill,
  timeZoneLabel,
  existingCalendar = false,
}: {
  row: TeamsCalendarTarget;
  form: TeamsCalendarForm;
  patch: (value: Partial<TeamsCalendarForm>) => void;
  holidayLabelFor?: (date: string) => string;
  /** Loading state of the tutor/learner prefill, when the caller offers it. */
  prefilling?: boolean;
  onPrefill?: () => void;
  timeZoneLabel?: string;
  existingCalendar?: boolean;
}) {
  const previewRow = { ...row, timeZone: form.scheduleTimeZone || row.timeZone,
    plannedStarts: teamsCalendarOccurrences(row, form.scheduleTimeZone).map(item => item.startDateTimeUtc) };
  const firstPlanned = previewRow.plannedStarts[0] || '';
  const override = overrideDurationMinutes(form, row);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
          <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
        </span>
        <p className="text-[12px] text-foreground-600">
          {existingCalendar
            ? 'Update saves changes to this existing Teams calendar and refreshes the links in the module’s live-session components. The dates below are its saved bookings.'
            : row.sessions.length
            ? `Create puts one Teams meeting on each of the ${row.sessions.length} session date${row.sessions.length === 1 ? '' : 's'} below and writes the join link into this module’s live-session components. The dates come from the module, not from this form.`
            : 'This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.'}
        </p>
      </div>

      {Boolean(row.sessions.length) && (
        <>
          <ModuleSessionSchedulePreview
            row={previewRow}
            title={existingCalendar ? 'Dates on the existing calendar' : 'Dates the calendar will be created on'}
            holidayLabelFor={holidayLabelFor}
            overrideDuration={override}
          />

          <FormField label="Schedule time zone" hint="Group/module times are interpreted in this zone. Each date above shows the same meeting in Egypt and England, including daylight-saving changes.">
            <SelectControl value={form.scheduleTimeZone || getCalendarTimeZone()}
              disabled={existingCalendar}
              onChange={value => patch({ scheduleTimeZone: value as TeamsCalendarForm['scheduleTimeZone'] })}
              options={[{ value: 'Africa/Cairo', label: 'Egypt (Africa/Cairo)' }, { value: 'Europe/London', label: 'England (Europe/London)' }]} />
          </FormField>
          <FormField label="Teams series and links" hint="Different start times or durations need a separate weekly series for each day. Each day's link repeats every week.">
            <SelectControl disabled={existingCalendar} value={form.seriesMode || 'auto'} onChange={value => patch({ seriesMode: value as TeamsCalendarForm['seriesMode'] })} options={[
              { value: 'auto', label: 'Automatic: share a link when times match' },
              { value: 'per_day', label: 'Separate series and link for each day' },
              ...(existingCalendar || new Set(teamsCalendarOccurrences(row).map(item => `${naiveLocalFromUtc(item.startDateTimeUtc).slice(11)}:${form.durationMinutes || item.durationMinutes}`)).size <= 1 ? [{ value: 'shared', label: 'One series and link for all days' }] : []),
            ]} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Organizer Microsoft 365 email"
              required
              hint={existingCalendar ? 'This organizer owns the existing calendar.' : 'The calendar this series is created in. The selected account must allow this app to manage Teams meetings.'}
            >
              {existingCalendar ? <input aria-label="Organizer" readOnly value={form.organizerEmail}
                className="h-11 w-full rounded-lg border border-background-200 bg-background-100 px-3 text-[13px]" /> : <EntraPeopleInput single label="Organizer"
                value={form.organizerEmail}
                onChange={value => patch({ organizerEmail: value })}
              />}
            </FormField>
            <FormField label="Duration" hint={durationFieldHint(previewRow, firstPlanned)}>
              <SelectControl
                value={form.durationMinutes}
                onChange={value => patch({ durationMinutes: value })}
                options={durationSelectOptions(form, row)}
              />
            </FormField>
            <FormField label="Who can bypass the lobby?">
              <SelectControl
                value={form.lobbyBypass}
                onChange={value => patch({ lobbyBypass: value })}
                options={[
                  { value: 'invited', label: 'People invited to this meeting' },
                  { value: 'organization', label: 'People in my organization' },
                  { value: 'organization-excluding-guests', label: 'Organization, excluding guests' },
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'organizer', label: 'Only organizers' },
                ]}
              />
            </FormField>
            <FormField label="Recording">
              <SelectControl
                value={form.recording}
                onChange={value => patch({ recording: value })}
                options={[
                  { value: 'none', label: 'Do not start automatically' },
                  { value: 'record', label: 'Record automatically' },
                  { value: 'record-transcribe', label: 'Record and transcribe' },
                ]}
              />
            </FormField>
            <FormField label="Spoken language">
              <SelectControl
                value={form.spokenLanguage}
                onChange={value => patch({ spokenLanguage: value })}
                options={[
                  { value: 'en-GB', label: 'English (UK)' },
                  { value: 'en-US', label: 'English (US)' },
                  { value: 'ar-EG', label: 'Arabic (Egypt)' },
                  { value: 'fr-FR', label: 'French' },
                ]}
              />
            </FormField>
            {existingCalendar ? <p className="self-center text-[11px] text-foreground-500">The existing invitation text is preserved. Edit its details in Outlook.</p> : <FormField label="Details" hint="Optional. Included in the calendar invitation.">
              <TextAreaControl
                value={form.details}
                onChange={value => patch({ details: value })}
                rows={2}
              />
            </FormField>}
            {onPrefill && (
              <div className="sm:col-span-2 -mb-2 flex items-center justify-end">
                <button
                  type="button"
                  disabled={prefilling}
                  onClick={onPrefill}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:underline disabled:opacity-50"
                >
                  <AppIcon className="ri-refresh-line text-sm"></AppIcon>
                  {prefilling ? 'Loading…' : "Prefill from the module's tutor and learner plans"}
                </button>
              </div>
            )}
            <FormField label="Presenters" hint="These people can share and record.">
              <EntraPeopleInput label="Presenters"
                value={form.presenters}
                onChange={value => patch({ presenters: value })}
              />
            </FormField>
            <FormField
              label="Co-organisers"
              hint="They run the meeting with the organizer: start and stop the recording, admit people from the lobby and change the meeting options. Invited automatically."
            >
              <EntraPeopleInput label="Co-organizers"
                value={form.coOrganizers}
                onChange={value => patch({ coOrganizers: value })}
              />
            </FormField>
            <FormField label="Attendees" hint="Presenters and co-organisers are invited automatically.">
              <EntraPeopleInput label="Attendees"
                value={form.attendees}
                onChange={value => patch({ attendees: value })}
              />
            </FormField>
          </div>
          {(form.scheduleTimeZone || timeZoneLabel) && (
            <p className="text-[10px] font-semibold text-foreground-400">
              <AppIcon className="ri-time-line mr-1"></AppIcon>
              Schedule time zone: {form.scheduleTimeZone === 'Africa/Cairo' ? 'Egypt (Africa/Cairo)' : form.scheduleTimeZone === 'Europe/London' ? 'England (Europe/London)' : timeZoneLabel}
            </p>
          )}
        </>
      )}
    </div>
  );
}
