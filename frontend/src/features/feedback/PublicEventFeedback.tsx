import { useEffect, useMemo, useState } from 'react';
import { eventFeedbackApi, type PublicEventFeedback as PublicEventFeedbackData } from '@/api/eventFeedback';
import type { FeedbackAnswerValue } from '@/api/feedback';
import { FeedbackFormHeader, FormRenderer } from './FormRenderer';

export function PublicEventFeedback({ token }: { token: string }) {
  const [data, setData] = useState<PublicEventFeedbackData | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, Record<string, FeedbackAnswerValue>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // The token has been captured in component state; remove it from the
    // address bar/history before any link or asset navigation can leak it.
    window.history.replaceState(window.history.state, '', '/login');
    let cancelled = false;
    eventFeedbackApi.publicAccess(token).then(result => {
      if (cancelled) return;
      setData(result);
      setActiveId(result.forms[0]?.id ?? null);
      setAnswers(Object.fromEntries(result.forms.map(form => [form.id, form.response.answers])));
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to open feedback.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const active = useMemo(() => data?.forms.find(form => form.id === activeId) ?? null, [data, activeId]);

  async function submit() {
    if (!active) return;
    setSaving(true); setError('');
    try {
      const result = await eventFeedbackApi.savePublicResponse(token, active.id, answers[active.id] || {}, true);
      setData(current => current ? {
        ...current,
        forms: current.forms.map(form => form.id === active.id ? { ...form, response: { ...form.response, status: 'completed', submittedAt: result.response.submittedAt } } : form),
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not submit feedback.');
    } finally { setSaving(false); }
  }

  if (loading) return <PublicShell><p className="text-center text-sm text-foreground-500">Opening your event feedback…</p></PublicShell>;
  if (error && !data) return <PublicShell><div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div></PublicShell>;
  if (!data || !active) return <PublicShell><p className="text-center text-sm text-foreground-500">There are no open feedback forms for this event.</p></PublicShell>;

  const completed = active.response.status === 'completed' && !active.allowEditAfterSubmission;
  return <PublicShell>
    <div className="mb-5 rounded-xl bg-primary-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Post-event feedback</p>
      <h1 className="mt-1 text-xl font-bold text-foreground-900">{data.event.title}</h1>
      <p className="mt-1 text-xs text-foreground-500">{data.event.date} · {data.event.location}</p>
      <p className="mt-3 text-sm text-foreground-700">Welcome, {data.recipient.name}. This personal link gives access only to your event forms.</p>
    </div>
    {data.forms.length > 1 && <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Event feedback forms">
      {data.forms.map(form => <button key={form.id} type="button" role="tab" aria-selected={form.id === active.id} onClick={() => { setActiveId(form.id); setError(''); }} className={`rounded-lg px-3 py-2 text-xs font-semibold ${form.id === active.id ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-700'}`}>{form.title}{form.response.status === 'completed' ? ' ✓' : ''}</button>)}
    </div>}
    <FeedbackFormHeader title={active.title} description={active.description} instructions={active.instructions} />
    {completed ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm font-semibold text-emerald-800">Thank you. Your feedback has been submitted.</div> : <>
      <FormRenderer sections={active.sections} answers={answers[active.id] || {}} onChange={(questionId, value) => setAnswers(current => ({ ...current, [active.id]: { ...(current[active.id] || {}), [String(questionId)]: value } }))} />
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Submitting…' : 'Submit feedback'}</button></div>
    </>}
  </PublicShell>;
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background-100 px-4 py-8"><section className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/60 bg-white p-5 shadow-sm sm:p-8">{children}<footer className="mt-8 border-t border-foreground-200 pt-4 text-center text-xs text-foreground-400">Kent Business College · Secure event feedback</footer></section></main>;
}
