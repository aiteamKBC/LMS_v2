import type { CoachingMeeting } from '@/api/coachingRecordings';
import { useMemo } from 'react';
import { periodBounds, type Period } from '@/pages/curriculum/recordings/filters';
import { addDays, formatFullDate, formatMonthLabel, getMonthMatrix, parseIsoDate, WEEKDAY_SHORT } from '@/pages/curriculum/recordings/utils';
import { meetingDate, meetingPhase, recordingLabel, meetingKey, meetingTitle } from './model';
import MeetingTimeline from './MeetingTimeline';

interface Props {
  date: string;
  period: Period;
  timeZone: string;
  meetings: CoachingMeeting[];
  totalMeetings?: number;
  now: number;
  coachName: (email: string) => string;
  learnerName: (id: string) => string;
  onSelectDay: (date: string) => void;
  onSelectMeeting?: (meeting: CoachingMeeting) => void;
  selected?: string | null;
}

const phaseLabels = { ended: 'Ended', upcoming: 'Upcoming', 'in-progress': 'Within scheduled time', cancelled: 'Cancelled' };

export default function MeetingCalendar({ date, period, timeZone, meetings, totalMeetings = meetings.length, now, coachName, learnerName, onSelectDay, onSelectMeeting, selected }: Props) {
  const month = parseIsoDate(date);
  const bounds = periodBounds(date, period);
  const days = period === 'month' ? getMonthMatrix(month.year, month.month)
    : Array.from({ length: period === 'day' ? 1 : period === 'workWeek' ? 5 : 7 }, (_, index) => addDays(bounds.start, index));
  const clockFormatter = useMemo(() => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }), [timeZone]);
  const clock = (value: string) => clockFormatter.format(new Date(value));
  const spans = useMemo(() => meetings.map(row => ({ row, first: meetingDate(row.startsAt, timeZone),
    last: meetingDate(new Date(Date.parse(row.endsAt) - 1).toISOString(), timeZone) })), [meetings, timeZone]);
  const cellLimit = period === 'month' ? 3 : period === 'day' ? 12 : 8;

  return <section aria-label="Coach meeting calendar" className="min-w-0 rounded-xl border border-background-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="text-base font-bold">{period === 'month' ? formatMonthLabel(month.year, month.month) : period === 'day' ? formatFullDate(date) : `${formatFullDate(bounds.start)} – ${formatFullDate(bounds.end)}`}</h2>
      <p className="text-xs text-foreground-500">{meetings.length < totalMeetings ? `Showing ${meetings.length} of ${totalMeetings} matching meetings` : `${totalMeetings} meetings match the filters`} · {timeZone}</p>
    </div>
    <p className="mt-2 text-xs text-foreground-600">Select a meeting to review its recordings and attendance.</p>
    {period !== 'month' ? <div className="mt-4"><MeetingTimeline start={bounds.start} end={bounds.end} timeZone={timeZone} meetings={meetings} now={now}
      selected={selected} coachName={coachName} learnerName={learnerName} onSelect={(row, day) => onSelectMeeting ? onSelectMeeting(row) : onSelectDay(day)} /></div> : <div className="mt-4 overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-7">
        {WEEKDAY_SHORT.map(day => <div key={day} className="border-b border-background-200 px-2 pb-2 text-xs font-semibold text-foreground-600">{day}</div>)}
        {days.map(day => {
          const loaded = day >= bounds.start && day <= bounds.end;
          // The end is exclusive: a meeting ending at midnight belongs to the previous day.
          const rows = loaded ? spans.filter(item => item.first <= day && item.last >= day).map(item => item.row) : [];
          return <section key={day} aria-label={`Meetings on ${day}`} className={`relative min-w-0 border-b border-r border-background-100 p-2 ${loaded ? 'bg-white' : 'bg-background-50'}`}>
            <button type="button" aria-label={`Show meetings on ${day}`} aria-current={day === date ? 'date' : undefined}
              className={`mb-2 min-h-9 min-w-9 rounded-lg px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${day === date ? 'bg-primary-600 text-white' : 'text-foreground-700 hover:bg-primary-50'}`}
              onClick={() => onSelectDay(day)}>{period === 'month' ? parseIsoDate(day).day : formatFullDate(day)}</button>
            <div className="max-h-64 min-h-24 space-y-2 overflow-y-auto">
              {rows.slice(0, cellLimit).map(row => {
                const phase = meetingPhase(row, now);
                const title = meetingTitle(row);
                return <button type="button" key={`${row.coachEmail}:${row.calendarEventId}:${row.startsAt}`} aria-label={`View ${title} on ${day}`}
                  onClick={() => onSelectMeeting ? onSelectMeeting(row) : onSelectDay(day)} aria-pressed={selected === meetingKey(row)} className={`block w-full rounded-lg border-l-4 p-2 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${phase === 'cancelled' ? 'border-rose-400 bg-rose-50' : row.media.readyCount > 0 ? 'border-emerald-400 bg-emerald-50' : 'border-primary-400 bg-primary-50'}`}>
                  <span className="block font-semibold">{meetingDate(row.startsAt, timeZone) < day ? 'Continues' : clock(row.startsAt)} · {phaseLabels[phase]}</span>
                  <span className="mt-1 line-clamp-2 break-words font-semibold">{title}</span>
                  <span className="mt-1 block break-words">{coachName(row.coachEmail)}</span>
                  <span className="block break-words">{row.learnerIds.map(learnerName).join(', ') || 'No learner linked'}</span>
                  <span className="mt-1 block text-foreground-600">{recordingLabel(row.media)}</span>
                </button>;
              })}
              {rows.length > cellLimit && <button type="button" className="w-full rounded-lg bg-background-100 px-2 py-2 text-left text-xs font-semibold text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500" onClick={() => onSelectDay(day)}>+{rows.length - cellLimit} more · View day</button>}
              {!loaded && <p className="text-xs text-foreground-400">Select this day to load meetings.</p>}
              {loaded && !rows.length && <p className="sr-only">No matching meetings loaded.</p>}
            </div>
          </section>;
        })}
      </div>
    </div>}
  </section>;
}
