import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { ReviewSignatures } from '@/components/reviews/ReviewSignatures';
import { fetchLearnerEventReviewInstance, type LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { LearnerKind } from '@/api/learnerDetail';
import { flattenReviewFields } from '@/api/reviewInstances';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';

/**
 * The learner's half of the ONE Curriculum-driven Review form.
 *
 * Coach opens a Review instance through ReviewInstanceModal; the learner reads
 * the very same `review_instance_form_definition` here and hands it to the very
 * same ReviewFormRenderer. Neither side owns a per-Review-type form: sections,
 * fields, conditional fields, required rules and signatures all arrive from the
 * Curriculum template the occurrence was generated from.
 *
 * Read-only on purpose. The Review belongs to the coach's record of the
 * meeting: the learner sees what was authored and answered, and signs through
 * the page's existing signature flow, but never writes answers here.
 */

export interface LearnerReviewInstanceState {
  definition: LearnerReviewDefinition | null;
  loading: boolean;
  error: string;
  refresh: () => void;
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

export function LearnerReviewInstanceForm({ definition, onSign, signatoryName = 'Learner' }: { definition: LearnerReviewDefinition; onSign?: (signature: string) => Promise<void>; signatoryName?: string }) {
  const [openSectionId, setOpenSectionId] = useState('');
  const [signing, setSigning] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [signatureOpen, setSignatureOpen] = useState(true);
  const signingInFlight = useRef(false);
  const signatureSection = useRef<HTMLDivElement>(null);

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

  // The renderer draws from `answers`, not from the field rows, so the saved
  // answers are seeded the same way ReviewInstanceModal seeds them.
  const answers = useMemo(() => {
    const saved: Record<string, unknown> = {};
    for (const field of flattenReviewFields(definition.sections)) {
      if (field.answer !== undefined && field.answer !== null) saved[field.id] = field.answer;
    }
    return saved;
  }, [definition]);

  const requiredSignatures = Object.values(definition.signatures).filter(state => state.required);
  const submitted = ['awaiting-signature', 'completed'].includes(definition.instance?.status || '');
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

      <ReviewFormRenderer
        sections={definition.sections}
        answers={answers}
        onAnswerChange={() => undefined}
        readOnly
        openSectionId={openSectionId}
        onOpenSectionChange={setOpenSectionId}
      />

      <div ref={signatureSection} tabIndex={-1} aria-label="Signature step" className="scroll-mt-6 space-y-3 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        <ReviewSignatures signatures={definition.signatures} />
      {canSign && signatureOpen ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-busy={signing}>
          <p className="mb-3 text-sm font-bold text-violet-950">Your signature is required</p>
          {signatureError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{signatureError} You can try signing again.</p>}
          {signing && <p role="status" className="mb-3 text-sm text-violet-900">Saving your signature…</p>}
          <fieldset disabled={signing} className="min-w-0 border-0 p-0">
            <SignaturePad signatoryName={signatoryName} onCommit={(signature) => { void saveSignature(signature); }} onCancel={() => setSignatureOpen(false)} />
          </fieldset>
        </div>
      ) : null}
      {canSign && !signatureOpen && <button type="button" onClick={showSignatures} className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-800">Review &amp; sign</button>}
      </div>
    </section>
  );
}
