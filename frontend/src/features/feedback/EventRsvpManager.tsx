import { useEffect, useMemo, useState } from 'react';
import type { EngagementEvent } from '@/api/engagement';
import { feedbackApi, type FeedbackForm, type FeedbackLearnerOption } from '@/api/feedback';
import { eventFeedbackApi, type EventRsvpCampaign } from '@/api/eventFeedback';
import { AppIcon } from '@/components/feature/AppIcon';
import { EventEmailEditor } from './EventEmailEditor';

function parseGuests(value: string) {
  return value.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const comma = line.lastIndexOf(',');
    if (comma < 1) throw new Error(`Guest line ${index + 1} must be: Name, email@example.com`);
    return { name: line.slice(0, comma).trim(), email: line.slice(comma + 1).trim() };
  });
}

export function EventRsvpManager({ event, onClose }: { event: EngagementEvent; onClose: () => void }) {
  const [forms, setForms] = useState<FeedbackForm[]>([]);
  const [learners, setLearners] = useState<FeedbackLearnerOption[]>([]);
  const [campaign, setCampaign] = useState<EventRsvpCampaign | null>(null);
  const [formId, setFormId] = useState<number | null>(null);
  const [selectedLearners, setSelectedLearners] = useState<string[]>([]);
  const [guestText, setGuestText] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = () => eventFeedbackApi.rsvpCampaign(event.id).then(setCampaign);
  useEffect(() => {
    Promise.all([feedbackApi.listForms(), feedbackApi.learners(), eventFeedbackApi.rsvpCampaign(event.id)])
      .then(([formResult, learnerResult, campaignResult]) => {
        setForms(formResult.forms.filter(item => item.formType === 'event_rsvp' && item.status === 'published'));
        setLearners(learnerResult.learners);
        setCampaign(campaignResult);
        setFormId(campaignResult.form?.id ?? null);
        setSelectedLearners(campaignResult.recipients.flatMap(item => item.learnerId ? [item.learnerId] : []));
        setGuestText(campaignResult.recipients.filter(item => !item.learnerId).map(item => `${item.name}, ${item.email}`).join('\n'));
      }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load RSVP campaign.'));
  }, [event.id]);

  const visibleLearners = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? learners.filter(item => `${item.name} ${item.email} ${item.programme}`.toLowerCase().includes(term)) : learners;
  }, [learners, search]);
  const counts = useMemo(() => ({
    yes: campaign?.recipients.filter(item => item.rsvpStatus === 'yes').length ?? 0,
    no: campaign?.recipients.filter(item => item.rsvpStatus === 'no').length ?? 0,
    maybe: campaign?.recipients.filter(item => item.rsvpStatus === 'maybe').length ?? 0,
    waiting: campaign?.recipients.filter(item => item.rsvpStatus === 'no_response').length ?? 0,
  }), [campaign]);

  function toggleLearner(id: string) {
    setSelectedLearners(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  async function saveAudience() {
    if (!formId) { setError('Choose a published Event RSVP form.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const guests = parseGuests(guestText);
      const result = await eventFeedbackApi.configureRsvp(event.id, formId, selectedLearners, guests);
      setNotice(`${result.recipientCount} recipient(s) saved. Review the email, then send invitations.`);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save RSVP audience.'); }
    finally { setBusy(false); }
  }

  async function send(resendAll = false) {
    if (resendAll && !window.confirm('Resend to every active recipient? Their previous RSVP links will stop working.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await eventFeedbackApi.sendRsvp(event.id, resendAll);
      setNotice(`${result.sent} invitation(s) sent; ${result.failed} failed.${result.remaining ? ` ${result.remaining} remain.` : ''}`);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send RSVP invitations.'); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={click => click.stopPropagation()} aria-labelledby="event-rsvp-heading">
      <header className="flex items-start justify-between gap-3 border-b border-foreground-200 pb-4">
        <div><h2 id="event-rsvp-heading" className="text-lg font-bold text-foreground-900">Event invitations & RSVP</h2><p className="text-xs text-foreground-500">{event.title} · RSVP intent stays separate from actual attendance.</p></div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-foreground-500 hover:bg-background-100"><AppIcon className="ri-close-line" /></button>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-foreground-200 p-4">
          <h3 className="text-sm font-semibold text-foreground-800">1. Form and audience</h3>
          <label className="mt-3 block text-xs font-semibold text-foreground-700">Published RSVP form<select className="mt-1 w-full rounded-lg border border-foreground-200 px-3 py-2 text-xs" value={formId ?? ''} onChange={change => setFormId(change.target.value ? Number(change.target.value) : null)}><option value="">Choose a form</option>{forms.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          {!forms.length && <p className="mt-2 text-xs text-amber-700">Create and publish an Event RSVP form in Feedback first.</p>}
          <label className="mt-4 block text-xs font-semibold text-foreground-700">Search learners<input className="mt-1 w-full rounded-lg border border-foreground-200 px-3 py-2 text-xs" value={search} onChange={change => setSearch(change.target.value)} placeholder="Name, email, or programme" /></label>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-foreground-200">
            {visibleLearners.map(item => <label key={item.id} className="flex items-center gap-2 border-b border-foreground-100 px-3 py-2 text-xs last:border-0"><input type="checkbox" checked={selectedLearners.includes(item.id)} onChange={() => toggleLearner(item.id)} /><span className="min-w-0"><strong className="block truncate">{item.name}</strong><span className="block truncate text-foreground-500">{item.email}</span></span></label>)}
          </div>
          <label className="mt-4 block text-xs font-semibold text-foreground-700">External guests <span className="font-normal text-foreground-500">— one per line: Name, Email</span><textarea className="mt-1 min-h-28 w-full rounded-lg border border-foreground-200 px-3 py-2 text-xs" value={guestText} onChange={change => setGuestText(change.target.value)} placeholder={'Alex Morgan, alex@example.com\nSam Lee, sam@example.com'} /></label>
          <button type="button" disabled={busy} onClick={() => void saveAudience()} className="mt-3 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Save form & audience</button>
        </section>

        <section className="rounded-xl border border-foreground-200 p-4">
          <h3 className="text-sm font-semibold text-foreground-800">Responses</h3>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs"><Stat label="Yes" value={counts.yes} tone="text-emerald-700" /><Stat label="Maybe" value={counts.maybe} tone="text-amber-700" /><Stat label="No" value={counts.no} tone="text-red-700" /><Stat label="Waiting" value={counts.waiting} tone="text-foreground-600" /></div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-foreground-200">
            {campaign?.recipients.map(item => <div key={item.id} className="flex items-center gap-3 border-b border-foreground-100 px-3 py-2 text-xs last:border-0"><span className="min-w-0 flex-1"><strong className="block truncate">{item.name}</strong><span className="block truncate text-foreground-500">{item.email}</span></span><span className="rounded-full bg-background-100 px-2 py-1 text-[10px] font-semibold">{item.rsvpStatus.replace('_', ' ')}</span><span className={`text-[10px] ${item.inviteStatus === 'failed' ? 'text-red-600' : 'text-foreground-400'}`}>{item.inviteStatus}</span></div>)}
            {!campaign?.recipients.length && <p className="p-4 text-center text-xs text-foreground-400">No RSVP audience saved yet.</p>}
          </div>
        </section>
      </div>

      <div className="mt-5"><EventEmailEditor eventId={event.id} purpose="event_rsvp" /></div>
      <section className="mt-5 border-t border-foreground-200 pt-4"><h3 className="text-sm font-semibold text-foreground-800">3. Send invitations</h3><p className="mt-1 text-xs text-foreground-500">Each person receives a private 30-day link. Resending invalidates their previous link but keeps their recorded answer.</p><div className="mt-3 flex gap-2"><button type="button" disabled={busy || !campaign?.recipients.length} onClick={() => void send()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Send pending / retry failed</button><button type="button" disabled={busy || !campaign?.recipients.length} onClick={() => void send(true)} className="rounded-lg border border-foreground-300 px-4 py-2 text-xs font-semibold text-foreground-700 disabled:opacity-40">Resend all</button></div></section>
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
    </section>
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="rounded-lg bg-background-100 p-2"><strong className={`block text-base ${tone}`}>{value}</strong><span className="text-[10px] text-foreground-500">{label}</span></div>;
}
