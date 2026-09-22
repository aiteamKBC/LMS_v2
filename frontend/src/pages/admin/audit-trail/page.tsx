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

export const systemAuditScope: AuditTrailScope = {
  // Empty: every workspace. The filter narrows it; the server resolves whatever
  // it is given against its own route table and ignores a value it does not
  // recognise, so a stale bookmark cannot produce a silently empty page.
  workspace: '',
  basePath: '/admin/audit-trail',
  role: 'admin',
  roleLabel: 'Super Admin',
  workspaceLabel: 'Super Admin',
  navItems: adminNavItems,
  subjectLabel: 'the LMS',
  showWorkspaceFilter: true,
};

export default function SystemAuditTrailPage() {
  return <AuditTrailView scope={systemAuditScope} />;
}
