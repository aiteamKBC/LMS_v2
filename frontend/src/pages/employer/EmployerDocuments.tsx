// Readdy DocumentsTab composition. Signing/opening logic and API calls are
// unchanged from the original panel — only the presentation is ported.
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { getEnrolmentDocumentUrl } from '@/api/enrolmentDocuments';
import type { LearnerKind } from '@/api/extendedIlr';
import { signDocumentAsEmployer, signAgreementAsEmployer, signTrainingPlanAsEmployer, signWrittenAgreementAsEmployer, type EmployerDocumentRow, type SignableItem } from '@/api/employerPortal';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { Badge, secondaryButton, primaryButton } from './components/Presentation';

function fmt(value: string | null | undefined) {
  if (!value) return '—';
  // ISO timestamps render as a plain UK date; anything else is passed through.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB');
}

/**
 * The sign-off dialog for one document.
 *
 * The employer signs in their own name, set in a script face — there is nothing
 * to draw and nothing saved to pick from, because the same name always produces
 * the same mark.
 */
function SignModal({
  item,
  employerName,
  onClose,
  onSign,
}: {
  item: SignableItem;
  employerName: string;
  onClose: () => void;
  onSign: (name: string, signature: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (signature: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSign(signature ? employerName : '', signature);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the signature.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg mt-[5vh] mb-8 rounded-2xl bg-background-50 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-foreground-100 shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Sign as employer</h3>
            <p className="text-[12px] text-foreground-500 truncate" title={item.label}>{item.label}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 shrink-0">
            <i className="ri-close-line text-[18px]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <SignaturePad
            signatoryName={employerName}
            onCommit={(url) => { void submit(url); }}
            onCancel={onClose}
          />

          <p className="text-[11px] text-foreground-500 leading-relaxed">
            By signing you confirm the details recorded in this document are accurate.
            Your name, signature and the date are stored with it.
          </p>

          {err && <p className="text-[11px] text-red-600"><i className="ri-error-warning-line mr-1" />{err}</p>}

          {item.signed && (
            <button
              onClick={() => void submit('')}
              disabled={busy}
              className="text-[12px] font-semibold text-red-600 hover:underline disabled:opacity-60"
            >
              Remove signature
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Who has signed: one row per party, ticked when they have.
 *
 * Readdy's Documents card lists every party the document needs under a
 * "SIGNATURES x of y completed" heading. A party is omitted entirely when
 * undefined rather than shown unsigned — a compliance PDF only tracks the
 * employer's signature, and rendering an empty "Learner" row there would
 * imply a signature was expected and missing.
 */
function SignatureList({
  learner,
  admin,
  employer,
}: {
  learner?: boolean;
  admin?: boolean;
  employer?: boolean;
}) {
  const parties = [
    { key: 'learner', label: 'Learner', signed: learner },
    { key: 'employer', label: 'Employer', signed: employer },
    { key: 'admin', label: 'Provider / Coach', signed: admin },
  ].filter((p) => p.signed !== undefined);
  const completed = parties.filter((p) => p.signed).length;

  return (
    <div className="min-w-[13rem] rounded-lg border border-background-200 bg-background-100/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Signatures</p>
        <p className="text-xs font-medium text-foreground-600">{completed} of {parties.length} completed</p>
      </div>
      <div className="mt-2 space-y-1.5">
        {parties.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground-700">{p.label}</span>
            <span className={`inline-flex items-center gap-1 font-medium ${p.signed ? 'text-emerald-600' : 'text-foreground-400'}`}>
              <i className={p.signed ? 'ri-checkbox-circle-fill' : 'ri-radio-button-line'} aria-hidden="true" />
              {p.signed ? 'Signed' : 'Awaiting'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One document card, ported from Readdy's DocumentCard. */
function DocumentCard({
  item,
  onSign,
  onShow,
  opening,
}: {
  item: SignableItem;
  onSign: () => void;
  onShow: () => void;
  opening: boolean;
}) {
  const isReview = item.kind === 'review';
  const typeLabel = isReview ? 'Progress Review' : item.kind === 'agreement' ? 'Agreement' : item.kind === 'training-plan' ? 'Training Plan' : item.kind === 'written-agreement' ? 'Agreement' : 'Document';
  return (
    <li className="rounded-lg border border-background-200 bg-background-50 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
            <i className={`${isReview ? 'ri-file-list-3-line' : 'ri-file-text-line'} text-lg`} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground-950" title={item.label}>{item.label}</h3>
            <p className="mt-0.5 text-xs text-foreground-500">{typeLabel}</p>
            <p className="mt-1 text-xs text-foreground-500">
              {isReview
                ? item.scheduledDate ? `Scheduled ${fmt(item.scheduledDate)}` : 'Not yet scheduled'
                : `Created ${fmt(item.generatedAt)}`}
              {item.signed && item.signedAt ? ` · Signed ${fmt(item.signedAt)}` : ''}
            </p>
            <div className="mt-2">
              {item.signed
                ? <Badge><i className="ri-checkbox-circle-line" aria-hidden="true" />Completed</Badge>
                : item.signable
                  ? <Badge><i className="ri-quill-pen-line" aria-hidden="true" />Awaiting employer signature</Badge>
                  : <Badge><i className="ri-time-line" aria-hidden="true" />Awaiting completion by the learner</Badge>}
            </div>
          </div>
        </div>

        {/* Every party the item needs, so the employer can see they aren't the
            only one outstanding. Reviews report all three; a compliance PDF
            reports the parties its own doc type asks for — the Apprenticeship
            Agreement is learner + employer, with no provider signature. */}
        {isReview ? (
          <SignatureList learner={item.learnerSigned} admin={item.adminSigned} employer={item.signed} />
        ) : (
          <SignatureList
            learner={item.parties?.includes('learner') ? Boolean(item.learnerSigned) : undefined}
            admin={item.parties?.includes('provider') ? Boolean(item.providerSigned) : undefined}
            employer={item.parties?.includes('employer') !== false ? item.signed : undefined}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-background-200 pt-3">
        {item.signed ? (
          // Opens the saved document — the signed artefact, carrying every
          // party's signature. Not the sign dialog: this row is done, and
          // re-opening the pad here invited an accidental re-sign.
          <button type="button" onClick={onShow} disabled={opening} className={secondaryButton}>
            {opening ? <><i className="ri-loader-4-line animate-spin" aria-hidden="true" />Opening…</> : <><i className="ri-file-text-line" aria-hidden="true" />View</>}
          </button>
        ) : item.signable ? (
          <>
            <button type="button" onClick={onSign} className={primaryButton}><i className="ri-quill-pen-line" aria-hidden="true" />Review &amp; Sign</button>
            <button type="button" onClick={onShow} disabled={opening} className={secondaryButton}>
              {opening ? <><i className="ri-loader-4-line animate-spin" aria-hidden="true" />Opening…</> : 'View'}
            </button>
          </>
        ) : (
          <span className="text-xs italic text-foreground-500">Awaiting completion by the learner</span>
        )}
      </div>
    </li>
  );
}


export function EmployerDocuments({ documents, employerName, kind, learnerId, onReload }: {
  documents: EmployerDocumentRow[];
  employerName: string;
  kind: LearnerKind;
  learnerId: string;
  onReload: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [signing, setSigning] = useState<EmployerDocumentRow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const sorted = [...documents].sort((a, b) => {
    if (a.signed !== b.signed) return a.signed ? 1 : -1;
    if (a.signable !== b.signable) return a.signable ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  const outstanding = documents.filter(item => item.signable && !item.signed).length;
  const handleSign = async (name: string, signature: string) => {
    if (!signing) return;
    if (signing.kind === 'written-agreement') {
      await signWrittenAgreementAsEmployer(learnerId, { name, signature });
    } else if (signing.kind === 'training-plan') {
      await signTrainingPlanAsEmployer(learnerId, { name, signature });
    } else if (signing.kind === 'agreement') {
      await signAgreementAsEmployer(learnerId, { name, signature });
    } else {
      await signDocumentAsEmployer(kind, learnerId, signing.id, { name, signature });
    }
    success(signature ? 'Signed' : 'Signature removed', signing.label);
    onReload();
  };
  const openDocument = async (item: EmployerDocumentRow) => {
    setOpening(item.id);
    try {
      const url = await getEnrolmentDocumentUrl(kind, learnerId, item.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      toastError('Could not open the document', reason instanceof Error ? reason.message : 'Unexpected error');
    } finally {
      setOpening(null);
    }
  };
  const signedCount = documents.filter(item => item.signed).length;
  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold text-foreground-950">Documents</h2>
      <p className="mt-1 text-sm text-foreground-600">View, review and sign documents shared with you for this learner.</p>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-background-200 bg-background-50 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Documents</p>
        <p className="mt-0.5 text-2xl font-bold text-foreground-950">{documents.length}</p>
      </div>
      <div className={`rounded-lg border px-4 py-3 ${outstanding > 0 ? 'border-accent-300 bg-accent-50' : 'border-background-200 bg-background-50'}`}>
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${outstanding > 0 ? 'text-accent-800' : 'text-foreground-500'}`}>Awaiting Action</p>
        <p className="mt-0.5 text-2xl font-bold text-foreground-950">{outstanding}</p>
      </div>
      <div className="rounded-lg border border-background-200 bg-background-50 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Signed</p>
        <p className="mt-0.5 text-2xl font-bold text-foreground-950">{signedCount}</p>
      </div>
    </div>
    {sorted.length === 0 ? (
      <div className="rounded-lg border border-background-200 bg-background-50 p-8 text-center">
        <i className="ri-folder-open-line text-2xl text-foreground-400" aria-hidden="true" />
        <p className="mt-2 text-sm text-foreground-600">No documents need your signature yet. They appear here once the provider has prepared them.</p>
      </div>
    ) : (
      <ul className="space-y-3">
        {sorted.map(item => <DocumentCard key={`d-${item.id}`} item={item} onSign={() => setSigning(item)} onShow={() => void openDocument(item)} opening={opening === item.id} />)}
      </ul>
    )}
    {signing && <SignModal item={signing} employerName={employerName} onClose={() => setSigning(null)} onSign={handleSign} />}
  </div>;
}
