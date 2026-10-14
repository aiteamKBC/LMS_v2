import { useCallback, useEffect, useState } from 'react';
import { eventFeedbackApi, type PublicEventRsvp as PublicEventRsvpData } from '@/api/eventFeedback';
import type { FeedbackAnswerValue } from '@/api/feedback';
import { FeedbackFormExperience } from './FormRenderer';
import { missingRequiredQuestionIds } from './formPresentation';

export function PublicEventRsvp({ token }: { token: string }) {
  const [data, setData] = useState<PublicEventRsvpData | null>(null);
  const [status, setStatus] = useState<'yes' | 'no' | 'maybe' | null>(null);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerValue>>({});
  const [step, setStep] = useState(0);
  const [invalidQuestionIds, setInvalidQuestionIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    eventFeedbackApi.publicRsvp(token).then(result => {
      if (cancelled) return;
      setData(result); setAnswers(result.form.response.answers);
      setStatus(result.rsvpStatus === 'no_response' ? null : result.rsvpStatus);
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to open your event response.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  function updateAnswer(questionId: number, value: FeedbackAnswerValue) {
    setInvalidQuestionIds(current => { const next = new Set(current); next.delete(questionId); return next; });
    setAnswers(current => ({ ...current, [String(questionId)]: value })); setSaved(false);
  }

  function nextStep() {
    if (!data) return;
    const missing = missingRequiredQuestionIds(data.form.sections[step], answers);
    setInvalidQuestionIds(missing);
    if (!missing.size) setStep(value => Math.min(value + 1, data.form.sections.length - 1));
  }

  async function submit() {
    if (!data || !status) { setError('Choose Yes, No, or Maybe before submitting.'); return; }
    const invalidBySection = data.form.sections.map(section => missingRequiredQuestionIds(section, answers));
    const firstInvalidSection = invalidBySection.findIndex(ids => ids.size > 0);
    if (firstInvalidSection >= 0) { setStep(firstInvalidSection); setInvalidQuestionIds(invalidBySection[firstInvalidSection]); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      const result = await eventFeedbackApi.savePublicRsvp(token, status, answers);
      setData(current => current ? { ...current, rsvpStatus: result.rsvpStatus, form: { ...current.form, response: { ...current.form.response, status: 'completed', submittedAt: result.response.submittedAt } } } : current);
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your response.'); }
    finally { setSaving(false); }
  }

  const loadPhoto = useCallback((uploadId: string) => eventFeedbackApi.loadPublicRsvpPhoto(token, uploadId), [token]);

  if (loading) return <Shell><p className="text-center text-sm text-foreground-500">Opening your invitation…</p></Shell>;
  if (error && !data) return <Shell><div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div></Shell>;
  if (!data) return <Shell><p className="text-center text-sm text-foreground-500">This invitation is not available.</p></Shell>;

  return <Shell>
    <div className="mb-5 rounded-xl bg-primary-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Event invitation</p><h1 className="mt-1 text-xl font-bold text-foreground-900">{data.event.title}</h1><p className="mt-1 text-xs text-foreground-500">{data.event.date} · {data.event.time} · {data.event.location}</p><p className="mt-3 text-sm text-foreground-700">Hello, {data.recipient.name}. Can you attend?</p></div>
    <fieldset className="mb-5"><legend className="text-sm font-semibold text-foreground-800">Your response</legend><div className="mt-2 grid grid-cols-3 gap-2">{(['yes', 'maybe', 'no'] as const).map(value => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setSaved(false); }} className={`rounded-xl border px-3 py-3 text-sm font-semibold capitalize ${status === value ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-white text-foreground-700'}`}>{value}</button>)}</div></fieldset>
    <FeedbackFormExperience title={data.form.title.replace(/\bRSVP\b/gi, 'Response')} description={data.form.description} instructions={data.form.instructions}
      sections={data.form.sections} activeSection={step} answers={answers} invalidQuestionIds={invalidQuestionIds}
      onChange={updateAnswer} onStepChange={index => { if (index <= step) { setStep(index); setInvalidQuestionIds(new Set()); } }}
      onBack={() => { setStep(value => Math.max(value - 1, 0)); setInvalidQuestionIds(new Set()); }} onNext={nextStep}
      onPhotoUpload={(questionId, file) => eventFeedbackApi.uploadPublicRsvpPhoto(token, questionId, file)}
      onPhotoRemove={uploadId => eventFeedbackApi.removePublicRsvpPhoto(token, uploadId)}
      loadPhoto={loadPhoto}
      dragDropPhotos
      onSubmit={() => void submit()} submitting={saving} />
    {saved && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Your response has been saved. You can return to this link and change it while the event is open.</div>}
    {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background-100 px-4 py-8"><section className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/60 bg-white p-5 shadow-sm sm:p-8">{children}<footer className="mt-8 border-t border-foreground-200 pt-4 text-center text-xs text-foreground-400">Kent Business College · Secure event response</footer></section></main>;
}
