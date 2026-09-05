import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { CurriculumSession } from '@/lib/curriculumApi';
import {
  formatCalendarDateTime,
  getCalendarTimeZone,
  parseUtcInstant,
  zonedNaiveToUtcIso,
  type TeamsMeetingInput,
} from '../module-builder/moduleAuthoringData';
import { EmailChipsInput, emailList } from '../module-builder/EmailChipsInput';
import { cleanText, formatDateLabel } from '../shared/entities/model';
import {
  buildHolidayShiftPlan,
  CompactSchedulePreview,
  type HolidayShiftPlan,
} from '../shared/entities/sessionShiftPreview';
import { FormField, SelectControl, TextAreaControl, TextControl } from '../shared/entities/ui';

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

/** `YYYY-MM-DDTHH:mm` for a stored session — the wall clock the group meets on. */
export function sessionNaiveLocal(session: CurriculumSession): string {
  const time = cleanText(session.startTime).slice(0, 5) || DEFAULT_START_TIME;
  return `${cleanText(session.date)}T${time}`;
}

export function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = cleanText(startTime).split(':').map(Number);
  const [endHour, endMinute] = cleanText(endTime).split(':').map(Number);
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
export const calendarLabel = formatCalendarDateTime;

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
 * The cascade in words, above the dates that prove it.
 *
 * Shown the moved dates alone, a reader guesses "one session slipped" when the
 * whole tail did. The rule and its outcome are stated here instead — which
 * holiday closed which dates, how far the plan rolled, and the end date it
 * rolled to.
 */
function HolidayCascadeNote({ plan }: { plan: HolidayShiftPlan }) {
  if (!plan.closures.length) return null;
  const names = Array.from(new Set(plan.closures.map(closure => closure.label).filter(Boolean)));
  // One holiday named twice reads as two, so the dates only carry their own
  // label when more than one holiday closed them.
  const closureList = plan.closures
    .map(closure => (names.length > 1 && closure.label
      ? `${formatDateLabel(closure.date)} (${closure.label})`
      : formatDateLabel(closure.date)))
    .join(', ');
  const endMoved = Boolean(plan.originalEndDate)
    && Boolean(plan.shiftedEndDate)
    && plan.originalEndDate !== plan.shiftedEndDate;
  return (
    <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50/70 px-3 py-2.5">
      <AppIcon className="ri-calendar-close-line mt-0.5 shrink-0 text-sm text-amber-700"></AppIcon>
      <div className="space-y-1 text-[11px] leading-relaxed text-amber-900">
        <p>
          <span className="font-bold">{names.length ? names.join(', ') : 'A cohort holiday'}</span>
          {' closes '}
          <span className="font-semibold">{closureList}</span>
          {' inside this module’s dates.'}
        </p>
        <p>
          Sessions run to their normal pattern until one lands on a closed date. That session is not
          dropped — it moves to the next delivery day, and moves again if that day is closed too. Every
          session after it moves along by the same amount.
        </p>
        {Boolean(plan.movedCount) && (
          <p className="font-semibold">
            {plan.movedRangeLabel} {plan.movedCount === 1 ? 'runs' : 'run'} later
            {endMoved && (
              <>
                {', so the module now ends '}
                <span className="font-bold">{formatDateLabel(plan.shiftedEndDate)}</span>
                {' instead of '}
                {formatDateLabel(plan.originalEndDate)}
              </>
            )}
            .
          </p>
        )}
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
  name: string;
  sessions: CurriculumSession[];
  /** The module's own session dates, as the UTC instants Teams would hold. */
  plannedStarts: string[];
  /** What Teams holds today, in order, when it has been asked for. */
  teamsStarts: string[];
  durationMinutes: number;
  /** Present once the module has a Teams calendar; only its existence matters here. */
  summary?: unknown;
}

export function ModuleSessionSchedulePreview({
  row,
  title = 'Module session plan',
  calendarDates,
  holidayLabelFor,
  renderActions,
  renderFacts,
}: {
  row: TeamsSchedulePreviewRow;
  title?: string;
  calendarDates?: string[];
  holidayLabelFor?: (date: string) => string;
  /** The way into one meeting, shown on the session's own row. */
  renderActions?: (index: number, durationMinutes: number) => ReactNode;
  /** What one meeting left behind — attendance, transcript, recording. */
  renderFacts?: (index: number, durationMinutes: number) => ReactNode;
}) {
  const plan = buildHolidayShiftPlan(row.sessions, holidayLabelFor);
  const hasCalendar = Boolean(row.summary);
  // A meeting can outlive the module's stored dates. When that happens the
  // calendar entries are still the rows worth showing, so they are listed
  // against the date Teams holds rather than dropped for an empty state.
  const sessionRows: Array<CurriculumSession | undefined> = row.sessions.length
    ? row.sessions
    : row.teamsStarts.map(() => undefined);
  const occurrences = sessionRows.map((session, index) => {
    const teamsUtc = calendarDates?.[index] || row.teamsStarts[index] || '';
    const plannedUtc = session
      ? row.plannedStarts[index] || zonedNaiveToUtcIso(sessionNaiveLocal(session))
      : '';
    const durationMinutes = session
      ? Math.max(15, minutesBetween(session.startTime, session.endTime) || row.durationMinutes)
      : row.durationMinutes;
    const gap = teamsGapNote(plannedUtc, teamsUtc, hasCalendar);
    const facts = renderFacts?.(index, durationMinutes);
    return {
      session,
      plannedUtc: plannedUtc || teamsUtc,
      teamsUtc,
      durationMinutes,
      shift: plan.shifts[index],
      matches: gap.matches,
      actions: renderActions?.(index, durationMinutes),
      extra: gap.note || facts || !session ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {!session && <span className="font-semibold text-amber-700">Held on Teams, but the module has no session on this date.</span>}
          {facts}
          {gap.note && <span className="font-semibold text-amber-700">{gap.note}</span>}
        </span>
      ) : undefined,
    };
  });
  // Stated once when they all agree, and per row when they do not: a length
  // repeated down twenty rows is read as decoration, not as a fact.
  const durations = Array.from(new Set(occurrences.map(item => item.durationMinutes)));
  const uniformDuration = durations.length === 1 ? durations[0] : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
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
          <span className={`rounded-full border px-2.5 py-1 ${plan.movedCount ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {plan.movedCount ? `${plan.movedCount} moved by holidays` : 'No holiday shifts'}
          </span>
        </div>
      </div>
      <HolidayCascadeNote plan={plan} />
      {occurrences.length ? (
        <>
          <CompactSchedulePreview
            occurrences={occurrences}
            showDuration={!uniformDuration}
            formatLabel={(plannedUtc, date) => calendarLabel(plannedUtc || date)}
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
        <p className="px-3 py-4 text-[12px] font-semibold text-foreground-500">
          No stored session dates yet. Save the module schedule first.
        </p>
      )}
    </div>
  );
}

/** Everything the create form holds, and nothing a caller has to reproduce. */
export interface TeamsCalendarForm {
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
    title: '',
    organizerEmail: '',
    attendees: '',
    presenters: '',
    coOrganizers: '',
    details: '',
    durationMinutes: String(DEFAULT_DURATION_MINUTES),
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
export function teamsCalendarOccurrences(row: TeamsCalendarTarget) {
  return row.sessions.map((session, index) => ({
    sessionNumber: index + 1,
    startDateTimeUtc: zonedNaiveToUtcIso(sessionNaiveLocal(session)),
    durationMinutes: Math.max(15, minutesBetween(session.startTime, session.endTime) || row.durationMinutes),
  }));
}

/**
 * The create payload, built the same way from either door.
 *
 * The chosen duration applies to every occurrence, and the dates are the
 * module's own — a holiday-shifted plan included, which is what the backend
 * moves each Graph instance onto.
 */
export function buildTeamsCalendarInput(row: TeamsCalendarTarget, form: TeamsCalendarForm): TeamsMeetingInput {
  const meetingTitle = cleanText(row.name) || 'Live session';
  const duration = Math.max(15, Number(form.durationMinutes) || row.durationMinutes || DEFAULT_DURATION_MINUTES);
  const occurrences = teamsCalendarOccurrences(row).map(occurrence => ({ ...occurrence, durationMinutes: duration }));
  return {
    title: meetingTitle,
    organizerEmail: form.organizerEmail.trim(),
    attendees: emailList(form.attendees),
    presenters: emailList(form.presenters),
    coOrganizers: emailList(form.coOrganizers),
    moduleCatalogueId: row.catalogueId,
    moduleTitle: meetingTitle,
    localStartDateTime: sessionNaiveLocal(row.sessions[0]),
    startDateTimeUtc: occurrences[0].startDateTimeUtc,
    durationMinutes: duration,
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
    hideAttendees: false,
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
function durationOptions(picked: string, groupMinutes: number) {
  const minutes = Array.from(new Set([...DURATION_OPTIONS, groupMinutes, Number(picked) || 0]))
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
}: {
  row: TeamsCalendarTarget;
  form: TeamsCalendarForm;
  patch: (value: Partial<TeamsCalendarForm>) => void;
  holidayLabelFor?: (date: string) => string;
  /** Loading state of the tutor/learner prefill, when the caller offers it. */
  prefilling?: boolean;
  onPrefill?: () => void;
  timeZoneLabel?: string;
}) {
  const firstPlanned = row.plannedStarts[0] || '';
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
          <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
        </span>
        <p className="text-[12px] text-foreground-600">
          {row.sessions.length
            ? `Create puts one Teams meeting on each of the ${row.sessions.length} session date${row.sessions.length === 1 ? '' : 's'} below and writes the join link into this module’s live-session components. The dates come from the module, not from this form.`
            : 'This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.'}
        </p>
      </div>

      {Boolean(row.sessions.length) && (
        <>
          <ModuleSessionSchedulePreview
            row={row}
            title="Dates the calendar will be created on"
            holidayLabelFor={holidayLabelFor}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Organizer Microsoft 365 email"
              required
              hint="The calendar this series is created in. The selected account must allow this app to manage Teams meetings."
            >
              <TextControl
                value={form.organizerEmail}
                onChange={value => patch({ organizerEmail: value })}
              />
            </FormField>
            <FormField
              label="Duration"
              hint={firstPlanned ? `First session ${calendarLabel(firstPlanned)}.` : 'Defaults to the group session length.'}
            >
              <SelectControl
                value={form.durationMinutes}
                onChange={value => patch({ durationMinutes: value })}
                options={durationOptions(form.durationMinutes, row.durationMinutes)}
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
            <FormField label="Details" hint="Optional. Included in the calendar invitation.">
              <TextAreaControl
                value={form.details}
                onChange={value => patch({ details: value })}
                rows={2}
              />
            </FormField>
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
              <EmailChipsInput
                value={form.presenters}
                onChange={value => patch({ presenters: value })}
              />
            </FormField>
            <FormField
              label="Co-organisers"
              hint="They run the meeting with the organizer: start and stop the recording, admit people from the lobby and change the meeting options. Invited automatically."
            >
              <EmailChipsInput
                value={form.coOrganizers}
                onChange={value => patch({ coOrganizers: value })}
              />
            </FormField>
            <FormField label="Attendees" hint="Presenters and co-organisers are invited automatically.">
              <EmailChipsInput
                value={form.attendees}
                onChange={value => patch({ attendees: value })}
              />
            </FormField>
          </div>
          {timeZoneLabel && (
            <p className="text-[10px] font-semibold text-foreground-400">
              <AppIcon className="ri-time-line mr-1"></AppIcon>
              Microsoft calendar time zone: {timeZoneLabel}
            </p>
          )}
        </>
      )}
    </div>
  );
}
