import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cleanText, formatDateLabel } from './model';

/** The minimum a generated session needs to carry to be placed on the timeline. */
export interface HolidayShiftSessionLike {
  date: string;
  skippedHolidays?: string[];
}

/**
 * The plan a holiday rewrote, hop by hop.
 *
 * The backend walks the group's delivery day forward, and a session that steps
 * over a closed date before landing carries every date it skipped, in order, in
 * its own `skippedHolidays` — the first of those is exactly where it was due
 * before any holiday touched it. That is the only fact this reads: a session's
 * shift is entirely its own `skippedHolidays`, never anything read off the rest
 * of the series.
 *
 * A closure still moves more than the one session it lands on — the next
 * session naturally starts one slot later too — but a session carried along
 * that way clashed with nothing itself (`skippedHolidays` is empty), so it is
 * not reported as moved. Reporting it against a slot borrowed from a neighbour
 * is exactly the bug this replaced: a date pooled from every session in the
 * series and re-handed out by array position drifts by one slot after the
 * first real closure, so a later, genuinely unaffected session could inherit
 * an earlier one's clash and a genuinely blocked session could be shown against
 * the date before its own.
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

export interface HolidayShiftPlan {
  shifts: SessionShift[];
  closures: Array<{ date: string; label: string }>;
  movedCount: number;
  movedRangeLabel: string;
  originalEndDate: string;
  shiftedEndDate: string;
}

/** How much later a session runs, in the delivery pattern's own units. */
function gapBetween(fromIso: string, toIso: string): string {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return '';
  const days = Math.round((to - from) / 86400000);
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? '' : 's'} later`;
  }
  return `${days} day${days === 1 ? '' : 's'} later`;
}

/** `2026-09-10` shifted by whole weeks, forward or back. */
function shiftByWeeks(iso: string, weeks: number): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed) || !weeks) return iso;
  return new Date(parsed + weeks * 7 * 86400000).toISOString().slice(0, 10);
}

export function buildHolidayShiftPlan<S extends HolidayShiftSessionLike>(
  sessions: S[],
  holidayLabelFor?: (date: string) => string,
): HolidayShiftPlan {
  const shifts: SessionShift[] = sessions.map((session, index) => {
    const actualDate = cleanText(session.date);
    // The walk hits its own closed dates in order before landing on
    // actualDate, so the first one is where this session was due.
    const clashes = (session.skippedHolidays || [])
      .map(date => cleanText(date))
      .filter(Boolean)
      .map(date => ({ date, holiday: cleanText(holidayLabelFor?.(date)) }));
    const moved = clashes.length > 0;
    const originalDate = moved ? clashes[0].date : actualDate;
    const clashNames = Array.from(new Set(clashes.map(clash => clash.holiday).filter(Boolean)));
    return {
      sessionNumber: index + 1,
      originalDate,
      actualDate,
      moved,
      gapLabel: moved ? gapBetween(originalDate, actualDate) : '',
      clashes,
      causeNames: [],
      headline: !moved
        ? ''
        : clashNames.length ? `Clashes with ${clashNames.join(', ')}` : 'Clashes with a holiday',
      detail: !moved
        ? ''
        : [
          `Was due ${formatDateLabel(originalDate)}`,
          ...clashes.map(clash => `${formatDateLabel(clash.date)} closed${clash.holiday ? `: ${clash.holiday}` : ''}`),
          `Runs ${formatDateLabel(actualDate)}`,
        ].join(' · '),
    };
  });

  const movedNumbers = shifts.filter(shift => shift.moved).map(shift => shift.sessionNumber);
  const contiguous = movedNumbers.length > 1
    && movedNumbers[movedNumbers.length - 1] - movedNumbers[0] === movedNumbers.length - 1;
  const closedDates = Array.from(new Set(
    sessions.flatMap(session => (session.skippedHolidays || []).map(date => cleanText(date))).filter(Boolean),
  )).sort();
  const shiftedEndDate = cleanText(sessions[sessions.length - 1]?.date);
  return {
    shifts,
    closures: closedDates.map(date => ({ date, label: cleanText(holidayLabelFor?.(date)) })),
    movedCount: movedNumbers.length,
    movedRangeLabel: !movedNumbers.length
      ? ''
      : movedNumbers.length === 1
        ? `Session ${movedNumbers[0]}`
        : contiguous
          ? `Sessions ${movedNumbers[0]}–${movedNumbers[movedNumbers.length - 1]}`
          : `Sessions ${movedNumbers.join(', ')}`,
    // Every closed date delays the series by exactly one week (a closure only
    // ever blocks a candidate on the module's own delivery weekday), so
    // stepping the actual end date back by the closure count recovers where
    // it would have landed with none of them.
    originalEndDate: shiftedEndDate ? shiftByWeeks(shiftedEndDate, -closedDates.length) : '',
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

/** Which holiday(s) to blame for a moved session, in the same words as its badge. */
export function holidayCausePhrase(shift: SessionShift): string {
  if (shift.clashes.length) {
    const names = Array.from(new Set(shift.clashes.map(clash => clash.holiday).filter(Boolean)));
    return names.length ? names.join(', ') : 'a holiday closure';
  }
  return shift.causeNames.length ? shift.causeNames.join(', ') : 'an earlier clash';
}

/**
 * The compact session timeline: sessions grouped by the month they land in,
 * with the session a holiday blocked shown as its own red row next to the
 * green row for where it actually runs — "shifted to replacement" paired with
 * "replacement delivered". Only a session that itself clashed with a closed
 * date (`shift.clashes.length`) gets that treatment; a session merely carried
 * along by an earlier clash renders as a normal delivered row on its actual
 * date, so the timeline reads as what genuinely moved, not everything the
 * move touched.
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
  type Entry =
    | { kind: 'session'; number: number; name: string; date: string; plannedUtc: string; durationMinutes: number; extra?: ReactNode; actions?: ReactNode }
    | { kind: 'blocked'; number: number; name: string; date: string; durationMinutes: number; causePhrase: string; replacementDate: string }
    | { kind: 'replacement'; number: number; name: string; date: string; plannedUtc: string; durationMinutes: number; extra?: ReactNode; actions?: ReactNode };

  const entries: Entry[] = [];
  occurrences.forEach((item, index) => {
    const number = item.shift?.sessionNumber || index + 1;
    // A blocked date and its replacement are one session that moved, so both
    // rows carry the same name.
    const name = cleanText(item.name);
    if (!item.session) {
      if (item.plannedUtc) {
        entries.push({ kind: 'session', number, name, date: cleanText(item.plannedUtc).slice(0, 10), plannedUtc: item.plannedUtc, durationMinutes: item.durationMinutes, extra: item.extra, actions: item.actions });
      }
      return;
    }
    if (item.shift?.clashes.length) {
      entries.push({
        kind: 'blocked',
        number,
        name,
        date: item.shift.originalDate,
        durationMinutes: item.durationMinutes,
        causePhrase: holidayCausePhrase(item.shift),
        replacementDate: item.shift.actualDate,
      });
      entries.push({ kind: 'replacement', number, name, date: item.shift.actualDate, plannedUtc: item.plannedUtc, durationMinutes: item.durationMinutes, extra: item.extra, actions: item.actions });
    } else {
      entries.push({ kind: 'session', number, name, date: cleanText(item.session.date), plannedUtc: item.plannedUtc, durationMinutes: item.durationMinutes, extra: item.extra, actions: item.actions });
    }
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
        const delivered = group.entries.filter(entry => entry.kind !== 'blocked').length;
        const skipped = group.entries.filter(entry => entry.kind === 'blocked').length;
        return (
          <div key={group.key || 'unscheduled'} className="flex flex-col gap-3 px-3 py-4 sm:flex-row">
            <div className="w-full shrink-0 sm:w-32">
              <p className="text-[13px] font-heading font-bold text-foreground-900">{group.label || 'Not scheduled yet'}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">
                {delivered} delivered
              </p>
              {skipped > 0 && <p className="text-[11px] font-semibold text-red-600">{skipped} skipped</p>}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {group.entries.map((entry, index) => {
                if (entry.kind === 'blocked') {
                  return (
                    <div key={`blocked-${index}`} className="overflow-hidden rounded-lg border border-red-200 bg-red-50">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2 text-[12px]">
                          <AppIcon className="ri-close-circle-fill shrink-0 text-sm text-red-600"></AppIcon>
                          <span className="font-bold text-red-700">{formatDateLabel(entry.date)}</span>
                          <span className="text-[11px] font-bold text-red-400">Session {entry.number}</span>
                          {entry.name && <span className="font-semibold text-red-700">{entry.name}</span>}
                        </span>
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                          Shifted to replacement
                        </span>
                      </div>
                      <div className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] font-medium text-red-700">
                        Blocked by {entry.causePhrase}; replacement scheduled on {formatDateLabel(entry.replacementDate)}.
                      </div>
                    </div>
                  );
                }
                const isReplacement = entry.kind === 'replacement';
                return (
                  <div
                    key={`${entry.kind}-${index}`}
                    className={`overflow-hidden rounded-lg border text-[12px] ${
                      isReplacement ? 'border-emerald-200 bg-emerald-50' : 'border-background-200 bg-background-0'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`font-bold ${isReplacement ? 'text-emerald-700' : 'text-foreground-900'}`}>
                          {formatLabel(entry.plannedUtc, entry.date)}
                        </span>
                        {/* The weekday is the part of a date a reader acts on:
                            a session is moved by changing a delivery day. */}
                        <span className="text-foreground-400">{weekdayLabel(entry.date)}</span>
                        {/* Numbered because the holiday note above talks in
                            session numbers -- "sessions 8-10 run later" is only
                            actionable if session 8 can be found in the list. */}
                        <span className="text-[11px] font-bold text-foreground-400">Session {entry.number}</span>
                        {/* What is taught on the date, next to when it runs. */}
                        {entry.name && (
                          <span className={`font-semibold ${isReplacement ? 'text-emerald-700' : 'text-foreground-700'}`}>
                            {entry.name}
                          </span>
                        )}
                        {showDuration && <span className="text-foreground-400">{entry.durationMinutes} min</span>}
                      </span>
                      {(isReplacement || entry.actions) && (
                        <span className="flex flex-wrap items-center gap-2">
                          {isReplacement && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                              Replacement delivered
                            </span>
                          )}
                          {entry.actions}
                        </span>
                      )}
                    </div>
                    {entry.extra && (
                      <div className={`border-t px-3 py-1.5 text-[11px] font-medium ${isReplacement ? 'border-emerald-100 bg-emerald-50/70 text-emerald-800' : 'border-background-200 bg-background-50 text-foreground-600'}`}>
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
