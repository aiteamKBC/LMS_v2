import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { DashboardTrainingPlan } from '@/pages/workspace/learner/DashboardTrainingPlan';
import OTJHTab from './components/OTJHTab';
import KSBsTab from './components/KSBsTab';
import EvidenceTab from './components/EvidenceTab';
import AuditTab from '@/features/audit/AuditTab';
import ActivityTab from './components/ActivityTab';
import DocumentsTab from './components/DocumentsTab';
import NetworkTab from './components/NetworkTab';
import LearningPlanTab from './components/OverviewTab';
import AssignmentsTab from './components/AssignmentsTab';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import {
  formatFraction,
  formatPercent,
  selectCaseFileOtjh,
  useCoachLearnerCaseFileData,
} from './data';
import type { CaseFileReviewMeeting, CoachLearnerCaseFileData } from './types';
import styles from './learnerCaseFile.module.css';
import { useCaseFileDashboardPlan } from './useCaseFileDashboardPlan';
import { useCaseFileAttendance } from './useCaseFileAttendance';
import { useCaseFileNextSession } from './useCaseFileNextSession';
import { useCaseFileReviews } from './useCaseFileReviews';
import { useCaseFileMarking } from './useCaseFileMarking';
import { CaseFileTabs } from './components/CaseFileTabs';
import { caseFileTabs, type CaseFileTabId } from './components/caseFileTabs.config';
import { LearnerCaseFileHeader } from './components/LearnerCaseFileHeader';
import { AttendanceTab } from './tabs/AttendanceTab';
import { ReviewsTab } from './tabs/ReviewsTab';
import { EvidencePreviewModal, ProgressTab } from './tabs/ProgressTab';
import { selectCaseFileKsbRows, selectCaseFileKsbSummary, type EvidencePreviewTarget } from './domain/ksbSelectors';
import { formatAttendanceFraction } from './formatters';

const coachNav = roleNavMap.coach;

type TabId = CaseFileTabId;
type LocationState = {
  learnerId?: string;
  learnerName?: string;
  kind?: 'commercial' | 'apprenticeship';
  /** enrolment."Created_users".id -- see useCoachLearnerCaseFileData's enrolmentId doc. */
  enrolmentId?: string;
  tab?: string;
};

function resolveCaseFileTab(tab?: string | null): TabId {
  const normalized = tab === 'learning-plan' ? 'support' : tab;
  return caseFileTabs.some(candidate => candidate.id === normalized) ? normalized as TabId : 'overview';
}

export default function LearnerCaseFile() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as LocationState;

  const requestedTab = searchParams.get('tab') || state.tab;
  const initialTab = resolveCaseFileTab(requestedTab);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreviewTarget | null>(null);
  const requestedReviewId = searchParams.get('reviewId') || undefined;
  const learnerId = searchParams.get('id') || state.learnerId;
  const learnerName = state.learnerName;
  const explicitKind = parseLearnerKind(searchParams.get('kind') || state.kind);
  const enrolmentId = searchParams.get('enrolmentId') || state.enrolmentId;

  const { data, loading, error, refresh } = useCoachLearnerCaseFileData({
    learnerId,
    learnerName,
    kind: explicitKind,
    enrolmentId,
    enabled: coach.isInitialized && coach.hasCoachAccess,
  });
  const dashboardKind = data?.kind || explicitKind;
  const dashboardLearnerId = data?.enrolmentId || enrolmentId;
  const dashboardPlan = useCaseFileDashboardPlan(
    dashboardKind,
    dashboardLearnerId,
    coach.isInitialized && coach.hasCoachAccess && !!dashboardKind && !!dashboardLearnerId,
    activeTab === 'overview' || activeTab === 'support',
  );
  const caseFileAttendance = useCaseFileAttendance(
    data?.kind,
    data?.enrolmentId,
    coach.isInitialized && coach.hasCoachAccess && !!data?.kind && !!data?.enrolmentId,
  );
  const caseFileNextSession = useCaseFileNextSession(
    data?.learnerId,
    coach.isInitialized && coach.hasCoachAccess && !!data?.learnerId,
  );
  const caseFileReviews = useCaseFileReviews(
    data?.learnerId,
    coach.isInitialized && coach.hasCoachAccess && !!data?.learnerId && activeTab === 'reviews',
  );
  const caseFileMarking = useCaseFileMarking(
    data?.enrolmentId,
    coach.isInitialized && coach.hasCoachAccess && !!data?.enrolmentId && activeTab === 'assignments',
  );

  useEffect(() => {
    if (requestedTab === 'learning-plan' || caseFileTabs.some(tab => tab.id === requestedTab)) {
      setActiveTab(resolveCaseFileTab(requestedTab));
    }
  }, [requestedTab]);

  const subtitle = buildSubtitle(data);
  const pageTitle = data?.displayName || learnerName || 'Learner case file';
  const pageSubtitle = subtitle || 'Live learner view for coaching support';
  const nextLiveSession = caseFileNextSession.data;
  const headerOtjh = data ? selectCaseFileOtjh(data) : null;
  const headerKsb = data?.metricsAvailable === false ? null : data ? selectCaseFileKsbSummary(selectCaseFileKsbRows(data)) : null;

  const handleOpenReviewMeeting = (item: CaseFileReviewMeeting) => {
    const returnParams = new URLSearchParams(location.search);
    returnParams.set('id', data?.learnerId || learnerId || '');
    returnParams.set('tab', 'reviews');
    if (data?.kind) returnParams.set('kind', data.kind);
    const returnTo = `${location.pathname}?${returnParams.toString()}`;
    const detailBase = item.source === 'mcr'
      ? '/coach/meetings'
      : '/coach/reviews';
    const detailKey = item.eventKey;

    navigate(`${detailBase}/${encodeURIComponent(detailKey)}`, {
      state: { returnTo },
    });
  };

  const renderTab = () => {
    if (!data) {
      return (
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          {loading
            ? <RowsSkeleton rows={5} />
            : <EmptyState text={error || 'No learner selected.'} />}
        </div>
      );
    }

    switch (activeTab) {
      case 'overview':
        return dashboardKind ? <DashboardTrainingPlan
          kind={dashboardKind}
          learnerId={data.enrolmentId || data.learnerId}
          plan={dashboardPlan}
          programmeStartDate={data.detail?.programmeStartDate}
          programmeEndDate={data.detail?.programmeEndDate}
          canOpenActivities
          showRewards={false}
          activityOverviewOnly
          programmeSnapshot={{
            overall: data.overallProgress,
            otjhActual: headerOtjh?.logged ?? null,
            otjhTarget: headerOtjh?.target ?? null,
            ksb: headerKsb?.percent ?? null,
            ksbAvailable: Boolean(headerKsb?.total),
            attendancePresent: caseFileAttendance.data?.present ?? null,
            attendanceTotal: caseFileAttendance.data?.sessions ?? null,
          }}
        /> : null;
      case 'progress':
        return <ProgressTab data={data} onViewEvidence={setEvidencePreview} />;
      case 'attendance':
        return <AttendanceTab attendanceState={caseFileAttendance} />;
      case 'reviews':
        return <ReviewsTab
          data={data}
          reviewsState={caseFileReviews}
          onOpen={handleOpenReviewMeeting}
          requestedReviewId={requestedReviewId}
        />;
      case 'assignments':
        return dashboardKind && (data.enrolmentId || data.learnerId)
          ? <AssignmentsTab kind={dashboardKind} learnerId={data.enrolmentId || data.learnerId} markingState={caseFileMarking} />
          : <EmptyState text="Assignments are unavailable because this learner's record type is unknown." />;
      case 'coach-notes':
        return <DocumentsTab data={data} />;
      case 'support':
        return <div className="space-y-5">
          {dashboardKind ? <DashboardTrainingPlan
            kind={dashboardKind}
            learnerId={data.enrolmentId || data.learnerId}
            plan={dashboardPlan}
            programmeStartDate={data.detail?.programmeStartDate}
            programmeEndDate={data.detail?.programmeEndDate}
            canOpenActivities
            showRewards={false}
            timelineOnly
          /> : null}
          <LearningPlanTab data={data} ksbSummary={headerKsb || undefined} onOpenNotes={() => setActiveTab('coach-notes')} />
        </div>;
      case 'otjh':
        return <OTJHTab data={data} />;
      case 'ksbs':
        return <KSBsTab data={data} />;
      case 'evidence':
        return <EvidenceTab data={data} />;
      case 'audit':
        return <AuditTab data={data} />;
      case 'activity':
        return <ActivityTab data={data} />;
      case 'network':
        return <NetworkTab data={data} />;
      case 'documents':
        return <DocumentsTab data={data} />;
      default:
        return null;
    }
  };

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Learner Case File"
      pageSubtitle="Coaching record, progress and evidence for one learner"
      userName={data?.coachName || coach.name}
      userRole="Progress Coach"
      hidePageChrome
    >
      <main className={styles.page}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <button type="button" aria-label="Coach dashboard" onClick={() => navigate('/workspace/coach')}><AppIcon className="ri-home-4-line" /></button>
          <AppIcon className="ri-arrow-right-s-line" />
          <button type="button" onClick={() => navigate('/workspace/coach')}>Coach Workspace</button>
          <AppIcon className="ri-arrow-right-s-line" />
          <button type="button" onClick={() => navigate('/coach/caseload')}>Coach</button>
          <AppIcon className="ri-arrow-right-s-line" />
          <strong>Learner Case File</strong>
        </nav>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">{error}</div>
        )}

        <LearnerCaseFileHeader
          data={data}
          pageTitle={pageTitle}
          pageSubtitle={pageSubtitle}
          overall={formatPercent(data?.overallProgress ?? null)}
          otjh={headerOtjh ? formatFraction(headerOtjh.logged, headerOtjh.target) : '--'}
          ksb={headerKsb?.percent == null ? '--' : formatPercent(headerKsb.percent)}
          attendance={formatAttendanceFraction(caseFileAttendance.data?.present ?? null, caseFileAttendance.data?.sessions ?? null)}
          nextSession={nextLiveSession?.summary || '--'}
        />

        <CaseFileTabs activeTab={activeTab} onChange={setActiveTab} />

        <section className={styles.content} role="tabpanel">
          {renderTab()}
        </section>
      </main>
      {evidencePreview && (
        <EvidencePreviewModal
          evidence={evidencePreview}
          onClose={() => setEvidencePreview(null)}
          onOpenAssignment={(componentId) => {
            if (!data?.kind || !data.learnerId) return;
            navigate(`/learner/monthly-submission/${data.kind}/${data.learnerId}/${encodeURIComponent(componentId)}`);
          }}
        />
      )}
    </WorkspaceShell>
  );
}

function buildSubtitle(data: CoachLearnerCaseFileData | null) {
  if (!data) {
    return '';
  }

  return [data.programme, data.cohort ? `Cohort ${data.cohort}` : '', data.group ? `Group ${data.group}` : '']
    .filter(Boolean)
    .join(' - ');
}

function parseLearnerKind(value?: string | null) {
  if (value === 'commercial' || value === 'apprenticeship') {
    return value;
  }
  return null;
}
