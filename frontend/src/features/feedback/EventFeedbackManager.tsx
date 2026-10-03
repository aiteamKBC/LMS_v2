import { useEffect, useMemo, useState } from 'react';
import { eventFeedbackApi, type EventFeedbackCampaign } from '@/api/eventFeedback';
import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import type { EngagementEvent } from '@/api/engagement';
import { AppIcon } from '@/components/feature/AppIcon';
import { EventEmailEditor } from './EventEmailEditor';

export function EventFeedbackManager({ event, onClose }: { event: EngagementEvent; onClose: () => void }) {
  const [forms, setForms] = useState<FeedbackForm[]>([]);
  const [campaign, setCampaign] = useState<EventFeedbackCampaign | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
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

  async function prepare() {
    if (!selected.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await eventFeedbackApi.prepareQrAttendance(event.id, selected);
      setNotice(`${result.recipientCount} QR attendee(s) linked to ${result.formCount} form(s). Learner forms are available in LMS now; publish below to email guest links.`);
      await reloadCampaign();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare feedback.'); }
    finally { setBusy(false); }
  }

  async function publish(resendAll = false) {
    if (resendAll && !window.confirm('Republish to every attendee? Existing guest links will stop working.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await eventFeedbackApi.sendInvitations(event.id, resendAll);
      setNotice(`${result.sent} recipient(s) published; ${result.failed} failed.${result.remaining ? ` ${result.remaining} remain for another batch.` : ''}`);
      await reloadCampaign();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not publish feedback.'); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={click => click.stopPropagation()} aria-labelledby="event-feedback-heading">
      <header className="flex items-start justify-between gap-3 border-b border-foreground-200 pb-4">
        <div><h2 id="event-feedback-heading" className="text-lg font-bold text-foreground-900">Post-event feedback</h2><p className="text-xs text-foreground-500">{event.title} · use QR attendance, then publish feedback.</p></div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-foreground-500 hover:bg-background-100"><AppIcon className="ri-close-line" /></button>
      </header>

      <div className="mt-5 space-y-5">
        <section><h3 className="text-sm font-semibold text-foreground-800">1. Choose published forms</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{forms.map(form => <label key={form.id} className="flex items-center gap-2 rounded-lg border border-foreground-200 p-3 text-xs"><input type="checkbox" checked={selected.includes(form.id)} onChange={change => setSelected(current => change.target.checked ? [...current, form.id] : current.filter(id => id !== form.id))} />{form.title}</label>)}{!forms.length && <p className="text-xs text-amber-700">Publish a Post-event feedback form first.</p>}</div>
        </section>

        <section><h3 className="text-sm font-semibold text-foreground-800">2. QR attendance</h3><p className="mt-1 text-xs text-foreground-500">{campaign?.qrAttendance.length ?? 0} attendee(s) checked in through this event QR.</p>
          <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-foreground-200">
            {campaign?.qrAttendance.map(item => <div key={item.email} className="flex items-center gap-3 border-b border-foreground-100 px-3 py-2 text-xs last:border-0"><span className="min-w-0 flex-1"><strong className="block truncate">{item.name}</strong><span className="block truncate text-foreground-500">{item.email}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.attendeeType === 'learner' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>{item.attendeeType}</span></div>)}
            {!campaign?.qrAttendance.length && <p className="p-4 text-center text-xs text-foreground-400">No QR attendance recorded yet.</p>}
          </div>
          <button type="button" disabled={busy || !campaign?.qrAttendance.length || !selected.length} onClick={() => void prepare()} className="mt-3 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Prepare feedback for attendees</button>
        </section>

        <EventEmailEditor eventId={event.id} purpose="post_event" />

        <section className="border-t border-foreground-200 pt-4"><h3 className="text-sm font-semibold text-foreground-800">4. Publish feedback</h3>
          <p className="mt-1 text-xs text-foreground-500">{campaign?.recipients.length ?? 0} recipients · {pending} pending · {failed} failed. Learner forms are already available in LMS; publishing emails each guest a private 30-day link.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || pending + failed === 0 || !campaign?.forms.length} onClick={() => void publish()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Publish / retry failed</button>
            <button type="button" disabled={busy || !campaign?.recipients.length || !campaign.forms.length} onClick={() => void publish(true)} className="rounded-lg border border-foreground-300 px-4 py-2 text-xs font-semibold text-foreground-700 disabled:opacity-40">Republish all</button>
          </div>
        </section>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
      </div>
    </section>
  </div>;
}
