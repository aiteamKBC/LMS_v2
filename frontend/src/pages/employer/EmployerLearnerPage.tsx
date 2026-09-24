import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import {
  fetchEmployerLearner,
  fetchEmployerLearnerPlan,
  type EmployerLearnerDetail,
  type SignableItem,
} from '@/api/employerPortal';
import type { LearnerKind } from '@/api/extendedIlr';
import { Hero, SectionPanel, btnSecondary } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { LearnerPlanBody } from '@/components/feature/RealLearnerPlanView';
import { OtjhBody } from '@/components/feature/RealOtjhView';
import { KsbProgressBody } from '@/components/feature/RealKsbView';
import { DashboardTrainingPlan } from '@/pages/workspace/learner/DashboardTrainingPlan';
import { EmployerLearnerHeader } from './EmployerLearnerOverview';
import { useEmployerDashboardPlan } from './useEmployerDashboardPlan';
import { DocumentRow, SignModal } from './EmployerDocumentRows';
import { compareSignable, targetKey, useEmployerSigning } from './useEmployerSigning';
import { useEmployerPortalChrome } from './employerPortalNav';
import { EmployerAssignmentsTab } from './EmployerAssignmentsTab';

// ============================================================================
// One learner, as their employer sees them.
//
// Styled as the learner workspace. Overview is the learner dashboard's own header
// and module timeline (see EmployerLearnerOverview); the documents needing this
// employer's signature have their own tab, badged from every tab while any are
// outstanding. Unsigned documents are pinned above signed ones. The rows and
// sign-off dialog are shared with All documents (EmployerDocumentRows).
// ============================================================================

/**
 * The page is one learner seen six ways. Overview is the learner's own
 * dashboard header and module timeline; Assignments is what they have handed
 * in; Documents is the employer's own business — the signing queue; the other
 * three are the learner's workspace
 * shown read-only, so employer and apprentice discuss the same plan, the same
 * hours and the same KSBs rather than two different pictures of them.
 */
type TabKey = 'overview' | 'plan' | 'otjh' | 'ksbs' | 'assignments' | 'documents';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { key: 'plan', label: 'Learning plan', icon: 'ri-calendar-check-line' },
  { key: 'otjh', label: 'Off-the-job hours', icon: 'ri-time-line' },
  { key: 'ksbs', label: 'KSB progress', icon: 'ri-award-line' },
  { key: 'assignments', label: 'Assignments', icon: 'ri-file-upload-line' },
  { key: 'documents', label: 'Documents', icon: 'ri-draft-line' },
];

/** The tabs that read the learner's workspace payload (fetched on first use). */
const PLAN_TABS: TabKey[] = ['plan', 'otjh', 'ksbs'];

export default function EmployerLearnerPage() {
  const { employerId = '', kind: kindParam = 'apprenticeship', learnerId = '' } = useParams();
  // The URL segment is a plain string; the document APIs want the narrowed union.
  const kind: LearnerKind = kindParam === 'commercial' ? 'commercial' : 'apprenticeship';
  const navigate = useNavigate();
  const [data, setData] = useState<EmployerLearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  // The learner's own workspace payload, behind the three progress tabs. Fetched
  // once, on first use: an employer who only came to sign a document never pays
  // for it, and all three tabs read the same object afterwards.
  const [plan, setPlan] = useState<LearnerDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // The learner dashboard's header and timeline behind the Overview tab. Waits
  // for the learner record, whose ownership check it shares.
  const dashboardPlan = useEmployerDashboardPlan(employerId, kind, learnerId, !!data);

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
    if (!PLAN_TABS.includes(tab) || plan || planLoading || planError) return;
    loadPlan();
  }, [tab, plan, planLoading, planError]);

  // A different learner invalidates whatever plan is held.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    setTab('overview');
  }, [employerId, kind, learnerId]);

  const signingActions = useEmployerSigning(employerId, load);
  const target = (item: SignableItem) => ({ item, kind, learnerId });

  const learner = data?.learner;
  const items: SignableItem[] = data ? [...data.reviews, ...data.documents] : [];
  const sorted = [...items].sort(compareSignable);
  // The fetch is kicked off by an effect, so the first render after a tab switch
  // has neither data nor an in-flight flag yet. Treat that frame as loading too,
  // or the panels flash "nothing here" before the request has even started.
  const planPending = !plan && !planError;
  const outstanding = data?.outstandingCount ?? 0;

  const { shell } = useEmployerPortalChrome(employerId, data?.employer.name);
  const backToLearners = () => navigate(`/employers/${employerId}`);

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
              key={targetKey(target(item))}
              item={item}
              onSign={() => signingActions.startSigning(target(item))}
              onShow={() => signingActions.openDocument(target(item))}
              opening={signingActions.opening === targetKey(target(item))}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  );

  return (
    <WorkspaceShell {...shell} pageTitle="Learner" pageSubtitle={learner?.name ?? 'Learner'}>
      <PageContainer>
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

        {!loading && !error && data && learner && (
          <>
            {/* Overview carries the learner dashboard's own header; the other
                tabs keep the compact banner until they are redesigned. */}
            {tab === 'overview' ? (
              <EmployerLearnerHeader
                employerId={employerId}
                kind={kind}
                learner={learner}
                plan={dashboardPlan}
                onBack={backToLearners}
              />
            ) : (
              <Hero
                icon="ri-user-3-line"
                title={learner.name || 'Learner'}
                subtitle={<>
                  {learner.programme || 'No programme'}
                  {learner.cohort ? ` · ${learner.cohort}` : ''}
                  {` · ${learner.programmeStatus || 'Status not set'}`}
                </>}
                right={
                  <button onClick={backToLearners} className={btnSecondary}>
                    <i className="ri-arrow-left-line" />All learners
                  </button>
                }
              />
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
                  {/* Paperwork waiting on this employer stays visible from
                      every tab, now that it has a tab of its own. */}
                  {t.key === 'documents' && outstanding > 0 && (
                    <span
                      className={`ml-0.5 min-w-[18px] rounded-full px-1.5 text-center text-[10px] leading-[18px] ${
                        tab === t.key ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'
                      }`}
                      aria-label={`${outstanding} to sign`}
                    >
                      {outstanding}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Read-only by construction: no activity, module or calendar
                links, and the portal serves the plan without meeting links. */}
            {tab === 'overview' && (
              <DashboardTrainingPlan
                key={`plan:${kind}:${learnerId}`}
                kind={kind}
                learnerId={learnerId}
                plan={dashboardPlan}
                programmeStartDate={dashboardPlan.data?.programmeStartDate ?? learner.startDate}
                programmeEndDate={dashboardPlan.data?.programmeEndDate ?? learner.endDate}
                canOpenActivities={false}
                canOpenCalendar={false}
                canOpenRewards={false}
                showRewards={false}
                cardsOnly
                simpleModuleOverview
              />
            )}

            {tab === 'assignments' && (
              <EmployerAssignmentsTab employerId={employerId} kind={kind} learnerId={learnerId} learnerName={learner.name || 'this learner'} />
            )}

            {tab === 'documents' && (
              <div className="space-y-4">
                {outstanding > 0 && (
                  <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 flex items-center gap-2.5">
                    <i className="ri-error-warning-line text-amber-600 shrink-0" />
                    <p className="text-[13px] text-amber-900">
                      <strong>{outstanding} document{outstanding === 1 ? '' : 's'}</strong> need your signature.
                    </p>
                  </div>
                )}
                {documentsPanel}
              </div>
            )}

            {PLAN_TABS.includes(tab) && planError && (
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
                note={`${learner.name || 'This learner'}'s training plan as they see it — modules, weeks and every component, with recorded quiz results.`}
              />
            )}

            {tab === 'otjh' && !planError && (
              <OtjhBody real={plan} loading={planPending} showHero={false} audience="observer" />
            )}

            {tab === 'ksbs' && !planError && (
              <KsbProgressBody real={plan} loading={planPending} showHero={false} audience="observer" />
            )}
          </>
        )}
      </PageContainer>

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
