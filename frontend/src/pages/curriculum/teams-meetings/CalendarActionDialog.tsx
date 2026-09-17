import { useState } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { naiveLocalFromUtc } from './createCalendarForm';
import { getCalendarTimeZone, zonedNaiveToUtcIso } from '../module-builder/moduleAuthoringData';
import { calendarAction, type ActionReview, type ActionResult } from './calendarActions';

export interface CalendarActionTarget {
  liveId: string; moduleId: string; title: string; action: 'cancel' | 'reschedule'; scope: 'series' | 'occurrence';
  timeZone?: string;
  occurrences: Array<{ session_number: number; scheduled_start: string; scheduled_end: string; status?: string }>;
}

export function CalendarActionDialog({ target, onClose, onChanged }: {
  target: CalendarActionTarget; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const timeZone = target.timeZone === 'GMT Standard Time' ? 'Europe/London' : target.timeZone || getCalendarTimeZone();
  const calendarLabel = (value: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: review?.timeZone || timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(value)).replace(/\b(am|pm)\b/g, match => match.toUpperCase());
  const [drafts, setDrafts] = useState(() => target.occurrences.filter(row => target.action === 'cancel'
    || (row.status === 'scheduled' && Date.parse(row.scheduled_start) > Date.now())).map(row => ({
      sessionNumber: row.session_number, localStart: naiveLocalFromUtc(row.scheduled_start, timeZone),
      durationMinutes: Math.round((Date.parse(row.scheduled_end) - Date.parse(row.scheduled_start)) / 60000),
    })));
  const [review, setReview] = useState<ActionReview | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [comment, setComment] = useState('');
  const [includeComment, setIncludeComment] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const cancelling = target.action === 'cancel';

  const prepare = async () => {
    setBusy(true); setError(''); setChecked(false);
    try {
      const value = await calendarAction<ActionReview>(target.liveId, {
        stage: 'review', action: target.action, scope: target.scope,
        sessionNumber: target.scope === 'occurrence' ? target.occurrences[0].session_number : undefined,
        comment: includeComment ? comment : '',
        changes: cancelling ? undefined : drafts.map(draft => ({ sessionNumber: draft.sessionNumber,
          startDateTimeUtc: zonedNaiveToUtcIso(draft.localStart, timeZone), durationMinutes: draft.durationMinutes })),
      });
      setReview(value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Review could not be loaded.'); }
    finally { setBusy(false); }
  };
  const execute = async (statusOnly = false) => {
    if (!statusOnly && (!checked || !review || attempted)) return;
    setBusy(true); setError('');
    if (!statusOnly) setAttempted(true);
    try {
      const value = await calendarAction<ActionResult>(target.liveId, statusOnly ? { stage: 'status' }
        : { stage: 'confirm', reviewToken: review!.reviewToken, acknowledgeNotifications: true });
      setResult(value);
      await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The calendar action could not be confirmed.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`${cancelling ? 'Cancel' : 'Edit'} ${target.scope === 'series' ? 'calendar series' : 'session'}`} onClose={onClose}
      dismissible={!busy} size="max-w-4xl" scrollResetKey={review ? 'review' : 'edit'} footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-semibold">{result?.status === 'done' ? 'Done' : 'Close'}</button>
          {attempted ? result?.status !== 'done' && <button type="button" disabled={busy} onClick={() => void execute(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white">Check action status</button>
            : review ? <>
              <button type="button" disabled={busy} onClick={() => { setReview(null); setChecked(false); }} className="rounded-lg border px-4 py-2 text-sm font-semibold">Back to editing</button>
              <button type="button" disabled={busy || !checked} onClick={() => void execute()} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40 ${cancelling ? 'bg-red-700' : 'bg-primary-600'}`}>{busy ? 'Applying...' : cancelling ? 'Confirm cancellation' : 'Save and send update'}</button>
            </> : <button type="button" disabled={busy || !drafts.length} onClick={() => void prepare()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Checking Microsoft...' : 'Review changes'}</button>}
        </div>
      }>
      <div className="space-y-4">
        <p className="font-bold text-foreground-900">{target.title}</p>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {cancelling ? 'Microsoft sends a cancellation notice to the affected invitees. Silent cancellation is not available.'
            : 'The new times will update Teams, the module timetable and learner training plans. Microsoft sends calendar updates to invitees.'}
        </p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {result && <p role="status" className={`rounded-lg p-3 text-sm ${result.status === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
          {result.message}{result.total ? ` (${result.completed}/${result.total} calendar changes confirmed)` : ''}
        </p>}
        {!review && !attempted && (cancelling ? <>
          <p>{target.scope === 'series' ? 'The entire calendar series will be cancelled.' : `Only session ${target.occurrences[0].session_number} will be cancelled.`}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeComment} onChange={event => setIncludeComment(event.target.checked)} />Add a message to Microsoft's cancellation notice</label>
          {includeComment && <textarea aria-label="Cancellation message" value={comment} maxLength={1000} onChange={event => setComment(event.target.value)} className="min-h-24 w-full rounded-lg border p-3 text-sm" />}
        </> : <div className="max-h-[50vh] space-y-3 overflow-auto">
          <p className="text-sm text-foreground-600">Edit the sessions you want to move. Unchanged sessions keep their current times.</p>
          <p className="text-sm text-foreground-600">Time zone: {timeZone}. 12 AM is midnight; 12 PM is noon.</p>
          {drafts.map((draft, index) => <div key={draft.sessionNumber} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[80px_1fr_130px]">
            <strong className="text-sm">Session {draft.sessionNumber}</strong>
            <input aria-label={`Session ${draft.sessionNumber} date and time`} type="datetime-local" value={draft.localStart} onChange={event => setDrafts(current => current.map((item, i) => i === index ? { ...item, localStart: event.target.value } : item))} className="rounded border px-2 py-1 text-sm" />
            <label className="text-xs">Minutes<input aria-label={`Session ${draft.sessionNumber} duration`} type="number" min={15} max={1440} value={draft.durationMinutes} onChange={event => setDrafts(current => current.map((item, i) => i === index ? { ...item, durationMinutes: Number(event.target.value) } : item))} className="w-full rounded border px-2 py-1 text-sm" /></label>
          </div>)}
        </div>)}
        {review && <>
          <p className="text-sm">Organizer: {review.organizer} · Time zone: {review.timeZone}</p>
          {review.warnings?.map((warning, index) => <p key={index} className="text-sm text-amber-800">{warning}</p>)}
          <div className="max-h-[45vh] overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm"><thead className="bg-background-100"><tr><th className="p-3">Session</th><th className="p-3">Current time</th>{!cancelling && <th className="p-3">New time</th>}<th className="p-3">Meeting</th></tr></thead>
              <tbody>{review.sessions.map(session => <tr key={session.sessionNumber} className="border-t"><td className="p-3">{session.sessionNumber}</td>
                <td className="p-3">{calendarLabel(session.startDateTimeUtc)}<br />to {calendarLabel(session.endDateTimeUtc)}
                  {session.calendarVerified === false && <span className="block text-xs text-amber-800">Stored LMS time; this occurrence could not be verified.</span>}</td>
                {!cancelling && <td className="p-3 font-semibold">{session.newStartDateTimeUtc ? <>{calendarLabel(session.newStartDateTimeUtc)}<br />to {calendarLabel(session.newEndDateTimeUtc!)}</> : 'Unchanged'}</td>}
                <td className="p-3">{session.joinUrl?.startsWith('https://') ? <a href={session.joinUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 underline">Current link</a> : 'Unavailable'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-foreground-500">{review.calendarRequests} calendar request{review.calendarRequests === 1 ? '' : 's'}. 12 AM is midnight; 12 PM is noon. Existing meeting links are preserved when moving sessions.</p>
          {!attempted && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />I checked these sessions and understand that Microsoft will notify the affected invitees.</label>}
        </>}
      </div>
    </Modal>
  );
}
