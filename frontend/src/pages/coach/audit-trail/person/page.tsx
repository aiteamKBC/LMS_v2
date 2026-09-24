// One person's activity, scoped to the Coach workspace.
//
// A person's own page rather than a panel over the list: an audit finding is
// something people send each other, and a link to it has to survive being
// pasted into a message. Same component as `/admin/audit-trail/people/:email`,
// scoped to coach and drawn inside the Coach workspace's chrome.
import AuditTrailPersonView from '@/features/audit-trail/AuditTrailPersonView';
import { useCoachAuditScope } from '../page';

export default function CoachAuditTrailPersonPage() {
  return <AuditTrailPersonView scope={useCoachAuditScope()} />;
}
