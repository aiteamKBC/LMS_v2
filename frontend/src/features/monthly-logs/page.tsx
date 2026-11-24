import { LearnerLogs } from './MonthlyLog';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from "@/hooks/useAuth";
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { roleNavMap } from '@/mocks/navigation';
import design from '@/features/old-otjh/design.module.css';
import journal from '@/features/old-otjh/journal.module.css';
import { type LogPerspective } from './api';
import styles from './monthlyLogs.module.css';
import { CoachLearnerLogs } from '@/features/coach/monthly-logs/components/CoachLearnerLogs';
import { CoachMonthlyLogLearners } from '@/features/coach/monthly-logs/components/CoachMonthlyLogLearners';

export default function MonthlyLogsPage() {
  const { auth } = useAuth();
  const { learnerId, kind, id: routeId, month } = useParams<{ learnerId?: string; kind?: string; id?: string; month?: string }>();
  const { pathname } = useLocation();
  const student = auth.account?.role === 'learner';
  const perspective: LogPerspective = student || pathname.startsWith('/learner/') ? 'learner' : 'coach';
  const selected = useResolvedLearner(student ? undefined : kind, student ? undefined : routeId);
  const id = student ? String(auth.account?.subjectId ?? '') : perspective === 'learner' ? selected.id : learnerId;
  const base = perspective === 'learner' ? student ? '/learner/monthly-logs' : `/learner/monthly-logs/${selected.kind}/${id}` : `/coach/monthly-logs/${id}`;
  const overview = student ? '/workspace/learner/dashboard' : `/workspace/learner/${selected.kind}/${id}/dashboard`;
  const nav = roleNavMap[perspective];
  const coachOverview = perspective === 'coach' && !month;
  return <WorkspaceShell role={perspective} roleLabel={nav.label} navItems={nav.items}
    workspaceLabel={nav.workspaceLabel} pageTitle="Monthly Logs" pageSubtitle="Your monthly learning record, activities and signatures"
    showBackButton backFallbackHref={month ? base : perspective === 'learner' ? overview : '/coach/monthly-logs'} hidePageChrome={coachOverview}>
    <PageContainer className={`${design.scope} ${design.page} ${styles.theme} ${month ? journal.canvas : ''} ${coachOverview ? styles.coachCanvas : ''}`}>
      {coachOverview ? <CoachMonthlyLogLearners selectedLearnerId={id} renderSelected={learner => {
        const learnerId = String(learner.id);
        return <CoachLearnerLogs key={`coach-${learnerId}`} id={learnerId} />;
      }} /> : id && perspective === 'coach' && month ? <CoachLearnerLogs key={`coach-${id}-${month}`} id={id} month={month} /> : id ? <LearnerLogs key={`${perspective}-${id}`} id={id} month={month} base={base} perspective={perspective} /> : perspective === 'learner'
        ? <EmptyState title="Your learner account is unavailable" /> : <EmptyState title="Choose a learner to view monthly logs" />}
    </PageContainer>
  </WorkspaceShell>;
}

export { LearnerLogs, MonthlyLog } from './MonthlyLog';
export type { MonthlyLogReader } from './MonthlyLog';
