import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { curriculumNavItems } from '@/mocks/navigation';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import {
  fetchCurriculumScopeLearnerRoster,
  fetchCurriculumSessions,
  fetchCurriculumTeamsMeetingSummaries,
  type CurriculumModule,
  type CurriculumSession,
  type CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';
import {
  createTeamsMeeting,
  fetchModuleMeetingInvitees,
  formatCalendarDateTime,
  getCalendarTimeZone,
  loadTeamsMeetingArtifacts,
  loadTeamsMeetingConfiguration,
  parseUtcInstant,
  restoreModuleTeamsMeeting,
  saveTeamsRecordingEvents,
  syncTeamsMeetingArtifacts,
  teamsMeetingArtifactPreviewUrl,
  updateTeamsMeetingSchedule,
  viewerZoneOffset,
  zonedNaiveToUtcIso,
  type TeamsMeetingArtifact,
  type TeamsMeetingArtifactsResult,
  type TeamsMeetingInput,
  type TeamsRecordingEventInput,
} from '../module-builder/moduleAuthoringData';
import { EmailChipsInput, emailList } from '../module-builder/EmailChipsInput';
import {
  cleanText,
  cohortsForProgramme,
  formatDateLabel,
  matchesSearch,
  moduleIdentity,
  modulesForScope,
  namedCurriculumWorkspacePath,
  normaliseKey,
  programmeIdentity,
  resolveModuleContext,
} from '../shared/entities/model';
import {
  buildHolidayShiftPlan,
  CompactSchedulePreview,
  type HolidayShiftPlan,
  type SessionShift,
} from '../shared/entities/sessionShiftPreview';
import {
  DetailRow,
  EntityDrawer,
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  FormField,
  InlineError,
  PlainCell,
  SelectControl,
  StackedCell,
  TextAreaControl,
  TextControl,
} from '../shared/entities/ui';
import { useDrawerState } from '../shared/entities/useDrawerState';

// ============================================================================
// Teams Meetings — one row per module, and the schedule side of the Teams work.
//
// The module's own stored session dates are the authority here: they are the
// dates the backend generated after the cohort's holidays were applied, and the
// Teams calendar has to be made to agree with them. Graph can only hold an
// unbroken weekly recurrence, so a holiday-shifted plan is reconciled instance
// by instance — which is what `updateTeamsMeetingSchedule` does with the
// `scheduledOccurrences` this page sends.
//
// Attendance, transcripts and recordings stay read-mostly: they are pulled back
// from Teams after a meeting has run, and the same panel that shows them is in
// the module workspace. Nothing here creates a second way to author a module.
// ============================================================================

const GRID = 'grid grid-cols-[minmax(170px,1.2fr)_minmax(140px,1fr)_minmax(150px,1fr)_minmax(130px,.9fr)_minmax(104px,.7fr)_minmax(120px,.8fr)_minmax(300px,auto)]';

const COLUMNS = [
  { label: 'Module' },
  { label: 'Cohort / Group' },
  { label: 'Organizer' },
  { label: 'First meeting' },
  { label: 'Sessions', align: 'center' as const },
  { label: 'Calendar' },
  { label: 'Actions', align: 'right' as const },
];

const DEFAULT_START_TIME = '09:00';
const DEFAULT_DURATION_MINUTES = 60;

type CalendarState = 'in-sync' | 'out-of-sync' | 'not-created' | 'no-sessions';

const STATE_LABELS: Record<CalendarState, string> = {
  'in-sync': 'In sync',
  'out-of-sync': 'Dates differ',
  'not-created': 'Not created',
  'no-sessions': 'No sessions',
};

const STATE_TONES: Record<CalendarState, string> = {
  'in-sync': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'out-of-sync': 'border-amber-200 bg-amber-50 text-amber-800',
  'not-created': 'border-background-200 bg-background-100 text-foreground-500',
  'no-sessions': 'border-background-200 bg-background-100 text-foreground-500',
};

/**
 * The minute a UTC instant falls on, for comparing two dates for equality.
 *
 * Instants, never wall clocks: the module's plan and the Teams calendar are
 * compared as the same absolute moment, so a reader in another zone can never
 * turn a matching date into "will be moved".
 */
function minuteKey(value: unknown): string {
  const instant = parseUtcInstant(value);
  return Number.isNaN(instant.getTime()) ? '' : instant.toISOString().slice(0, 16);
}

/** `YYYY-MM-DDTHH:mm` for a stored session — the wall clock the group meets on. */
function sessionNaiveLocal(session: CurriculumSession): string {
  const time = cleanText(session.startTime).slice(0, 5) || DEFAULT_START_TIME;
  return `${cleanText(session.date)}T${time}`;
}

function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = cleanText(startTime).split(':').map(Number);
  const [endHour, endMinute] = cleanText(endTime).split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(value => !Number.isFinite(value))) return 0;
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

/** The same wall clock a UTC instant shows on the Microsoft calendar. */
function naiveLocalFromUtc(value: unknown, timeZone = getCalendarTimeZone()): string {
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
const calendarLabel = formatCalendarDateTime;

/**
 * Row actions with their names on them. The shared `RowActions` is icon-only,
 * which works where the verb is obvious (edit, archive); here it is not — "send
 * the module's dates to Teams" and "fetch what Teams recorded" are two different
 * kinds of sync, and a glyph makes the reader guess which is which.
 */
function NamedActions({ actions }: {
  actions: Array<{
    icon: string;
    label: string;
    title: string;
    onClick: () => void;
    disabled?: boolean;
    primary?: boolean;
    busy?: boolean;
  }>;
}) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5 self-center">
      {actions.map(action => (
        <button
          key={action.label}
          type="button"
          title={action.title}
          disabled={action.disabled}
          onClick={event => { event.stopPropagation(); action.onClick(); }}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth disabled:cursor-not-allowed disabled:opacity-50 ${
            action.primary
              ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700'
              : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
          }`}
        >
          <AppIcon className={`${action.busy ? 'ri-loader-4-line animate-spin' : action.icon} text-sm`}></AppIcon>
          {action.label}
        </button>
      ))}
    </span>
  );
}

interface MeetingRow {
  module: CurriculumModule;
  catalogueId: string;
  name: string;
  programmeName: string;
  cohortName: string;
  groupName: string;
  summary?: CurriculumTeamsMeetingSummary;
  sessions: CurriculumSession[];
  /** The module's own session dates, as the UTC instants Teams would hold. */
  plannedStarts: string[];
  /** What Teams holds today, in order, when it has been asked for. */
  teamsStarts: string[];
  durationMinutes: number;
  state: CalendarState;
  differingSessions: number;
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
 * Where one meeting sits against the clock.
 *
 * A join link is only worth offering while the meeting can still be joined, and
 * a row for a meeting that already happened should say so rather than invite a
 * click that lands in an empty lobby. The window opens a quarter of an hour
 * early because people join before the hour, and closes when the session's own
 * end time passes.
 */
type MeetingRunState = 'unknown' | 'upcoming' | 'live' | 'ended';

function meetingRunState(startIso: string, durationMinutes: number, now: number): MeetingRunState {
  const start = parseUtcInstant(startIso).getTime();
  if (Number.isNaN(start)) return 'unknown';
  const end = start + Math.max(15, durationMinutes) * 60000;
  if (now >= end) return 'ended';
  if (now >= start - 15 * 60000) return 'live';
  return 'upcoming';
}

/**
 * What sending the dates would actually change on the Teams calendar.
 *
 * Only the difference is reported. The module's date is the authority and it is
 * already on the row, so a calendar entry that agrees with it has nothing to
 * say — printing "same as the module" against every session was the same fact
 * three times over, and twenty rows of it buried the one row that had moved.
 *
 * A day and an hour are reported apart: a calendar entry on the right day at
 * the wrong time is not "moved" in any sense a reader would recognise, so it
 * names the hour Teams is holding and leaves the date alone.
 */
function teamsGapNote(plannedUtc: string, teamsUtc: string, hasCalendar: boolean): { matches: boolean; note: string } {
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
 * A head count that opens onto the names behind it.
 *
 * "2 invited" answers how many but not who, and finding out used to mean opening
 * the invitations form — an editor, for a question that is only a read. The
 * count is the control now: it says who is on the invite, in place, and folds
 * back up.
 */
function InvitedPeopleList({ emails, empty }: { emails: string[]; empty: string }) {
  const [open, setOpen] = useState(false);
  if (!emails.length) return <>{empty}</>;
  return (
    <span className="inline-block text-right">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        title={open ? 'Hide the invite list.' : 'Show who is on the invite.'}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-700 transition-smooth hover:underline"
      >
        {`${emails.length} invited`}
        <AppIcon className={`text-sm ${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></AppIcon>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {emails.map(email => (
            <li key={email} className="truncate text-[11px] font-semibold text-foreground-600">{email}</li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * The module's session plan, and what the Teams calendar makes of it.
 *
 * One list, and the same list the module form shows: sessions grouped by the
 * month they land in, the session a holiday closed shown in red beside the green
 * row for the day it moved to. It used to be a table whose two leading columns
 * held the same timestamp — the module's date, then the calendar's date, then a
 * line saying they agreed — so the reader compared a column against itself and
 * the one row that had genuinely moved read like the other nine.
 *
 * Now only differences are written down. A row says its date and its weekday;
 * the length is stated once above the list while every session runs for the same
 * number of minutes; and the footer under a row appears only when there is
 * something there to act on — a calendar entry to be moved, an attendance count,
 * a recording to watch.
 *
 * `renderActions` and `renderFacts` are how the caller hangs the meeting itself
 * off these rows without a second copy of the dates underneath.
 */
function ModuleSessionSchedulePreview({
  row,
  title = 'Module session plan',
  calendarDates,
  holidayLabelFor,
  renderActions,
  renderFacts,
}: {
  row: MeetingRow;
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
              <span className="font-bold text-foreground-700">Send session dates to Teams</span>.
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

/**
 * Play a session recording in place, and record how it was watched.
 *
 * A reviewer watching the recording is standing in for having attended, so the
 * play/pause/skip trail belongs with the session the same way the attendance
 * report does. Who watched is filled in by the backend from the signed-in
 * session rather than declared here. Tracking is best-effort on purpose: a
 * failed post must never interrupt playback, so every send swallows its error.
 */
function RecordingPreview({ liveSessionId, artifact, title, onClose }: {
  liveSessionId: string;
  artifact: TeamsMeetingArtifact;
  title: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queued = useRef<TeamsRecordingEventInput[]>([]);
  const previewSessionId = useRef('');
  const lastTime = useRef(0);
  const watchedSinceSend = useRef(0);

  const flush = useCallback(async () => {
    if (!queued.current.length) return;
    const events = queued.current.splice(0, queued.current.length);
    try {
      const result = await saveTeamsRecordingEvents(liveSessionId, artifact.id, {
        previewSessionId: previewSessionId.current || undefined,
        browser: {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          userAgent: window.navigator.userAgent,
          pageUrl: window.location.href,
        },
        events,
      });
      previewSessionId.current = result.previewSessionId || previewSessionId.current;
    } catch {
      // Watch tracking is not worth a broken player.
    }
  }, [artifact.id, liveSessionId]);

  const record = useCallback((type: TeamsRecordingEventInput['type'], extra: Partial<TeamsRecordingEventInput> = {}) => {
    const video = videoRef.current;
    queued.current.push({
      type,
      videoTimeSeconds: video?.currentTime ?? 0,
      durationSeconds: Number.isFinite(video?.duration) ? video?.duration : undefined,
      playbackRate: video?.playbackRate ?? 1,
      watchedSecondsDelta: watchedSinceSend.current,
      eventTime: new Date().toISOString(),
      ...extra,
    });
    watchedSinceSend.current = 0;
  }, []);

  // Opening and closing bracket the watch, and a heartbeat keeps a long sit
  // from arriving as one event at the end.
  useEffect(() => {
    record('open');
    const timer = window.setInterval(() => { record('heartbeat'); void flush(); }, 15000);
    return () => {
      window.clearInterval(timer);
      record('close');
      void flush();
    };
  }, [flush, record]);

  const preview = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Recording — ${title}`}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Session recording</p>
            <h3 className="mt-0.5 truncate text-[15px] font-heading font-bold text-foreground-950">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
          >
            <AppIcon className="ri-close-line text-sm"></AppIcon>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-black/90 p-3">
          <video
            ref={videoRef}
            controls
            preload="metadata"
            className="mx-auto max-h-[62vh] w-full rounded-xl bg-black"
            src={teamsMeetingArtifactPreviewUrl(liveSessionId, artifact.id)}
            onPlay={() => record('play')}
            onPause={() => { if (!videoRef.current?.ended) record('pause'); }}
            onEnded={() => { record('ended'); void flush(); }}
            onTimeUpdate={() => {
              const current = videoRef.current?.currentTime ?? 0;
              const delta = current - lastTime.current;
              // Only forward, real-time progress counts as watched; a jump is a
              // skip and is reported as one by the seek handler instead.
              if (delta > 0 && delta < 2) watchedSinceSend.current += delta;
              lastTime.current = current;
            }}
            onSeeked={() => {
              const current = videoRef.current?.currentTime ?? 0;
              record('seeked', {
                previousVideoTimeSeconds: lastTime.current,
                skipFromSeconds: lastTime.current,
                skipToSeconds: current,
              });
              lastTime.current = current;
            }}
          />
        </div>
        <p className="shrink-0 border-t border-background-200 px-5 py-3 text-[11px] font-semibold text-foreground-400">
          Watching is recorded against this session — who watched, and which parts were skipped.
        </p>
      </div>
    </div>
  );
  // A plain child of the page sits inside the same DOM branch as the module
  // detail Modal it is opened from, and that Modal already portals itself to
  // document.body -- so this stayed a sibling of #root while the Modal's own
  // content moved past it, and lost the paint order regardless of matching
  // z-index. Portalling here too puts both at the same level, and this one
  // mounts after (only once "Watch recording" is clicked), so it paints on top.
  return typeof document === 'undefined' ? preview : createPortal(preview, document.body);
}

interface TranscriptCue {
  start: string;
  speaker: string;
  text: string;
}

/** `00:12:03.400` -> `12:03`; drops the hour segment when it is `00`. */
function formatVttTimestamp(value: string): string {
  const match = /^(\d+):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const [, hours, minutes, seconds] = match;
  return hours === '00' ? `${minutes}:${seconds}` : `${hours}:${minutes}:${seconds}`;
}

/** WEBVTT text, one cue per timed block, into `{ start, speaker, text }`. */
function parseVttCues(vtt: string): TranscriptCue[] {
  return vtt
    .replace(/\r/g, '')
    .split(/\n\n+/)
    .map((block): TranscriptCue | null => {
      const lines = block.split('\n').filter(Boolean);
      const timeIndex = lines.findIndex(line => line.includes('-->'));
      if (timeIndex === -1) return null;
      const start = formatVttTimestamp(lines[timeIndex].split('-->')[0]);
      const raw = lines.slice(timeIndex + 1).join(' ');
      const speakerMatch = /<v\s+([^>]+)>/.exec(raw);
      const text = raw.replace(/<\/?v[^>]*>/g, '').trim();
      return text ? { start, speaker: speakerMatch?.[1].trim() || '', text } : null;
    })
    .filter((cue): cue is TranscriptCue => cue !== null);
}

/**
 * The transcript, read in place rather than downloaded as a `.vtt` file — the
 * same "watch it here" treatment `RecordingPreview` gives the recording, and
 * portalled to `document.body` for the same reason: a plain child would sit
 * inside the module detail Modal's DOM branch and lose the paint order to it
 * even at an equal z-index, because that Modal already portals itself out.
 */
function TranscriptPreview({ liveSessionId, artifact, title, onClose }: {
  liveSessionId: string;
  artifact: TeamsMeetingArtifact;
  title: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; cues: TranscriptCue[] }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(teamsMeetingArtifactPreviewUrl(liveSessionId, artifact.id))
      .then(response => {
        if (!response.ok) throw new Error(`The transcript could not be loaded (${response.status}).`);
        return response.text();
      })
      .then(text => { if (!cancelled) setState({ status: 'ready', cues: parseVttCues(text) }); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'The transcript could not be loaded.' });
        }
      });
    return () => { cancelled = true; };
  }, [artifact.id, liveSessionId]);

  const preview = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Transcript — ${title}`}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Session transcript</p>
            <h3 className="mt-0.5 truncate text-[15px] font-heading font-bold text-foreground-950">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
          >
            <AppIcon className="ri-close-line text-sm"></AppIcon>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {state.status === 'loading' && (
            <p className="text-[12px] font-semibold text-foreground-500">Loading transcript…</p>
          )}
          {state.status === 'error' && (
            <p className="text-[12px] font-semibold text-red-600">{state.message}</p>
          )}
          {state.status === 'ready' && (
            state.cues.length ? (
              <ul className="space-y-3">
                {state.cues.map((cue, index) => (
                  <li key={index} className="text-[13px] leading-relaxed">
                    <span className="font-bold text-foreground-400">{cue.start}</span>
                    {cue.speaker && <span className="ml-2 font-bold text-primary-700">{cue.speaker}</span>}
                    <p className="mt-0.5 text-foreground-800">{cue.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] font-semibold text-foreground-500">No transcript text was found.</p>
            )
          )}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? preview : createPortal(preview, document.body);
}

interface PeopleForm {
  attendees: string;
  presenters: string;
}

interface CreateForm {
  title: string;
  organizerEmail: string;
  attendees: string;
  presenters: string;
  details: string;
  durationMinutes: string;
  lobbyBypass: string;
  recording: string;
  spokenLanguage: string;
  meetingType: string;
}

export default function CurriculumTeamsMeetingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { programmes, cohorts, groups, modules, tutors, holidays, loading, loaded, error, reload } = useCurriculumEntities({ includeHolidays: true, includeStaff: true });

  const [summaries, setSummaries] = useState<CurriculumTeamsMeetingSummary[]>([]);
  const [sessions, setSessions] = useState<CurriculumSession[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [graphConfigured, setGraphConfigured] = useState(true);
  const [defaultOrganizer, setDefaultOrganizer] = useState('');
  const [organizerLocked, setOrganizerLocked] = useState(false);
  const [timeZoneLabel, setTimeZoneLabel] = useState('');

  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState(searchParams.get('programme') || '');
  const [cohortFilter, setCohortFilter] = useState(searchParams.get('cohort') || '');
  const [stateFilter, setStateFilter] = useState(searchParams.get('state') || '');
  const [selectedId, setSelectedId] = useState(searchParams.get('module') || '');

  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'error'; text: string } | null>(null);
  const [detail, setDetail] = useState<TeamsMeetingArtifactsResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ liveSessionId: string; artifact: TeamsMeetingArtifact; title: string } | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState<{ liveSessionId: string; artifact: TeamsMeetingArtifact; title: string } | null>(null);
  // Whether a session is joinable or over is a fact about right now, so the
  // page keeps its own minute hand rather than freezing at first render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const peopleDrawer = useDrawerState<PeopleForm>({ attendees: '', presenters: '' });
  const createDrawer = useDrawerState<CreateForm>({
    title: '', organizerEmail: '', attendees: '', presenters: '', details: '',
    durationMinutes: String(DEFAULT_DURATION_MINUTES),
    lobbyBypass: 'invited', recording: 'record-transcribe', spokenLanguage: 'en-GB', meetingType: 'live-session',
  });
  const [drawerTarget, setDrawerTarget] = useState<MeetingRow | null>(null);
  const [invitedPrefilling, setInvitedPrefilling] = useState(false);
  // Guards a fetchModuleMeetingInvitees() response against landing after the
  // caller has since opened a different module's drawer (or closed it).
  const inviteesRequestId = useRef(0);

  // ------------------------------------------------------------------ loads

  const loadTeamsState = useCallback(async (signal?: AbortSignal) => {
    setTeamsLoading(true);
    try {
      const [nextSummaries, nextSessions] = await Promise.all([
        fetchCurriculumTeamsMeetingSummaries(signal, { occurrenceDates: true, skipCache: true }),
        fetchCurriculumSessions(signal),
      ]);
      if (signal?.aborted) return;
      setSummaries(nextSummaries);
      setSessions(nextSessions);
      setTeamsError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setTeamsError(err instanceof Error ? err.message : 'Unable to load the tracked Teams meetings.');
    } finally {
      if (!signal?.aborted) setTeamsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTeamsState(controller.signal);
    return () => controller.abort();
  }, [loadTeamsState]);

  // The organizer default and the calendar's timezone both come from the
  // backend's Graph configuration — never from this browser's own zone.
  useEffect(() => {
    let active = true;
    loadTeamsMeetingConfiguration()
      .then(configuration => {
        if (!active) return;
        setGraphConfigured(configuration.configured);
        setDefaultOrganizer(configuration.defaultOrganizer || '');
        setOrganizerLocked(Boolean(configuration.organizerLocked));
        setTimeZoneLabel(configuration.timeZone || configuration.timeZoneIana || '');
      })
      .catch(() => { if (active) setGraphConfigured(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (programmeFilter) next.set('programme', programmeFilter); else next.delete('programme');
    if (cohortFilter) next.set('cohort', cohortFilter); else next.delete('cohort');
    if (stateFilter) next.set('state', stateFilter); else next.delete('state');
    if (selectedId) next.set('module', selectedId); else next.delete('module');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [cohortFilter, programmeFilter, searchParams, selectedId, setSearchParams, stateFilter]);

  const scopedCohorts = useMemo(
    () => cohortsForProgramme(cohorts, programmes, programmeFilter),
    [cohorts, programmes, programmeFilter],
  );
  useEffect(() => {
    if (!cohortFilter) return;
    if (scopedCohorts.some(cohort => normaliseKey(cohort.id) === normaliseKey(cohortFilter))) return;
    setCohortFilter('');
  }, [cohortFilter, scopedCohorts]);

  // -------------------------------------------------------------- row model

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

  const summaryByModule = useMemo(() => {
    const map = new Map<string, CurriculumTeamsMeetingSummary>();
    summaries.forEach(summary => map.set(normaliseKey(summary.moduleCatalogueId), summary));
    return map;
  }, [summaries]);

  const sessionsByModule = useMemo(() => {
    const map = new Map<string, CurriculumSession[]>();
    sessions.forEach(session => {
      const key = normaliseKey(session.moduleCatalogueId) || normaliseKey(session.moduleId);
      if (!key) return;
      const list = map.get(key);
      if (list) list.push(session); else map.set(key, [session]);
    });
    map.forEach(list => list.sort((left, right) => (
      `${left.date}T${left.startTime}`.localeCompare(`${right.date}T${right.startTime}`)
    )));
    return map;
  }, [sessions]);

  const rows = useMemo<MeetingRow[]>(() => {
    return modules.map(module => {
      const catalogueId = moduleIdentity(module);
      const key = normaliseKey(catalogueId);
      const context = resolveModuleContext(module, groups, cohorts, programmes);
      const summary = summaryByModule.get(key);
      const moduleSessions = sessionsByModule.get(key) || [];
      const plannedStarts = moduleSessions.map(session => zonedNaiveToUtcIso(sessionNaiveLocal(session)));
      const teamsStarts = summary?.occurrenceDates || [];
      const firstSession = moduleSessions[0];
      const durationMinutes = Math.max(
        15,
        minutesBetween(firstSession?.startTime || '', firstSession?.endTime || '')
          || summary?.durationMinutes
          || DEFAULT_DURATION_MINUTES,
      );

      let state: CalendarState = 'not-created';
      let differingSessions = 0;
      if (summary && !moduleSessions.length) {
        state = 'no-sessions';
      } else if (summary) {
        const teamsKeys = teamsStarts.map(minuteKey);
        differingSessions = plannedStarts.reduce((count, planned, index) => (
          minuteKey(planned) === teamsKeys[index] ? count : count + 1
        ), 0) + Math.max(0, teamsKeys.length - plannedStarts.length);
        state = differingSessions ? 'out-of-sync' : 'in-sync';
      } else if (!moduleSessions.length) {
        state = 'no-sessions';
      }

      return {
        module,
        catalogueId,
        name: cleanText(module.name, 'Untitled module'),
        programmeName: context.programmeName,
        cohortName: context.cohortName,
        groupName: context.groupName,
        summary,
        sessions: moduleSessions,
        plannedStarts,
        teamsStarts,
        durationMinutes,
        state,
        differingSessions,
      };
    });
  }, [cohorts, groups, modules, programmes, sessionsByModule, summaryByModule]);

  // The tutor is the module's own assignment (a name, from `enrolment.Staff_users`
  // by way of the curriculum staff directory), so the meeting's presenter is
  // looked up from the same directory rather than typed in here.
  const tutorEmailByName = useMemo(() => {
    const map = new Map<string, string>();
    tutors.forEach(profile => {
      const key = normaliseKey(cleanText(profile.name));
      const email = cleanText(profile.email);
      if (key && email) map.set(key, email);
    });
    return map;
  }, [tutors]);

  const presentersFor = useCallback((row: MeetingRow): string[] => {
    const tutorName = cleanText(row.module.tutor);
    if (!tutorName || tutorName === 'Unassigned') return [];
    const email = tutorEmailByName.get(normaliseKey(tutorName));
    return email ? [email] : [];
  }, [tutorEmailByName]);

  // Learner emails come from enrolment's own roster (`Learner.learners.email`)
  // for the group this module delivers to — never typed in by hand. Fetched on
  // demand and cached per module, since most rows never open either dialog.
  const [moduleLearnerEmails, setModuleLearnerEmails] = useState<Map<string, string[]>>(new Map());
  const pendingLearnerFetches = useRef<Map<string, Promise<string[]>>>(new Map());
  const ensureLearnerEmails = useCallback((catalogueId: string): Promise<string[]> => {
    const key = normaliseKey(catalogueId);
    if (!key) return Promise.resolve([]);
    const cached = moduleLearnerEmails.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = pendingLearnerFetches.current.get(key);
    if (pending) return pending;
    const request = fetchCurriculumScopeLearnerRoster('module', catalogueId)
      .then(roster => {
        const emails = Array.from(new Set(
          (roster.assignedLearners || []).map(learner => cleanText(learner.email)).filter(Boolean),
        ));
        setModuleLearnerEmails(previous => {
          const next = new Map(previous);
          next.set(key, emails);
          return next;
        });
        return emails;
      })
      .catch(() => [] as string[])
      .finally(() => { pendingLearnerFetches.current.delete(key); });
    pendingLearnerFetches.current.set(key, request);
    return request;
  }, [moduleLearnerEmails]);

  const visibleRows = useMemo(() => {
    const scoped = new Set(
      modulesForScope(modules, groups, cohorts, programmes, {
        programmeId: programmeFilter,
        cohortId: cohortFilter,
      }).map(module => normaliseKey(moduleIdentity(module))),
    );
    return rows.filter(row => {
      if (!scoped.has(normaliseKey(row.catalogueId))) return false;
      // Modules with neither a meeting nor a session plan have nothing to show
      // here, and they are the bulk of the catalogue — the unfiltered view is
      // "modules whose Teams calendar is a live concern".
      if (!row.summary && !row.sessions.length) return false;
      if (stateFilter && row.state !== stateFilter) return false;
      return matchesSearch(search, [
        row.name, row.catalogueId, row.cohortName, row.groupName, row.programmeName,
        row.summary?.organizerEmail, row.summary?.liveSessionId,
      ]);
    });
  }, [cohortFilter, cohorts, groups, modules, programmeFilter, programmes, rows, search, stateFilter]);

  const selected = useMemo(
    () => rows.find(row => normaliseKey(row.catalogueId) === normaliseKey(selectedId)) || null,
    [rows, selectedId],
  );

  const stats = useMemo(() => {
    const tracked = rows.filter(row => row.summary);
    return {
      tracked: tracked.length,
      inSync: tracked.filter(row => row.state === 'in-sync').length,
      drifted: tracked.filter(row => row.state === 'out-of-sync').length,
      toCreate: rows.filter(row => !row.summary && row.sessions.length).length,
    };
  }, [rows]);

  // ---------------------------------------------------------- detail loader

  const loadDetail = useCallback(async (liveSessionId: string) => {
    if (!liveSessionId) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await loadTeamsMeetingArtifacts(liveSessionId));
    } catch (err) {
      setDetail(null);
      setDetailError(err instanceof Error ? err.message : 'Unable to load this meeting from Teams.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const liveSessionId = selected?.summary?.liveSessionId || '';
    if (!liveSessionId) { setDetail(null); setDetailError(null); return; }
    void loadDetail(liveSessionId);
  }, [loadDetail, selected?.summary?.liveSessionId]);

  // --------------------------------------------------------------- actions

  /** The module's own session dates, in the shape the Teams endpoints take. */
  const scheduledOccurrences = (row: MeetingRow) => row.sessions.map((session, index) => ({
    sessionNumber: index + 1,
    startDateTimeUtc: zonedNaiveToUtcIso(sessionNaiveLocal(session)),
    durationMinutes: Math.max(15, minutesBetween(session.startTime, session.endTime) || row.durationMinutes),
  }));

  const pushDates = async (row: MeetingRow) => {
    const summary = row.summary;
    if (!summary || !row.sessions.length) return;
    const occurrences = scheduledOccurrences(row);
    setBusy(`${row.catalogueId}:dates`);
    setNotice(null);
    try {
      const result = await updateTeamsMeetingSchedule(summary.liveSessionId, {
        title: row.name,
        organizerEmail: summary.organizerEmail,
        eventId: summary.eventId,
        localStartDateTime: sessionNaiveLocal(row.sessions[0]),
        startDateTimeUtc: occurrences[0].startDateTimeUtc,
        durationMinutes: occurrences[0].durationMinutes,
        repeat: occurrences.length > 1 ? 'weekly' : 'none',
        repeatOccurrences: occurrences.length,
        scheduledOccurrences: occurrences,
      });
      await loadTeamsState();
      const warnings = result.warnings || [];
      if (warnings.length) {
        setNotice({
          tone: 'warning',
          text: `${row.name}: the session dates are saved here, but Microsoft Teams did not accept every shifted meeting. ${warnings[0].message}`,
        });
      }
      await showCurriculumAlert({
        title: warnings.length ? 'Sent with warnings' : 'Teams calendar updated',
        text: `${occurrences.length} session date${occurrences.length === 1 ? '' : 's'} sent to the Teams calendar for ${row.name}.`,
        timer: warnings.length ? undefined : 2000,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'The session dates could not be sent to Teams.' });
    } finally {
      setBusy('');
    }
  };

  const fetchArtifacts = async (row: MeetingRow) => {
    const summary = row.summary;
    if (!summary) return;
    setBusy(`${row.catalogueId}:artifacts`);
    setNotice(null);
    try {
      const result = await syncTeamsMeetingArtifacts(summary.liveSessionId);
      setSelectedId(row.catalogueId);
      await Promise.all([loadDetail(summary.liveSessionId), loadTeamsState()]);
      await showCurriculumAlert({
        title: result.partial ? 'Some Teams data could not be fetched' : 'Attendance and recordings updated',
        text: `Saved ${result.synced.attendanceRecords} attendance record${result.synced.attendanceRecords === 1 ? '' : 's'}, ${result.synced.transcripts} transcript${result.synced.transcripts === 1 ? '' : 's'} and ${result.synced.recordings} recording${result.synced.recordings === 1 ? '' : 's'}.`,
        timer: result.partial ? undefined : 2200,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'The Teams sync failed.' });
    } finally {
      setBusy('');
    }
  };

  /**
   * Give every week of the module a live-session component holding this meeting.
   *
   * A created series is only really in front of the learner once each week has
   * a session to open, on that week's own date. So this does not just rewrite
   * the components that already exist: a week with none is given one, which is
   * what makes this the one action that finishes the job for a whole module.
   */
  const reattach = async (row: MeetingRow) => {
    setBusy(`${row.catalogueId}:reattach`);
    setNotice(null);
    try {
      const result = await restoreModuleTeamsMeeting(row.catalogueId, { createMissingComponents: true });
      const created = result.createdComponents || 0;
      const updated = result.updatedComponents || 0;
      const parts = [
        created ? `${created} live-session component${created === 1 ? '' : 's'} created` : '',
        updated ? `${updated} updated` : '',
      ].filter(Boolean);
      await showCurriculumAlert({
        title: created ? 'Live sessions added to the module' : 'Meeting re-attached',
        text: parts.length
          ? `${parts.join(', ')} — each week now opens its own session, on its own date.`
          : 'This module has no weeks to hold a live session yet.',
        timer: 2600,
      });
      await loadTeamsState();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'The meeting could not be re-attached.' });
    } finally {
      setBusy('');
    }
  };

  /**
   * Presenters/Attendees derived from the module itself: its assigned tutor as
   * presenter, every learner whose training plan carries this module as
   * attendee. Only ever a starting point — it patches whichever drawer form is
   * open, never sends anything on its own, and a response arriving after the
   * caller has since switched modules or closed the drawer is dropped rather
   * than applied to the wrong one.
   */
  const prefillInvitees = async (
    row: MeetingRow,
    patch: (value: { attendees: string; presenters: string }) => void,
  ) => {
    const requestId = ++inviteesRequestId.current;
    setInvitedPrefilling(true);
    try {
      const result = await fetchModuleMeetingInvitees(row.catalogueId);
      if (inviteesRequestId.current !== requestId) return;
      patch({
        attendees: result.attendees.join('\n'),
        presenters: result.presenters.join('\n'),
      });
    } catch {
      // Best-effort: the form stays usable with people typed in by hand.
    } finally {
      if (inviteesRequestId.current === requestId) setInvitedPrefilling(false);
    }
  };

  /**
   * Presenters and attendees are not typed in here: the presenter is this
   * module's tutor and the attendees are the learners enrolment placed in its
   * group, both read fresh so the invite list always matches who is actually
   * assigned. Fetched before the drawer opens rather than patched in after, so
   * a plain close right afterwards is never mistaken for an unsaved edit.
   */
  const openPeople = async (row: MeetingRow) => {
    setDrawerTarget(row);
    const [presenters, attendees] = await Promise.all([
      Promise.resolve(presentersFor(row)),
      ensureLearnerEmails(row.catalogueId),
    ]);
    peopleDrawer.openWith({
      attendees: attendees.join('\n'),
      presenters: presenters.join('\n'),
    });
  };

  const savePeople = async () => {
    const row = drawerTarget;
    const summary = row?.summary;
    if (!row || !summary) return;
    const presenters = emailList(peopleDrawer.form.presenters);
    const attendees = emailList(peopleDrawer.form.attendees);
    if (!presenters.length && !attendees.length) {
      peopleDrawer.setError('Name at least one attendee or presenter.');
      return;
    }
    // Only the invitation list is being changed, so the dates sent back are the
    // ones Teams already holds. Moving dates is the separate action — and with
    // the held dates unknown, saving would shorten the series to whatever this
    // form could name, so it refuses rather than guessing.
    const held = (summary.occurrenceDates || []).filter(Boolean);
    if (!held.length) {
      peopleDrawer.setError('The meeting dates for this series have not loaded, so saving now could shorten it. Reload the page and try again.');
      return;
    }
    const occurrences = held.map((value, index) => ({
      sessionNumber: index + 1,
      startDateTimeUtc: parseUtcInstant(value).toISOString(),
      durationMinutes: summary.durationMinutes || row.durationMinutes,
    }));
    peopleDrawer.setSaving(true);
    peopleDrawer.setError(null);
    try {
      const result = await updateTeamsMeetingSchedule(summary.liveSessionId, {
        title: row.name,
        organizerEmail: summary.organizerEmail,
        eventId: summary.eventId,
        localStartDateTime: naiveLocalFromUtc(occurrences[0].startDateTimeUtc),
        startDateTimeUtc: occurrences[0].startDateTimeUtc,
        durationMinutes: summary.durationMinutes || row.durationMinutes,
        repeat: occurrences.length > 1 ? 'weekly' : 'none',
        repeatOccurrences: occurrences.length,
        scheduledOccurrences: occurrences,
        attendees,
        presenters,
      });
      peopleDrawer.close();
      await loadTeamsState();
      const warning = (result.warnings || [])[0];
      await showCurriculumAlert({
        title: warning ? 'Saved with a warning' : 'Invitations updated',
        text: warning
          ? warning.message
          : `${presenters.length} presenter${presenters.length === 1 ? '' : 's'} and ${attendees.length} attendee${attendees.length === 1 ? '' : 's'} are saved for ${row.name}.`,
        timer: warning ? undefined : 2200,
      });
    } catch (err) {
      peopleDrawer.setError(err instanceof Error ? err.message : 'The invitations could not be saved.');
    } finally {
      peopleDrawer.setSaving(false);
    }
  };

  /**
   * Seed the create form for a module with no calendar. The dialog that shows
   * it is the create form, so this runs when that dialog opens — from a row
   * click or from a `?module=` link — rather than from a button of its own.
   */
  const seedCreateForm = (row: MeetingRow, presenters: string[], attendees: string[]) => {
    setDrawerTarget(row);
    createDrawer.openWith({
      // The meeting is named after the module itself. The module's stored notes
      // are deliberately *not* offered as the description: they carry the
      // hidden `__key:value` lines the API appends (programme, cohort, group and
      // catalogue ids), and those would end up in the calendar invitation.
      title: cleanText(row.module.name, row.name),
      organizerEmail: defaultOrganizer,
      // The presenter is this module's own tutor and the attendees are the
      // learners enrolment placed in its group — read fresh rather than typed
      // in, so the invite list always matches who is actually assigned.
      attendees: attendees.join('\n'),
      presenters: presenters.join('\n'),
      details: '',
      durationMinutes: String(row.durationMinutes),
      lobbyBypass: 'invited',
      recording: 'record-transcribe',
      spokenLanguage: 'en-GB',
      meetingType: 'live-session',
    });
    // Starts from blank, so there is nothing typed by hand to overwrite.
    void prefillInvitees(row, createDrawer.patch);
  };

  const createCalendar = async (target?: MeetingRow) => {
    const row = target || drawerTarget;
    if (!row) return;
    const form = createDrawer.form;
    // A locked organizer is the backend's to decide; this only catches the drawer
    // being submitted before the configuration call has answered.
    const organizer = (organizerLocked ? defaultOrganizer : form.organizerEmail).trim();
    if (!organizer) {
      createDrawer.setError(organizerLocked
        ? 'The Microsoft 365 organizer is still loading. Try again in a moment.'
        : 'Enter the Microsoft 365 organizer email.');
      return;
    }
    if (!row.sessions.length) { createDrawer.setError('This module has no stored session dates yet.'); return; }
    const meetingTitle = cleanText(row.name, 'Live session');
    const duration = Math.max(15, Number(form.durationMinutes) || row.durationMinutes);
    const occurrences = scheduledOccurrences(row).map(occurrence => ({ ...occurrence, durationMinutes: duration }));
    const input: TeamsMeetingInput = {
      title: meetingTitle,
      organizerEmail: organizer,
      attendees: emailList(form.attendees),
      presenters: emailList(form.presenters),
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
      transactionId: `TEAMS-${row.catalogueId}`,
    };
    createDrawer.setSaving(true);
    createDrawer.setError(null);
    try {
      const result = await createTeamsMeeting(input);
      // Creating the series is only half of it: the module's live-session
      // components are where delivery reads the join link from, and the restore
      // endpoint is the one place that writes it into all of them.
      let attached = 0;
      try {
        attached = (await restoreModuleTeamsMeeting(row.catalogueId)).updatedComponents;
      } catch {
        setNotice({
          tone: 'warning',
          text: `${row.name}: the Teams meeting was created, but its join link could not be written into the module's live-session components. Use "Re-attach meeting to components" to retry.`,
        });
      }
      createDrawer.close();
      setSelectedId(row.catalogueId);
      await loadTeamsState();
      // `settingsApplied` false means the calendar is right and the recording is
      // not: Graph refused the meeting options, so the session opens recording
      // nothing. It reads as success otherwise, which is how it went unnoticed.
      const optionsRefused = !result.meeting.settingsApplied;
      await showCurriculumAlert({
        title: optionsRefused
          ? 'Created, but NOT recording'
          : result.warnings.length ? 'Created with warnings' : 'Teams calendar created',
        text: optionsRefused
          ? `The invitations and join links are in place, but Microsoft Teams refused the recording, transcription and lobby options, so these sessions will record nothing. Grant the Teams application access policy to ${result.meeting.organizerEmail || 'the organizer'}, then re-apply the meeting options.`
          : result.warnings.length
            ? result.warnings[0]
            : `${occurrences.length} meeting${occurrences.length === 1 ? '' : 's'} on this module's session dates${attached ? `, linked to ${attached} live-session component${attached === 1 ? '' : 's'}` : ''}.`,
        timer: optionsRefused || result.warnings.length ? undefined : 2400,
      });
    } catch (err) {
      createDrawer.setError(err instanceof Error ? err.message : 'Microsoft Teams could not create the meeting.');
    } finally {
      createDrawer.setSaving(false);
    }
  };

  // Opening the dialog for a module with no calendar opens the create form with
  // it. Keyed on the module, the organizer the backend reports, and the tutor /
  // learner emails once they arrive, so a link straight to `?module=` is seeded
  // the same way a row click is — and typing in the form never re-seeds it.
  const seededCreateRef = useRef('');
  useEffect(() => {
    if (!selected || selected.summary || !selected.sessions.length) {
      seededCreateRef.current = '';
      return;
    }
    const presenters = presentersFor(selected);
    const cachedAttendees = moduleLearnerEmails.get(normaliseKey(selected.catalogueId));
    if (!cachedAttendees) void ensureLearnerEmails(selected.catalogueId);
    const attendees = cachedAttendees || [];
    const key = `${selected.catalogueId}:${defaultOrganizer}:${presenters.join(',')}:${attendees.join(',')}`;
    if (seededCreateRef.current === key) return;
    seededCreateRef.current = key;
    seedCreateForm(selected, presenters, attendees);
    // seedCreateForm is re-created every render; the ref above is what keeps
    // this from running twice for the same module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrganizer, selected, moduleLearnerEmails]);

  // True while the discard dialog is up. Escape reaches both this dialog and
  // SweetAlert's own handler in the same event, so without the flag dismissing
  // the dialog with the keyboard immediately raises a second one.
  const confirmingDiscard = useRef(false);

  /**
   * Every way out of the dialog -- the title-bar cross, the backdrop and
   * Escape -- comes through here. When the dialog is the create form and it has
   * been filled in, nothing is on Teams yet, so closing asks before it throws
   * the answers away.
   */
  const requestCloseSelected = () => {
    if (createDrawer.saving) return;
    if (!createDrawer.dirty) { setSelectedId(''); return; }
    if (confirmingDiscard.current) return;
    confirmingDiscard.current = true;
    void showCurriculumConfirm({
      title: 'Discard unsaved changes?',
      text: 'This Teams calendar has not been created yet. Closing now throws away what you filled in.',
      icon: 'warning',
      confirmButtonText: 'Discard changes',
      cancelButtonText: 'Keep editing',
      onConfirm: () => { createDrawer.close(); setSelectedId(''); },
    }).finally(() => { confirmingDiscard.current = false; });
  };

  /**
   * Whose clock these times are.
   *
   * Every meeting is one absolute instant, and each person's Teams renders it in
   * that person's own timezone -- so a page printing the college calendar's
   * clock has to say so, and say how far the reader's own Teams will differ.
   * Without that, 09:00 here and 11:00 in the reader's Teams read as two
   * different meetings rather than one.
   */
  const timeZoneNote = useMemo(() => {
    if (!timeZoneLabel) return undefined;
    const base = `Meeting times are shown in the Microsoft calendar's timezone (${timeZoneLabel}).`;
    const { viewerZoneLabel, differenceMinutes } = viewerZoneOffset();
    if (!differenceMinutes) return base;
    const hours = Math.abs(differenceMinutes) / 60;
    const amount = `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}`;
    return `${base} Your device is on ${viewerZoneLabel}, so your own Teams shows them ${amount} ${differenceMinutes > 0 ? 'later' : 'earlier'}.`;
  }, [timeZoneLabel]);

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );


  const listLoading = (loading && !loaded) || teamsLoading;

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Teams Meetings"
      pageSubtitle="Every module's Teams calendar, and whether it still matches the module's session dates"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
        <EntityHero
          eyebrow="Curriculum Studio · Modules"
          title="Teams Meetings"
          description="A module's stored session dates are the authority. This page sends them to the Microsoft Teams calendar — holiday shifts included — and brings back the attendance, transcripts and recordings of the meetings that have already run."
          loading={listLoading}
          stats={[
            { icon: 'ri-vidicon-line', label: 'Tracked meetings', value: stats.tracked },
            { icon: 'ri-check-double-line', label: 'In sync', value: stats.inSync },
            { icon: 'ri-error-warning-line', label: 'Dates differ', value: stats.drifted, detail: stats.drifted ? 'Send the session dates to Teams' : undefined },
            { icon: 'ri-calendar-line', label: 'No calendar yet', value: stats.toCreate },
          ]}
        />

        {error && <InlineError message={error} onRetry={() => void reload()} />}
        {teamsError && <InlineError message={teamsError} onRetry={() => void loadTeamsState()} />}
        {!graphConfigured && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
            <AppIcon className="ri-information-line mr-1"></AppIcon>
            Microsoft Graph credentials are missing from the backend, so nothing here can reach the Teams calendar. The dates and attendance already stored are still shown.
          </div>
        )}
        {notice && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-[12px] font-semibold ${
            notice.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : notice.tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-primary-100 bg-primary-50 text-primary-700'
          }`}
          >
            <AppIcon className="ri-information-line mt-0.5"></AppIcon>
            <span className="min-w-0 flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-[11px] font-bold underline">Dismiss</button>
          </div>
        )}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search modules, cohorts, organizers..."
          selects={[
            {
              label: 'Programme',
              value: programmeFilter,
              onChange: setProgrammeFilter,
              options: [{ value: '', label: 'All programmes' }, ...programmeOptions],
            },
            {
              label: 'Cohort',
              value: cohortFilter,
              onChange: setCohortFilter,
              options: [
                { value: '', label: 'All cohorts' },
                ...scopedCohorts.map(cohort => ({ value: cohort.id, label: cohort.name })),
              ],
            },
            {
              label: 'Calendar',
              value: stateFilter,
              onChange: setStateFilter,
              options: [
                { value: '', label: 'Any state' },
                { value: 'out-of-sync', label: 'Dates differ' },
                { value: 'in-sync', label: 'In sync' },
                { value: 'not-created', label: 'Not created' },
                { value: 'no-sessions', label: 'No sessions' },
              ],
            },
          ]}
          onReset={() => { setSearch(''); setProgrammeFilter(''); setCohortFilter(''); setStateFilter(''); }}
          summary={timeZoneNote}
        />

        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={visibleRows}
          rowKey={row => row.catalogueId}
          loading={listLoading}
          empty={(
            <EntityEmptyState
              icon="ri-vidicon-line"
              title={rows.some(row => row.summary) ? 'No modules match these filters' : 'No Teams meetings tracked yet'}
              message={rows.some(row => row.summary)
                ? 'Clear a filter, or search for a different module.'
                : 'A module needs stored session dates before its Teams calendar can be created here.'}
            />
          )}
          renderRow={row => (
            <>
              <StackedCell
                href={`${namedCurriculumWorkspacePath('modules', row.catalogueId, row.name)}&tab=teams`}
                primary={row.name}
                secondary={row.programmeName}
              />
              <StackedCell primary={row.cohortName} secondary={row.groupName} />
              <PlainCell>{cleanText(row.summary?.organizerEmail, '—')}</PlainCell>
              <PlainCell>{row.summary ? calendarLabel(row.summary.startDateTime) : '—'}</PlainCell>
              <PlainCell align="center">
                {row.sessions.length}
                {row.summary ? ` / ${row.summary.occurrenceCount}` : ''}
              </PlainCell>
              <span className="min-w-0 self-center">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STATE_TONES[row.state]}`}>
                  {STATE_LABELS[row.state]}
                </span>
                {row.state === 'out-of-sync' && (
                  <span className="mt-0.5 block truncate text-[10px] font-semibold text-amber-700">
                    {row.differingSessions === 1 ? '1 session differs' : `${row.differingSessions} sessions differ`}
                  </span>
                )}
              </span>
              {/* One way in per row. Every Teams action for a module \u2014 creating
                  the calendar, sending the dates, invitations, fetching what
                  ran \u2014 happens in the dialog this opens, so the row does not
                  carry a bank of buttons that are half disabled. */}
              <NamedActions
                actions={[
                  row.summary
                    ? {
                      icon: 'ri-eye-line',
                      label: 'Detail',
                      title: 'Show this module\u2019s session dates next to the dates Teams holds.',
                      primary: row.state === 'out-of-sync',
                      onClick: () => setSelectedId(row.catalogueId),
                    }
                    : {
                      icon: 'ri-calendar-line',
                      label: 'Create Teams meetings calendar',
                      title: 'Create one Teams meeting on each of this module\u2019s stored session dates.',
                      primary: true,
                      onClick: () => setSelectedId(row.catalogueId),
                    },
                ]}
              />
            </>
          )}
        />

        {selected && (
          <Modal
            /* Two lines rather than one long "name — Teams meeting" string: the
               module is the subject, its cohort and group are the context. */
            title={(
              <span className="block min-w-0">
                <span className="block truncate">{selected.name}</span>
                <span className="mt-1 block truncate text-[11px] font-semibold text-foreground-400">
                  {[selected.cohortName, selected.groupName, selected.programmeName].filter(Boolean).join(' · ') || 'Teams meeting'}
                </span>
              </span>
            )}
            /* The comparison table needs the width; the empty state does not,
               and a wide box around two sentences is what made this look bare. */
            size={selected.summary ? 'max-w-5xl' : 'max-w-3xl'}
            onClose={requestCloseSelected}
            footer={(
              <>
                {/* Only the actions this module can actually take: a footer of
                    greyed-out buttons reads as broken rather than as guidance.
                    Closing is the title bar's X — no second Close down here. */}
                {selected.summary ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void reattach(selected)}
                      disabled={Boolean(busy)}
                      title="Give every week of this module a live-session component for this meeting, on that week's own date — creating the ones that are missing."
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AppIcon className={busy === `${selected.catalogueId}:reattach` ? 'ri-loader-4-line animate-spin text-sm' : 'ri-history-line text-sm'}></AppIcon>
                      Re-attach to components
                    </button>
                    <button
                      type="button"
                      onClick={() => void fetchArtifacts(selected)}
                      disabled={Boolean(busy) || !graphConfigured}
                      title="Ask Teams for the attendance, transcripts and recordings of the meetings that have already run."
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AppIcon className={busy === `${selected.catalogueId}:artifacts` ? 'ri-loader-4-line animate-spin text-sm' : 'ri-refresh-line text-sm'}></AppIcon>
                      Fetch attendance &amp; recordings
                    </button>
                    <button
                      type="button"
                      onClick={() => void pushDates(selected)}
                      disabled={!selected.sessions.length || Boolean(busy) || !graphConfigured}
                      title="Move the Teams calendar onto this module's stored session dates, holiday shifts included."
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <AppIcon className={busy === `${selected.catalogueId}:dates` ? 'ri-loader-4-line animate-spin text-sm' : 'ri-calendar-check-line text-sm'}></AppIcon>
                      Send session dates to Teams
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void createCalendar(selected)}
                    disabled={!selected.sessions.length || createDrawer.saving || Boolean(busy) || !graphConfigured}
                    title="Create one Teams meeting on each of this module's stored session dates."
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon className={createDrawer.saving ? 'ri-loader-4-line animate-spin text-sm' : 'ri-calendar-check-line text-sm'}></AppIcon>
                    Create
                  </button>
                )}
              </>
            )}
          >
            {/* Where this module stands, in the same chips the table uses. */}
            <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 ${STATE_TONES[selected.state]}`}>
                {STATE_LABELS[selected.state]}
              </span>
              <span className="inline-flex items-center rounded-full border border-background-200 bg-background-100 px-2.5 py-1 text-foreground-600">
                {selected.sessions.length} module session{selected.sessions.length === 1 ? '' : 's'}
              </span>
              {selected.differingSessions > 0 && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                  {selected.differingSessions === 1 ? '1 date differs' : `${selected.differingSessions} dates differ`}
                </span>
              )}
            </div>

            {!graphConfigured && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                Microsoft Graph credentials are missing from the backend, so nothing here can reach the Teams calendar.
              </p>
            )}

            {selected.summary ? (
              <div className="space-y-4">
                {/* Invitations are edited beside the people they name, rather
                    than from a button on every table row. */}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">The meeting</p>
                  <span className="flex items-center gap-2">
                  {/* Once the dates are on the calendar the next thing anyone
                      wants is the way in, so the join link is a button here
                      rather than a line of text further down the panel. */}
                  {Boolean(selected.summary.joinUrl) && (
                    <a
                      href={selected.summary.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="meeting-join-action inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold transition-smooth"
                    >
                      <AppIcon className="ri-microsoft-teams-line text-sm"></AppIcon>
                      Join Teams meeting
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => { setSelectedId(''); void openPeople(selected); }}
                    disabled={Boolean(busy) || !graphConfigured}
                    title="Edit who is invited and who can present, without moving any dates."
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2.5 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon className="ri-user-voice-line text-sm"></AppIcon>
                    Edit invitations
                  </button>
                  </span>
                </div>
                <div className="grid gap-x-6 sm:grid-cols-2">
                  <DetailRow label="Organizer" value={cleanText(selected.summary.organizerEmail, '—')} />
                  <DetailRow label="Repeats" value={cleanText(selected.summary.repeatPattern, 'none')} />
                  <DetailRow
                    label="Presenters"
                    value={(selected.summary.presenters || []).length
                      ? (selected.summary.presenters || []).join(', ')
                      : 'None — everyone joins as an attendee'}
                  />
                  <DetailRow
                    label="Attendees"
                    value={(
                      <InvitedPeopleList
                        emails={selected.summary.attendees || []}
                        empty="None invited"
                      />
                    )}
                  />
                  <DetailRow label="Meetings tracked" value={`${selected.summary.occurrenceCount} (${selected.summary.upcomingCount} upcoming)`} />
                </div>

                {detailError && <InlineError message={detailError} onRetry={() => void loadDetail(selected.summary!.liveSessionId)} />}

                {/* One list, not two. The module's own dates, the meetings
                    Teams holds on them and what each meeting offers -- the way
                    in, who attended, what it left behind -- are facts about the
                    same sessions, so they hang off the same rows. */}
                <ModuleSessionSchedulePreview
                  row={selected}
                  title="Module dates sent to Teams"
                  holidayLabelFor={holidayLabelFor}
                  renderActions={(index, durationMinutes) => {
                    // The meeting runs when Teams says it does, so the clock
                    // is read against the calendar entry when there is one
                    // and against the module's own date when there is not.
                    const runsAt = selected.teamsStarts[index] || selected.plannedStarts[index] || '';
                    const runState = meetingRunState(runsAt, durationMinutes, now);
                    if (runState === 'ended') {
                      return (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground-400">
                          <AppIcon className="ri-check-double-line"></AppIcon>
                          Session ended
                        </span>
                      );
                    }
                    // A session Teams would only accept as an event of its own
                    // has a link of its own, so the row's own link comes first
                    // and the series' link is the fallback the rest share.
                    const joinUrl = detail?.occurrences?.[index]?.join_url || selected.summary?.joinUrl || '';
                    if (!joinUrl) {
                      return <span className="text-[11px] font-semibold text-foreground-400">Not on Teams yet</span>;
                    }
                    return (
                      <a
                        href={joinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`meeting-join-action inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-smooth ${
                          runState === 'live'
                            ? ''
                            : 'opacity-80 hover:opacity-100'
                        }`}
                      >
                        <AppIcon className="ri-microsoft-teams-line text-sm"></AppIcon>
                        {runState === 'live' ? 'Join now' : 'Join Teams'}
                      </a>
                    );
                  }}
                  renderFacts={index => {
                    const occurrence = detail?.occurrences?.[index];
                    // Nothing is written down for a meeting that has not run:
                    // "0 attended, nothing yet" on every future session is a
                    // column of absences, and the note under the list already
                    // says these facts arrive afterwards.
                    if (!occurrence) return null;
                    const attended = occurrence.participant_count || occurrence.attendance?.length || 0;
                    const artifacts = occurrence.artifacts || [];
                    if (!attended && !artifacts.length) return null;
                    return (
                      <>
                        {Boolean(attended) && (
                          <span className="font-semibold text-foreground-600">{attended} attended</span>
                        )}
                        {artifacts.map(artifact => (artifact.artifact_type === 'recording' ? (
                          // Played here rather than downloaded, so the watch
                          // is recorded against the session.
                          <button
                            key={artifact.id}
                            type="button"
                            onClick={() => setPreview({
                              liveSessionId: selected.summary!.liveSessionId,
                              artifact,
                              title: `${selected.name} — meeting ${index + 1}`,
                            })}
                            className="inline-flex items-center gap-1 font-bold text-primary-700 hover:underline"
                          >
                            <AppIcon className="ri-play-circle-line text-sm"></AppIcon>
                            Watch recording
                          </button>
                        ) : artifact.artifact_type === 'transcript' ? (
                          // Read here rather than downloaded, matching the
                          // recording's own in-place preview.
                          <button
                            key={artifact.id}
                            type="button"
                            onClick={() => setTranscriptPreview({
                              liveSessionId: selected.summary!.liveSessionId,
                              artifact,
                              title: `${selected.name} — meeting ${index + 1}`,
                            })}
                            className="font-bold text-primary-700 hover:underline"
                          >
                            Transcript
                          </button>
                        ) : (
                          <a
                            key={artifact.id}
                            href={teamsMeetingArtifactPreviewUrl(selected.summary!.liveSessionId, artifact.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-primary-700 hover:underline"
                          >
                            {artifact.artifact_type}
                          </a>
                        )))}
                      </>
                    );
                  }}
                />

                <p className="text-[11px] font-semibold text-foreground-400">
                  Attendance, transcripts and recordings only exist once a meeting has run. Fetch them after the session.
                </p>
              </div>
            ) : (
              /* No calendar yet, so this dialog *is* the create form: the dates
                 it will be built on, the settings Teams needs, and one Create
                 at the end. There is no second drawer to step through. */
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
                    <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
                  </span>
                  <p className="text-[12px] text-foreground-600">
                    {selected.sessions.length
                      ? `Create puts one Teams meeting on each of the ${selected.sessions.length} session date${selected.sessions.length === 1 ? '' : 's'} below and writes the join link into this module’s live-session components. The dates come from the module, not from this form.`
                      : 'This module has no stored session dates yet, so there is nothing to put on a calendar. Save its schedule first — those dates are what the calendar is built from.'}
                  </p>
                </div>

                {Boolean(selected.sessions.length) && (
                  <>
                    <ModuleSessionSchedulePreview
                      row={selected}
                      title="Dates the calendar will be created on"
                      holidayLabelFor={holidayLabelFor}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        label="Organizer Microsoft 365 email"
                        required={!organizerLocked}
                        hint={organizerLocked
                          ? 'Set for this deployment. Recording and transcription only turn on for this mailbox, so tutors are invited as presenters instead.'
                          : 'The calendar this series is created in.'}
                      >
                        <TextControl
                          value={organizerLocked ? defaultOrganizer : createDrawer.form.organizerEmail}
                          onChange={value => createDrawer.patch({ organizerEmail: value })}
                          disabled={organizerLocked}
                        />
                      </FormField>
                      <FormField
                        label="Duration"
                        hint={`First session ${calendarLabel(selected.plannedStarts[0])}.`}
                      >
                        <SelectControl
                          value={createDrawer.form.durationMinutes}
                          onChange={value => createDrawer.patch({ durationMinutes: value })}
                          options={[
                            { value: '30', label: '30 minutes' },
                            { value: '45', label: '45 minutes' },
                            { value: '60', label: '1 hour' },
                            { value: '90', label: '1 hour 30 minutes' },
                            { value: '120', label: '2 hours' },
                            { value: '180', label: '3 hours' },
                          ]}
                        />
                      </FormField>
                      <FormField label="Who can bypass the lobby?">
                        <SelectControl
                          value={createDrawer.form.lobbyBypass}
                          onChange={value => createDrawer.patch({ lobbyBypass: value })}
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
                          value={createDrawer.form.recording}
                          onChange={value => createDrawer.patch({ recording: value })}
                          options={[
                            { value: 'none', label: 'Do not start automatically' },
                            { value: 'record', label: 'Record automatically' },
                            { value: 'record-transcribe', label: 'Record and transcribe' },
                          ]}
                        />
                      </FormField>
                      <FormField label="Spoken language">
                        <SelectControl
                          value={createDrawer.form.spokenLanguage}
                          onChange={value => createDrawer.patch({ spokenLanguage: value })}
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
                          value={createDrawer.form.details}
                          onChange={value => createDrawer.patch({ details: value })}
                          rows={2}
                        />
                      </FormField>
                      <div className="sm:col-span-2 -mb-2 flex items-center justify-end">
                        <button
                          type="button"
                          disabled={invitedPrefilling}
                          onClick={() => void prefillInvitees(selected, createDrawer.patch)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:underline disabled:opacity-50"
                        >
                          <AppIcon className="ri-refresh-line text-sm"></AppIcon>
                          {invitedPrefilling ? 'Loading…' : "Prefill from the module's tutor and learner plans"}
                        </button>
                      </div>
                      <FormField label="Presenters" hint="These people can share and record.">
                        <EmailChipsInput
                          value={createDrawer.form.presenters}
                          onChange={value => createDrawer.patch({ presenters: value })}
                        />
                      </FormField>
                      <FormField label="Attendees" hint="Presenters are invited automatically.">
                        <EmailChipsInput
                          value={createDrawer.form.attendees}
                          onChange={value => createDrawer.patch({ attendees: value })}
                        />
                      </FormField>
                    </div>

                    {createDrawer.error && <InlineError message={createDrawer.error} />}
                  </>
                )}
              </div>
            )}
          </Modal>
        )}
      </div>

      {preview && (
        <RecordingPreview
          liveSessionId={preview.liveSessionId}
          artifact={preview.artifact}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      )}

      {transcriptPreview && (
        <TranscriptPreview
          liveSessionId={transcriptPreview.liveSessionId}
          artifact={transcriptPreview.artifact}
          title={transcriptPreview.title}
          onClose={() => setTranscriptPreview(null)}
        />
      )}

      <EntityDrawer
        open={peopleDrawer.open}
        title="Attendees and presenters"
        subtitle={drawerTarget
          ? `Who is invited to ${drawerTarget.name}, and who can share and record. The meeting dates are left exactly as they are.`
          : undefined}
        onClose={peopleDrawer.close}
        onSubmit={savePeople}
        submitLabel="Save invitations"
        saving={peopleDrawer.saving}
        error={peopleDrawer.error}
        dirty={peopleDrawer.dirty}
      >
        <div className="-mb-2 flex items-center justify-end">
          <button
            type="button"
            disabled={invitedPrefilling || !drawerTarget}
            onClick={() => drawerTarget && void prefillInvitees(drawerTarget, peopleDrawer.patch)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:underline disabled:opacity-50"
          >
            <AppIcon className="ri-refresh-line text-sm"></AppIcon>
            {invitedPrefilling ? 'Loading…' : "Prefill from the module's tutor and learner plans"}
          </button>
        </div>
        <FormField label="Presenters" hint="Only these people get the presenter role in Teams.">
          <EmailChipsInput value={peopleDrawer.form.presenters} onChange={value => peopleDrawer.patch({ presenters: value })} />
        </FormField>
        <FormField label="Attendees" hint="Presenters are invited automatically — no need to repeat them.">
          <EmailChipsInput value={peopleDrawer.form.attendees} onChange={value => peopleDrawer.patch({ attendees: value })} />
        </FormField>
      </EntityDrawer>
    </WorkspaceShell>
  );
}
