import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TransferRequests } from './TransferRequestsView';
import styles from './TransferProgress.module.css';

export { TransferRequests } from './TransferRequestsView';

// Served at /users/progress-transfers, in the enrolment workspace's sidebar.
export default function ProgressTransfersPage() {
  const { auth } = useAuth();
  return <WorkspaceShell role="compliance" roleLabel={roleNavMap.apprentice.label} navItems={roleNavMap.apprentice.items} workspaceLabel={roleNavMap.apprentice.workspaceLabel} pageTitle="Transfer Progress" pageSubtitle="Review learner requests to move progress to the new LMS.">
    {auth.account?.role === 'admin' ? <TransferRequests /> : <div className={styles.page}><p role="alert">Only administrators can review and approve progress transfers.</p></div>}
  </WorkspaceShell>;
}
