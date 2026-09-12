import { useEffect, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { usePrefetchStudentActivity } from '@/hooks/usePrefetchStudentActivity';
import { OtjhBody } from '@/components/feature/RealOtjhView';
import { KsbProgressBody } from '@/components/feature/RealKsbView';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { OverviewTab, type ProgressTabKey } from './components/OverviewTab';
import { MockOtjhBody } from './components/MockOtjhBody';
import { MockKsbBody } from './components/MockKsbBody';
import { useUnifiedLearningSummary } from '@/pages/learner/my-learning/SubjectWorkspace';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { useLearnerMetrics } from '@/hooks/useLearnerMetrics';

const learnerNav = roleNavMap.learner;

const TAB_ORDER: ProgressTabKey[] = ['overview', 'otjh', 'ksbs'];

/** Legacy routes (/learner/otjh, /learner/ksbs — the former OTJH / KSB pages)
 * land on this same page, pre-selected to the matching tab, so every existing
 * link and bookmark into those sections keeps working unchanged. Evidence is no
 * longer a tab here: /learner/evidence is its own page. */
function tabFromLocation(pathname: string, queryTab: string | null): ProgressTabKey {
  if (pathname.startsWith('/learner/otjh')) return 'otjh';
  if (pathname.startsWith('/learner/ksbs')) return 'ksbs';
  if (queryTab && (TAB_ORDER as string[]).includes(queryTab)) return queryTab as ProgressTabKey;
  return 'overview';
}

export default function ProgressPage() {
  const location = useLocation();
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const [searchParams] = useSearchParams();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  usePrefetchStudentActivity(kind, id);
  const { isRealMode, real, loading: realLoading, loadError, refresh } = useLearnerDetailParam(kind, id);
  const metrics = useLearnerMetrics(kind, id, isRealMode);
  const combinedLearning = useUnifiedLearningSummary(
    real,
    kind,
    id,
    isRealMode && !!real?.studentActivityAvailable,
  );
  const combinedLoading = realLoading
    || (isRealMode && !!real?.studentActivityAvailable && combinedLearning.loading);

  const [activeTab, setActiveTab] = useState<ProgressTabKey>(() => tabFromLocation(location.pathname, searchParams.get('tab')));
  useEffect(() => {
    setActiveTab(tabFromLocation(location.pathname, searchParams.get('tab')));
    // Only the entry route should decide the initial tab — after that, clicking
    // a tab must not be overridden by an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const tabs: PageTabItem[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'otjh', label: 'OTJ Hours' },
    { value: 'ksbs', label: 'KSBs' },
  ];

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="OTJH & KSBs progress" pageSubtitle="Off-the-job hours and KSB coverage across your programme"
      userName={real?.name || 'Learner'} userRole={`${real?.programme || 'Apprenticeship'} Apprentice`}
    >
      <PageContainer>
        {(loadError || combinedLearning.error || metrics.error) && <LearnerLoadError error={loadError || combinedLearning.error || metrics.error || ''} onRetry={() => { refresh(); combinedLearning.retry(); metrics.refresh(); }} />}
        <PageTabs items={tabs} value={activeTab} onChange={(v) => setActiveTab(v as ProgressTabKey)} label="Progress section" />

        {activeTab === 'overview' && (
          <OverviewTab
            real={real}
            realLoading={realLoading || metrics.loading}
            metrics={metrics.data}
            recordedOtjhTotal={combinedLearning.data?.recorded_otjh_total}
            auditOtjhActual={combinedLearning.data?.audit_lms_actual}
            auditOtjhPlanned={combinedLearning.data?.audit_tp_planned}
            subjectCount={combinedLearning.summary?.subjectCount ?? combinedLearning.data?.module_count}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'otjh' && (
          isRealMode
            ? <OtjhBody
                real={real}
                loading={combinedLoading}
                showHero={false}
                activityData={combinedLearning.data}
                metrics={metrics.data}
                subjectCount={combinedLearning.summary?.subjectCount ?? combinedLearning.data?.module_count}
              />
            : <MockOtjhBody showHero={false} />
        )}

        {activeTab === 'ksbs' && (
          isRealMode
            ? <KsbProgressBody real={real} loading={realLoading || metrics.loading} showHero={false} metric={metrics.data?.ksb ?? null} />
            : <MockKsbBody showHero={false} />
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
