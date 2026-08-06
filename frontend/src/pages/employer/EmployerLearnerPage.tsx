import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchEmployerLearner,
  saveEmployerSignature,
  signDocumentAsEmployer,
  signAgreementAsEmployer,
  signReviewAsEmployer,
  type EmployerLearnerDetail,
  type SavedSignature,
  type SignableItem,
} from '@/api/employerPortal';
import { fetchReviewForm } from '@/api/reviewForm';
import { getEnrolmentDocumentUrl } from '@/api/enrolmentDocuments';
import type { LearnerKind } from '@/api/extendedIlr';
import { downloadReviewPdf } from '@/pages/learner/onboarding/reviews/reviewDocument';
import { REVIEW_QUESTION_LABELS } from '@/pages/learner/onboarding/reviews/questions';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { Hero, SectionPanel, FieldRow, StatCard, btnPrimary, btnSecondary } from '@/pages/users/components/ui';

// ============================================================================
// One learner, as their employer sees them.
//
// Shows both halves always — the learner's details and performance, and the
// documents needing this employer's signature. Programme status only decides
// which comes first: an Active learner leads with performance (their paperwork is
// done or nearly so), anyone still being set up leads with the paperwork.
// Unsigned documents are pinned above signed ones either way.
//
// Signing reuses the admin side's flow exactly: the same SignaturePad, and for
// reviews the same sign endpoint with party="employer". The employer's saved
// signature is offered as the default so they confirm it once, not per document —
// mirroring how a learner reuses the mark captured during enrolment.
// ============================================================================

const employerNav = roleNavMap.apprentice;

function fmt(value: string | null | undefined) {
  if (!value) return '—';
  // ISO timestamps render as a plain UK date; anything else is passed through.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB');
}

/**
 * The sign-off dialog for one document.
 *
 * The saved signature is the default path and typing a name is the fallback, which is
 * the same arrangement SignReviewModal uses on the learner/admin side.
 */
function SignModal({
  item,
  saved,
  defaultName,
  onClose,
  onSign,
}: {
  item: SignableItem;
  saved: SavedSignature;
  defaultName: string;
  onClose: () => void;
  onSign: (name: string, signature: string, remember: boolean) => Promise<void>;
}) {
  const savedSignature = saved.signature ?? '';
  const [name, setName] = useState(item.signedName || saved.name || defaultName);
  const [signature, setSignature] = useState(item.signed ? '' : savedSignature);
  const [editing, setEditing] = useState(!savedSignature && !item.signed);
  const [remember, setRemember] = useState(!savedSignature);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const usingSaved = !!savedSignature && signature === savedSignature;

  const submit = async (clear = false) => {
    if (busy) return;
    if (!clear && (!signature || !name.trim())) {
      setErr('Add your name and a signature first.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSign(clear ? '' : name.trim(), clear ? '' : signature, !clear && remember);
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
          <label className="block">
            <span className="text-[12px] text-foreground-700 block mb-1">Full name <span className="text-red-500">*</span></span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2.5 py-2 text-[13px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40"
            />
          </label>

          <div>
            <p className="text-[12px] text-foreground-700 mb-2">Employer signature <span className="text-red-500">*</span></p>
            {editing ? (
              <>
                <SignaturePad
                  onCommit={(url) => { setSignature(url); setEditing(false); }}
                  onCancel={() => setEditing(false)}
                />
                {savedSignature && (
                  <button
                    onClick={() => { setSignature(savedSignature); setEditing(false); }}
                    className="text-[12px] text-primary-600 hover:underline inline-flex items-center gap-1 mt-2"
                  >
                    <i className="ri-arrow-go-back-line" />Use my saved signature instead
                  </button>
                )}
              </>
            ) : signature ? (
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <img src={signature} alt="Employer signature" className="h-16 max-w-[280px] object-contain px-3 py-2 border border-foreground-200 rounded-lg bg-white" />
                  <button onClick={() => setEditing(true)} className="text-[12px] text-primary-600 hover:underline inline-flex items-center gap-1">
                    <i className="ri-pen-nib-line" />Sign with a different name
                  </button>
                </div>
                {usingSaved && (
                  <p className="text-[11px] text-emerald-700 mt-1.5">
                    <i className="ri-check-line mr-1" />Using your saved signature
                    {saved.date ? ` (${fmt(saved.date)})` : ''}.
                  </p>
                )}
                {!usingSaved && (
                  <label className="flex items-center gap-2 text-[12px] text-foreground-600 mt-2 cursor-pointer">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-primary-500" />
                    Save this signature for next time
                  </label>
                )}
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="w-full h-24 border-2 border-dashed border-foreground-200 rounded-lg flex flex-col items-center justify-center text-foreground-400 hover:border-primary-300 hover:text-primary-500"
              >
                <i className="ri-pen-nib-line text-2xl mb-1" />
                <span className="text-[12px]">Add a signature</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-foreground-500 leading-relaxed">
            By signing you confirm the details recorded in this document are accurate.
            Your name, signature and the date are stored with it.
          </p>

          {err && <p className="text-[11px] text-red-600"><i className="ri-error-warning-line mr-1" />{err}</p>}
        </div>

        <footer className="flex items-center justify-between gap-2 px-5 py-4 border-t border-foreground-100 shrink-0">
          {item.signed ? (
            <button onClick={() => submit(true)} disabled={busy} className="text-[12px] font-semibold text-red-600 hover:underline disabled:opacity-60">
              Remove signature
            </button>
          ) : <span />}
          <span className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className={btnSecondary}>Cancel</button>
            <button onClick={() => submit()} disabled={busy} className={btnPrimary}>
              {busy ? <><i className="ri-loader-4-line animate-spin" />Signing…</> : <><i className="ri-pen-nib-line" />Sign</>}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}

/**
 * Who has signed: one chip per party, ticked when they have.
 *
 * Mirrors the admin board's SignatureParties so both sides read the same way. A
 * party is omitted entirely when undefined rather than shown unsigned — a
 * compliance PDF only tracks the employer's signature, and rendering an empty
 * "Learner" cell there would imply a signature was expected and missing.
 */
function PartyChips({
  learner,
  admin,
  employer,
}: {
  learner?: boolean;
  admin?: boolean;
  employer?: boolean;
}) {
  const parties = [
    { key: 'learner', label: 'Learner', icon: 'ri-user-line', signed: learner },
    { key: 'admin', label: 'Provider', icon: 'ri-shield-user-line', signed: admin },
    { key: 'employer', label: 'You', icon: 'ri-briefcase-line', signed: employer },
  ].filter((p) => p.signed !== undefined);

  return (
    <span className="flex items-center gap-1.5">
      {parties.map((p) => (
        <span
          key={p.key}
          title={p.signed ? `${p.label} signed` : `${p.label} has not signed yet`}
          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${
            p.signed
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
              : 'bg-background-100 text-foreground-400 border-foreground-200/60'
          }`}
        >
          <i className={`${p.signed ? 'ri-check-line' : p.icon} text-[11px]`} />
          <span className="hidden sm:inline">{p.label}</span>
        </span>
      ))}
    </span>
  );
}

/** One row in the documents panel. */
function DocumentRow({
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
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
      <span className="flex items-center gap-2.5 min-w-0">
        <i className={`${item.kind === 'review' ? 'ri-file-list-3-line' : 'ri-file-pdf-line'} text-foreground-400 shrink-0`} />
        <span className="min-w-0">
          <span className="text-[13px] text-foreground-800 font-medium block truncate" title={item.label}>{item.label}</span>
          <span className="text-[11px] text-foreground-400">
            {item.kind === 'review'
              ? item.scheduledDate ? `Review · ${item.scheduledDate}` : 'Review'
              : `Document · ${fmt(item.generatedAt)}`}
            {item.signed && item.signedName ? ` · signed by ${item.signedName} on ${fmt(item.signedAt)}` : ''}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {/* Every party the item needs, so the employer can see they aren't the
            only one outstanding. Reviews report all three; a compliance PDF
            reports the parties its own doc type asks for — the Apprenticeship
            Agreement is learner + employer, with no provider signature. */}
        {item.kind === 'review' ? (
          <PartyChips
            learner={item.learnerSigned}
            admin={item.adminSigned}
            employer={item.signed}
          />
        ) : (
          <PartyChips
            learner={item.parties?.includes('learner') ? Boolean(item.learnerSigned) : undefined}
            employer={item.parties?.includes('employer') !== false ? item.signed : undefined}
          />
        )}
        {item.signed ? (
          <>
            {/* Opens the saved document — the signed artefact, carrying every
                party's signature. Not the sign dialog: this row is done, and
                re-opening the pad here invited an accidental re-sign. */}
            <button
              onClick={onShow}
              disabled={opening}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[12px] font-medium text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {opening
                ? <><i className="ri-loader-4-line animate-spin" />Opening…</>
                : <><i className="ri-file-text-line text-[13px]" />Show document</>}
            </button>
          </>
        ) : item.signable ? (
          <button
            onClick={onSign}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700 transition-smooth cursor-pointer"
          >
            <i className="ri-pen-nib-line" />Sign
          </button>
        ) : (
          // A review whose questionnaire isn't finished can't be signed by
          // anyone yet — saying so beats an inert button.
          <span className="text-[11px] text-foreground-400 italic">Awaiting completion by the learner</span>
        )}
      </span>
    </div>
  );
}

export default function EmployerLearnerPage() {
  const { employerId = '', kind: kindParam = 'apprenticeship', learnerId = '' } = useParams();
  // The URL segment is a plain string; the document APIs want the narrowed union.
  const kind: LearnerKind = kindParam === 'commercial' ? 'commercial' : 'apprenticeship';
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<EmployerLearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<SignableItem | null>(null);
  // Which row is mid-open, so its button can show progress. Reviews are keyed by
  // event key and documents by id — they never collide.
  const [opening, setOpening] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEmployerLearner(employerId, kind, learnerId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [employerId, kind, learnerId]);

  const handleSign = async (name: string, signature: string, remember: boolean) => {
    if (!signing) return;
    if (signing.kind === 'review') {
      await signReviewAsEmployer(kind, learnerId, signing.eventKey, { name, signature });
    } else if (signing.kind === 'agreement') {
      // Its own table, its own endpoint — see apprenticeship_agreement.py.
      await signAgreementAsEmployer(learnerId, { name, signature });
    } else {
      await signDocumentAsEmployer(kind, learnerId, signing.id, { name, signature });
    }
    // Saving the reusable signature is secondary — a failure here must not look
    // like the document itself failed to sign, so it's deliberately swallowed.
    if (remember && signature) {
      try {
        await saveEmployerSignature(employerId, { signature, name });
      } catch { /* the document is signed; the convenience copy just isn't kept */ }
    }
    success(signature ? 'Signed' : 'Signature removed', signing.label);
    load();
  };

  /**
   * Open the saved document itself — the signed artefact, not the sign dialog.
   *
   * A review is rendered client-side into the same PDF the admin board exports
   * (so it carries the Declaration block with every signature on it), while a
   * compliance PDF already exists in blob storage and just needs a download URL.
   */
  const openDocument = async (item: SignableItem) => {
    setOpening(item.kind === 'review' ? item.eventKey : item.id);
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

  const learner = data?.learner;
  const items: SignableItem[] = data ? [...data.reviews, ...data.documents] : [];
  // Unsigned first, then signable-but-unsigned before blocked ones, so the row
  // an employer can actually act on is always at the top.
  const sorted = [...items].sort((a, b) => {
    if (a.signed !== b.signed) return a.signed ? 1 : -1;
    if (a.signable !== b.signable) return a.signable ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  const outstanding = data?.outstandingCount ?? 0;
  // Active learners lead with performance; anyone still being set up leads with
  // the paperwork. Both panels always render.
  const documentsFirst = !learner?.isActive || outstanding > 0;

  const documentsPanel = (
    <SectionPanel
      title={outstanding > 0 ? `Documents to sign (${outstanding} outstanding)` : 'Documents'}
      icon="ri-draft-line"
      defaultOpen
    >
      {sorted.length === 0 ? (
        <p className="text-[13px] text-foreground-400 py-2">
          No documents need your signature yet. They appear here once the provider has prepared them.
        </p>
      ) : (
        <div className="divide-y divide-foreground-100 -mx-4 -my-1">
          {sorted.map((item) => (
            <DocumentRow
              key={item.kind === 'review' ? `r-${item.eventKey}` : `d-${item.id}`}
              item={item}
              onSign={() => setSigning(item)}
              onShow={() => openDocument(item)}
              opening={opening === (item.kind === 'review' ? item.eventKey : item.id)}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  );

  const performancePanel = (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard icon="ri-question-answer-line" label="Quizzes taken" value={data?.performance.quizzesTaken ?? 0} tint="primary" />
        <StatCard icon="ri-check-double-line" label="Quizzes passed" value={data?.performance.quizzesPassed ?? 0} tint="emerald" />
        <StatCard
          icon="ri-percent-line"
          label="Average score"
          value={data?.performance.averageScore != null ? `${data.performance.averageScore}%` : '—'}
          tint="accent"
        />
        <StatCard icon="ri-award-line" label="KSBs evidenced" value={data?.performance.ksbsEvidenced ?? 0} tint="secondary" />
      </div>

      <SectionPanel title="Learner details" icon="ri-user-3-line" defaultOpen>
        <FieldRow readonly label="Email" value={learner?.email || '—'} />
        <FieldRow readonly label="Phone" value={learner?.phone || '—'} />
        <FieldRow readonly label="Programme" value={learner?.programme || '—'} />
        <FieldRow readonly label="Cohort" value={learner?.cohort || '—'} />
        <FieldRow readonly label="Programme status" value={learner?.programmeStatus || '—'} />
        <FieldRow readonly label="Start date" value={learner?.startDate || '—'} />
        <FieldRow readonly label="End date" value={learner?.endDate || '—'} />
      </SectionPanel>

      <SectionPanel title="Progress" icon="ri-line-chart-line" defaultOpen>
        <FieldRow readonly label="Components completed" value={String(data?.performance.componentsCompleted ?? 0)} />
        <FieldRow readonly label="Off-the-job hours logged" value={data?.performance.completedHours || '—'} />
        <FieldRow readonly label="Last activity" value={fmt(data?.performance.lastActivityAt)} />
      </SectionPanel>
    </>
  );

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={employerNav.label}
      navItems={employerNav.items}
      workspaceLabel={employerNav.workspaceLabel}
      pageTitle="Learner"
      pageSubtitle={learner?.name ?? 'Learner'}
      userName="Enrolment Officer"
      userRole="Enrolment Officer"
    >
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-user-3-line"
            title={learner?.name || 'Learner'}
            subtitle={
              learner
                ? <>
                    {learner.programme || 'No programme'}
                    {learner.cohort ? ` · ${learner.cohort}` : ''}
                    {` · ${learner.programmeStatus || 'Status not set'}`}
                  </>
                : undefined
            }
            right={
              <button
                onClick={() => navigate(`/employers/${employerId}`)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/15 backdrop-blur-sm border border-white/25 text-white rounded-xl text-[13px] font-semibold hover:bg-white/25 transition-smooth cursor-pointer"
              >
                <i className="ri-arrow-left-line" />All learners
              </button>
            }
          />
        </div>

        {loading && (
          <p className="py-16 text-center text-[13px] text-foreground-400">
            <i className="ri-loader-4-line animate-spin mr-2" />Loading learner…
          </p>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-4">
            {outstanding > 0 && (
              <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 flex items-center gap-2.5">
                <i className="ri-error-warning-line text-amber-600 shrink-0" />
                <p className="text-[13px] text-amber-900">
                  <strong>{outstanding} document{outstanding === 1 ? '' : 's'}</strong> need your signature.
                </p>
              </div>
            )}
            {documentsFirst
              ? <>{documentsPanel}{performancePanel}</>
              : <>{performancePanel}{documentsPanel}</>}
          </div>
        )}
      </div>

      {signing && data && (
        <SignModal
          item={signing}
          saved={data.employer.savedSignature}
          defaultName={data.employer.name}
          onClose={() => setSigning(null)}
          onSign={handleSign}
        />
      )}
    </WorkspaceShell>
  );
}
