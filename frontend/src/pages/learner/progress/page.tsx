import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { OtjhBody } from '@/components/feature/RealOtjhView';
import { KsbProgressBody } from '@/components/feature/RealKsbView';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { OverviewTab, type ProgressTabKey } from './components/OverviewTab';
import { EvidenceTab } from './components/EvidenceTab';
import { MockOtjhBody } from './components/MockOtjhBody';
import { MockKsbBody } from './components/MockKsbBody';

const learnerNav = roleNavMap.learner;

const TAB_ORDER: ProgressTabKey[] = ['overview', 'evidence', 'otjh', 'ksbs'];

/** Legacy routes (/learner/evidence, /learner/otjh, /learner/ksbs — the former
 * Evidence Library / OTJH / KSB pages) land on this same merged page,
 * pre-selected to the matching tab, so every existing link and bookmark into
 * those sections keeps working unchanged. */
function tabFromLocation(pathname: string, queryTab: string | null): ProgressTabKey {
  if (pathname.startsWith('/learner/evidence')) return 'evidence';
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
  const { isRealMode, real, loading: realLoading } = useLearnerDetailParam(kind, id);
  const { canProgress, showReadOnlyNotice } = useLearnerWorkspaceAccess(id);

  const [activeTab, setActiveTab] = useState<ProgressTabKey>(() => tabFromLocation(location.pathname, searchParams.get('tab')));
  useEffect(() => {
    setActiveTab(tabFromLocation(location.pathname, searchParams.get('tab')));
    // Only the entry route should decide the initial tab — after that, clicking
    // a tab must not be overridden by an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceRecord[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const reloadEvidence = useCallback(async () => {
    if (!kind || !id) return;
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      setEvidenceRecords(await fetchEvidence(kind, id));
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : 'Could not load evidence.');
    } finally {
      setEvidenceLoading(false);
    }
  }, [kind, id]);

  useEffect(() => { void reloadEvidence(); }, [reloadEvidence]);

  const tabs: PageTabItem[] = [
    { value: 'overview', label: 'Overview' },
  ];

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="My Progress" pageSubtitle="Evidence, off-the-job hours and KSBs — all in one place"
      userName={real?.name || 'Learner'} userRole={`${real?.programme || 'Apprenticeship'} Apprentice`}
    >
      <PageContainer>
        <PageTabs items={tabs} value={activeTab} onChange={(v) => setActiveTab(v as ProgressTabKey)} label="My Progress section" />

        {activeTab === 'overview' && (
          <OverviewTab
            real={real}
            realLoading={realLoading}
            evidenceRecords={evidenceRecords}
            evidenceLoading={evidenceLoading}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'evidence' && (
          <EvidenceTab
            learnerKind={kind}
            learnerId={id}
            real={real}
            canProgress={canProgress}
            showReadOnlyNotice={showReadOnlyNotice}
            evidenceRecords={evidenceRecords}
            evidenceLoading={evidenceLoading}
            evidenceError={evidenceError}
            reloadEvidence={reloadEvidence}
          />
        )}

        {activeTab === 'otjh' && (
          isRealMode
            ? <OtjhBody real={real} loading={realLoading} showHero={false} />
            : <MockOtjhBody showHero={false} />
        )}

        {activeTab === 'ksbs' && (
          isRealMode
            ? <KsbProgressBody real={real} loading={realLoading} showHero={false} />
            : <MockKsbBody showHero={false} />
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
