import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer, computeMissingRequiredFields, computeVisibleRequiredFields } from '@/components/reviews/ReviewFormRenderer';
import {
  completeReviewInstance,
  downloadMcmReviewPdf,
  fetchReviewInstanceForm,
  flattenReviewFields,
  saveReviewInstanceAnswers,
  signReviewInstance,
  type ReviewInstanceFormDefinition,
} from '@/api/reviewInstances';
import { ModalHeader, ModalShell } from './ModalHeader';
import { formatDateLabel } from './calendarEvents';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { useAuth } from '@/hooks/useAuth';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { ReviewPdfDownload } from '@/components/reviews/ReviewPdfDownload';

const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/**
 * The generic "open a Curriculum-driven Review" screen -- what a coach sees
 * when they open ANY Review instance (Monthly Coaching Meeting, Progress
 * Review, or any future Review Curriculum creates), instead of a
 * per-Review-type hard-coded form. The header always shows the Review's
 * live Curriculum name (`definition.template.name`), never a fixed string.
 *
 * Deliberately does not touch scheduling/Teams/calendar state -- this modal
 * only reads/writes the Review's own answers via the review instance API;
 * the calendar event it was opened from is untouched here.
 */
export function ReviewInstanceModal({
  event,
  instanceId,
  onClose,
  onStatusChange,
}: {
  /** Only what the header shows -- deliberately structural so the timetable,
   *  meetings and progress-review pages can each pass their own event type. */
  event: { learner?: string | null; programme?: string | null };
  instanceId: string;
  onClose: () => void;
  /** Update the calendar after submission/signing without closing the form:
   * the next signature step must stay available in this same visit. */
  onStatusChange: (status: string) => void;
}) {
  const { auth } = useAuth();
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [signatureNotice, setSignatureNotice] = useState('');
  const signingInFlight = useRef(false);
  const focusSignatureStep = useRef(false);
  const signatureStep = useRef<HTMLDivElement>(null);
  const coachName = auth.user?.fullName?.trim() || '';
  const submitted = ['awaiting-signature', 'completed'].includes(definition?.instance.status || '');
  const coachNeedsToSign = Boolean(submitted && definition?.signatures.advisor?.required && !definition.signatures.advisor.signed);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDefinition(null);
    setSignatureError('');
    setSignatureNotice('');
    fetchReviewInstanceForm(instanceId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setDefinition(data);
        const initialAnswers: Record<string, unknown> = {};
        for (const field of flattenReviewFields(data.sections)) {
          if (field.answer !== undefined && field.answer !== null) initialAnswers[field.id] = field.answer;
        }
        setAnswers(initialAnswers);
        setOpenSectionId(data.sections.find((s) => s.enabled)?.id || '');
      })
      .catch((err) => {
        // A superseded request (React 18 double-invokes this effect in dev,
        // and a new instanceId aborts the previous one) is not a real load
        // failure -- only a genuinely failed fetch should surface here.
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Unable to load this review.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [instanceId]);

  useEffect(() => {
    if (focusSignatureStep.current && submitted && signatureStep.current) {
      focusSignatureStep.current = false;
      signatureStep.current.focus();
      signatureStep.current.scrollIntoView?.({ block: 'nearest' });
    }
  }, [definition, submitted]);

  const missingFieldIds = useMemo(
    () => (definition ? computeMissingRequiredFields(definition.sections, answers) : new Set<string>()),
    [definition, answers],
  );
  // Counted from the fields actually on screen, so a conditional question
  // hidden behind an unanswered case block is not silently counted as done.
  const requiredCount = useMemo(
    () => (definition ? computeVisibleRequiredFields(definition.sections, answers).size : 0),
    [definition, answers],
  );
  const answeredCount = requiredCount - missingFieldIds.size;

  const handleAnswerChange = (fieldId: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setShowErrors(false);
  };

  const saveDraft = async () => {
    if (!definition || submitted || saving || signing) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveReviewInstanceAnswers(definition.instance.id, answers);
      setDefinition(updated);
    } catch (err) {
      // A request cancelled mid-flight (e.g. a dev-server reload, or the
      // modal closing) is not a real save failure -- nothing for the coach
      // to act on, so it should not surface as an error banner.
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Unable to save this review.');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (!definition || submitted || saving || signing) return;
    if (missingFieldIds.size > 0) {
      setShowErrors(true);
      const containsMissingField = (fields: typeof definition.sections[number]['fields']): boolean => (
        fields.some((field) => missingFieldIds.has(field.id) ||
          containsMissingField(field.yesFields || []) || containsMissingField(field.noFields || []))
      );
      const firstMissingSection = definition.sections.find((section) => containsMissingField(section.fields));
      if (firstMissingSection) setOpenSectionId(firstMissingSection.id);
      setError('Please complete every required field before finishing the review.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveReviewInstanceAnswers(definition.instance.id, answers);
      const completed = await completeReviewInstance(definition.instance.id);
      focusSignatureStep.current = true;
      setDefinition(completed);
      onStatusChange(completed.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be completed yet.');
    } finally {
      setSaving(false);
    }
  };

  const saveSignature = async (signature: string) => {
    if (!definition || !coachNeedsToSign || !coachName || signingInFlight.current) return;
    signingInFlight.current = true;
    setSigning(true);
    setSignatureError('');
    setSignatureNotice('');
    try {
      const signed = await signReviewInstance(definition.instance.id, 'advisor', coachName, signature);
      setDefinition(signed);
      setSignatureNotice('Your coach signature has been saved.');
      onStatusChange(signed.instance.status);
    } catch (err) {
      setSignatureError(err instanceof Error ? err.message : 'Could not save your signature. Please try again.');
    } finally {
      signingInFlight.current = false;
      setSigning(false);
    }
  };

  const busy = saving || signing;

  return (
    <ModalShell busy={busy} onClose={onClose}>
      <ModalHeader
        eyebrow={submitted ? 'Review signatures' : 'Complete review'}
        icon="ri-chat-check-line"
        title={definition ? `${event.learner || 'Learner'} · ${definition.template.name} #${definition.instance.occurrenceNumber}` : 'Loading review...'}
        subtitle={submitted ? 'Check the saved review and the required signatures.' : 'Complete the review, then confirm the required signatures.'}
        busy={busy}
        onClose={onClose}
        progressPercent={requiredCount ? Math.round((answeredCount / requiredCount) * 100) : undefined}
        progressLabel={requiredCount ? `${answeredCount}/${requiredCount} answered` : undefined}
      />

      <div className="flex-1 space-y-3 overflow-y-auto bg-background-100 p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground-400">
            <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>Loading review...
          </div>
        ) : null}

        {!loading && definition ? (
          <>
            <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-[13px] leading-5 text-primary-800">
              <AppIcon className="ri-information-line mr-2"></AppIcon>
              These answers are saved to this {definition.template.name} and follow the sections/questions configured in Curriculum.
            </div>

            <div className="grid gap-3 rounded-2xl border border-background-200 bg-background-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Learner', event.learner || 'Unknown learner'],
                ['Programme', event.programme || '--'],
                ['Review', `${definition.template.name} #${definition.instance.occurrenceNumber}`],
                ['Target date', formatDateLabel(definition.instance.targetDate)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-background-100 px-3.5 py-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
                  <p className="mt-1 text-[13px] font-bold text-foreground-800">{value}</p>
                </div>
              ))}
            </div>

            <ReviewFormRenderer
              sections={definition.sections}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              errors={showErrors ? { missingFieldIds } : undefined}
              readOnly={submitted}
              openSectionId={openSectionId}
              onOpenSectionChange={setOpenSectionId}
            />
            <div ref={signatureStep} tabIndex={-1} aria-label="Review signature step" className="space-y-4 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {submitted && <div className="rounded-xl border border-violet-200 bg-violet-50 p-4" role="status">
                <p className="text-sm font-bold text-violet-950">{definition.instance.status === 'completed' ? 'Review completed' : 'Review submitted — signatures pending'}</p>
                <p className="mt-1 text-sm text-violet-900">{definition.instance.status === 'completed'
                  ? 'All required steps are complete. The saved review and signatures are shown below.'
                  : coachNeedsToSign
                    ? 'Review the saved answers and confirm your signature below. The review completes when every required person has signed.'
                    : 'Your part is complete. The review is waiting for the remaining required signatures.'}</p>
              </div>}
              <ReviewSignatures signatures={definition.signatures} />
              <ReviewPdfDownload availability={definition.pdf} onDownload={() => downloadMcmReviewPdf(definition.instance.id)} />
              {signatureNotice && <p role="status" className="text-sm font-semibold text-emerald-800">{signatureNotice}</p>}
              {coachNeedsToSign && <section aria-label="Your coach signature" aria-busy={signing} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <h3 className="mb-3 text-sm font-bold text-violet-950">Your coach signature is required</h3>
                {coachName ? <fieldset disabled={signing} className="min-w-0 disabled:opacity-70">
                  <SignaturePad signatoryName={coachName} onCommit={(signature) => { void saveSignature(signature); }} onCancel={onClose} />
                </fieldset> : <p role="alert" className="text-sm text-red-700">Your account has no name on record. Add your name before signing this review.</p>}
                {signing && <p role="status" className="mt-3 text-sm text-violet-900">Saving your signature...</p>}
                {signatureError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{signatureError} Your signature has not been saved. Please try signing again.</p>}
              </section>}
            </div>
          </>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">{submitted ? 'Close' : 'Cancel'}</button>
        {!submitted && <div className="flex gap-2">
          <button type="button" onClick={saveDraft} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-5 text-xs font-bold text-foreground-700 shadow-sm transition hover:bg-background-100 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon>Save draft
          </button>
          <button type="button" onClick={complete} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
            {saving ? 'Saving...' : 'Complete review'}
          </button>
        </div>}
      </footer>
    </ModalShell>
  );
}
