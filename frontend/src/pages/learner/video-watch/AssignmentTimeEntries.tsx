import type { MonthlyAssignment } from '@/api/monthlyAssignment';
import { useEffect, useId, useState } from 'react';
import { fetchLearnerCalendarEvents, type BookingCalendarRules } from '@/api/learnerCalendar';
import type { LearnerKind } from '@/api/learnerDetail';

function HoursInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const hours = Number(value);
  const adjust = (direction: number) => {
    if (direction < 0 && hours <= 0.5) return;
    onChange(String(Number(Math.min(8, Math.max(0.5, (Number.isFinite(hours) ? hours : 0) + direction * 0.5)).toFixed(2))));
  };
  const button = 'h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-slate-50 text-lg font-semibold text-slate-700 disabled:opacity-40';
  return <div className="min-w-0 text-sm">
    <label htmlFor={id}>{label}</label>
    <div className="mt-1 flex items-center gap-1">
      <button type="button" className={button} aria-label={`Decrease ${label} by half an hour`} disabled={hours <= 0.5} onClick={() => adjust(-1)}>&minus;</button>
      <input id={id} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-center disabled:bg-slate-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        type="number" min="0.01" max="8" step="any" value={value} onChange={event => onChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); adjust(event.key === 'ArrowUp' ? 1 : -1); } }}
        placeholder="e.g. 1.5" required />
      <button type="button" className={button} aria-label={`Increase ${label} by half an hour`} disabled={hours >= 8} onClick={() => adjust(1)}>+</button>
    </div>
  </div>;
}

export function assignmentDateRestriction(date: string, rules: BookingCalendarRules | null) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return 'Weekend';
  if (!rules || !rules.coveredYears.includes(Number(date.slice(0, 4)))) return 'Holiday calendar unavailable';
  return rules.bankHolidays.find(item => item.date === date)?.title || '';
}

function WorkingDatePicker({ month, value, label, rules, disabled, onChange }: {
  month: string; value: string; label: string; rules: BookingCalendarRules | null;
  disabled: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [month, disabled]);
  const bounds = assignmentMonthBounds(month);
  const days = bounds ? Number(bounds.max.slice(-2)) : 0;
  const offset = bounds ? new Date(`${bounds.min}T12:00:00Z`).getUTCDay() : 0;
  return <div className="relative text-sm" onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
    <span>{label}</span>
    <button type="button" aria-label={label} aria-expanded={open} disabled={disabled || !bounds || !rules}
      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left disabled:bg-slate-100"
      onClick={() => setOpen(current => !current)}>{value || 'Choose date'}</button>
    {open && <div role="group" aria-label={`${label} calendar`} className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
      <div className="mb-3 flex items-center justify-between"><strong>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button type="button" aria-label="Close calendar" onClick={() => setOpen(false)}>×</button></div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day} className="text-xs text-slate-500">{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, '0')}`;
          const reason = assignmentDateRestriction(date, rules);
          return <button type="button" key={date} aria-label={date} title={reason || date} disabled={Boolean(reason)} aria-pressed={value === date}
            className={`rounded p-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${value === date ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}
            onClick={() => { onChange(date); setOpen(false); }}>{index + 1}</button>;
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">Weekends and England & Wales bank holidays are unavailable.</p>
      <button type="button" className="mt-2 text-blue-700" onClick={() => { onChange(''); setOpen(false); }}>Clear date</button>
    </div>}
  </div>;
}

export function assignmentMonthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { min: `${month}-01`, max: `${month}-${days}` };
}

export function assignmentTimeHours(entries: MonthlyAssignment['timeEntries']) {
  return (entries || []).reduce((sum, row) => {
    const hours = Number(row.hours);
    return sum + (Number.isFinite(hours) && hours > 0 ? hours : 0);
  }, 0);
}

export function AssignmentTimeEntries({ month, entries, onChange, disabled, kind, learnerId }: {
  kind: LearnerKind; learnerId: string;
  month: string; entries: NonNullable<MonthlyAssignment['timeEntries']>;
  onChange: (entries: NonNullable<MonthlyAssignment['timeEntries']>) => void; disabled: boolean;
}) {
  const [rules, setRules] = useState<BookingCalendarRules | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRules(null); setError('');
    void fetchLearnerCalendarEvents(kind, learnerId, { force: retry > 0 }).then(result => {
      if (!result.bookingCalendar) throw new Error('Holiday calendar unavailable.');
      if (active) setRules(result.bookingCalendar);
    }).catch(() => { if (active) setError('Could not load bank holidays. Retry to choose a date.'); });
    return () => { active = false; };
  }, [kind, learnerId, retry]);
  const bounds = assignmentMonthBounds(month);
  const rows = entries.length ? entries : [{ topic: '', hours: '', date: '' }];
  const update = (index: number, key: 'topic' | 'hours' | 'date', value: string) =>
    onChange(rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const input = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:bg-slate-100';
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-3 text-sm text-slate-600">Add each topic, the hours you spent on it and the day you worked on it.</legend>
    {rows.map((row, index) => <div key={index} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[2fr_1fr_1.5fr_auto]">
      <label className="text-sm">Topic {index + 1}<input className={input} value={row.topic} maxLength={300} onChange={e => update(index, 'topic', e.target.value)} placeholder="e.g. Research and analysis" required /></label>
      <HoursInput label={`Hours ${index + 1}`} value={row.hours} onChange={value => update(index, 'hours', value)} />
      <WorkingDatePicker month={month} value={row.date} label={`Date ${index + 1}`} rules={rules} disabled={disabled} onChange={value => update(index, 'date', value)} />
      <button type="button" className="self-end rounded-lg px-3 py-2 text-sm text-red-700 disabled:opacity-40" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove topic {index + 1}</button>
      {Number(row.hours) > 8 && <p role="alert" className="text-sm text-red-700 sm:col-span-4">Each topic can have a maximum of 8 hours.</p>}
      {row.date && bounds && (row.date < bounds.min || row.date > bounds.max) && <p role="alert" className="text-sm text-red-700 sm:col-span-4">Choose a date within the assignment month ({month}).</p>}
      {row.date && rules && assignmentDateRestriction(row.date, rules) && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{assignmentDateRestriction(row.date, rules)}: choose a working day.</p>}
    </div>)}
    {!rules && !error && <p role="status">Loading bank holidays…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry calendar</button></p>}
    <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" onClick={() => onChange([...rows, { topic: '', hours: '', date: '' }])}>Add topic</button>
    <p className="text-sm font-semibold" aria-live="polite">Total learning time: {Number(assignmentTimeHours(entries).toFixed(2))} hours</p>
    <p className="text-xs text-slate-600">Dates must be within the assignment month: {month}. Use the plus and minus buttons to adjust by half an hour, or type hours directly: 1 = 1 hour, 1.5 = 1 hour 30 minutes.</p>
  </fieldset>;
}
