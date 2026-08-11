import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchEmployerLearner,
  fetchEmployerLearnerPlan,
  signDocumentAsEmployer,
  signAgreementAsEmployer,
  signTrainingPlanAsEmployer,
  signWrittenAgreementAsEmployer,
  signReviewAsEmployer,
  type EmployerLearnerDetail,
  type SignableItem,
} from '@/api/employerPortal';
import { fetchReviewForm } from '@/api/reviewForm';
import { getEnrolmentDocumentUrl } from '@/api/enrolmentDocuments';
import type { LearnerKind } from '@/api/extendedIlr';
import { downloadReviewPdf } from '@/pages/learner/onboarding/reviews/reviewDocument';
import { REVIEW_QUESTION_LABELS } from '@/pages/learner/onboarding/reviews/questions';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { Hero, SectionPanel, FieldRow, StatCard, btnPrimary, btnSecondary } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { LearnerPlanBody } from '@/components/feature/RealLearnerPlanView';
import { OtjhBody } from '@/components/feature/RealOtjhView';
import { KsbProgressBody } from '@/components/feature/RealKsbView';

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
            admin={item.parties?.includes('provider') ? Boolean(item.providerSigned) : undefined}
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

/**
 * The page is one learner seen four ways. Overview is the employer's own
 * business — details and the signing queue; the other three are the learner's
 * workspace shown read-only, so employer and apprentice discuss the same plan,
 * the same hours and the same KSBs rather than two different pictures of them.
 */
type TabKey = 'overview' | 'plan' | 'otjh' | 'ksbs';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { key: 'plan', label: 'Learning plan', icon: 'ri-calendar-check-line' },
  { key: 'otjh', label: 'Off-the-job hours', icon: 'ri-time-line' },
  { key: 'ksbs', label: 'KSB progress', icon: 'ri-award-line' },
];

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
  const [tab, setTab] = useState<TabKey>('overview');
  // The learner's own workspace payload, behind the three progress tabs. Fetched
  // once, on first use: an employer who only came to sign a document never pays
  // for it, and all three tabs read the same object afterwards.
  const [plan, setPlan] = useState<LearnerDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
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

  const loadPlan = () => {
    setPlanLoading(true);
    setPlanError(null);
    fetchEmployerLearnerPlan(employerId, kind, learnerId)
      .then(setPlan)
      .catch((e: Error) => setPlanError(e.message))
      .finally(() => setPlanLoading(false));
  };

  // Only when a progress tab is actually opened, and only once per learner.
  useEffect(() => {
    if (tab === 'overview' || plan || planLoading || planError) return;
    loadPlan();
  }, [tab, plan, planLoading, planError]);

  // A different learner invalidates whatever plan is held.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    setTab('overview');
  }, [employerId, kind, learnerId]);

  const handleSign = async (name: string, signature: string) => {
    if (!signing) return;
    if (signing.kind === 'review') {
      await signReviewAsEmployer(kind, learnerId, signing.eventKey, { name, signature });
    } else if (signing.kind === 'written-agreement') {
      await signWrittenAgreementAsEmployer(learnerId, { name, signature });
    } else if (signing.kind === 'training-plan') {
      await signTrainingPlanAsEmployer(learnerId, { name, signature });
    } else if (signing.kind === 'agreement') {
      // Its own table, its own endpoint — see apprenticeship_agreement.py.
      await signAgreementAsEmployer(learnerId, { name, signature });
    } else {
      await signDocumentAsEmployer(kind, learnerId, signing.id, { name, signature });
    }
    // No reusable copy is kept: the employer's name always produces the same
    // mark, so there is nothing to save and nothing to go stale.
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
  // The fetch is kicked off by an effect, so the first render after a tab switch
  // has neither data nor an in-flight flag yet. Treat that frame as loading too,
  // or the panels flash "nothing here" before the request has even started.
  const planPending = !plan && !planError;
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
      {/* The progress tabs render the learner's own multi-column layouts, which
          need more room than the signing queue does. */}
      <div className={`p-6 mx-auto space-y-6 ${tab === 'overview' ? 'max-w-5xl' : 'max-w-7xl'}`}>
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

            <nav className="flex flex-wrap items-center gap-1.5 border-b border-foreground-100 pb-2" aria-label="Learner sections">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={tab === t.key ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-smooth cursor-pointer ${
                    tab === t.key
                      ? 'bg-primary-600 text-white'
                      : 'text-foreground-500 hover:bg-background-100 hover:text-foreground-700'
                  }`}
                >
                  <i className={`${t.icon} text-[14px]`} />{t.label}
                </button>
              ))}
            </nav>

            {tab === 'overview' && (documentsFirst
              ? <>{documentsPanel}{performancePanel}</>
              : <>{performancePanel}{documentsPanel}</>)}

            {tab !== 'overview' && planError && (
              <div className="py-16 text-center">
                <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{planError}</p>
                <button className={btnSecondary} onClick={loadPlan}><i className="ri-refresh-line" />Retry</button>
              </div>
            )}

            {/* No kind/learnerId is passed on purpose: every start/open/upload
                action in the learner's plan is gated on them, so the employer
                gets the plan and its recorded outcomes but none of the actions. */}
            {tab === 'plan' && !planError && (
              <LearnerPlanBody
                real={plan}
                loading={planPending}
                loadError={null}
                pageLabel="Learning plan"
                showHero={false}
                note={`${learner?.name || 'This learner'}'s training plan as they see it — modules, weeks and every component, with recorded quiz results.`}
              />
            )}

            {tab === 'otjh' && !planError && (
              <OtjhBody real={plan} loading={planPending} showHero={false} audience="observer" />
            )}

            {tab === 'ksbs' && !planError && (
              <KsbProgressBody real={plan} loading={planPending} showHero={false} audience="observer" />
            )}
          </div>
        )}
      </div>

      {signing && data && (
        <SignModal
          item={signing}
          employerName={data.employer.name}
          onClose={() => setSigning(null)}
          onSign={handleSign}
        />
      )}
    </WorkspaceShell>
  );
}
