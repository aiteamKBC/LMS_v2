import { systemAuditScope } from './page.helpers';
// The system-wide Audit Trail.
//
// Who used the LMS — every workspace — when they were here, which pages they
// opened, what they did on each, and what they changed. The same component
// Curriculum Studio renders at `/curriculum/audit-trail`, with the workspace
// scope left open and the filter offered.
//
// The two halves do not currently reach equally far, and the page says so
// rather than implying otherwise: the reading half (visits, searches, exports)
// covers every workspace; the Changes feed covers the workspaces that write to
// a revision log, which the server names in `changeWorkspaces`.
import AuditTrailView from '@/features/audit-trail/AuditTrailView';
import { adminNavItems } from '@/mocks/navigation';
import type { AuditTrailScope } from '@/features/audit-trail/scope';

export default function SystemAuditTrailPage() {
  return <AuditTrailView scope={systemAuditScope} />;
}
