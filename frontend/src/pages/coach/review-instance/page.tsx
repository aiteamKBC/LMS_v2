import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { roleNavMap } from '@/mocks/navigation';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { ReviewInstanceModal } from '../shared/ReviewInstanceModal';
import type { ReviewInstanceRouteState } from '../shared/reviewInstanceNavigation';

const coachNav = roleNavMap.coach;
const DEFAULT_RETURN_TO = '/coach/timetable';
const ALLOWED_RETURN_PATHS = [
  '/workspace/coach',
  '/coach/meetings',
  '/coach/monthly-coaching',
  '/coach/progress-reviews',
  '/coach/reviews',
  '/coach/learner-case-file',
  '/coach/timetable',
];

function safeReturnTo(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_RETURN_TO;
  return ALLOWED_RETURN_PATHS.some(path => value === path || value.startsWith(`${path}/`) || value.startsWith(`${path}?`))
    ? value
    : DEFAULT_RETURN_TO;
}

function routeState(value: unknown): Partial<ReviewInstanceRouteState> {
  return value && typeof value === 'object' ? value as Partial<ReviewInstanceRouteState> : {};
}

export default function CoachReviewInstancePage() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const { instanceId = '' } = useParams();
  const state = routeState(location.state);
  const returnTo = safeReturnTo(state.returnTo);
  const event = state.event && typeof state.event === 'object'
    ? state.event
    : { learner: null, programme: null };

  const leaveReview = () => navigate(returnTo, { replace: true });

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Review workspace"
      pageSubtitle="Complete the review one step at a time"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <PageContainer className="pb-10">
        {instanceId ? (
          <ReviewInstanceModal
            presentation="page"
            event={event}
            instanceId={instanceId}
            onClose={leaveReview}
          />
        ) : null}
      </PageContainer>
    </WorkspaceShell>
  );
}
