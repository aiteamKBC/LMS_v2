import { useEffect, useState } from 'react';
import { meetingQualityChecks, invalidateQualityReviews, type MeetingQualityCheck } from '@/api/coachingQualityReviews';
import QualityPdfActions from './QualityPdfActions';

export default function MeetingQualityChecks({ meetingId, refresh, onOpen, onPreviewChange }: { meetingId?: string; refresh: number; onOpen: (id: string) => void; onPreviewChange: (open: boolean) => void }) {
  const [rows, setRows] = useState<MeetingQualityCheck[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const key = `${meetingId}:${refresh}:${retry}`;
  const [page, setPage] = useState({ key, offset: 0 }), [next, setNext] = useState<number | null>(null);
  const offset = page.key === key ? page.offset : 0;
  useEffect(() => {
    if (!meetingId) return;
    const controller = new AbortController(); setBusy(true); setError(''); if (!offset) { setRows([]); setNext(null); }
    void meetingQualityChecks(meetingId, controller.signal, offset).then(value => { if (!controller.signal.aborted) { setRows(current => offset ? [...new Map([...current, ...value.reviews].map(row => [row.id, row])).values()] : value.reviews); setNext(value.nextOffset ?? null); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Quality checks could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [meetingId, key, offset]);
  return <section aria-label="Meeting quality checks" className="mt-5 space-y-3 border-t border-background-200 pt-5">
    <h3 className="text-sm font-bold">Quality checks &amp; saved PDFs</h3>
    {busy && <p role="status" className="text-xs text-foreground-500">Loading saved checks…</p>}
    {error && <div role="alert" className="text-xs text-amber-800">{error}<button className="ml-2 underline" onClick={() => { invalidateQualityReviews(); setRetry(value => value + 1); }}>Retry checks</button></div>}
    {!busy && !error && rows.length === 0 && <p className="text-xs text-foreground-500">No quality check has been saved for this meeting yet.</p>}
    {rows.map(row => <article key={row.id} className="space-y-3 rounded-xl border border-background-200 bg-background-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="break-words text-sm font-semibold">{row.learnerName}</p><span className="text-xs text-foreground-500">{row.reviewType && `${row.reviewType} · `}{row.status === 'completed' ? 'Completed' : 'Draft'} · v{row.version}</span></div><button className="text-xs font-semibold text-primary-700 underline" onClick={() => onOpen(row.id)}>Open saved form</button>
      {(row.pdfVersion || row.status === 'completed') && <QualityPdfActions key={`${row.id}:${row.status === 'completed' ? row.version : row.pdfVersion}`} reviewId={row.id} version={row.status === 'completed' ? row.version : row.pdfVersion!} onPreviewChange={onPreviewChange} />}
    </article>)}
    {next !== null && <button className="text-xs font-semibold text-primary-700 underline" disabled={busy} onClick={() => setPage({ key, offset: next })}>Load more checks</button>}
  </section>;
}
