import { useCallback, useEffect, useState } from 'react';
import { fetchCountryCalendars, syncCountryCalendars, type CountryCalendarStatus } from '@/lib/curriculumApi';
import { CALENDAR_COUNTRIES } from '../shared/entities/deliveryCalendar';

export function CountryCalendarPanel({ onSynced }: { onSynced: () => void }) {
  const [calendars, setCalendars] = useState<CountryCalendarStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetchCountryCalendars();
      setCalendars(response.calendars);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read saved country calendars.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section aria-label="Saved country calendars" className="space-y-3 rounded-xl border border-background-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">Saved country calendars</h2>
      <button type="button" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={loading} onClick={async () => {
        setLoading(true); setError(''); setResult('');
        try {
          const response = await syncCountryCalendars();
          setResult(response.success ? 'Saved calendars updated. Manual closures and delivery choices were preserved.' : 'Some calendars could not be updated. Review the country messages and GOV.UK update log.');
          await load(); onSynced();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Sync failed; retry the update.');
        } finally { setLoading(false); }
      }}>{loading ? 'Syncing…' : 'Sync saved calendars'}</button>
    </div>
    <p className="text-xs text-foreground-600">England keeps its existing GOV.UK feed. Other countries are added when selected on a cohort. Only saved country/year calendars are refreshed.</p>
    {error && <div role="alert" className="text-xs text-red-700">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></div>}
    {result && <p role="status" className="text-xs">{result}</p>}
    {!calendars.length && !error && <p className="text-xs text-foreground-500">No other country calendars have been imported yet.</p>}
    <ul className="space-y-2">{calendars.map(row => <li key={`${row.country}:${row.year}`} className="rounded-lg border p-2 text-xs">
      <span className="font-semibold">{CALENDAR_COUNTRIES.find(item => item[0] === row.country)?.[1] || row.country} — {row.year}</span>
      <span className="ml-2">{row.count} public holidays. Last sync: {row.fetchedAt ? new Date(row.fetchedAt).toLocaleString('en-GB') : 'Never'}.</span>
      {row.expired ? <span className="ml-2 text-red-700">Expired — sync required.</span> : row.due && <span className="ml-2 text-amber-700">Refresh due.</span>}
      {row.message && <p className="mt-1 text-red-700">{row.message}</p>}
    </li>)}</ul>
    <p className="text-[11px] text-foreground-500">Other-country public holiday data: <a href="https://calendarific.com" target="_blank" rel="noreferrer">Powered by Calendarific</a>. Future dates can change; existing Teams meetings are not moved by a sync.</p>
  </section>;
}
