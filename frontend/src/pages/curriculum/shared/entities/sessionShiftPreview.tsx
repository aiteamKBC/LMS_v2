import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cleanText, formatDateLabel } from './model';

/** The minimum a generated session needs to carry to be placed on the timeline. */
export interface HolidayShiftSessionLike {
  date: string;
  skippedHolidays?: string[];
}

/**
 * The plan's own dates, with each session's holiday clashes named against them.
 *
 * A ticked holiday moves nothing and decides nothing: the session keeps its own
 * delivery day and the plan only NAMES the holidays that fall on it, in
 * `clashes`. That is the whole of it -- a warning, no shift, no replacement, no
 * effect on the run or on the module's end date.
 *
 * `moved`, `gapLabel`, `headline` and `detail` are the parked clash fields.
 * They are kept on the shape because every caller still renders it, and they
 * are now always inert (`false` / empty). See the parked block below.
 */
export interface SessionShift {
  sessionNumber: number;
  originalDate: string;
  actualDate: string;
  moved: boolean;
  gapLabel: string;
  /** The closed dates this session itself landed on, in the order it hit them. */
  clashes: Array<{ date: string; holiday: string }>;
  /** Unused now that a shift is read solely off the session's own clashes; kept for callers matching on the shape. */
  causeNames: string[];
  headline: string;
  detail: string;
}

/** A holiday as the curriculum stores it, in the shape every plan serves. */
export interface ReadingWeekHoliday {
  id?: string;
  label: string;
  startDate: string;
  endDate: string;
  type?: string;
  notes?: string;
  /** Which calendar the holiday came from: the mirrored GOV.UK feed, or one
   *  somebody entered on the Holidays page. */
  source?: string;
}

/** A closed delivery slot: a curriculum position with no live session in it. */
export interface HolidayReadingWeekSlot {
  slotNumber: number;
  date: string;
  day?: string;
  holidays: ReadingWeekHoliday[];
}

/**
 * The holiday notice a week's own delivery day puts on that week.
 *
 * It states a fact and stops there. The week is a completely ordinary week --
 * same date, same place in the run, same components, same live session -- and
 * what to do about the holiday is the author's call: rename the week a reading
 * week, drop its live session, move a component, or leave it. Nothing here and
 * nothing behind it changes the plan, so no date moves and the module still
 * ends where its delivery pattern says it ends.
 *
 * It names the holiday's own label, dates, type and any note the GOV.UK feed
 * carried, all read off the holiday record the scheduler already matched, so
 * the author can judge the clash without opening the holidays page.
 *
 * A strip inside the week card rather than a card of its own: there is no
 * second week to draw, and drawing one made a single ticked holiday read as an
 * extra week in the course with a number that collided with a real one.
 */
export function WeekHolidayNotice({
  slot,
  weekDate,
  compact = false,
}: {
  slot: HolidayReadingWeekSlot;
  /**
   * The date the week's own header already prints, directly above this notice.
   *
   * When the closed day IS that date, naming it here said the same day twice on
   * two adjacent lines. It is still named when the two differ, which is the case
   * that needs it: a week delivering twice can have its second day closed while
   * the header shows its first.
   */
  weekDate?: string;
  /** Tighter type and spacing, for the narrow Course structure rail. */
  compact?: boolean;
}) {
  const holidays = (slot.holidays || []).filter(holiday => cleanText(holiday.label) || cleanText(holiday.startDate));
  const slotDate = cleanText(slot.date);
  const shownAbove = Boolean(slotDate) && slotDate.slice(0, 10) === cleanText(weekDate).slice(0, 10);
  return (
    <div
      data-testid="week-holiday-notice"
      className={`relative border-t border-amber-200 bg-amber-50/70 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
    >
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-amber-400"></span>
      <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-semibold text-amber-900 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
        <AppIcon className="ri-calendar-close-line shrink-0 text-sm text-amber-600"></AppIcon>
        <span>Heads up: this week falls on a holiday</span>
        {!shownAbove && slotDate && (
          <span className="font-medium text-foreground-500">
            {formatDateLabel(slotDate)} {weekdayLabel(slotDate)}
          </span>
        )}
      </p>
      {holidays.map((holiday, index) => (
        <p
          key={`${holiday.id || holiday.label}-${holiday.startDate}-${index}`}
          className={`mt-0.5 leading-snug text-amber-900 ${compact ? 'text-[10px]' : 'text-[11px]'}`}
        >
          <span className="font-bold">{cleanText(holiday.label) || 'Holiday'}</span>
          {' '}
          {/* Where the day came from decides who can change it: a GOV.UK row is
              mirrored reference data, a manual one was entered on the Holidays
              page. Same wording as that page's Source filter. */}
          <span className={`rounded-full border px-1.5 py-px align-middle font-bold ${
            holiday.source === 'gov.uk'
              ? 'border-sky-200 bg-sky-50 text-sky-700'
              : 'border-amber-300 bg-amber-100 text-amber-800'
          } ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
            {holiday.source === 'gov.uk' ? 'GOV.UK' : 'Manual'}
          </span>
          {' · '}
          {formatDateLabel(holiday.startDate)}
          {cleanText(holiday.endDate) && holiday.endDate !== holiday.startDate && ` – ${formatDateLabel(holiday.endDate)}`}
          {cleanText(holiday.type) && ` · ${cleanText(holiday.type)}`}
          {cleanText(holiday.notes) && ` · ${cleanText(holiday.notes)}`}
        </p>
      ))}
    </div>
  );
}

export interface HolidayShiftPlan {
  shifts: SessionShift[];
  closures: Array<{ date: string; label: string }>;
  movedCount: number;
  movedRangeLabel: string;
  originalEndDate: string;
  shiftedEndDate: string;
}

// ---------------------------------------------------------------------------
// Holiday clash handling -- PARKED ON PURPOSE, kept below as comments.
//
// A ticked holiday landing on a session used to push that session to the next
// delivery day and drag every session behind it along with it. That rule is
// off. A holiday is a WARNING now and nothing else: the session keeps its own
// date, the week keeps its place in the run, the module keeps its end date, and
// whether the session runs, becomes a reading week or is dropped is the
// author's call, made on the week itself.
//
// The arithmetic is commented out rather than deleted, because the shape it
// filled in (`moved`, `gapLabel`, `headline`, `detail`, `movedCount`,
// `movedRangeLabel`) is still on the payload every caller renders, and the rule
// may be asked for again. Nothing reads it while it is parked.
//
// How much later a session runs, in the delivery pattern's own units:
//   function gapBetween(fromIso: string, toIso: string): string {
//     const from = Date.parse(`${fromIso}T00:00:00Z`);
//     const to = Date.parse(`${toIso}T00:00:00Z`);
//     if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return '';
//     const days = Math.round((to - from) / 86400000);
//     if (days % 7 === 0) {
//       const weeks = days / 7;
//       return `${weeks} week${weeks === 1 ? '' : 's'} later`;
//     }
//     return `${days} day${days === 1 ? '' : 's'} later`;
//   }
//
// `2026-09-10` shifted by whole weeks, forward or back:
//   function shiftByWeeks(iso: string, weeks: number): string {
//     const parsed = Date.parse(`${iso}T00:00:00Z`);
//     if (Number.isNaN(parsed) || !weeks) return iso;
//     return new Date(parsed + weeks * 7 * 86400000).toISOString().slice(0, 10);
//   }
//
// Inside the per-session walk below, where a clash used to become a move:
//   const originalDate = clashes.length ? clashes[0].date : actualDate;
//   const moved = Boolean(originalDate) && originalDate !== actualDate;
//   const clashNames = Array.from(new Set(clashes.map(c => c.holiday).filter(Boolean)));
//   gapLabel: moved ? gapBetween(originalDate, actualDate) : '',
//   headline: !moved ? '' : clashNames.length ? `Clashes with ${clashNames.join(', ')}` : 'Clashes with a holiday',
//   detail: !moved ? '' : [
//     `Was due ${formatDateLabel(originalDate)}`,
//     ...clashes.map(c => `${formatDateLabel(c.date)} closed${c.holiday ? `: ${c.holiday}` : ''}`),
//     `Runs ${formatDateLabel(actualDate)}`,
//   ].join(' · '),
//
// And the run-level summary of those moves:
//   const movedNumbers = shifts.filter(shift => shift.moved).map(shift => shift.sessionNumber);
//   const contiguous = movedNumbers.length > 1
//     && movedNumbers[movedNumbers.length - 1] - movedNumbers[0] === movedNumbers.length - 1;
//   movedCount: movedNumbers.length,
//   movedRangeLabel: !movedNumbers.length ? ''
//     : movedNumbers.length === 1 ? `Session ${movedNumbers[0]}`
//     : contiguous ? `Sessions ${movedNumbers[0]}-${movedNumbers[movedNumbers.length - 1]}`
//     : `Sessions ${movedNumbers.join(', ')}`,
//   originalEndDate: cleanText(plannedOriginalEndDate)
//     || (shiftedEndDate ? shiftByWeeks(shiftedEndDate, -closedDates.length) : ''),
// ---------------------------------------------------------------------------

export function buildHolidayShiftPlan<S extends HolidayShiftSessionLike>(
  sessions: S[],
  holidayLabelFor?: (date: string) => string,
  plannedOriginalEndDate?: string,
): HolidayShiftPlan {
  const shifts: SessionShift[] = sessions.map((session, index) => {
    const actualDate = cleanText(session.date);
    // The one fact still read off a holiday: which closed days land on THIS
    // session's own date, named so a screen can warn about them. It stops here
    // -- naming a clash is not acting on one.
    const clashes = (session.skippedHolidays || [])
      .map(date => cleanText(date))
      .filter(Boolean)
      .map(date => ({ date, holiday: cleanText(holidayLabelFor?.(date)) }));
    return {
      sessionNumber: index + 1,
      // A session is never displaced, so where it was due and where it runs are
      // the same day, and every clash field stays inert.
      originalDate: actualDate,
      actualDate,
      moved: false,
      gapLabel: '',
      clashes,
      causeNames: [],
      headline: '',
      detail: '',
    };
  });

  const closedDates = Array.from(new Set(
    sessions.flatMap(session => (session.skippedHolidays || []).map(date => cleanText(date))).filter(Boolean),
  )).sort();
  const shiftedEndDate = cleanText(sessions[sessions.length - 1]?.date);
  return {
    shifts,
    closures: closedDates.map(date => ({ date, label: cleanText(holidayLabelFor?.(date)) })),
    // Nothing moves, so nothing is counted as moved.
    movedCount: 0,
    movedRangeLabel: '',
    // The same day either way: the run a holiday never touched ends where this
    // one ends. Stated rather than dropped, because callers render the pair.
    originalEndDate: cleanText(plannedOriginalEndDate) || shiftedEndDate,
    shiftedEndDate,
  };
}

export function monthKeyOf(value: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2]}` : '';
}

export function monthLabelOf(key: string): string {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** `2026-09-16` -> `(Wednesday)`. Empty for anything that is not a date. */
export function weekdayLabel(value: string): string {
  const parsed = new Date(`${String(value || '').trim().slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return `(${parsed.toLocaleDateString('en-GB', { weekday: 'long' })})`;
}

/** Which holiday(s) land on a session, in the words its warning uses. */
export function holidayCausePhrase(shift: SessionShift): string {
  if (shift.clashes.length) {
    const names = Array.from(new Set(shift.clashes.map(clash => clash.holiday).filter(Boolean)));
    return names.length ? names.join(', ') : 'a holiday';
  }
  return shift.causeNames.length ? shift.causeNames.join(', ') : 'a holiday';
}

/**
 * The compact session timeline: sessions grouped by the month they land in.
 *
 * Every session is an ordinary row on its own date. A holiday falling on one
 * adds a WARNING under that row and changes nothing else -- no red "blocked"
 * card, no green "replacement", no second date, nothing skipped. What to do
 * about the clash is the author's call, made on the week itself.
 */
export function CompactSchedulePreview({
  occurrences,
  formatLabel = (plannedUtc, date) => formatDateLabel(plannedUtc || date),
  showDuration = true,
}: {
  occurrences: Array<{
    session?: HolidayShiftSessionLike;
    plannedUtc: string;
    durationMinutes: number;
    shift?: SessionShift;
    /**
     * What is taught on this date: the title of the week's live-session
     * component. A date and a number say when a session runs; the name says
     * which session it is. Optional, because a caller that has not read the
     * module's weeks has no name to give — the row then reads as it always did.
     */
    name?: string;
    /** Extra read-only info for this occurrence (e.g. a Teams calendar status), rendered under the date. */
    extra?: ReactNode;
    /** Controls this one session offers — a join link, a recording to play. */
    actions?: ReactNode;
  }>;
  /** How to render an occurrence's date (and, if the caller wants, its time). Defaults to a bare date label. */
  formatLabel?: (plannedUtc: string, date: string) => string;
  /**
   * Whether each row states its own length. Off when every session runs for the
   * same number of minutes and the caller says so once above the list: repeated
   * down twenty rows, "120 min" stops being read as information.
   */
  showDuration?: boolean;
}) {
  // One kind of row. The parked clash rule used to emit two more -- a red
  // `blocked` card on the closed date and a green `replacement` card on the day
  // the session was pushed to:
  //   | { kind: 'blocked'; number; name; date; durationMinutes; causePhrase; replacementDate }
  //   | { kind: 'replacement'; number; name; date; plannedUtc; durationMinutes; extra?; actions? }
  type Entry = {
    kind: 'session';
    number: number;
    name: string;
    date: string;
    plannedUtc: string;
    durationMinutes: number;
    /** The holidays on this session's own date, named. A warning, nothing more. */
    holidayNote: string;
    extra?: ReactNode;
    actions?: ReactNode;
  };

  const entries: Entry[] = [];
  occurrences.forEach((item, index) => {
    const number = item.shift?.sessionNumber || index + 1;
    const name = cleanText(item.name);
    // Named off the session's own clashes, which is all a holiday produces now.
    const holidayNote = item.shift?.clashes.length ? holidayCausePhrase(item.shift) : '';
    if (!item.session) {
      if (item.plannedUtc) {
        entries.push({ kind: 'session', number, name, date: cleanText(item.plannedUtc).slice(0, 10), plannedUtc: item.plannedUtc, durationMinutes: item.durationMinutes, holidayNote, extra: item.extra, actions: item.actions });
      }
      return;
    }
    // Parked: a moved session split into a blocked row plus a replacement row.
    //   if (item.shift?.moved) {
    //     entries.push({ kind: 'blocked', number, name, date: item.shift.originalDate, durationMinutes: item.durationMinutes, causePhrase: holidayCausePhrase(item.shift), replacementDate: item.shift.actualDate });
    //     entries.push({ kind: 'replacement', number, name, date: item.shift.actualDate, plannedUtc: item.plannedUtc, durationMinutes: item.durationMinutes, extra: item.extra, actions: item.actions });
    //     return;
    //   }
    entries.push({ kind: 'session', number, name, date: cleanText(item.session.date), plannedUtc: item.plannedUtc, durationMinutes: item.durationMinutes, holidayNote, extra: item.extra, actions: item.actions });
  });

  const monthGroups: Array<{ key: string; label: string; entries: Entry[] }> = [];
  entries.forEach(entry => {
    const key = monthKeyOf(entry.date);
    const current = monthGroups[monthGroups.length - 1];
    if (current && current.key === key) {
      current.entries.push(entry);
      return;
    }
    monthGroups.push({ key, label: monthLabelOf(key), entries: [entry] });
  });

  return (
    <div className="divide-y divide-background-200">
      {monthGroups.map(group => {
        const delivered = group.entries.length;
        // Every session in the month is delivered -- a holiday skips nothing.
        // Parked with the clash rule:
        //   const delivered = group.entries.filter(entry => entry.kind !== 'blocked').length;
        //   const skipped = group.entries.filter(entry => entry.kind === 'blocked').length;
        //   {skipped > 0 && <p className="...text-red-600">{skipped} skipped</p>}
        return (
          <div key={group.key || 'unscheduled'} className="flex flex-col gap-3 px-3 py-4 sm:flex-row">
            <div className="w-full shrink-0 sm:w-32">
              <p className="text-[13px] font-heading font-bold text-foreground-900">{group.label || 'Not scheduled yet'}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">
                {delivered} delivered
              </p>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {group.entries.map((entry, index) => {
                // Parked: the red "Shifted to replacement" card emitted for a
                // `blocked` entry, and the green "Replacement delivered"
                // styling on the row that followed it.
                //   if (entry.kind === 'blocked') { ...red card, "Blocked by X;
                //     replacement scheduled on Y."... }
                //   const isReplacement = entry.kind === 'replacement';
                return (
                  <div
                    key={`${entry.kind}-${index}`}
                    className={`overflow-hidden rounded-lg border text-[12px] ${
                      entry.holidayNote ? 'border-amber-200 bg-amber-50/40' : 'border-background-200 bg-background-0'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-foreground-900">
                          {formatLabel(entry.plannedUtc, entry.date)}
                        </span>
                        {/* The weekday is the part of a date a reader acts on:
                            a session is moved by changing a delivery day. */}
                        <span className="text-foreground-400">{weekdayLabel(entry.date)}</span>
                        {/* Numbered so a note talking in session numbers stays
                            actionable: session 8 can be found in the list. */}
                        <span className="text-[11px] font-bold text-foreground-400">Session {entry.number}</span>
                        {/* What is taught on the date, next to when it runs. */}
                        {entry.name && (
                          <span className="font-semibold text-foreground-700">
                            {entry.name}
                          </span>
                        )}
                        {showDuration && <span className="text-foreground-400">{entry.durationMinutes} min</span>}
                      </span>
                      {entry.actions && (
                        <span className="flex flex-wrap items-center gap-2">
                          {entry.actions}
                        </span>
                      )}
                    </div>
                    {/* The whole of what a holiday does to a session: says so.
                        The date, the session and everything below it stand. */}
                    {entry.holidayNote && (
                      <div className="flex items-center gap-1.5 border-t border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[11px] font-semibold text-amber-900">
                        <AppIcon className="ri-error-warning-line shrink-0 text-sm text-amber-600"></AppIcon>
                        <span>Heads up: this session falls on a holiday ({entry.holidayNote}). It runs as planned.</span>
                      </div>
                    )}
                    {entry.extra && (
                      <div className="border-t border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-medium text-foreground-600">
                        {entry.extra}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
