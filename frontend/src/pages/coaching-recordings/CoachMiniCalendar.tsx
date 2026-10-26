import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, formatMonthLabel, getMonthMatrix, parseIsoDate, todayIso, WEEKDAY_SHORT } from '@/pages/curriculum/recordings/utils';

interface Props {
  date: string;
  timeZone: string;
  meetingDates: Set<string>;
  onSelectDay: (date: string) => void;
}

export default function CoachMiniCalendar({ date, timeZone, meetingDates, onSelectDay }: Props) {
  const { year, month } = parseIsoDate(date);
  const changeMonth = (delta: number) => onSelectDay(new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10));
  const nav = 'flex h-8 w-8 items-center justify-center rounded-md text-foreground-600 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
  return <aside aria-label="Choose meeting date" className="min-w-0 self-start rounded-xl border border-background-200 bg-white p-4">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-bold text-foreground-950">{formatMonthLabel(year, month)}</h2>
      <div className="flex"><button type="button" className={nav} aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button>
        <button type="button" className={nav} aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button></div>
    </div>
    <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
      {WEEKDAY_SHORT.map(day => <span key={day} className="py-2 text-[10px] font-semibold uppercase text-foreground-400">{day.slice(0, 1)}</span>)}
      {getMonthMatrix(year, month).map(day => <button type="button" key={day} aria-label={`Show meetings on ${day}`}
        aria-current={day === date ? 'date' : undefined} onClick={() => onSelectDay(day)}
        className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${day === date ? 'bg-primary-600 font-bold text-white' : parseIsoDate(day).month !== month ? 'text-foreground-300 hover:bg-background-100' : 'text-foreground-700 hover:bg-primary-50'}`}>
        {parseIsoDate(day).day}
        {meetingDates.has(day) && <span aria-hidden="true" className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${day === date ? 'bg-white' : 'bg-primary-500'}`} />}
        {day === todayIso(timeZone) && day !== date && <span aria-hidden="true" className="absolute bottom-0.5 h-0.5 w-3 rounded bg-primary-400" />}
      </button>)}
    </div>
    <div className="mt-4 flex items-center justify-between border-t border-background-200 pt-3">
      <button type="button" className={nav} aria-label="Previous day" onClick={() => onSelectDay(addDays(date, -1))}><ChevronLeft size={16} /></button>
      <button type="button" aria-label="Today in mini calendar" onClick={() => onSelectDay(todayIso(timeZone))} className="rounded-md px-4 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50">Today</button>
      <button type="button" className={nav} aria-label="Next day" onClick={() => onSelectDay(addDays(date, 1))}><ChevronRight size={16} /></button>
    </div>
    <p className="mt-3 text-[11px] leading-relaxed text-foreground-500">Dots mark dates with meetings in the loaded results. Choose any date to check its meetings.</p>
    <div className="mt-4 space-y-2 border-t border-background-200 pt-4 text-xs text-foreground-600">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-foreground-400">Meeting status</p>
      {[['bg-emerald-500', 'Recording available'], ['bg-primary-400', 'Upcoming / in progress'], ['bg-amber-400', 'Recording pending'], ['bg-rose-400', 'Cancelled']].map(([color, label]) =>
        <p key={label} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</p>)}
      <p className="pt-2 text-[11px]">All times shown in {timeZone}</p>
    </div>
  </aside>;
}
