import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { fetchHistoricalEvidence, type HistoricalEvidenceItem } from '@/api/historicalEvidence';
import { PageContainer } from '@/components/ui/PageContainer';
import { EvidenceBody } from './components/EvidenceBody';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';

const learnerNav = roleNavMap.learner;

/** The learner's evidence library — uploads, their review status and the KSBs
 * each one covers. Split out from the old merged "Evidence & Progress" page so
 * evidence (what you submit) and progress (OTJ hours and KSB coverage, what
 * those submissions add up to) are two destinations rather than tabs. */
export default function EvidencePage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { real, loadError, refresh } = useLearnerDetailParam(kind, id);
  const { canProgress, showReadOnlyNotice } = useLearnerWorkspaceAccess(id);

  const identity = `${kind}:${id}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ identity: string; records: EvidenceRecord[]; loading: boolean; error: string | null } | null>(null);
  const [history, setHistory] = useState<{ identity: string; records: HistoricalEvidenceItem[]; loading: boolean; error: string | null } | null>(null);
  const reloadEvidence = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    setState(previous => ({ identity, records: previous?.identity === identity ? previous.records : [], loading: true, error: null }));
    setHistory(previous => ({ identity, records: previous?.identity === identity ? previous.records : [], loading: true, error: null }));
    void fetchHistoricalEvidence(kind, id, controller.signal)
      .then(records => { if (!controller.signal.aborted) setHistory({ identity, records, loading: false, error: null }); })
      .catch(error => {
        if (!controller.signal.aborted) setHistory(previous => ({ identity, records: previous?.identity === identity ? previous.records : [], loading: false, error: error instanceof Error ? error.message : 'Could not load previous evidence.' }));
      });
    void fetchEvidence(kind, id, { signal: controller.signal })
      .then(records => { if (!controller.signal.aborted) setState({ identity, records, loading: false, error: null }); })
      .catch(error => {
        if (!controller.signal.aborted) setState(previous => ({ identity, records: previous?.identity === identity ? previous.records : [], loading: false, error: error instanceof Error ? error.message : 'Could not load evidence.' }));
      });
    return () => controller.abort();
  }, [kind, id, identity, attempt]);
  const current = state?.identity === identity ? state : null;
  const previous = history?.identity === identity ? history : null;

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Evidence" pageSubtitle="Everything you have submitted, and where it is in review"
      userName={real?.name || 'Learner'} userRole={`${real?.programme || 'Apprenticeship'} Apprentice`}
    >
      <PageContainer>
        {loadError && <LearnerLoadError error={loadError} onRetry={refresh} />}
        <EvidenceBody
          key={identity}
          learnerKind={kind}
          learnerId={id}
          real={real}
          canProgress={canProgress}
          showReadOnlyNotice={showReadOnlyNotice}
          evidenceRecords={current?.records ?? []}
          historicalRecords={previous?.records ?? []}
          historicalLoading={previous?.loading ?? (!!kind && !!id)}
          historicalError={previous?.error ?? null}
          evidenceLoading={current?.loading ?? (!!kind && !!id)}
          evidenceError={current?.error ?? null}
          reloadEvidence={reloadEvidence}
        />
      </PageContainer>
    </WorkspaceShell>
  );
}
