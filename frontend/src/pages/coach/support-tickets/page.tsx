import { useSyncExternalStore } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from "@/hooks/useAuth";
import { coachViewAs, subscribeCoachViewAs } from '@/lib/coachViewAs';
import { roleNavMap } from '@/mocks/navigation';
import { LmsTickets } from './LmsTickets';

const coachNav = roleNavMap.coach;

export default function CoachSupportTicketsPage() {
  const { auth } = useAuth();
  const viewedCoach = useSyncExternalStore(subscribeCoachViewAs, coachViewAs);

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Support Tickets"
      pageSubtitle="LMS support tickets for your learners"
    >
      <PageContainer className="space-y-4">
        <PageHeader
          title="Support Tickets"
          description="LMS support tickets for learners on your caseload."
          icon="ri-lifebuoy-line"
        />
        <LmsTickets
          key={`${auth.account?.id}:${viewedCoach?.email ?? ''}`}
          accountId={auth.account?.id}
          coachEmail={viewedCoach?.email}
          active
        />
      </PageContainer>
    </WorkspaceShell>
  );
}
