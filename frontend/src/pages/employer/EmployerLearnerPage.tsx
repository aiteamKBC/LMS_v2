import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import {
  fetchEmployerLearner,
  fetchEmployerLearnerPlan,
  type EmployerLearnerDetail,
  type EmployerOwnedItem,
} from '@/api/employerPortal';
import type { LearnerKind } from '@/api/extendedIlr';
import { btnSecondary } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { LearnerPlanBody } from '@/components/feature/RealLearnerPlanView';
import { KsbProgressBody } from '@/components/feature/RealKsbView';
import { DashboardTrainingPlan } from '@/pages/workspace/learner/DashboardTrainingPlan';
import type { DashboardPlanState } from '@/pages/workspace/learner/useDashboardPlan';
import type { ProgrammeProgressSnapshot } from '@/pages/learner/training-plan-timeline/ProgressCharts';
import { EmployerLearnerHeader } from './EmployerLearnerOverview';
import { useEmployerDashboardPlan } from './useEmployerDashboardPlan';
import { SignModal } from './EmployerDocumentRows';
import { useEmployerSigning } from './useEmployerSigning';
import { EmployerDocumentsTable } from './EmployerDocumentsTable';
import documentStyles from './EmployerDocumentsPage.module.css';
import { useEmployerPortalChrome } from './employerPortalNav';
import { EmployerAssignmentsTab } from './EmployerAssignmentsTab';
import { EmployerMonthlyLogsTab } from './EmployerMonthlyLogsTab';
import { EmployerProgressReviewsTab } from './EmployerProgressReviewsTab';

// ============================================================================
// One learner, as their employer sees them.
//
// Styled as the learner workspace. Overview keeps the dashboard header and progress;
// Learning plan adds the module timeline and overview above the full plan. The documents needing this
// employer's signature have their own tab, badged from every tab while any are
// outstanding. Unsigned documents are pinned above signed ones. The rows and
// sign-off dialog are shared with All documents (EmployerDocumentRows).
// ============================================================================

/**
 * The page is one learner seen six ways. Overview is the learner's own
 * dashboard header and progress; Learning plan includes the timeline and full plan;
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
  { key: 'reviews', label: 'Progress reviews', icon: 'ri-file-list-3-line' },
];

/** The tabs that read the learner's workspace payload (fetched on first use). */
const PLAN_TABS: TabKey[] = ['plan', 'ksbs'];

const progressPercent = (completed: number, total: number) => total > 0
  ? Math.min(100, Math.round(completed / total * 10_000) / 100)
  : null;

/** Build the same whole-programme series the coach overview charts. */
function employerProgrammeSnapshot(plan: DashboardPlanState): ProgrammeProgressSnapshot {
  const metrics = plan.week.data?.metrics;
  const subjects = plan.subjects || plan.data?.planSubjects || [];
  const activitiesCompleted = metrics?.programme.status === 'ready'
    ? metrics.programme.completed
    : subjects.reduce((total, subject) => total + subject.completed, 0);
  const activitiesTotal = metrics?.programme.status === 'ready'
    ? metrics.programme.total
    : subjects.reduce((total, subject) => total + subject.total, 0);
  const activitiesPercent = metrics?.programme.status === 'ready'
    ? metrics.programme.percent
    : activitiesCompleted != null && activitiesTotal != null
      ? progressPercent(activitiesCompleted, activitiesTotal)
      : null;
  const ksbRows = subjects.map(subject => subject.ksbProgress).filter((row): row is { completed: number; total: number } => !!row);
  const ksbCompleted = ksbRows.reduce((total, row) => total + row.completed, 0);
  const ksbTotal = ksbRows.reduce((total, row) => total + row.total, 0);
  const ksbAvailable = metrics ? metrics.ksb.status === 'ready' : ksbRows.length > 0;
  const ksb = metrics?.ksb.status === 'ready' ? metrics.ksb.percent
    : ksbAvailable ? progressPercent(ksbCompleted, ksbTotal) : null;
  const now = Date.now();
  const endedSessions = [...new Map((plan.data?.sessions || []).filter(session => {
    if (['cancelled', 'deleted'].includes(session.status)) return false;
    const start = Date.parse(session.start);
    const explicitEnd = Date.parse(session.end || '');
    const end = Number.isFinite(explicitEnd) ? explicitEnd
      : Number.isFinite(start) ? start + Math.max(0, session.minutes || 0) * 60_000 : Number.NaN;
    return Number.isFinite(end) && end <= now;
  }).map(session => [session.id, session])).values()];
  const attendanceTotal = endedSessions.length || null;
  const attendancePresent = attendanceTotal === null ? null : endedSessions.filter(session => session.attended === true).length;
  return {
    overall: metrics?.programme.status === 'ready' ? metrics.programme.percent : activitiesPercent,
    activitiesCompleted,
    activitiesTotal,
    activitiesPercent,
    otjhActual: metrics?.otjh.completed_actual ?? metrics?.otjh.actual ?? plan.otjh.actual,
    otjhTarget: metrics?.otjh.planned ?? plan.otjh.planned,
    ksb,
    ksbAvailable,
    attendancePresent,
    attendanceTotal,
  };
}

export default function EmployerLearnerPage() {
  const { employerId = '', kind: kindParam = 'apprenticeship', learnerId = '' } = useParams();
  // The URL segment is a plain string; the document APIs want the narrowed union.
  const kind: LearnerKind = kindParam === 'commercial' ? 'commercial' : 'apprenticeship';
  const navigate = useNavigate();
  const [data, setData] = useState<EmployerLearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  // The learner's own workspace payload, behind Learning plan and KSB progress. Fetched
  // once, on first use: an employer who only came to sign a document never pays
  // for it, and both tabs read the same object afterwards.
  const [plan, setPlan] = useState<LearnerDetail | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // The learner dashboard's Overview header and Learning plan timeline. Waits
  // for the learner record, whose ownership check it shares.
  const dashboardPlan = useEmployerDashboardPlan(employerId, kind, learnerId, !!data);
  const progressSnapshot = employerProgrammeSnapshot(dashboardPlan);

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

  const learner = data?.learner;
  const items: EmployerOwnedItem[] = data ? [...data.reviews, ...data.documents].map(item => ({
    ...item, learner: { id: learnerId, kind, name: data.learner.name, programme: data.learner.programme },
  })) : [];
  // The fetch is kicked off by an effect, so the first render after a tab switch
  // has neither data nor an in-flight flag yet. Treat that frame as loading too,
  // or the panels flash "nothing here" before the request has even started.
  const planPending = !plan && !planError;
  const outstanding = data?.outstandingCount ?? 0;

  const { shell } = useEmployerPortalChrome(employerId, data?.employer.name);
  const backToLearners = () => navigate(`/employers/${employerId}`);

  return (
    <WorkspaceShell {...shell} pageTitle="Learner" pageSubtitle={learner?.name ?? 'Learner'}>
      <PageContainer>
        {loading && (
          <div
            role="status"
            aria-label="Loading learner"
            aria-live="polite"
            className="flex min-h-[18rem] items-center justify-center py-16"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-50 text-primary-700 shadow-sm">
                <LoaderCircle data-testid="learner-loading-spinner" aria-hidden="true" className="h-7 w-7 animate-spin" />
              </span>
              <div>
                <p className="text-[13px] font-semibold text-foreground-700">Loading learner...</p>
                <p className="mt-1 text-[11px] text-foreground-400">Preparing the learner workspace</p>
              </div>
            </div>
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
              plan={dashboardPlan}
              onBack={backToLearners}
            />

            <nav className="flex w-full flex-nowrap items-center gap-1 overflow-x-auto border-b border-foreground-100 pb-2" aria-label="Learner sections">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={tab === t.key ? 'page' : undefined}
                  className={`inline-flex min-w-max flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[12px] font-semibold transition-smooth cursor-pointer lg:px-3 lg:text-[13px] ${
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
                      className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white ring-2 ring-white/70"
                      aria-label={`${outstanding} to sign`}
                      title="Awaiting your signature"
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
              <div className="learner-dashboard employer-learner-dashboard">
                <DashboardTrainingPlan
                  key={`overview:${kind}:${learnerId}`}
                  kind={kind}
                  learnerId={learnerId}
                  plan={dashboardPlan}
                  programmeStartDate={dashboardPlan.data?.programmeStartDate ?? learner.startDate}
                  programmeEndDate={dashboardPlan.data?.programmeEndDate ?? learner.endDate}
                  canOpenActivities={false}
                  canOpenCalendar={false}
                  canOpenRewards={false}
                  showRewards={false}
                  activityOverviewOnly
                  overviewOnly
                  wholeProgrammeRings
                  programmeSnapshot={progressSnapshot}
                />
              </div>
            )}

            {tab === 'plan' && (
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
                trainingOnly
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

            {/* Omitting kind/learnerId keeps the full plan read-only: no
                start/open/upload actions, with all recorded outcomes retained. */}
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

            {tab === 'otjh' && (
              <EmployerMonthlyLogsTab key={`${employerId}:${kind}:${learnerId}`} employerId={employerId} kind={kind} learnerId={learnerId} />
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
