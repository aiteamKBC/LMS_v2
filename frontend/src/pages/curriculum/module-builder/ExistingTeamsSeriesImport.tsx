import { useEffect, useRef, useState } from 'react';
import {
  previewExistingTeamsSeries, linkExistingTeamsSeries,
  type ExistingTeamsSeriesReview, type ModuleCatalogueItem,
} from './moduleAuthoringData';

export function ExistingTeamsSeriesImport({ moduleId, link, weekIds, unsaved, onBusy, onLinked }: {
  moduleId: string; link: string; weekIds: string[]; unsaved: boolean;
  onBusy: (busy: boolean) => void;
  onLinked: (module: ModuleCatalogueItem) => void;
}) {
  const [mailbox, setMailbox] = useState('');
  const [review, setReview] = useState<ExistingTeamsSeriesReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (apply: boolean) => {
    if (inFlight.current) return;
    if (unsaved) { setError('Save the module first, then reopen this review. Your current edits have been kept.'); return; }
    if (!link.trim() || !weekIds.length) { setError('Paste the original Teams link and choose its live weeks.'); return; }
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    try {
      if (apply && review) {
        const result = await linkExistingTeamsSeries(moduleId, review.previewToken);
        if (mounted.current) onLinked(result.module);
      } else {
        const result = await previewExistingTeamsSeries(moduleId, { link: link.trim(), weekIds, calendarMailbox: mailbox.trim() });
        if (mounted.current) setReview(result);
      }
    } catch (failure) {
      if (mounted.current) {
        setReview(null);
        setError(failure instanceof Error ? failure.message : 'The series could not be verified. Reopen the module before retrying.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setBusy(false); onBusy(false); }
    }
  };
  return <section aria-label="Link existing Teams series" className="w-full space-y-2 text-xs">
    <details>
      <summary className="cursor-pointer text-foreground-600">Calendar mailbox (if the automatic check cannot find the series)</summary>
      <label className="mt-2 block">
        Original organiser or invited calendar mailbox
        <input aria-label="Calendar mailbox" type="text" value={mailbox} disabled={busy}
          onChange={event => { setMailbox(event.target.value); setReview(null); setError(''); }}
          className="mt-1 w-full rounded-lg border border-background-300 bg-background-50 px-3 py-2" />
      </label>
    </details>
    {unsaved && <p role="status" className="text-amber-800">Save the module before linking its calendar. Viewing this dialog does not save or change it.</p>}
    {review && <div className="space-y-1">
      <p className="font-semibold">{review.matched} matched · {review.unmatched} need review · {review.timeZone}</p>
      <div className="max-h-32 overflow-y-auto rounded-lg border border-background-200">
        {review.sessions.map(session => <div key={session.componentId} className="border-b border-background-100 px-2 py-1.5 last:border-0">
          <span>{session.title} · {session.date}</span>
          <span className={session.status === 'matched' ? 'ml-2 text-emerald-700' : 'ml-2 text-amber-800'}>
            {session.status === 'matched' ? 'Original session found' : session.status === 'ambiguous' ? 'More than one session matches' : 'No original session on this date'}
          </span>
          {session.holidays.length > 0 && <span className="ml-2 text-amber-800">Holiday in saved plan</span>}
        </div>)}
      </div>
      {review.unmatched > 0 && <p className="text-amber-800">Unmatched weeks keep their planned date and link but stay unconfirmed. No recording or attendance is assigned to them.</p>}
    </div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => void run(false)} disabled={busy}
        className="rounded-lg border border-primary-200 px-3 py-2 font-bold text-primary-700 disabled:opacity-50">
        {busy ? 'Checking…' : review ? 'Check series again' : 'Check existing series'}
      </button>
      {review && <button type="button" onClick={() => void run(true)} disabled={busy || !review.matched}
        className="rounded-lg bg-primary-500 px-3 py-2 font-bold text-white disabled:opacity-50">
        Link {review.matched} matched session{review.matched === 1 ? '' : 's'}
      </button>}
    </div>
  </section>;
}
