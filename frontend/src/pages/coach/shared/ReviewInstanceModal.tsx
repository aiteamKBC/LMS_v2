import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer, computeMissingRequiredFields, computeVisibleRequiredFields } from '@/components/reviews/ReviewFormRenderer';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { ReviewPdfDownload } from '@/components/reviews/ReviewPdfDownload';
import { ReviewProgressPanel } from '@/components/reviews/ReviewProgressPanel';
import {
  calculateReviewInstanceProgress,
  completeReviewInstance,
  downloadReviewInstancePdf,
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

const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/** Review Types with a signed PDF export, by the Review Type's stable code --
 *  mirrors curriculum_api.review_pdf.EXPORTABLE_REVIEW_TYPES. */
const EXPORTABLE_REVIEW_TYPES = ['mcm', 'progress_review'];

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
  onStatusChanged,
  presentation = 'modal',
}: {
  /** Only what the header shows -- deliberately structural so the timetable,
   *  meetings and progress-review pages can each pass their own event type. */
  event: { learner?: string | null; programme?: string | null };
  instanceId: string;
  onClose: () => void;
  /** Called with the instance's resulting status after a successful
   *  "Complete review" -- 'awaiting-signature' when the Curriculum template
   *  requires a signature, 'completed' when it requires none. Callers mirror
   *  this onto their own CoachCalendarEvent state rather than assuming which
   *  one it landed on. */
  onCompleted?: (status: string) => void;
  /** Keeps the parent calendar row in sync after a lifecycle change that
   *  does not close this modal, such as a manual scheduled -> in-progress
   *  override. */
  onStatusChanged?: (status: string) => void;
  /** Page mode reuses the same form lifecycle without modal chrome. */
  presentation?: 'modal' | 'page';
}) {
  const { auth } = useAuth();
  const [definition, setDefinition] = useState<ReviewInstanceFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const signatureSaveInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchReviewInstanceForm(instanceId, controller.signal)
      .then((data) => {
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
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [instanceId]);

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
  const isSignatureStage = definition ? ['awaiting-signature', 'completed'].includes(definition.instance.status) : false;
  const advisorSignature = definition?.signatures.advisor;
  const advisorSignaturePending = Boolean(
    definition
    && advisorSignature?.required
    && !advisorSignature.signed
    && isSignatureStage,
  );
  const advisorSignatureSaved = Boolean(definition && advisorSignature?.required && advisorSignature.signed);
  const requiredSignatures = definition ? Object.values(definition.signatures).filter(state => state.required) : [];
  const allRequiredSignaturesSaved = requiredSignatures.length > 0 && requiredSignatures.every(state => state.signed);
  const waitingForOtherSignatures = Boolean(
    definition
    && isSignatureStage
    && !advisorSignaturePending
    && !allRequiredSignaturesSaved,
  );
  const formReadOnly = isSignatureStage;

  const handleAnswerChange = (fieldId: string, value: unknown) => {
    if (formReadOnly) return;
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setShowErrors(false);
  };

  const saveDraft = async () => {
    if (!definition) return;
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
    if (!definition) return;
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
      setDefinition(completed);
      onStatusChanged?.(completed.instance.status);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'This review cannot be completed yet.');
    } finally {
      setSaving(false);
    }
  };

  /** Calculating is an explicit action and never happens on load, reload or
   *  reopen -- the snapshot below is whatever the backend already stored. */
  const calculateProgress = async () => {
    if (!definition || calculating) return;
    setCalculating(true);
    setError(null);
    try {
      setDefinition(await calculateReviewInstanceProgress(definition.instance.id));
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Progress could not be calculated.');
    } finally {
      setCalculating(false);
    }
  };

  const busy = saving || calculating;
  const pageMode = presentation === 'page';

  const content = (
    <>
      {pageMode ? (
        <header className="rounded-t-2xl border-b border-white/10 bg-gradient-to-r from-[#10021f] via-primary-950 to-[#35105e] px-5 py-6 text-white sm:px-7">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="mb-5 inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            <AppIcon className="ri-arrow-left-line"></AppIcon>Back to reviews
          </button>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-lg text-secondary-200">
              <AppIcon className="ri-chat-check-line"></AppIcon>
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-secondary-200">Complete review</p>
              <h1 className="mt-1 text-xl font-bold text-white sm:text-2xl">
                {definition ? `${event.learner || 'Learner'} · ${definition.template.name} #${definition.instance.occurrenceNumber}` : 'Loading review...'}
              </h1>
              <p className="mt-1 text-[13px] text-white/60">Work through each Curriculum-defined step, then save or complete the review.</p>
            </div>
          </div>
          {requiredCount ? (
            <div className="mt-5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-secondary-300 transition-all" style={{ width: `${Math.round((answeredCount / requiredCount) * 100)}%` }} />
              </div>
              <span className="text-[12px] font-bold text-white/70">{answeredCount}/{requiredCount} answered</span>
            </div>
          ) : null}
        </header>
      ) : (
        <ModalHeader
          eyebrow="Complete review"
          icon="ri-chat-check-line"
          title={definition ? `${event.learner || 'Learner'} · ${definition.template.name} #${definition.instance.occurrenceNumber}` : 'Loading review...'}
          subtitle="Complete the Curriculum-defined review before closing it."
          busy={busy}
          onClose={onClose}
          progressPercent={requiredCount ? Math.round((answeredCount / requiredCount) * 100) : undefined}
          progressLabel={requiredCount ? `${answeredCount}/${requiredCount} answered` : undefined}
        />
      )}

      <div className={pageMode ? 'space-y-4 bg-background-100 p-4 sm:p-6' : 'flex-1 space-y-3 overflow-y-auto bg-background-100 p-4 sm:p-6'}>
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

            {definition.instance.status === 'scheduled' ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-bold text-amber-900">Not yet in progress</p>
                  <p className="mt-0.5 text-[12px] text-amber-800">
                    Start the review from the meeting actions before completing this form.
                  </p>
                </div>
              </div>
            ) : null}

            {/* The Learning Progress area belongs to the canonical Progress
                Review type only -- identified by the Review Type's stable
                code, never by the template's name. Calculating is locked once
                the review reaches the signature step, so the figures a party
                signs cannot move afterwards. */}
            {definition.template.reviewTypeCode === 'progress_review' ? (
              <ReviewProgressPanel
                snapshot={definition.progressSnapshot}
                ragHistory={definition.ragHistory}
                canCalculate={!isSignatureStage}
                calculating={calculating}
                onCalculate={() => { void calculateProgress(); }}
              />
            ) : null}

            <ReviewFormRenderer
              sections={definition.sections}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              errors={showErrors ? { missingFieldIds } : undefined}
              readOnly={formReadOnly}
              openSectionId={openSectionId}
              onOpenSectionChange={setOpenSectionId}
              variant={pageMode ? 'steps' : 'accordion'}
              stepOffset={pageMode ? 2 : 0}
            />
            {advisorSignaturePending ? (
              <section aria-label="Review signature step" tabIndex={-1} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <h3 className="mb-3 text-sm font-bold text-violet-950">Your coach signature is required</h3>
                {auth.user?.fullName ? (
                  <fieldset disabled={saving} className="min-w-0 border-0 p-0">
                    <SignaturePad
                      signatoryName={auth.user.fullName}
                      onCommit={(signature) => {
                        if (signatureSaveInFlightRef.current) return;
                        signatureSaveInFlightRef.current = true;
                        setSaving(true);
                        setError(null);
                        void signReviewInstance(definition.instance.id, 'advisor', auth.user?.fullName || 'Coach', signature)
                          .then((updated) => {
                            setDefinition(updated);
                            onStatusChanged?.(updated.instance.status);
                          })
                          .catch((err) => {
                            if (isAbortError(err)) return;
                            setError(err instanceof Error ? err.message : 'Unable to save your signature.');
                          })
                          .finally(() => {
                            signatureSaveInFlightRef.current = false;
                            setSaving(false);
                          });
                      }}
                      onCancel={() => undefined}
                    />
                  </fieldset>
                ) : (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    Your account has no name on record, so this cannot be signed.
                  </p>
                )}
              </section>
            ) : null}
            {advisorSignatureSaved ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Your coach signature has been saved.
              </div>
            ) : null}
            {waitingForOtherSignatures ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm font-semibold text-violet-900">
                Your part is complete. The review is waiting for the remaining required signatures.
              </div>
            ) : null}
            {definition.instance.status === 'completed' ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Review completed
              </div>
            ) : null}
            {/* The signed-PDF export and the full signature summary (coach +
                learner + any other configured party) belong to the Review
                Types that have a signed export -- identified by the Review
                Type's stable code, never by name/title -- and reuse the exact
                same components/API the learner side already uses, reading the
                same signatures/pdf-availability this same fetch already
                returned. */}
            {EXPORTABLE_REVIEW_TYPES.includes(definition.template.reviewTypeCode || '') && isSignatureStage ? (
              <>
                <ReviewSignatures signatures={definition.signatures} />
                <ReviewPdfDownload
                  availability={definition.pdf}
                  onDownload={() => downloadReviewInstancePdf(definition.instance.id)}
                />
              </>
            ) : null}
          </>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}
          </div>
        ) : null}
      </div>

      <footer className={pageMode ? 'sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 rounded-b-2xl border-t border-background-200 bg-white/95 px-5 py-4 shadow-[0_-8px_24px_rgba(31,24,51,0.06)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-7' : 'flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7'}>
        <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">{pageMode ? 'Back' : 'Cancel'}</button>
        {!isSignatureStage ? <div className="flex gap-2">
          <button type="button" onClick={saveDraft} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-5 text-xs font-bold text-foreground-700 shadow-sm transition hover:bg-background-100 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon>Save draft
          </button>
          <button type="button" onClick={complete} disabled={busy || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
            {saving ? 'Saving...' : 'Complete review'}
          </button>
        </div> : null}
      </footer>
    </>
  );

  if (pageMode) {
    return <div className="rounded-2xl border border-background-200 bg-white shadow-sm">{content}</div>;
  }

  return <ModalShell busy={busy} onClose={onClose}>{content}</ModalShell>;
}
