import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  fetchEmployerLearner,
  fetchEmployerLearnerPlan,
  type EmployerLearnerDetail,
  type EmployerOwnedItem,
} from '@/api/employerPortal';
import type { LearnerKind } from '@/api/extendedIlr';
import { btnSecondary } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { KsbProgressBody } from '@/components/feature/RealKsbView';
import { EmployerLearningOverview, EmployerTrainingPlan } from './EmployerLearning';
import { EmployerLearnerHeader } from './EmployerLearnerOverview';
import { SignModal } from './EmployerDocumentRows';
import { EmployerDocumentPreview } from './EmployerDocumentPreview';
import { useEmployerSigning } from './useEmployerSigning';
import { EmployerDocumentsTable } from './EmployerDocumentsTable';
import documentStyles from './EmployerDocumentsPage.module.css';
import { useEmployerPortalChrome } from './employerPortalNav';
import { EmployerAssignmentsTab } from './EmployerAssignmentsTab';
import { EmployerMonthlyLogsTab } from './EmployerMonthlyLogsTab';
import { EmployerProgressReviewsTab } from './EmployerProgressReviewsTab';
import styles from './EmployerLearnerPage.module.css';

// ============================================================================
// One learner, as their employer sees them.
//
// Styled as the learner workspace. Overview keeps the dashboard header and progress;
// Learning plan uses the same module timeline and overview. The documents needing this
// employer's signature have their own tab, badged from every tab while any are
// outstanding. Unsigned documents are pinned above signed ones. The rows and
// sign-off dialog are shared with All documents (EmployerDocumentRows).
// ============================================================================

/**
 * The page is one learner seen six ways. Overview is the learner's own
 * dashboard header and progress; Learning plan includes the timeline and module overview;
 * Assignments is what they have handed
 * in; Documents is the employer's own business — the signing queue; the other
 * progress tabs are the learner's workspace
 * shown read-only, so employer and apprentice discuss the same plan, the same
 * hours and the same KSBs rather than two different pictures of them.
 */
type TabKey = 'overview' | 'plan' | 'otjh' | 'ksbs' | 'assignments' | 'documents' | 'reviews';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { key: 'plan', label: 'Learning plan', icon: 'ri-calendar-check-line' },
  { key: 'otjh', label: 'Monthly logs', icon: 'ri-time-line' },
  { key: 'ksbs', label: 'KSB progress', icon: 'ri-award-line' },
  { key: 'assignments', label: 'Assignments', icon: 'ri-task-line' },
  { key: 'documents', label: 'Documents', icon: 'ri-folder-open-line' },
  { key: 'reviews', label: 'Progress & Gateway reviews', icon: 'ri-file-list-3-line' },
];

/** The tabs that read the learner's workspace payload (fetched on first use). */
const PLAN_TABS: TabKey[] = ['ksbs'];

export default function EmployerLearnerPage() {
  const { employerId, kind, learnerId } = useParams();
  const { auth } = useAuth();
  return <EmployerLearnerContent key={`${auth.account?.id}:${employerId}:${kind}:${learnerId}`} />;
}

function EmployerLearnerContent() {
  const { employerId = '', kind: kindParam = 'apprenticeship', learnerId = '' } = useParams();
  // The URL segment is a plain string; the document APIs want the narrowed union.
  const kind: LearnerKind = kindParam === 'commercial' ? 'commercial' : 'apprenticeship';
  const navigate = useNavigate();
  const [data, setData] = useState<EmployerLearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.find(item => item.key === params.get('tab'))?.key || 'overview';
  const setTab = (nextTab: TabKey) => {
    const next = new URLSearchParams(params);
    if (nextTab === 'overview') next.delete('tab');
    else next.set('tab', nextTab);
    setParams(next);
  };
  // The KSB observer uses the read-only full-plan compatibility payload.
  // Overview and Learning plan use the current learner dashboard projections.
  const [plan, setPlan] = useState<LearnerDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const load = () => {
    setLoading(true);
    setError(null);
    fetchEmployerLearner(employerId, kind, learnerId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [employerId, kind, learnerId]);

  const loadPlan = useCallback(() => {
    setPlanLoading(true);
    setPlanError(null);
    fetchEmployerLearnerPlan(employerId, kind, learnerId)
      .then(setPlan)
      .catch((e: Error) => setPlanError(e.message))
      .finally(() => setPlanLoading(false));
  }, [employerId, kind, learnerId]);

  // Only when a progress tab is actually opened, and only once per learner.
  useEffect(() => {
    if (!PLAN_TABS.includes(tab) || plan || planLoading || planError) return;
    loadPlan();
  }, [tab, plan, planLoading, planError, loadPlan]);

  // A different learner invalidates whatever plan is held.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
  }, [employerId, kind, learnerId]);

  const signingActions = useEmployerSigning(employerId, load);

  const learner = data?.learner;
  const items: EmployerOwnedItem[] = data ? [...data.reviews, ...data.documents].map(item => ({
    ...item, learner: { id: learnerId, kind, name: data.learner.name, programme: data.learner.programme },
  })) : [];
  // The fetch is kicked off by an effect, so the first render after a tab switch
  // has neither data nor an in-flight flag yet. Treat that frame as loading too,
  // or the panels flash "nothing here" before the request has even started.
  const planPending = !plan && !planError;
  const outstanding = data?.outstandingCount ?? 0;
  const unsigned = items.filter(item => !item.signed).length;
  const unsignedNote = outstanding > 0 ? `${outstanding} awaiting your signature`
    : unsigned > 0 ? `${unsigned} not signed yet` : null;

  const { shell } = useEmployerPortalChrome(employerId, data?.employer.name);
  const backToLearners = () => navigate(`/employers/${employerId}/learners`);

  return (
    <WorkspaceShell {...shell} pageTitle="Learner" pageSubtitle={learner?.name ?? 'Learner'}>
      <PageContainer className={styles.page}>
        <div id="employer-learner-profile" className={styles.content} data-employer-theme="learner">
        {loading && (
          <div



            className="min-h-[18rem] py-6"
          >
            <LoadingSkeleton label="Loading learner" variant="cards" />
          </div>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {!loading && !error && data && learner && (
          <>
            <EmployerLearnerHeader
              employerId={employerId}
              kind={kind}
              learner={learner}
              onBack={backToLearners}
            />

            <nav className={styles.tabs} aria-label="Learner sections">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={tab === t.key ? 'page' : undefined}
                  className={styles.tab}
                >
                  <AppIcon className={t.icon} aria-hidden="true" />{t.label}
                  {/* Paperwork not yet signed by this employer stays visible
                      from every tab, now that it has a tab of its own —
                      including items not ready to sign yet. */}
                  {t.key === 'documents' && unsignedNote && (
                    <span
                      data-testid="documents-unsigned-dot"
                      className={styles.unsignedDot}
                      title={unsignedNote}
                    >
                      <span className="sr-only">{unsignedNote}</span>
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className={styles.tabContent}>
            {tab === 'overview' && <EmployerLearningOverview key={`${employerId}:${kind}:${learnerId}`}
              employerId={employerId} kind={kind} learnerId={learnerId} />}

            {tab === 'plan' && <EmployerTrainingPlan key={`${employerId}:${kind}:${learnerId}`}
              employerId={employerId} kind={kind} learnerId={learnerId} />}

            {tab === 'assignments' && (
              <EmployerAssignmentsTab employerId={employerId} kind={kind} learnerId={learnerId} learnerName={learner.name || 'this learner'} />
            )}

            {tab === 'documents' && (
              <div className="space-y-4">
                {outstanding > 0 && (
                  <div className={styles.signatureNotice}>
                    <i className="ri-error-warning-line text-amber-600 shrink-0" />
                    <p className="text-[13px] text-amber-900">
                      <strong>{outstanding} document{outstanding === 1 ? '' : 's'}</strong> need your signature.
                    </p>
                  </div>
                )}
                <div className={documentStyles.page}>
                  <EmployerDocumentsTable items={items} employerId={employerId}
                    opening={signingActions.opening} onSign={signingActions.startSigning} onShow={signingActions.openDocument} />
                </div>
              </div>
            )}

            {tab === 'reviews' && (
              <EmployerProgressReviewsTab key={`${employerId}:${kind}:${learnerId}`} employerId={employerId} kind={kind}
                learnerId={learnerId} employerName={data.employer.name}
                onReviewChanged={() => fetchEmployerLearner(employerId, kind, learnerId).then(setData)} />
            )}

            {PLAN_TABS.includes(tab) && planError && (
              <div className="py-16 text-center">
                <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{planError}</p>
                <button className={btnSecondary} onClick={loadPlan}><i className="ri-refresh-line" />Retry</button>
              </div>
            )}

            {tab === 'otjh' && (
              <EmployerMonthlyLogsTab key={`${employerId}:${kind}:${learnerId}`} employerId={employerId} kind={kind} learnerId={learnerId} />
            )}

            {tab === 'ksbs' && !planError && (
              <div className={styles.ksbContent}>
                <KsbProgressBody real={plan} loading={planPending} showHero={false} audience="observer" />
              </div>
            )}
            </div>
          </>
        )}
        </div>
      </PageContainer>

      {signingActions.preview && <EmployerDocumentPreview employerId={employerId}
        target={signingActions.preview} onClose={signingActions.closePreview} />}

      {signingActions.signing && data && (
        <SignModal
          item={signingActions.signing.item}
          employerName={data.employer.name}
          reviewDefinition={signingActions.reviewDefinition}
          onClose={signingActions.closeSigning}
          onSign={signingActions.sign}
          onSaveReviewAnswers={signingActions.saveReviewAnswers}
        />
      )}
    </WorkspaceShell>
  );
}
