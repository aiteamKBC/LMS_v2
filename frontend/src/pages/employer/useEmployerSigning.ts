import { useEffect, useState } from 'react';
import {
  fetchEmployerReviewInstance,
  saveEmployerReviewAnswers,
  signAgreementAsEmployer,
  signDocumentAsEmployer,
  signReviewAsEmployer,
  signTrainingPlanAsEmployer,
  signWrittenAgreementAsEmployer,
  type SignableItem,
} from '@/api/employerPortal';
import { fetchReviewForm } from '@/api/reviewForm';
import { getEnrolmentDocumentUrl } from '@/api/enrolmentDocuments';
import type { LearnerKind } from '@/api/extendedIlr';
import { useToast } from '@/hooks/useToast';
import { downloadReviewPdf } from '@/pages/learner/onboarding/reviews/reviewDocument';
import { REVIEW_QUESTION_LABELS } from '@/pages/learner/onboarding/reviews/questions';

/** One signable item and the learner it belongs to. */
export type SigningTarget = { item: SignableItem; kind: LearnerKind; learnerId: string };

/** Reviews are keyed by event key and documents by id; the learner keeps keys unique across learners. */
export function targetKey({ item, kind, learnerId }: SigningTarget) {
  return `${kind}:${learnerId}:${item.kind === 'review' ? `r-${item.eventKey}` : `d-${item.id}`}`;
}

/** Unsigned first, then signable-but-unsigned before blocked ones, so the row an employer can act on leads. */
export function compareSignable(a: SignableItem, b: SignableItem) {
  if (a.signed !== b.signed) return a.signed ? 1 : -1;
  if (a.signable !== b.signable) return a.signable ? -1 : 1;
  return a.label.localeCompare(b.label);
}

/**
 * Signing and opening an employer's documents, for any of their learners.
 *
 * `onSigned` runs after a signature is saved or withdrawn, so the caller can
 * reload the list it came from.
 */
export function useEmployerSigning(employerId: string, onSigned: () => void) {
  const { success, error: toastError } = useToast();
  const [signing, setSigning] = useState<SigningTarget | null>(null);
  const [reviewDefinition, setReviewDefinition] = useState<any>(null);
  // Which row is mid-open, so its button can show progress.
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    const item = signing?.item;
    if (!signing || item?.kind !== 'review' || !item.reviewInstanceId) {
      setReviewDefinition(null);
      return;
    }
    let active = true;
    fetchEmployerReviewInstance(employerId, signing.kind, signing.learnerId, item.eventKey)
      .then(value => { if (active) setReviewDefinition(value); })
      .catch(() => { if (active) setReviewDefinition(null); });
    return () => { active = false; };
  }, [employerId, signing]);

  const sign = async (name: string, signature: string) => {
    if (!signing) return;
    const { item, kind, learnerId } = signing;
    if (item.kind === 'review') {
      await signReviewAsEmployer(employerId, kind, learnerId, item.eventKey, { name, signature });
    } else if (item.kind === 'written-agreement') {
      await signWrittenAgreementAsEmployer(learnerId, { name, signature });
    } else if (item.kind === 'training-plan') {
      await signTrainingPlanAsEmployer(learnerId, { name, signature });
    } else if (item.kind === 'agreement') {
      // Its own table, its own endpoint — see apprenticeship_agreement.py.
      await signAgreementAsEmployer(learnerId, { name, signature });
    } else {
      await signDocumentAsEmployer(kind, learnerId, item.id, { name, signature });
    }
    // No reusable copy is kept: the employer's name always produces the same
    // mark, so there is nothing to save and nothing to go stale.
    success(signature ? 'Signed' : 'Signature removed', item.label);
    onSigned();
  };

  /**
   * Open the saved document itself — the signed artefact, not the sign dialog.
   *
   * A review is rendered client-side into the same PDF the admin board exports
   * (so it carries the Declaration block with every signature on it), while a
   * compliance PDF already exists in blob storage and just needs a download URL.
   */
  const openDocument = async (target: SigningTarget) => {
    const { item, kind, learnerId } = target;
    setOpening(targetKey(target));
    try {
      if (item.kind === 'review') {
        const review = await fetchReviewForm(kind, learnerId, item.eventKey);
        downloadReviewPdf(review, REVIEW_QUESTION_LABELS);
      } else {
        const url = await getEnrolmentDocumentUrl(kind, learnerId, item.id);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      toastError('Could not open the document', e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setOpening(null);
    }
  };

  const signingItem = signing?.item;
  const saveReviewAnswers = signing && signingItem?.kind === 'review'
    ? (answers: Record<string, unknown>) =>
        saveEmployerReviewAnswers(employerId, signing.kind, signing.learnerId, signingItem.eventKey, answers)
    : undefined;

  return {
    signing,
    startSigning: setSigning,
    closeSigning: () => setSigning(null),
    reviewDefinition,
    opening,
    sign,
    openDocument,
    saveReviewAnswers,
  };
}
