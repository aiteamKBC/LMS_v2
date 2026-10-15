import type { CalendarMatches } from '../calendarMatches';
import { formatFullDate, formatTimeRange } from '../utils';
import ExternalRecordings from './ExternalRecordings';

export default function CalendarMatchesPanel({ data, error, onChoose, onRetry }: {
  data: CalendarMatches | null; error: string; onChoose: (value: string) => void; onRetry: () => void;
}) {
  return <section aria-label="Teams calendar matching" className="mt-3 rounded-lg border border-background-200 bg-background-50 p-3 text-sm">
    {error ? <div role="alert"><p>{error} Linked LMS sessions remain available below.</p><div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={onRetry} className="font-semibold text-primary-700 underline">Retry calendar comparison</button><button type="button" onClick={() => onChoose('')} className="font-semibold text-primary-700 underline">Choose another calendar</button></div></div>
      : !data ? <p role="status">Showing linked LMS sessions from all organizers. Checking the selected calendar for unlinked events…</p> : <>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs">Teams calendar account
            <select aria-label="Teams calendar account" value={data.mailbox} onChange={event => onChoose(event.target.value)} className="max-w-full rounded-md border border-background-200 bg-background-50 p-2">
              <option value="">Choose a calendar</option>{data.accounts.map(account => <option key={account}>{account}</option>)}
            </select>
          </label>
          {data.status === 'verified' && <button type="button" onClick={onRetry} className="text-xs font-semibold text-primary-700 underline">Refresh calendar comparison</button>}
        </div>
        <p className="mt-2 text-xs text-foreground-600">{data.status === 'choose' ? 'Linked LMS sessions from all organizers are shown in their scheduled dates. Choose a calendar to check for additional events not linked to LMS.' : 'Linked LMS sessions from all organizers are shown, including meetings absent from this selected calendar. Unbooked LMS plans are excluded. The comparison below lists events in this calendar that are not matched to LMS.'}</p>
        {data.status === 'verified' && <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-primary-700">Calendar events not matched to LMS ({data.unmatched.length})</summary>
          <ul className="mt-2 space-y-2">{data.unmatched.map((item, index) => <li key={`${item.date}:${index}`} className="rounded-md border border-background-200 p-2">
            <p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-foreground-600">{formatFullDate(item.date)} · {formatTimeRange(item.startTime, item.endTime)}{item.cancelled ? ' · Cancelled' : ''}</p>
            <p className="mt-1 text-xs">{item.reason}</p>
            {item.recordingsReference && <ExternalRecordings key={item.recordingsReference} reference={item.recordingsReference} />}
          </li>)}</ul>
        </details>}
      </>}
  </section>;
}
