import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { PageContainer } from '@/components/ui/PageContainer';
import { EvidenceBody } from './components/EvidenceBody';

const learnerNav = roleNavMap.learner;

/** The learner's evidence library — uploads, their review status and the KSBs
 * each one covers. Split out from the old merged "Evidence & Progress" page so
 * evidence (what you submit) and progress (OTJ hours and KSB coverage, what
 * those submissions add up to) are two destinations rather than tabs. */
export default function EvidencePage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { real } = useLearnerDetailParam(kind, id);
  const { canProgress, showReadOnlyNotice } = useLearnerWorkspaceAccess(id);

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

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Evidence" pageSubtitle="Everything you have submitted, and where it is in review"
      userName={real?.name || 'Learner'} userRole={`${real?.programme || 'Apprenticeship'} Apprentice`}
    >
      <PageContainer>
        <EvidenceBody
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
      </PageContainer>
    </WorkspaceShell>
  );
}
