import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useAuth } from '@/hooks/useAuth';
import { saveSignature } from '@/api/savedSignature';
import type { ReviewDocument, ReviewSignature } from '@/api/reviewForm';
import {
  fetchCoachEnrolmentDocument,
  fetchCoachEnrolmentDocuments,
  signCoachEnrolmentDocument,
  type CoachEnrolmentDocumentsResponse,
} from '@/api/coachEnrolmentDocuments';
import { buildReviewPdf, downloadReviewPdf } from '@/pages/learner/onboarding/reviews/reviewDocument';
import { REVIEW_QUESTION_LABELS } from '@/pages/learner/onboarding/reviews/questions';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { btnPrimary, btnSecondary } from '@/pages/users/components/ui';
import { ReferencePanel } from '../components/CaseFilePrimitives';

/**
 * The learner's enrolment review documents: the coach views and downloads each,
 * and adds their coach signature (the review's staff sign-off) with their saved signature. Signing is final
 * here — there is no withdraw — so it asks for confirmation first.
 */
export function EnrolmentDocumentsTab({ learnerId }: { learnerId: string }) {
  const session = useCaseFileSession();
  const currentRead = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const { auth } = useAuth();
  const account = auth.account;
  const accountKey = account ? `${account.subjectType}:${account.subjectId}` : '';
  const [data, setData] = useState<CoachEnrolmentDocumentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingSignature, setCreatingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    if (!mounted.current) return;
    currentRead.current?.abort();
    const controller = new AbortController();
    currentRead.current = controller;
    setLoading(true);
    setError(null);
    (session ? session.read<CoachEnrolmentDocumentsResponse>('enrolment-documents', {}, { refresh, signal: controller.signal }) : fetchCoachEnrolmentDocuments(learnerId))
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [learnerId, session]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; currentRead.current?.abort(); };
  }, [load]);

  const saveNewSignature = async (dataUrl: string) => {
    setSignatureError(null);
    try {
      await saveSignature(accountKey, dataUrl);
      setCreatingSignature(false);
      load(true);
    } catch (e) {
      setSignatureError(e instanceof Error ? e.message : 'Could not save your signature.');
    }
  };

  const hasSignature = Boolean(data?.signature.saved);

  return (
    <div className="space-y-4">
      <ReferencePanel
        title="Enrolment Documents"
        subtitle="The learner's enrolment review documents. View or download each one, and add your coach signature once the review is complete."
        icon="ri-file-shield-2-line"
        tone="primary"
      >
        {loading && !data ? (
          <RowsSkeleton rows={3} />
        ) : error ? (
          <p className="text-[13px] text-red-600"><AppIcon className="ri-error-warning-line mr-1.5" />{error}</p>
        ) : !data || data.documents.length === 0 ? (
          <p className="text-[13px] text-foreground-500">No enrolment review documents yet. They appear here once a review has been started.</p>
        ) : (
          <>
            {!hasSignature && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                {creatingSignature ? (
                  <>
                    <SignaturePad
                      signatoryName={data.signature.name}
                      onCommit={saveNewSignature}
                      onCancel={() => setCreatingSignature(false)}
                    />
                    {signatureError && <p role="alert" className="mt-2 text-[12px] text-red-600">{signatureError}</p>}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-amber-800">
                      <AppIcon className="ri-pencil-line mr-1.5" />
                      Create your signature to sign these documents. It is saved to your account and used for every document you sign.
                    </p>
                    <button className={btnPrimary} onClick={() => setCreatingSignature(true)}>
                      <AppIcon className="ri-pencil-line" />Create your signature
                    </button>
                  </div>
                )}
              </div>
            )}
            <ul className="divide-y divide-foreground-100 rounded-xl border border-foreground-100">
              {data.documents.map((doc) => (
                <DocumentRow key={doc.eventKey} learnerId={learnerId} doc={doc} canSign={hasSignature} signerName={data.signature.name} onSigned={() => load(true)} />
              ))}
            </ul>
          </>
        )}
      </ReferencePanel>
    </div>
  );
}

function DocumentRow({ learnerId, doc, canSign, signerName, onSigned }: {
  learnerId: string;
  doc: ReviewDocument;
  canSign: boolean;
  signerName: string;
  onSigned: () => void;
}) {
  const [busy, setBusy] = useState<'view' | 'download' | 'sign' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { learner, admin, employer } = doc.signatures;
  const coachSigned = admin.signed;
  const signable = doc.completed && !coachSigned;

  const view = async () => {
    // Opened before the request so the browser treats it as the click's popup.
    const tab = window.open('', '_blank');
    setBusy('view');
    setErr(null);
    try {
      const form = await fetchCoachEnrolmentDocument(learnerId, doc.eventKey);
      const url = buildReviewPdf(form, REVIEW_QUESTION_LABELS).output('bloburl');
      if (tab) tab.location.href = String(url);
      else window.open(String(url), '_blank');
    } catch (e) {
      tab?.close();
      setErr(e instanceof Error ? e.message : 'Could not open the document.');
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy('download');
    setErr(null);
    try {
      downloadReviewPdf(await fetchCoachEnrolmentDocument(learnerId, doc.eventKey), REVIEW_QUESTION_LABELS);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not download the document.');
    } finally {
      setBusy(null);
    }
  };

  const sign = async () => {
    setBusy('sign');
    setErr(null);
    try {
      await signCoachEnrolmentDocument(learnerId, doc.eventKey);
      setConfirming(false);
      onSigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign the document.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground-900">{doc.label}</p>
          <p className="mt-0.5 text-[12px] text-foreground-500">
            {doc.scheduledDate ? `Review date ${formatDate(doc.scheduledDate)} · ` : ''}
            {doc.completed ? 'Review complete' : `In progress — ${doc.sectionsDone} of ${doc.sectionsTotal} sections`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <SignatureChip party="Learner" state={learner} />
            <SignatureChip party="Coach" state={admin} />
            {employer?.required !== false && employer && <SignatureChip party="Employer" state={employer} />}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button className={btnSecondary} onClick={view} disabled={busy !== null} aria-label={`View ${doc.label}`}>
            <AppIcon className={busy === 'view' ? 'ri-loader-4-line animate-spin' : 'ri-eye-line'} />View
          </button>
          <button className={btnSecondary} onClick={download} disabled={busy !== null} aria-label={`Download ${doc.label}`}>
            <AppIcon className={busy === 'download' ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'} />Download
          </button>
          {signable && (
            <button
              className={btnPrimary}
              onClick={() => setConfirming(true)}
              disabled={busy !== null || !canSign}
              title={canSign ? undefined : 'Create your signature first'}
              aria-label={`Sign ${doc.label}`}
            >
              <AppIcon className="ri-pencil-line" />Sign
            </button>
          )}
        </div>
      </div>

      {!doc.completed && !coachSigned && (
        <p className="mt-2 text-[12px] text-foreground-500">It can be signed once the review is complete.</p>
      )}

      {confirming && (
        <div role="dialog" aria-label={`Confirm signing ${doc.label}`} className="mt-3 rounded-lg border border-primary-200 bg-primary-50/60 p-3">
          <p className="text-[12px] text-foreground-700">
            Add your coach signature to <strong>{doc.label}</strong> as <strong>{signerName || 'you'}</strong>, using your saved
            signature? A signature cannot be withdrawn from here.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button className={btnPrimary} onClick={sign} disabled={busy !== null}>
              {busy === 'sign' ? <><AppIcon className="ri-loader-4-line animate-spin" />Signing…</> : <><AppIcon className="ri-check-line" />Sign document</>}
            </button>
            <button className={btnSecondary} onClick={() => setConfirming(false)} disabled={busy !== null}>Cancel</button>
          </div>
        </div>
      )}

      {err && <p role="alert" className="mt-2 text-[12px] text-red-600"><AppIcon className="ri-error-warning-line mr-1" />{err}</p>}
    </li>
  );
}

function SignatureChip({ party, state }: { party: string; state: ReviewSignature }) {
  return state.signed ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
      <AppIcon className="ri-check-line" />{party} signed{state.name ? ` — ${state.name}` : ''}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2 py-0.5 text-[11px] font-medium text-foreground-500 ring-1 ring-foreground-200">
      {party} not signed
    </span>
  );
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
