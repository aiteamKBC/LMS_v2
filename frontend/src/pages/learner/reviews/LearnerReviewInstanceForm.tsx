import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  ReviewFormRenderer,
  computeMissingRequiredFieldsForRole,
  computeVisibleRequiredFields,
  computeVisibleWritableFieldIds,
  computeWritableFieldIds,
} from '@/components/reviews/ReviewFormRenderer';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { ReviewPdfDownload } from '@/components/reviews/ReviewPdfDownload';
import { ReviewProgressPanel } from '@/components/reviews/ReviewProgressPanel';
import { fetchLearnerEventReviewInstance, type LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { LearnerKind } from '@/api/learnerDetail';
import { flattenReviewFields } from '@/api/reviewInstances';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';

/**
 * The learner's half of the ONE Curriculum-driven Review form -- also reused
 * as-is for the Employer's half (see viewerRole below), since both are the
 * same "someone other than the coach reads/answers this Review" surface.
 *
 * Coach opens a Review instance through ReviewInstanceModal; the learner reads
 * the very same `review_instance_form_definition` here and hands it to the very
 * same ReviewFormRenderer. Neither side owns a per-Review-type form: sections,
 * fields, conditional fields, required rules and signatures all arrive from the
 * Curriculum template the occurrence was generated from.
 *
 * Read-only by default -- the Review is the coach's record of the meeting.
 * A field only becomes writable here when the Curriculum template's Form
 * Builder explicitly opts `viewerRole` into answering it (see
 * computeWritableFieldIds / reviews.FIELD_RESPONDENT_ROLES), and only once
 * the caller supplies `onSaveAnswers` -- omitted, the form stays exactly as
 * read-only as it always has.
 */

export interface LearnerReviewInstanceState {
  definition: LearnerReviewDefinition | null;
  loading: boolean;
  error: string;
  refresh: () => void;
}

function savedLearnerSignatureKey(name: string): string {
  return `learner-review-signature:${name.trim().toLowerCase() || 'learner'}`;
}

function readSavedLearnerSignature(name: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const value = window.localStorage.getItem(savedLearnerSignatureKey(name)) || '';
    return value.startsWith('data:image/') ? value : '';
  } catch {
    return '';
  }
}

function writeSavedLearnerSignature(name: string, signature: string): void {
  if (typeof window === 'undefined' || !signature.startsWith('data:image/')) return;
  try {
    window.localStorage.setItem(savedLearnerSignatureKey(name), signature);
  } catch {
    // The review signature itself is saved server-side. Reuse is best-effort.
  }
}

/**
 * Loads a booked instance or an unscheduled occurrence's template preview.
 * This hook only issues a GET; opening a form never creates an instance.
 */
export function useLearnerReviewInstance(
  kind: LearnerKind,
  learnerId: string,
  eventKey: string,
): LearnerReviewInstanceState {
  const [definition, setDefinition] = useState<LearnerReviewDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!eventKey) {
      setDefinition(null);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setDefinition(null);
    setError('');
    fetchLearnerEventReviewInstance(kind, learnerId, eventKey, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setDefinition('template' in data ? data : null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setDefinition(null);
        setError(reason instanceof Error ? reason.message : 'Could not load this review.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, learnerId, eventKey, revision]);

  return { definition, loading, error, refresh };
}

function seedAnswersFromDefinition(definition: LearnerReviewDefinition): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  for (const field of flattenReviewFields(definition.sections)) {
    if (field.answer !== undefined && field.answer !== null) saved[field.id] = field.answer;
  }
  return saved;
}

export function LearnerReviewInstanceForm({
  definition, onSign, onDownload, signatoryName = 'Learner',
  viewerRole = 'participant', onSaveAnswers,
}: {
  definition: LearnerReviewDefinition;
  onSign?: (signature: string) => Promise<void>;
  onDownload?: () => Promise<void>;
  signatoryName?: string;
  /** Which respondent role this rendering represents -- 'participant' (the
   *  Learner) unless the caller is the Employer's own surface. */
  viewerRole?: 'participant' | 'employer';
  /** Persists a role-scoped subset of answers and returns the refreshed
   *  definition. Omitted (every existing caller until it opts in), the form
   *  stays fully read-only exactly as it always has. */
  onSaveAnswers?: (answers: Record<string, unknown>) => Promise<LearnerReviewDefinition>;
}) {
  const [openSectionId, setOpenSectionId] = useState('');
  const [signing, setSigning] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [signatureOpen, setSignatureOpen] = useState(true);
  const [savedSignature, setSavedSignature] = useState('');
  const [drawingSignature, setDrawingSignature] = useState(false);
  const signingInFlight = useRef(false);
  const signatureSection = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => seedAnswersFromDefinition(definition));
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [saveAnswersError, setSaveAnswersError] = useState('');

  function showSignatures() {
    setSignatureOpen(true);
    signatureSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    signatureSection.current?.focus({ preventScroll: true });
  }

  async function saveSignature(signature: string) {
    if (!onSign || signingInFlight.current) return;
    signingInFlight.current = true;
    setSigning(true);
    setSignatureError('');
    try {
      await onSign(signature);
      writeSavedLearnerSignature(signatoryName, signature);
      setSavedSignature(signature);
      setDrawingSignature(false);
    } catch (reason) {
      setSignatureError(reason instanceof Error ? reason.message : 'Could not save your signature. Please try again.');
    } finally {
      signingInFlight.current = false;
      setSigning(false);
    }
  }

  useEffect(() => {
    setOpenSectionId(definition.sections.find((section) => section.enabled)?.id || '');
  }, [definition]);

  useEffect(() => {
    setSavedSignature(readSavedLearnerSignature(signatoryName));
    setDrawingSignature(false);
  }, [signatoryName]);

  // The renderer draws from `answers`, not from the field rows, so the saved
  // answers are seeded the same way ReviewInstanceModal seeds them. Kept as
  // state (not a pure derivation) so a writable field's own edits show
  // immediately, then reseeded whenever a fresh definition arrives (a new
  // occurrence opened, or this component's own save below returns one).
  useEffect(() => {
    setAnswers(seedAnswersFromDefinition(definition));
  }, [definition]);

  const requiredSignatures = Object.values(definition.signatures).filter(state => state.required);
  const submitted = ['awaiting-signature', 'completed'].includes(definition.instance?.status || '');
  // Exactly the fields the Curriculum template opted this viewer into
  // answering -- every other field stays read-only regardless of onSaveAnswers.
  const writableFieldIds = useMemo(
    () => computeWritableFieldIds(definition.sections, viewerRole),
    [definition, viewerRole],
  );
  // Writing follows the same lifecycle rule the backend enforces: once the
  // review reaches the signature step, its answers are frozen for everyone.
  const canWriteAnswers = Boolean(onSaveAnswers) && !submitted;
  const visibleRespondentFieldIds = useMemo(
    () => computeVisibleWritableFieldIds(definition.sections, answers, viewerRole),
    [definition.sections, answers, viewerRole],
  );
  const respondentRequiredFieldIds = useMemo(() => {
    const writable = visibleRespondentFieldIds;
    return new Set(
      [...computeVisibleRequiredFields(definition.sections, answers)].filter((fieldId) => writable.has(fieldId)),
    );
  }, [definition.sections, answers, visibleRespondentFieldIds]);
  const respondentMissingFieldIds = useMemo(
    () => computeMissingRequiredFieldsForRole(definition.sections, answers, viewerRole),
    [definition.sections, answers, viewerRole],
  );
  const respondentLabel = viewerRole === 'employer' ? 'Employer' : 'Learner';
  const firstRespondentSectionId = useMemo(
    () => definition.sections.find(
      (section) => computeVisibleWritableFieldIds([section], answers, viewerRole).size > 0,
    )?.id || '',
    [definition.sections, answers, viewerRole],
  );

  const openRespondentQuestions = () => {
    if (!firstRespondentSectionId) return;
    setOpenSectionId(firstRespondentSectionId);
    window.requestAnimationFrame(() => {
      document.getElementById(`review-section-${firstRespondentSectionId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleAnswerChange = useCallback((fieldId: string, value: unknown) => {
    if (!canWriteAnswers || !writableFieldIds.has(fieldId)) return;
    setAnswers(current => ({ ...current, [fieldId]: value }));
    setSaveAnswersError('');
  }, [canWriteAnswers, writableFieldIds]);

  const saveAnswers = async () => {
    if (!onSaveAnswers || savingAnswers) return;
    setSavingAnswers(true);
    setSaveAnswersError('');
    try {
      const payload: Record<string, unknown> = {};
      for (const fieldId of writableFieldIds) payload[fieldId] = answers[fieldId];
      const updated = await onSaveAnswers(payload);
      setAnswers(seedAnswersFromDefinition(updated));
    } catch (reason) {
      setSaveAnswersError(reason instanceof Error ? reason.message : 'Could not save your answers. Please try again.');
    } finally {
      setSavingAnswers(false);
    }
  };
  const allSigned = requiredSignatures.length > 0 && requiredSignatures.every(state => state.signed);
  const learnerSigned = Boolean(definition.signatures.participant?.signed);
  const canSign = Boolean(onSign && submitted && definition.signatures.participant?.required && !learnerSigned);
  const signatureTitle = allSigned ? 'All signatures saved' : canSign ? 'Ready for your signature'
    : learnerSigned ? 'Your signature is saved' : submitted ? 'Awaiting required signatures' : 'Your coach is preparing this review';
  const signatureHelp = allSigned ? 'All required parties have signed this review.'
    : canSign ? "Read your coach's notes and the agreed next steps, then sign below."
    : learnerSigned ? 'You do not need to sign again. This review is waiting for the remaining required signatures.'
    : submitted ? 'The review is ready for the required parties to sign.'
    : 'The coach must complete this review before you can sign it.';

  return (
    <section className="space-y-3" data-testid="learner-review-instance-form">
      <div className="rounded-2xl border border-primary-100 bg-primary-50/70 px-4 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Review</p>
        {/* The Review Template's own name is the title. The Review Type only
            classifies/routes the occurrence and is never displayed here. */}
        <h2 className="mt-0.5 text-sm font-bold text-foreground-900" data-testid="learner-review-instance-title">
          {definition.template.name} #{definition.instance?.occurrenceNumber || definition.occurrenceNumber}
        </h2>
        <p className="mt-1 text-xs text-primary-800">
          <AppIcon className="ri-information-line mr-1.5" />
          Review your coach's notes and the agreed next steps.
        </p>
      </div>

      {requiredSignatures.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="text-sm font-bold text-violet-950">{signatureTitle}</h3>
          <p className="mt-1 text-sm text-violet-900">{signatureHelp}</p>
        </div>
        <button type="button" onClick={showSignatures} className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-semibold text-violet-800 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
          {canSign ? 'Go to signature' : 'View signatures'}
        </button>
      </div>}

      {/* The same frozen figures the coach calculated and the signed PDF
          renders. Read-only here: a learner never calculates, and nothing on
          this page recalculates against their current progress. */}
      {definition.template.reviewTypeCode === 'progress_review' ? (
        <ReviewProgressPanel
          snapshot={definition.progressSnapshot}
          ragHistory={definition.ragHistory}
          canCalculate={false}
          calculating={false}
          onCalculate={() => undefined}
        />
      ) : null}

      {canWriteAnswers && writableFieldIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-200 bg-primary-50/70 px-4 py-3">
          <p className="text-xs text-primary-900">
            <AppIcon className="ri-edit-2-line mr-1.5" />
            Your coach has opened some fields here for you to answer directly.
          </p>
          <button
            type="button"
            onClick={() => void saveAnswers()}
            disabled={savingAnswers}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            {savingAnswers && <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>}
            Save my answers
          </button>
        </div>
      )}
      {visibleRespondentFieldIds.size > 0 && (
        <div data-testid="respondent-question-summary" className="rounded-2xl border border-primary-200 bg-primary-50/70 px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-700">{respondentLabel} questions</p>
              <p className="mt-1 text-sm font-semibold text-primary-950">
                {visibleRespondentFieldIds.size} question{visibleRespondentFieldIds.size === 1 ? '' : 's'} for you
              </p>
              {respondentRequiredFieldIds.size > 0 ? (
                <p className="mt-1 text-xs text-primary-800">
                  {respondentRequiredFieldIds.size - respondentMissingFieldIds.size} of {respondentRequiredFieldIds.size} required questions completed
                </p>
              ) : (
                <p className="mt-1 text-xs text-primary-800">Your responses are optional.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {respondentMissingFieldIds.size > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">
                  <AppIcon className="ri-error-warning-line"></AppIcon>
                  {respondentMissingFieldIds.size} required remaining
                </span>
              ) : respondentRequiredFieldIds.size > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
                  <AppIcon className="ri-checkbox-circle-line"></AppIcon>All required answered
                </span>
              ) : null}
              <button
                type="button"
                onClick={openRespondentQuestions}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
              >
                <AppIcon className="ri-arrow-down-line"></AppIcon>Open my questions
              </button>
            </div>
          </div>
        </div>
      )}
      {saveAnswersError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveAnswersError}</p>}

      <ReviewFormRenderer
        sections={definition.sections}
        answers={answers}
        onAnswerChange={handleAnswerChange}
        readOnly
        fieldReadOnly={field => !canWriteAnswers || !writableFieldIds.has(field.id)}
        respondentRole={viewerRole}
        openSectionId={openSectionId}
        onOpenSectionChange={setOpenSectionId}
      />

      <div ref={signatureSection} tabIndex={-1} aria-label="Signature step" className="scroll-mt-6 space-y-3 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        <ReviewSignatures signatures={definition.signatures} />
        <ReviewPdfDownload availability={definition.pdf} onDownload={onDownload} />
      {canSign && signatureOpen ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-busy={signing}>
          <p className="mb-3 text-sm font-bold text-violet-950">Your signature is required</p>
          {signatureError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{signatureError} You can try signing again.</p>}
          {signing && <p role="status" className="mb-3 text-sm text-violet-900">Saving your signature…</p>}
          {savedSignature && !drawingSignature ? (
            <div className="max-w-md rounded-xl border border-foreground-200 bg-white p-3">
              <p className="text-[12px] text-foreground-700">Saved signature for</p>
              <p className="mt-1 text-[13px] font-medium text-foreground-900">{signatoryName}</p>
              <img src={savedSignature} alt="Your saved signature" className="mt-3 max-h-24 w-full rounded-lg border border-foreground-100 bg-white object-contain p-3" />
              <p className="mt-3 text-[11px] text-foreground-500">Use this saved signature for this review, or draw a new one.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={signing} onClick={() => { void saveSignature(savedSignature); }} className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">
                  Use saved signature
                </button>
                <button type="button" disabled={signing} onClick={() => setDrawingSignature(true)} className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50">
                  Draw new signature
                </button>
                <button type="button" disabled={signing} onClick={() => setSignatureOpen(false)} className="rounded-xl border border-background-200 bg-white px-4 py-2.5 text-sm font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <fieldset disabled={signing} className="min-w-0 border-0 p-0">
              <SignaturePad signatoryName={signatoryName} onCommit={(signature) => { void saveSignature(signature); }} onCancel={() => { setSignatureOpen(false); setDrawingSignature(false); }} />
            </fieldset>
          )}
        </div>
      ) : null}
      {canSign && !signatureOpen && <button type="button" onClick={showSignatures} className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-800">Review &amp; sign</button>}
      </div>
    </section>
  );
}
