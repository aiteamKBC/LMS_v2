import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackAnswerValue, type FeedbackForm } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { FeedbackFormHeader, FeedbackStepProgress, FormRenderer } from '@/features/feedback/FormRenderer';
import { missingRequiredQuestionIds } from '@/features/feedback/formPresentation';
import { useAuth } from '@/hooks/useAuth';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { roleNavMap } from '@/mocks/navigation';

export default function LearnerFeedbackFormPage() {
  const { formId, deliveryId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, isInitialized } = useAuth();
  const params = new URLSearchParams(location.search);
  const requestedKind = params.get('kind') || undefined;
  const requestedLearnerId = params.get('learnerId') || undefined;
  const resolved = useResolvedLearner(requestedKind, requestedLearnerId);
  const account = auth.account;
  const isLearner = account?.role === 'learner' && account.subjectType === 'learner';
  const learnerId = isLearner ? String(account.subjectId) : resolved.id;
  const learnerKind = isLearner ? account.learnerType || 'apprenticeship' : resolved.kind;
  const viewerReadOnly = Boolean(account && !isLearner);
  const [form, setForm] = useState<FeedbackForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerValue>>({});
  const answersRef = useRef<Record<string, FeedbackAnswerValue>>({});
  const [step, setStep] = useState(0);
  const [invalidQuestionIds, setInvalidQuestionIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimer = useRef<number | null>(null);
  const autoSaveRevision = useRef(0);
  const autoSaveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!isInitialized || (!formId && !deliveryId) || (viewerReadOnly && !learnerId)) return;
    const previewLearner = viewerReadOnly ? learnerId : undefined;
    const load = deliveryId ? feedbackApi.myDelivery(Number(deliveryId), previewLearner) : feedbackApi.myForm(Number(formId), previewLearner);
    load.then(({ form: loaded }) => {
      setForm(loaded);
      const loadedAnswers = loaded.response?.answers || {};
      answersRef.current = loadedAnswers;
      setAnswers(loadedAnswers);
      setComplete(loaded.response?.status === 'completed');
    }).catch(error => void Swal.fire({ icon: 'error', title: 'Could not open form', text: error.message }));
  }, [deliveryId, formId, isInitialized, learnerId, viewerReadOnly]);

  useEffect(() => () => {
    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
  }, []);

  const sections = useMemo(() => form?.sections || [], [form]);
  const isLast = step >= sections.length - 1;
  function nextStep() {
    const missing = missingRequiredQuestionIds(sections[step], answers);
    setInvalidQuestionIds(missing);
    if (missing.size) return;
    setStep(value => Math.min(value + 1, sections.length - 1));
  }
  function updateAnswer(id: number, value: FeedbackAnswerValue) {
    setInvalidQuestionIds(current => { const next = new Set(current); next.delete(id); return next; });
    const next = { ...answersRef.current, [String(id)]: value };
    answersRef.current = next;
    setAnswers(next);
    scheduleAutoSave(next);
  }
  function scheduleAutoSave(nextAnswers: Record<string, FeedbackAnswerValue>) {
    if (!form?.allowSaveContinue || viewerReadOnly || complete) return;
    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    const revision = ++autoSaveRevision.current;
    setAutoSaveStatus('pending');
    autoSaveTimer.current = window.setTimeout(() => {
      autoSaveTimer.current = null;
      autoSaveChain.current = autoSaveChain.current.catch(() => undefined).then(async () => {
        if (revision === autoSaveRevision.current) setAutoSaveStatus('saving');
        try {
          if (deliveryId) await feedbackApi.saveDeliveryResponse(Number(deliveryId), nextAnswers, false);
          else await feedbackApi.saveResponse(form.id, nextAnswers, false);
          if (revision === autoSaveRevision.current) setAutoSaveStatus('saved');
        } catch {
          if (revision === autoSaveRevision.current) setAutoSaveStatus('error');
        }
      });
    }, 700);
  }
  async function save(submit = false) {
    if (!form) return;
    autoSaveRevision.current += 1;
    if (autoSaveTimer.current !== null) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    if (submit) {
      const invalidBySection = sections.map(section => missingRequiredQuestionIds(section, answers));
      const firstInvalidSection = invalidBySection.findIndex(ids => ids.size > 0);
      if (firstInvalidSection >= 0) {
        setStep(firstInvalidSection);
        setInvalidQuestionIds(invalidBySection[firstInvalidSection]);
        return;
      }
    }
    setSaving(true);
    try {
      await autoSaveChain.current.catch(() => undefined);
      if (deliveryId) await feedbackApi.saveDeliveryResponse(Number(deliveryId), answersRef.current, submit);
      else await feedbackApi.saveResponse(form.id, answersRef.current, submit);
      if (submit) setComplete(true);
      await Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: submit ? 'Feedback submitted' : 'Progress saved', timer: 1800, showConfirmButton: false });
    } catch (error) {
      await Swal.fire({ icon: 'error', title: submit ? 'Could not submit' : 'Could not save', text: error instanceof Error ? error.message : '' });
    } finally { setSaving(false); }
  }

  const nav = roleNavMap.learner;
  const locked = complete && !form?.allowEditAfterSubmission;
  const previewQuery = viewerReadOnly && learnerId
    ? `?learnerId=${encodeURIComponent(learnerId)}${learnerKind ? `&kind=${encodeURIComponent(learnerKind)}` : ''}`
    : '';
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle={form?.title || 'Feedback'} pageSubtitle="Complete your assigned feedback form" userName={auth.account?.displayName || 'Learner'} userRole="Learner">
    <div className="p-6">
      <button onClick={() => navigate(`/learner/feedback${previewQuery}`)} className="mb-4 text-xs font-semibold text-primary-600">← Back to Feedback</button>
      {viewerReadOnly && learnerId && <div className="mx-auto mb-4 max-w-4xl rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">Learner feedback preview — responses cannot be changed or submitted from this view.</div>}
      {form ? locked && !viewerReadOnly ? <Completed /> : <div className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/70 bg-white p-6 shadow-xl sm:p-8">
        {form.delivery?.sessionTitle && <div className="mb-4 rounded-lg bg-primary-50 p-3 text-sm font-semibold text-primary-800">{form.delivery.sessionTitle}{form.delivery.startsAt ? ` · ${formatDateTime(form.delivery.startsAt)}` : ''}</div>}
        <FeedbackFormHeader title={form.title} description={form.description} instructions={form.instructions} />
        <FeedbackStepProgress sections={sections} activeSection={step} onStepChange={index => { if (index <= step) { setStep(index); setInvalidQuestionIds(new Set()); } }} />
        <FormRenderer sections={sections} activeSection={step} answers={answers} invalidQuestionIds={invalidQuestionIds} onChange={updateAnswer} onPhotoUpload={(questionId, file) => feedbackApi.uploadPhoto(form.id, questionId, file, deliveryId ? Number(deliveryId) : undefined)} readOnly={locked || viewerReadOnly} />
        <div className="mt-7 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-foreground-100 pt-5"><div className="flex items-center gap-3">{step > 0 && <button onClick={() => { setStep(step - 1); setInvalidQuestionIds(new Set()); }} className="rounded-md bg-[#34405f] px-6 py-2.5 text-xs font-semibold text-white">Back</button>}{!viewerReadOnly && form.allowSaveContinue && <span aria-live="polite" className={`text-[11px] font-medium ${autoSaveStatus === 'error' ? 'text-red-600' : 'text-foreground-400'}`}>{autoSaveStatus === 'pending' || autoSaveStatus === 'saving' ? 'Saving…' : autoSaveStatus === 'saved' ? 'All changes saved' : autoSaveStatus === 'error' ? 'Automatic save failed' : ''}</span>}</div>{!viewerReadOnly && (!isLast ? <button onClick={nextStep} className="rounded-md bg-[#34405f] px-6 py-2.5 text-xs font-semibold text-white">Next</button> : <button disabled={saving} onClick={() => void save(true)} className="rounded-md bg-[#541EA0] px-6 py-2.5 text-xs font-semibold text-white">{saving ? 'Submitting…' : 'Submit'}</button>)}<p className="text-right text-xs text-foreground-500">{step + 1}/{sections.length}</p></div>
      </div> : <p className="text-center text-sm text-foreground-400">Loading form…</p>}
    </div>
  </WorkspaceShell>;
}

function Completed() { return <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600"><i className="ri-check-line" /></span><h1 className="mt-4 text-xl font-bold text-foreground-900">Thank you for your feedback</h1><p className="mt-2 text-sm text-foreground-500">Your response has been submitted successfully.</p></div>; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
