// One person's activity, scoped to Curriculum Studio.
//
// A person's own page rather than a panel over the list: an audit finding is
// something people send each other, and a link to it has to survive being
// pasted into a message. Same component as `/admin/audit-trail/people/:email`,
// scoped to curriculum and drawn inside Curriculum Studio's chrome.
import AuditTrailPersonView from '@/features/audit-trail/AuditTrailPersonView';
import { curriculumAuditScope } from '../page';

export default function CurriculumAuditTrailPersonPage() {
  return <AuditTrailPersonView scope={curriculumAuditScope} />;
}
