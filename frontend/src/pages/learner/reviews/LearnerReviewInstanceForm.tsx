import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { fetchLearnerEventReviewInstance, type LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { LearnerKind } from '@/api/learnerDetail';
import { flattenReviewFields, type ReviewParticipantRole } from '@/api/reviewInstances';
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

const SIGNATURE_LABELS: Record<ReviewParticipantRole, string> = {
  advisor: 'Coach',
  employer: 'Employer',
  participant: 'Learner',
  referrer: 'Referrer',
};

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
  const signingInFlight = useRef(false);

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

  const requiredSignatures = useMemo(
    () => (Object.entries(definition.signatures) as Array<[ReviewParticipantRole, { required: boolean; signed: boolean; signedName?: string | null; signedAt?: string | null }]>)
      .filter(([, state]) => state.required),
    [definition.signatures],
  );

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

      <ReviewFormRenderer
        sections={definition.sections}
        answers={answers}
        onAnswerChange={() => undefined}
        readOnly
        openSectionId={openSectionId}
        onOpenSectionChange={setOpenSectionId}
      />

      {requiredSignatures.length > 0 ? (
        <div className="rounded-2xl border border-background-200 bg-background-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">Signatures</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {requiredSignatures.map(([role, state]) => (
              <div key={role} className="flex items-center gap-2.5 rounded-xl bg-background-100 px-3.5 py-2.5">
                <AppIcon className={state.signed ? 'ri-checkbox-circle-line text-emerald-600' : 'ri-time-line text-amber-600'} />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-foreground-400">{SIGNATURE_LABELS[role] || role}</p>
                  <p className="truncate text-xs font-bold text-foreground-800">
                    {state.signed ? state.signedName || 'Signed' : 'Awaiting signature'}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {onSign && definition.signatures.participant?.required && !definition.signatures.participant.signed &&
            !['awaiting-signature', 'completed'].includes(definition.instance?.status || '') ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800">
              The coach must complete this review before you can sign it.
            </p>
          ) : null}
        </div>
      ) : null}
      {onSign && definition.signatures.participant?.required && !definition.signatures.participant.signed &&
        ['awaiting-signature', 'completed'].includes(definition.instance?.status || '') ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-busy={signing}>
          <p className="mb-3 text-sm font-bold text-violet-950">Your signature is required</p>
          {signatureError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{signatureError} You can try signing again.</p>}
          {signing && <p role="status" className="mb-3 text-sm text-violet-900">Saving your signature…</p>}
          <fieldset disabled={signing} className="min-w-0 border-0 p-0">
            <SignaturePad signatoryName={signatoryName} onCommit={(signature) => { void saveSignature(signature); }} onCancel={() => undefined} />
          </fieldset>
        </div>
      ) : null}
    </section>
  );
}
