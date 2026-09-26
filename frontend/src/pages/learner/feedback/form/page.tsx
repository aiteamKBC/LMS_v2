import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackAnswerValue, type FeedbackForm } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { FeedbackFormHeader, FormRenderer } from '@/features/feedback/FormRenderer';
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
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!isInitialized || (!formId && !deliveryId) || (viewerReadOnly && !learnerId)) return;
    const previewLearner = viewerReadOnly ? learnerId : undefined;
    const load = deliveryId ? feedbackApi.myDelivery(Number(deliveryId), previewLearner) : feedbackApi.myForm(Number(formId), previewLearner);
    load.then(({ form: loaded }) => {
      setForm(loaded);
      setAnswers(loaded.response?.answers || {});
      setComplete(loaded.response?.status === 'completed');
    }).catch(error => void Swal.fire({ icon: 'error', title: 'Could not open form', text: error.message }));
  }, [deliveryId, formId, isInitialized, learnerId, viewerReadOnly]);

  const sections = useMemo(() => form?.sections || [], [form]);
  const isLast = step >= sections.length - 1;
  async function save(submit = false) {
    if (!form) return;
    setSaving(true);
    try {
      if (deliveryId) await feedbackApi.saveDeliveryResponse(Number(deliveryId), answers, submit);
      else await feedbackApi.saveResponse(form.id, answers, submit);
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
      {form ? locked && !viewerReadOnly ? <Completed /> : <div className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/60 bg-background-50 p-6">
        {form.delivery?.sessionTitle && <div className="mb-4 rounded-lg bg-primary-50 p-3 text-sm font-semibold text-primary-800">{form.delivery.sessionTitle}{form.delivery.startsAt ? ` · ${formatDateTime(form.delivery.startsAt)}` : ''}</div>}
        <FeedbackFormHeader title={form.title} description={form.description} instructions={form.instructions} />
        {sections.length > 1 && <div className="mb-5 flex items-center gap-2 overflow-x-auto">{sections.map((section, index) => <button key={section.id} onClick={() => setStep(index)} className={`flex min-w-24 flex-1 items-center gap-2 rounded-lg p-2 text-left text-[11px] ${index === step ? 'bg-primary-600 text-white' : index < step ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 font-bold">{index + 1}</span><span className="truncate">{section.title}</span></button>)}</div>}
        <FormRenderer sections={sections} activeSection={sections.length > 1 ? step : undefined} answers={answers} onChange={(id, value) => setAnswers(current => ({ ...current, [String(id)]: value }))} onPhotoUpload={(questionId, file) => feedbackApi.uploadPhoto(form.id, questionId, file, deliveryId ? Number(deliveryId) : undefined)} readOnly={locked || viewerReadOnly} />
        <div className="mt-5 flex flex-wrap justify-between gap-3"><button disabled={step === 0} onClick={() => setStep(step - 1)} className="rounded-lg border px-4 py-2 text-xs font-semibold disabled:opacity-30">Previous</button>{!viewerReadOnly && <div className="flex gap-2">{form.allowSaveContinue && <button disabled={saving} onClick={() => void save(false)} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-xs font-semibold text-primary-700">Save</button>}{!isLast ? <button onClick={() => setStep(step + 1)} className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white">Next</button> : <button disabled={saving} onClick={() => void save(true)} className="rounded-lg bg-[#541EA0] px-5 py-2 text-xs font-semibold text-white">{saving ? 'Submitting…' : 'Submit'}</button>}</div>}</div>
      </div> : <p className="text-center text-sm text-foreground-400">Loading form…</p>}
    </div>
  </WorkspaceShell>;
}

function Completed() { return <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600"><i className="ri-check-line" /></span><h1 className="mt-4 text-xl font-bold text-foreground-900">Thank you for your feedback</h1><p className="mt-2 text-sm text-foreground-500">Your response has been submitted successfully.</p></div>; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
