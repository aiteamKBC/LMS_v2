import { useEffect, useMemo, useRef, useState } from 'react';
import { importCountryCalendar, type CurriculumHoliday, type DeliveryCalendarPolicy } from '@/lib/curriculumApi';
import { CALENDAR_COUNTRIES, CALENDAR_DAYS, calendarPreset, effectiveCalendarHolidays } from './deliveryCalendar';

interface Props {
  value: DeliveryCalendarPolicy | null;
  onChange: (value: DeliveryCalendarPolicy | null) => void;
  legacyHolidays: CurriculumHoliday[];
  inheritedPolicy?: DeliveryCalendarPolicy | null;
  inheritedExcludedIds?: Array<string | number>;
  module?: boolean;
  startDate: string;
  endDate: string;
  onHolidaysChange: (rows: CurriculumHoliday[]) => void;
  onReadyChange: (ready: boolean) => void;
}

export function DeliveryCalendarEditor(props: Props) {
  const { value, onChange, legacyHolidays, inheritedPolicy, inheritedExcludedIds, module, startDate, endDate } = props;
  const [loaded, setLoaded] = useState<{ key: string; rows: CurriculumHoliday[] } | null>(null);
  const [error, setError] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const callbacks = useRef(props);
  callbacks.current = props;
  const inherited = value === null && module;
  const policy = value || (module ? inheritedPolicy : null) || { ...calendarPreset(), excludedHolidayIds: (inheritedExcludedIds || []).map(String) };
  const foreign = policy.country !== 'GB' && policy.observePublicHolidays;
  const requestKey = foreign && startDate && endDate ? `${policy.country}:${startDate}:${endDate}` : '';
  const ready = !foreign || Boolean(requestKey && loaded?.key === requestKey && !error);

  useEffect(() => {
    let active = true;
    setError('');
    if (!requestKey) return;
    importCountryCalendar(policy.country, startDate, endDate).then(result => {
      if (active) setLoaded({ key: requestKey, rows: result.holidays });
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load the country calendar.');
    });
    return () => { active = false; };
  }, [requestKey, policy.country, startDate, endDate]);

  const rows = policy.country === 'GB' ? legacyHolidays : loaded?.key === requestKey ? loaded.rows : [];
  const effective = useMemo(() => {
    const selected = effectiveCalendarHolidays(value || (module ? inheritedPolicy || null : null), rows);
    if (!inherited) return selected;
    const excluded = new Set((inheritedExcludedIds || []).map(String));
    return selected.filter(row => !excluded.has(String(row.id)));
  }, [value, module, inheritedPolicy, rows, inherited, inheritedExcludedIds]);
  const signature = JSON.stringify(effective);
  useEffect(() => { callbacks.current.onHolidaysChange(JSON.parse(signature) as CurriculumHoliday[]); }, [signature]);
  useEffect(() => { callbacks.current.onReadyChange(ready); }, [ready]);

  const update = (patch: Partial<DeliveryCalendarPolicy>) => onChange({ ...policy, ...patch });
  const toggleHoliday = (id: string) => update({ excludedHolidayIds: policy.excludedHolidayIds.includes(id)
    ? policy.excludedHolidayIds.filter(item => item !== id) : [...policy.excludedHolidayIds, id] });
  const label = CALENDAR_COUNTRIES.find(item => item[0] === policy.country)?.[1] || policy.country;

  return <section aria-label="Delivery calendar" className="space-y-3 rounded-xl border border-background-200 bg-background-50 p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Calendar &amp; holidays</h3>
      {module && <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => onChange(inherited
        ? { ...policy, excludedHolidayIds: [...new Set([...policy.excludedHolidayIds, ...(inheritedExcludedIds || []).map(String)])] }
        : null)}>{inherited ? 'Customize this module' : 'Use cohort calendar'}</button>}
    </div>
    {inherited ? <p className="text-xs text-foreground-600">Using the cohort calendar: {label}. Weekly rest days: {policy.weekendDays.join(', ') || 'None'}.</p>
      : <>
        <label className="block text-xs font-semibold">Country
          <select className="mt-1 w-full rounded-lg border border-background-300 bg-white p-2 text-sm" value={policy.country}
            onChange={event => onChange({ ...calendarPreset(event.target.value), manualHolidays: policy.manualHolidays, excludedHolidayIds: policy.excludedHolidayIds })}>
            {CALENDAR_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="text-xs font-semibold">Weekly rest days — confirm or change</legend>
          <div className="mt-2 flex flex-wrap gap-3">{CALENDAR_DAYS.map(day => <label key={day} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={policy.weekendDays.includes(day)} onChange={() => update({ weekendDays: policy.weekendDays.includes(day)
              ? policy.weekendDays.filter(item => item !== day) : [...policy.weekendDays, day] })} />{day}
          </label>)}</div>
        </fieldset>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={policy.observePublicHolidays}
          onChange={event => update({ observePublicHolidays: event.target.checked })} />Apply public holidays</label>
      </>}
    {foreign && !requestKey && <p className="text-xs text-amber-700">Set the start and end dates to load the required holiday years.</p>}
    {requestKey && !ready && !error && <p role="status" className="text-xs">Loading the saved country calendar…</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error} Change the country/dates or retry from Holiday Calendars.</p>}
    {!inherited && value !== null && <>
      <fieldset className="max-h-48 space-y-2 overflow-y-auto">
        <legend className="text-xs font-semibold">Holidays — untick a date to allow teaching</legend>
        {[...rows, ...policy.manualHolidays].map(row => <label key={String(row.id)} className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={!policy.excludedHolidayIds.includes(String(row.id)) && (policy.observePublicHolidays || row.source === 'authored')}
            disabled={!policy.observePublicHolidays && row.source !== 'authored'} onChange={() => toggleHoliday(String(row.id))} />
          <span>{row.startDate}{row.endDate !== row.startDate ? ` – ${row.endDate}` : ''}: {row.label} ({row.source === 'authored' ? 'Manual' : 'Public'})</span>
          {row.source === 'authored' && policy.manualHolidays.some(item => item.id === row.id) && <button type="button" className="ml-auto text-red-700"
            aria-label={`Remove ${row.label}`} onClick={() => update({ manualHolidays: policy.manualHolidays.filter(item => item.id !== row.id) })}>Remove</button>}
        </label>)}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Add a manual closure for this {module ? 'module' : 'cohort'}</legend>
        <label className="block text-xs">Closure name<input className="mt-1 w-full rounded-lg border p-2" value={manualName} onChange={event => setManualName(event.target.value)} /></label>
        <div className="flex gap-2">
          <label className="text-xs">From<input type="date" className="block rounded-lg border p-2" value={manualStart} onChange={event => setManualStart(event.target.value)} /></label>
          <label className="text-xs">To (optional)<input type="date" className="block rounded-lg border p-2" value={manualEnd} min={manualStart} onChange={event => setManualEnd(event.target.value)} /></label>
        </div>
        <button type="button" className="text-xs font-semibold text-primary-700" disabled={!manualName.trim() || !manualStart || Boolean(manualEnd && manualEnd < manualStart)} onClick={() => {
          update({ manualHolidays: [...policy.manualHolidays, { id: `manual:${crypto.randomUUID()}`, label: manualName.trim(), startDate: manualStart, endDate: manualEnd || manualStart, source: 'authored' }] });
          setManualName(''); setManualStart(''); setManualEnd('');
        }}>Add closure</button>
      </fieldset>
    </>}
    {!module && value === null && <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => onChange(policy)}>Customize England calendar</button>}
    {!module && value !== null && <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => onChange(null)}>Restore England default</button>}
    <p className="text-xs text-foreground-500">Changes apply to this {module ? 'module' : 'cohort'}. Existing Teams meetings are updated separately.</p>
    {foreign && <p className="text-[11px] text-foreground-500">Public holiday data: <a href="https://calendarific.com" target="_blank" rel="noreferrer">Powered by Calendarific</a>. Future dates may change.</p>}
  </section>;
}
