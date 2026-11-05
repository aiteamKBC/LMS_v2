import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import { addDays, formatCompactDate, formatHourLabel } from '@/pages/curriculum/recordings/utils';
import { meetingDate, meetingPhase, recordingLabel, meetingKey, meetingTitle } from './model';

interface Props {
  start: string; end: string; timeZone: string; meetings: CoachingMeeting[]; now: number;
  selected?: string | null;
  coachName: (email: string) => string; learnerName: (id: string) => string;
  onSelect: (row: CoachingMeeting, day: string) => void;
}
interface Placed { row: CoachingMeeting; start: number; finish: number; col: number; cols: number }
const HOUR_HEIGHT = 112;
const COACHES_PER_PAGE = 4;

function place(rows: Omit<Placed, 'col' | 'cols'>[]): Placed[] {
  const result: Placed[] = [];
  let group: Placed[] = [], ends: number[] = [], last = -1;
  const finish = () => { group.forEach(item => { item.cols = ends.length; result.push(item); }); group = []; ends = []; };
  for (const row of rows.sort((a, b) => a.start - b.start || a.finish - b.finish || meetingKey(a.row).localeCompare(meetingKey(b.row)))) {
    if (row.start >= last) finish();
    let col = ends.findIndex(end => end <= row.start);
    if (col < 0) col = ends.length;
    ends[col] = row.finish;
    last = Math.max(...ends);
    group.push({ ...row, col, cols: 1 });
  }
  finish();
  return result;
}

export default function MeetingTimeline({ start, end, timeZone, meetings, now, selected, coachName, learnerName, onSelect }: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const [coachPage, setCoachPage] = useState({ scope: '', offset: 0 });
  const formatter = useMemo(() => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [timeZone]);
  const clock = (stamp: string) => formatter.format(new Date(stamp));
  const columns = useMemo(() => {
    const minute = (stamp: string) => { const [hour, min] = formatter.format(new Date(stamp)).split(':').map(Number); return hour * 60 + min; };
    const spans = meetings.map(row => ({ row, first: meetingDate(row.startsAt, timeZone), last: meetingDate(new Date(Date.parse(row.endsAt) - 1).toISOString(), timeZone) }));
    const days = [];
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const items = spans.filter(span => span.first <= day && span.last >= day).map(({ row, first }) => {
        const begin = first < day ? 0 : minute(row.startsAt);
        const finish = meetingDate(row.endsAt, timeZone) > day ? 1440 : minute(row.endsAt);
        // Keep short appointments usable and repeated DST hours in a valid lane.
        return { row, start: begin, finish: Math.min(1440, Math.max(finish, begin + 30)) };
      });
      const owners = [...new Set(items.map(item => item.row.coachEmail))].sort();
      // In a day overview each coach owns a lane. Invitations in different
      // calendars must not compete for the same overlap columns or be merged.
      for (const owner of start === end && owners.length > 1 ? owners : [null]) {
        const positioned = place(owner ? items.filter(item => item.row.coachEmail === owner) : items);
        days.push({ day, owner, key: `${day}:${owner ?? ''}`, positioned,
          width: Math.max(280, ...positioned.map(item => item.cols * 220)) });
      }
    }
    return days;
  }, [meetings, start, end, timeZone, formatter]);
  const byCoach = start === end && columns.length > 1;
  const scope = JSON.stringify([start, end, timeZone, columns.map(column => column.key)]);
  const offset = coachPage.scope === scope ? Math.min(coachPage.offset, Math.max(0, columns.length - 1)) : 0;
  const shown = byCoach ? columns.slice(offset, offset + COACHES_PER_PAGE) : columns;
  const starts = shown.flatMap(day => day.positioned.map(item => item.start));
  const firstMinute = starts.length ? Math.min(...starts) : 8 * 60;
  useEffect(() => {
    if (scroll.current) {
      scroll.current.scrollTop = Math.max(0, firstMinute - 60) / 60 * HOUR_HEIGHT;
      scroll.current.scrollLeft = 0;
    }
  }, [start, end, firstMinute, offset, timeZone]);
  return <>
    {byCoach && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background-50 px-3 py-2">
      <div><p className="text-xs font-semibold" aria-live="polite">Coaches {offset + 1}–{Math.min(columns.length, offset + COACHES_PER_PAGE)} of {columns.length} · {shown.reduce((total, column) => total + column.positioned.length, 0)} meetings in these columns</p>
        <p className="mt-1 text-xs text-foreground-500">One column per coach. Scroll sideways for more space, or filter by coach above.</p></div>
      {columns.length > COACHES_PER_PAGE && <div className="flex gap-2">
        <button type="button" aria-label="Previous coaches" disabled={offset === 0} onClick={() => setCoachPage({ scope, offset: Math.max(0, offset - COACHES_PER_PAGE) })}
          className="rounded-lg border border-background-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-40">Previous</button>
        <button type="button" aria-label="Next coaches" disabled={offset + COACHES_PER_PAGE >= columns.length} onClick={() => setCoachPage({ scope, offset: offset + COACHES_PER_PAGE })}
          className="rounded-lg border border-background-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-40">Next</button>
      </div>}
    </div>}
    <div ref={scroll} role="region" aria-label="Hourly coach meeting calendar" tabIndex={0}
    className="relative h-[min(65vh,720px)] min-h-[360px] overflow-auto rounded-lg border border-background-200 bg-white scrollbar-slim">
    <div style={{ minWidth: 56 + shown.reduce((total, day) => total + day.width, 0) }}>
      <div className="sticky top-0 z-20 flex border-b border-background-200 bg-white">
        <div className="sticky left-0 z-20 w-14 shrink-0 bg-white p-2 text-xs text-foreground-500">Time</div>
        {shown.map(({ day, owner, key, positioned, width }) => <div key={key} style={{ minWidth: width }} className="flex-1 border-l border-background-200 px-3 py-2 text-sm font-bold text-primary-700">
          {owner ? <><span className="block">{coachName(owner)}</span><span className="mt-0.5 block text-xs font-normal text-foreground-500">{formatCompactDate(day)} · {positioned.length} meetings</span></> : formatCompactDate(day)}
        </div>)}
      </div>
      <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
        <div className="sticky left-0 z-10 w-14 shrink-0 bg-white">{Array.from({ length: 24 }, (_, hour) => <div key={hour} style={{ height: HOUR_HEIGHT }} className="border-t border-background-200 px-1 pt-1 text-right text-[11px] tabular-nums text-foreground-500">{formatHourLabel(hour * 60)}</div>)}</div>
        {shown.map(({ day, owner, key, positioned, width }) => <section key={key} aria-label={owner ? `Meetings for ${coachName(owner)} on ${day}` : `Meetings on ${day}`} style={{ minWidth: width }} className="relative flex-1 border-l border-background-200">
          {Array.from({ length: 48 }, (_, half) => <div key={half} aria-hidden="true" className={half % 2 ? 'border-t border-dashed border-background-100' : 'border-t border-background-200'} style={{ height: HOUR_HEIGHT / 2 }} />)}
          {positioned.map(({ row, start: begin, finish, col, cols }) => {
            const title = meetingTitle(row), phase = meetingPhase(row, now), active = selected === meetingKey(row), compact = finish - begin < 60;
            const people = row.learnerIds.map(learnerName);
            return <article key={meetingKey(row)} className="absolute" style={{ top: begin / 60 * HOUR_HEIGHT, height: (finish - begin) / 60 * HOUR_HEIGHT, left: `calc(${col / cols * 100}% + 3px)`, width: `calc(${100 / cols}% - 6px)` }}>
              <button type="button" aria-label={`View ${title} on ${day}`} aria-pressed={active} onClick={() => onSelect(row, day)}
                title={`${title}\n${coachName(row.coachEmail)}\n${clock(row.startsAt)}–${clock(row.endsAt)}\n${people.join(', ')}`}
                className={`h-full w-full overflow-hidden rounded-lg border border-l-4 px-2.5 ${compact ? 'py-1' : 'py-1.5'} text-left text-[11px] leading-[14px] shadow-sm hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${phase === 'cancelled' ? 'border-rose-200 border-l-rose-400 bg-rose-50' : 'border-primary-100 border-l-primary-400 bg-primary-50'} ${active ? 'ring-2 ring-primary-500' : ''}`}>
                <h3 className={`${compact ? 'truncate' : 'line-clamp-2 break-words'} text-xs font-bold leading-4 text-primary-900`}>{title}</h3>
                <span className="block truncate tabular-nums text-primary-800">{clock(row.startsAt)}–{clock(row.endsAt)}{meetingDate(row.startsAt, timeZone) < day ? ' · Continues' : ''}</span>
                <span className={compact || owner ? 'sr-only' : 'mt-0.5 block truncate text-foreground-700'}>{coachName(row.coachEmail)}</span>
                <span className={compact ? 'sr-only' : 'block truncate text-foreground-500'}>{people.slice(0, 2).join(', ') || 'No learner linked'}{people.length > 2 ? ` +${people.length - 2} more` : ''}</span>
                <span className={`block truncate ${compact ? 'text-[10px] leading-3' : 'mt-0.5'} ${row.media.readyCount > 0 ? 'text-emerald-700' : 'text-foreground-500'}`}>{phase === 'upcoming' ? 'Upcoming' : phase === 'in-progress' ? `Within scheduled time · ${recordingLabel(row.media)}` : phase === 'cancelled' ? 'Cancelled' : `Ended · ${recordingLabel(row.media)}`}</span>
              </button>
            </article>;
          })}
        </section>)}
      </div>
    </div>
  </div></>;
}
