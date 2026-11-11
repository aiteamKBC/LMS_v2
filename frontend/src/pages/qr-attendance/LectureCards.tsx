import { CalendarDays, Check, Clock3, Layers, Users } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { QRLecture } from '@/api/qrAttendance';
import { attendanceDayMessage, lectureDate, lectureSchedule } from './dates';

interface LectureCardsProps {
  lectures: QRLecture[];
  selectedId: string;
  timeZone: string;
  now: number;
  disabled: boolean;
  onSelect: (id: string) => void;
}

export function LectureCards({ lectures, selectedId, timeZone, now, disabled, onSelect }: LectureCardsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLLabelElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const card = selectedRef.current;
    if (!selectedId || !list || !card) return;
    const listBounds = list.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    if (cardBounds.top < listBounds.top) list.scrollTop += cardBounds.top - listBounds.top;
    else if (cardBounds.bottom > listBounds.bottom) list.scrollTop += cardBounds.bottom - listBounds.bottom;
  }, [selectedId, lectures]);

  return <div ref={listRef} role="region" aria-label="Available lectures" tabIndex={0}
    className="qr-attendance-lectures overscroll-contain rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
    {lectures.map(lecture => {
      const unavailable = attendanceDayMessage(lecture, timeZone, now);
      return <label key={lecture.id} ref={selectedId === lecture.id ? selectedRef : undefined} className={`qr-lecture-card ${disabled ? 'cursor-wait' : unavailable ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="radio" name="qr-lecture" value={lecture.id} checked={selectedId === lecture.id}
        aria-label={[lecture.title, lectureDate(lecture, timeZone), lecture.group, lecture.cohort].filter(Boolean).join(', ')}
        aria-describedby={unavailable ? `qr-lecture-unavailable-${lecture.id}` : undefined}
        disabled={disabled || Boolean(unavailable)} required onChange={() => onSelect(lecture.id)}
        className="peer sr-only" />
      <span className="qr-lecture-surface flex gap-2.5 rounded-2xl border border-primary-200 bg-white/70 p-3 transition-colors hover:border-primary-400 peer-checked:border-primary-500 peer-checked:bg-primary-50 peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-60">
        <span aria-hidden="true" className="qr-lecture-radio" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="qr-lecture-title break-words font-semibold text-primary-900">{lecture.title}</span>
            {!unavailable && lecture.current && <span className="qr-current-badge inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 font-medium text-primary-700 ring-1 ring-primary-100"><Check aria-hidden="true" size={14} /> Current lecture</span>}
          </span>
          <span className="qr-lecture-metadata text-foreground-700">
            <span><CalendarDays aria-hidden="true" size={15} /><span>{lectureSchedule(lecture, timeZone).date}</span></span>
            <span><Clock3 aria-hidden="true" size={15} /><span>{lectureSchedule(lecture, timeZone).time}</span></span>
            {lecture.group && <span><Users aria-hidden="true" size={15} /><span>{lecture.group}</span></span>}
            {lecture.cohort && <span><Layers aria-hidden="true" size={15} /><span>{lecture.cohort}</span></span>}
          </span>
          {unavailable && <span id={`qr-lecture-unavailable-${lecture.id}`} className="mt-2 block text-xs font-medium text-foreground-700">{unavailable}</span>}
        </span>
      </span>
    </label>;
    })}
  </div>;
}
