import { useEffect, useMemo, useRef } from 'react';
import type { Lecture } from '../types';
import { addDays, formatCompactDate, formatHourLabel, formatTimeRange, HOUR_HEIGHT, layoutDayLectures, lectureOverallStatus, lectureStatusSummary, STATUS_META, timeToMinutes } from '../utils';

interface Props {
  startDate: string;
  endDate: string;
  lectures: Lecture[];
  selectedLectureId: string | null;
  onSelectLecture: (lecture: Lecture) => void;
  expanded: boolean;
  emptyMessage: string;
}

/** A local, read-only time grid; opening an event preserves its saved identity. */
export default function CalendarTimeline({ startDate, endDate, lectures, selectedLectureId, onSelectLecture, expanded, emptyMessage }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    const result: string[] = [];
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) result.push(date);
    return result;
  }, [startDate, endDate]);
  const columns = days.map(date => {
    const events = lectures.filter(lecture => lecture.date === date);
    // The grid ends at midnight, including sessions that continue into the next day.
    const positioned = layoutDayLectures(events.map(lecture => ({ ...lecture,
      endTime: lecture.endTime < lecture.startTime ? '24:00' : lecture.endTime,
    })), 0, HOUR_HEIGHT);
    return { date, positioned, width: Math.max(180, ...positioned.map(event => event.cols * 150)) };
  });
  const firstMinute = lectures.length ? Math.min(...lectures.map(lecture => timeToMinutes(lecture.startTime))) : 8 * 60;
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, firstMinute - 60) / 60 * HOUR_HEIGHT;
  }, [startDate, endDate, firstMinute]);

  return <div ref={scrollRef} role="region" aria-label="Hourly lecture calendar" tabIndex={0}
    className={`relative overflow-auto rounded-lg border border-background-200 bg-background-50 scrollbar-slim ${expanded ? 'min-h-0 flex-1' : 'min-h-[420px]'}`}
    style={expanded ? undefined : { height: 'calc(100dvh - 24rem)' }}>
    <div style={{ minWidth: 56 + columns.reduce((total, day) => total + day.width, 0) }}>
      <div className="sticky top-0 z-20 flex border-b border-background-200 bg-background-50">
        <div className="sticky left-0 z-20 w-14 shrink-0 bg-background-50 p-2 text-xs text-foreground-500">Time</div>
        {columns.map(day => <div key={day.date} style={{ minWidth: day.width }} className="flex-1 border-l border-background-200 px-3 py-2 text-sm font-bold text-primary-700">{formatCompactDate(day.date)}</div>)}
      </div>
      {!lectures.length && <div className="sticky left-14 top-12 z-10 h-0 w-64"><p role="status" className="absolute rounded-md bg-background-50 p-3 text-sm text-foreground-600">{emptyMessage}</p></div>}
      <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
        <div className="sticky left-0 z-10 w-14 shrink-0 bg-background-50">
          {Array.from({ length: 24 }, (_, hour) => <div key={hour} style={{ height: HOUR_HEIGHT }} className="border-t border-background-200 px-1 pt-1 text-right text-[11px] tabular-nums text-foreground-500">{formatHourLabel(hour * 60)}</div>)}
        </div>
        {columns.map(day => <div key={day.date} aria-label={`Lectures on ${day.date}`} role="region" style={{ minWidth: day.width }}
          className="relative flex-1 border-l border-background-200">
          {Array.from({ length: 48 }, (_, halfHour) => <div key={halfHour} className={halfHour % 2 ? 'border-t border-dashed border-background-200/60' : 'border-t border-background-200'} style={{ height: HOUR_HEIGHT / 2 }} />)}
          {day.positioned.map(event => {
            const lecture = lectures.find(item => item.id === event.lecture.id)!;
            const meta = STATUS_META[lectureOverallStatus(lecture)];
            return <button key={lecture.id} type="button" aria-pressed={lecture.id === selectedLectureId}
              aria-label={`${lecture.title}, ${formatTimeRange(lecture.startTime, lecture.endTime)}, ${lecture.module}, ${lecture.group}, ${lectureStatusSummary(lecture)}`}
              title={`${lecture.title}\n${formatTimeRange(lecture.startTime, lecture.endTime)}\n${lecture.module} / ${lecture.group}\n${lectureStatusSummary(lecture)}`}
              onClick={() => onSelectLecture(lecture)}
              style={{ top: event.top, height: Math.min(event.height, 24 * HOUR_HEIGHT - event.top), left: `calc(${event.col / event.cols * 100}% + 2px)`, width: `calc(${100 / event.cols}% - 4px)` }}
              className={`absolute overflow-hidden rounded-md border border-background-200 border-l-4 bg-primary-50 px-2 py-1 text-left text-xs text-foreground-900 shadow-sm hover:bg-primary-100 focus:z-10 focus:outline-none focus:ring-2 focus:ring-primary-500 ${meta.borderLeft} ${lecture.id === selectedLectureId ? 'ring-2 ring-primary-500' : ''}`}>
              <span className="block truncate font-bold">{lecture.title}</span>
              <span className="block truncate tabular-nums">{formatTimeRange(lecture.startTime, lecture.endTime)}</span>
              {event.height >= 64 && <><span className="mt-1 block truncate">{lecture.module} / {lecture.group}</span><span className={`block truncate ${meta.textClass}`}>{lectureStatusSummary(lecture)}</span></>}
            </button>;
          })}
        </div>)}
      </div>
    </div>
  </div>;
}
