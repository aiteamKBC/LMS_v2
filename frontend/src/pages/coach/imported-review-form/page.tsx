import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { ImportedReviewHistory } from '@/pages/learner/reviews/ImportedReviewHistory';

const coachNav = roleNavMap.coach;

export default function CoachImportedReviewForm() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const { kind = '', learnerId = '', reviewId = '' } = useParams();
  const routeState = location.state as { returnTo?: string; learnerName?: string } | null;
  const validKind = kind === 'apprenticeship' || kind === 'commercial';

  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Review Form" pageSubtitle={routeState?.learnerName || 'Imported learner review'} userName={coach.name} userRole="Progress Coach">
    <PageContainer>
      <div className="mb-3 flex justify-end"><button type="button" onClick={() => navigate(routeState?.returnTo || '/coach/progress-reviews')} className="inline-flex h-9 items-center rounded-lg border border-primary-200 bg-white px-4 text-[12px] font-semibold text-primary-700 shadow-sm hover:bg-primary-50">Back</button></div>
      <Panel>
        {validKind && learnerId && reviewId
          ? <ImportedReviewHistory kind={kind as LearnerKind} learnerId={learnerId} category="reviews" reviewId={reviewId} />
          : <EmptyState variant="error" title="Unable to open this review form." description="The learner or imported review reference is missing." />}
      </Panel>
    </PageContainer>
  </WorkspaceShell>;
}
