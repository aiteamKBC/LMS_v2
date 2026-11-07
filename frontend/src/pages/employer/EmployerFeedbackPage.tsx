import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { feedbackApi, type EmployerFeedbackListItem, type FeedbackAnswerValue, type FeedbackForm } from '@/api/feedback';
import { FeedbackFormExperience } from '@/features/feedback/FormRenderer';
import { missingRequiredQuestionIds } from '@/features/feedback/formPresentation';
import { useEmployerPortalChrome } from './employerPortalNav';

export default function EmployerFeedbackPage() {
  const { employerId = '', deliveryId } = useParams();
  // A different account/assignment must never briefly render the old answers.
  return <EmployerFeedbackContent key={`${employerId}/${deliveryId || ''}`} employerId={employerId} deliveryId={deliveryId} />;
}

function EmployerFeedbackContent({ employerId, deliveryId }: { employerId: string; deliveryId?: string }) {
  const { shell, isEmployerViewer } = useEmployerPortalChrome(employerId);
  const [items, setItems] = useState<EmployerFeedbackListItem[]>();
  const [form, setForm] = useState<FeedbackForm & { relatedLearnerName: string }>();
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerValue>>({});
  const answersRef = useRef(answers);
  const [step, setStep] = useState(0);
  const [invalid, setInvalid] = useState(new Set<number>());
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    setError(''); setLoading(true);
    const load = deliveryId
      ? feedbackApi.employerForm(employerId, deliveryId).then(({ form: value }) => {
        if (!active) return;
        setForm(value); setAnswers(value.response?.answers || {});
        answersRef.current = value.response?.answers || {};
        setComplete(value.response?.status === 'completed');
      })
      : feedbackApi.employerForms(employerId).then(value => { if (active) setItems(value.forms); });
    void load.catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employerId, deliveryId, refresh]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (['Saving…', 'Changes waiting to save', 'Automatic save failed'].includes(saveStatus)) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveStatus]);

  const sections = form?.sections || [];
  const readOnly = !isEmployerViewer || (complete && !form?.allowEditAfterSubmission);
  function updateAnswer(id: number, value: FeedbackAnswerValue) {
    if (readOnly || !deliveryId) return;
    const next = { ...answersRef.current, [id]: value };
    answersRef.current = next; setAnswers(next);
    setInvalid(current => { const result = new Set(current); result.delete(id); return result; });
    setSaveStatus('Changes waiting to save');
    if (!form?.allowSaveContinue) return;
    if (timer.current) clearTimeout(timer.current);
    const version = ++revision.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      chain.current = chain.current.then(async () => {
        if (version === revision.current) setSaveStatus('Saving…');
        try {
          await feedbackApi.saveEmployerResponse(employerId, deliveryId, next);
          if (version === revision.current) setSaveStatus('All changes saved');
        } catch (cause) {
          if (version === revision.current) {
            setSaveStatus('Automatic save failed');
            setError(cause instanceof Error ? cause.message : 'Could not save feedback.');
          }
        }
      });
    }, 700);
  }
  async function save(submit: boolean) {
    if (readOnly || !deliveryId) return;
    if (submit) {
      const missing = sections.map(section => missingRequiredQuestionIds(section, answersRef.current));
      const first = missing.findIndex(ids => ids.size > 0);
      if (first >= 0) { setStep(first); setInvalid(missing[first]); return; }
    }
    revision.current += 1;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaving(true); setError('');
    try {
      await chain.current;
      await feedbackApi.saveEmployerResponse(employerId, deliveryId, answersRef.current, submit);
      setSaveStatus(submit ? 'Feedback submitted' : 'All changes saved');
      if (submit) setComplete(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save feedback.'); }
    finally { setSaving(false); }
  }
  function nextStep() {
    const missing = missingRequiredQuestionIds(sections[step], answers);
    setInvalid(missing);
    if (!missing.size) setStep(value => value + 1);
  }
  const back = `/employers/${employerId}/feedback`;
  return <WorkspaceShell {...shell} pageTitle="Feedback" pageSubtitle="Progress review feedback" hideBreadcrumbs>
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <Link to={deliveryId ? back : `/employers/${employerId}`} className="text-sm font-semibold text-primary-700"
        onClick={event => { if (['Changes waiting to save', 'Automatic save failed', 'Saving…'].includes(saveStatus) && !window.confirm('Leave with unsaved feedback changes?')) event.preventDefault(); }}>← {deliveryId ? 'Back to feedback' : 'Back to dashboard'}</Link>
      {!isEmployerViewer && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">Read-only preview. Only the assigned employer can submit feedback.</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">{error}{!form && <button className="ml-3 underline" onClick={() => setRefresh(value => value + 1)}>Retry</button>}</div>}
      {loading && <p role="status">Loading feedback…</p>}
      {!loading && !deliveryId && items && <section className="rounded-xl border bg-white p-5">
        <div className="mb-5 flex items-center justify-between"><h1 className="text-xl font-bold">Your feedback requests</h1><button onClick={() => setRefresh(value => value + 1)} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div>
        {!items.length ? <p>No feedback assigned.</p> : <ul className="divide-y">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div><h2 className="font-semibold">{item.title}</h2><p className="text-sm">{item.learnerName} · {item.reviewName}</p><p className="text-xs text-foreground-500">Completed {formatDate(item.completedAt)}</p></div>
          <div className="flex items-center gap-3"><span className="text-xs">{item.status === 'completed' ? 'Completed' : item.status === 'in_progress' ? 'In progress' : 'Not started'}</span><Link to={`${back}/${item.id}`} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white">{!isEmployerViewer || item.status === 'completed' ? 'View' : item.status === 'in_progress' ? 'Continue' : 'Start'}</Link></div>
        </li>)}</ul>}
      </section>}
      {!loading && form && <div className="rounded-xl border bg-white p-4 sm:p-8 max-sm:[&_header>div]:flex-col max-sm:[&_header>div]:items-start">
        <p className="mb-4 rounded-lg bg-violet-50 p-3 text-sm">{form.relatedLearnerName} · {form.reviewDelivery?.reviewName} · {form.reviewDelivery && formatDate(form.reviewDelivery.completedAt)}</p>
        {complete && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">Thank you for your feedback. Your response has been submitted.</p>}
        <FeedbackFormExperience title={form.title} description={form.description} instructions={form.instructions}
          sections={sections} answers={answers} activeSection={step} invalidQuestionIds={invalid}
          readOnly={readOnly || saving} onChange={updateAnswer} onNext={nextStep}
          onStepChange={index => { if (readOnly || index <= step) { setStep(index); setInvalid(new Set()); } }}
          onBack={() => { setStep(value => value - 1); setInvalid(new Set()); }} onSubmit={() => void save(true)} submitting={saving}
          onPhotoUpload={deliveryId ? (questionId, file) => feedbackApi.uploadEmployerPhoto(employerId, deliveryId, questionId, file) : undefined}
          footerStatus={<span aria-live="polite" className="text-xs">{saveStatus}</span>} />
        {!readOnly && form.allowSaveContinue && <button disabled={saving} onClick={() => void save(false)} className="mt-4 rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Save for later</button>}
      </div>}
    </div>
  </WorkspaceShell>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(value));
}
