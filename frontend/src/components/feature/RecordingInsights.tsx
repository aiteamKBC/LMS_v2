import { useEffect, useState } from 'react';
import { BarChart3, CheckCircle2, Users } from 'lucide-react';
import { loadRecordingInsights, type RecordingInsights as Insights } from '@/api/recordingInsights';
import type { SessionFile, SessionLearner } from '@/api/sessionResults';

const number = (value: number) => value.toLocaleString('en-GB');
const viewingTime = (seconds: number) => seconds >= 3600
  ? `${number(Math.floor(seconds / 3600))} hr${Math.floor(seconds / 60) % 60 ? ` ${Math.floor(seconds / 60) % 60} min` : ''}`
  : `${number(Math.round(seconds / 60))} min`;

export function RecordingInsights({ seriesId, file, learner }: { seriesId: string; file: SessionFile; learner?: SessionLearner }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ key: string; data: Insights } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([seriesId, file.id, learner?.kind, learner?.id]);
  const kind = learner?.kind, learnerId = learner?.id, fileId = file.id;
  useEffect(() => {
    if (!open && !kind) return;
    const controller = new AbortController();
    setResult(null); setError('');
    void loadRecordingInsights(seriesId, { id: fileId, type: 'recording', state: 'ready' },
      kind && learnerId ? { kind, id: learnerId } : undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Viewing insights could not be loaded.'); });
    return () => controller.abort();
  }, [open, seriesId, fileId, kind, learnerId, key, retry]);
  const data = result?.key === key ? result.data : null;
  if (learner) {
    if (data?.audience !== 'learner') return null;
    const watched = (data.highlights.watched ?? 0) >= 10 ? data.highlights.watched : null;
    const finished = (data.highlights.finished ?? 0) >= 5 ? data.highlights.finished : null;
    if (watched === null && finished === null) return null;
    return <div aria-label="Learning community" className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-primary-100 bg-primary-50/50 px-4 py-3 text-base leading-relaxed text-foreground-800">
      {watched !== null && <span className="inline-flex items-center gap-2"><Users size={18} className="shrink-0 text-primary-700" aria-hidden="true" /><span><strong className="tabular-nums">{number(watched)}</strong> learners watched</span></span>}
      {finished !== null && <span className="inline-flex items-center gap-2"><CheckCircle2 size={18} className="shrink-0 text-primary-700" aria-hidden="true" /><span><strong className="tabular-nums">{number(finished)}</strong> finished watching</span></span>}
    </div>;
  }
  return <details className="rounded-xl border border-background-200 bg-white" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">
      <span className="ml-1 inline-flex items-center gap-2"><BarChart3 size={18} aria-hidden="true" />Viewing insights</span>
    </summary>
    {open && <div className="space-y-4 border-t border-background-200 p-4 text-sm leading-relaxed text-foreground-800">
      {error ? <p role="status">{error}{' '}<button type="button" className="min-h-11 px-2 font-semibold text-primary-700 underline" onClick={() => setRetry(value => value + 1)}>Retry insights</button></p>
        : !data ? <p role="status">Loading viewing insights…</p>
          : data.audience === 'staff' && <>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[['Learners watched', number(data.learners)], ['Finished watching', number(data.finished)],
                ['Recorded viewing time', viewingTime(data.watchedSeconds)],
                ['Watching completion', data.completionPercent === null ? 'No viewing recorded' : `${data.completionPercent}%`]].map(([label, value]) =>
                <div key={label} className="rounded-lg bg-background-50 p-3"><dt className="text-sm text-foreground-600">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}
            </dl>
            <p className="text-sm text-foreground-600">Saved LMS viewing for this recording. Watching completion is separate from attendance.</p>
            {data.provider.state === 'available' ? <div className="space-y-2 border-t border-background-200 pt-3">
              <p><strong>{number(data.provider.views ?? 0)}</strong> Bunny playback starts · last 30 days</p>
              <p className="text-foreground-600">Includes repeat sessions and staff playback; this is not a count of individual learners.</p>
              {data.provider.engagementScore !== null && data.provider.engagementScore !== undefined && <p>Video engagement: {data.provider.engagementScore}/100</p>}
              {!!data.provider.dailyViews?.length && <details><summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary-700">Daily playback starts (UTC)</summary>
                <div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Bunny playback starts by UTC day</caption><thead><tr><th className="p-2">Date</th><th className="p-2">Starts</th></tr></thead>
                  <tbody>{data.provider.dailyViews.map(row => <tr key={row.date} className="border-t border-background-100"><td className="p-2">{row.date.slice(0, 10)}</td><td className="p-2 tabular-nums">{number(row.views)}</td></tr>)}</tbody></table></div>
              </details>}
            </div> : data.provider.state === 'unavailable' && <p className="text-foreground-600">Bunny statistics are temporarily unavailable. Saved LMS viewing is shown above.</p>}
            <p className="text-xs text-foreground-600">Updated {new Date(data.updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (UK time)</p>
          </>}
    </div>}
  </details>;
}
