// One person's activity across the whole LMS.
//
// Same component as Curriculum Studio's own person page, with the workspace
// scope left open — so this shows every visit they made anywhere, not only the
// ones inside one workspace.
import AuditTrailPersonView from '@/features/audit-trail/AuditTrailPersonView';
import { systemAuditScope } from '../page';

export default function SystemAuditTrailPersonPage() {
  return <AuditTrailPersonView scope={systemAuditScope} />;
}
