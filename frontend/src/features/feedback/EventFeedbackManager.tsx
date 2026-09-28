import { useEffect, useMemo, useState } from 'react';
import { eventFeedbackApi, type EventAttendancePreview, type EventFeedbackCampaign } from '@/api/eventFeedback';
import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import type { EngagementEvent } from '@/api/engagement';
import { AppIcon } from '@/components/feature/AppIcon';

export function EventFeedbackManager({ event, onClose }: { event: EngagementEvent; onClose: () => void }) {
  const [forms, setForms] = useState<FeedbackForm[]>([]);
  const [campaign, setCampaign] = useState<EventFeedbackCampaign | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EventAttendancePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reloadCampaign = () => eventFeedbackApi.campaign(event.id).then(setCampaign);
  useEffect(() => {
    Promise.all([feedbackApi.listForms(), eventFeedbackApi.campaign(event.id)])
      .then(([formResult, campaignResult]) => {
        setForms(formResult.forms.filter(form => form.formType === 'post_event' && form.status === 'published'));
        setCampaign(campaignResult);
        setSelected(campaignResult.forms.map(form => form.id));
      }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load event feedback.'));
  }, [event.id]);

  const failed = useMemo(() => campaign?.recipients.filter(item => item.inviteStatus === 'failed').length ?? 0, [campaign]);
  const pending = useMemo(() => campaign?.recipients.filter(item => item.inviteStatus === 'pending').length ?? 0, [campaign]);

  async function previewFile(next: File | null) {
    setFile(next); setPreview(null); setError(''); setNotice('');
    if (!next) return;
    setBusy(true);
    try { setPreview((await eventFeedbackApi.previewAttendance(event.id, next)).preview); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read attendance file.'); }
    finally { setBusy(false); }
  }

  async function importRoster() {
    if (!file || !preview || preview.errors.length || !selected.length) return;
    setBusy(true); setError('');
    try {
      const result = await eventFeedbackApi.importAttendance(event.id, file, selected);
      setNotice(`${result.recipientCount} present attendee(s) imported and linked to ${result.formCount} form(s).`);
      await reloadCampaign();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import attendance.'); }
    finally { setBusy(false); }
  }

  async function sendInvites() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await eventFeedbackApi.sendInvitations(event.id);
      setNotice(`${result.sent} invitation(s) sent; ${result.failed} failed.${result.remaining ? ` ${result.remaining} remain for another batch.` : ''}`);
      await reloadCampaign();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send invitations.'); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={event => event.stopPropagation()} aria-labelledby="event-feedback-heading">
      <header className="flex items-start justify-between gap-3 border-b border-foreground-200 pb-4">
        <div><h2 id="event-feedback-heading" className="text-lg font-bold text-foreground-900">Post-event feedback</h2><p className="text-xs text-foreground-500">{event.title} · import present attendees, then send their personal links.</p></div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-foreground-500 hover:bg-background-100"><AppIcon className="ri-close-line" /></button>
      </header>

      <div className="mt-5 space-y-5">
        <section><h3 className="text-sm font-semibold text-foreground-800">1. Choose published forms</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{forms.map(form => <label key={form.id} className="flex items-center gap-2 rounded-lg border border-foreground-200 p-3 text-xs"><input type="checkbox" checked={selected.includes(form.id)} onChange={e => setSelected(current => e.target.checked ? [...current, form.id] : current.filter(id => id !== form.id))} />{form.title}</label>)}{!forms.length && <p className="text-xs text-amber-700">Publish a Post-event feedback form first.</p>}</div>
        </section>

        <section><h3 className="text-sm font-semibold text-foreground-800">2. Preview attendance file</h3><p className="mt-1 text-xs text-foreground-500">Excel/CSV columns: Name, Email, Attendance Status. Only Present rows are imported.</p>
          <input className="mt-3 block w-full text-xs" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={e => void previewFile(e.target.files?.[0] ?? null)} />
          {preview && <div className="mt-3 rounded-lg bg-background-100 p-3 text-xs"><p><strong>{preview.presentCount}</strong> present · {preview.ignoredCount} non-present ignored · {preview.errors.length} errors</p>{preview.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-red-700">{preview.errors.slice(0, 10).map(item => <li key={`${item.row}-${item.error}`}>Row {item.row}: {item.error}</li>)}</ul>}</div>}
          <button type="button" disabled={busy || !file || !preview || preview.errors.length > 0 || selected.length === 0} onClick={() => void importRoster()} className="mt-3 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Import present attendees</button>
        </section>

        <section className="border-t border-foreground-200 pt-4"><h3 className="text-sm font-semibold text-foreground-800">3. Send personal links</h3>
          <p className="mt-1 text-xs text-foreground-500">{campaign?.recipients.length ?? 0} recipients · {pending} pending · {failed} failed. Each email gets a different 30-day token; only its hash is stored.</p>
          <button type="button" disabled={busy || pending + failed === 0 || !campaign?.forms.length} onClick={() => void sendInvites()} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Send pending / retry failed</button>
        </section>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      </div>
    </section>
  </div>;
}
