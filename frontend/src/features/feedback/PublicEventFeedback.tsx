import { useEffect, useMemo, useState } from 'react';
import { eventFeedbackApi, type PublicEventFeedback as PublicEventFeedbackData } from '@/api/eventFeedback';
import type { FeedbackAnswerValue } from '@/api/feedback';
import { FeedbackFormExperience } from './FormRenderer';
import { missingRequiredQuestionIds } from './formPresentation';

export function PublicEventFeedback({ token }: { token: string }) {
  const [data, setData] = useState<PublicEventFeedbackData | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, Record<string, FeedbackAnswerValue>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [invalidQuestionIds, setInvalidQuestionIds] = useState<Set<number>>(new Set());

  useEffect(() => {
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

  function chooseForm(formId: number) {
    setActiveId(formId);
    setStep(0);
    setInvalidQuestionIds(new Set());
    setError('');
  }

  function updateAnswer(questionId: number, value: FeedbackAnswerValue) {
    setInvalidQuestionIds(current => { const next = new Set(current); next.delete(questionId); return next; });
    setAnswers(current => ({ ...current, [activeId!]: { ...(current[activeId!] || {}), [String(questionId)]: value } }));
  }

  function nextStep() {
    if (!active) return;
    const missing = missingRequiredQuestionIds(active.sections[step], answers[active.id] || {});
    setInvalidQuestionIds(missing);
    if (!missing.size) setStep(value => Math.min(value + 1, active.sections.length - 1));
  }

  async function submit() {
    if (!active) return;
    const invalidBySection = active.sections.map(section => missingRequiredQuestionIds(section, answers[active.id] || {}));
    const firstInvalidSection = invalidBySection.findIndex(ids => ids.size > 0);
    if (firstInvalidSection >= 0) {
      setStep(firstInvalidSection);
      setInvalidQuestionIds(invalidBySection[firstInvalidSection]);
      return;
    }
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
      {data.forms.map(form => <button key={form.id} type="button" role="tab" aria-selected={form.id === active.id} onClick={() => chooseForm(form.id)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${form.id === active.id ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-700'}`}>{form.title}{form.response.status === 'completed' ? ' ✓' : ''}</button>)}
    </div>}
    {completed ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm font-semibold text-emerald-800">Thank you. Your feedback has been submitted.</div> : <>
      <FeedbackFormExperience title={active.title} description={active.description} instructions={active.instructions}
        sections={active.sections} activeSection={step} answers={answers[active.id] || {}}
        invalidQuestionIds={invalidQuestionIds} onChange={updateAnswer}
        onStepChange={index => { if (index <= step) { setStep(index); setInvalidQuestionIds(new Set()); } }}
        onBack={() => { setStep(value => Math.max(value - 1, 0)); setInvalidQuestionIds(new Set()); }}
        onNext={nextStep} onSubmit={() => void submit()} submitting={saving} />
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    </>}
  </PublicShell>;
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background-100 px-4 py-8"><section className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/60 bg-white p-5 shadow-sm sm:p-8">{children}<footer className="mt-8 border-t border-foreground-200 pt-4 text-center text-xs text-foreground-400">Kent Business College · Secure event feedback</footer></section></main>;
}
