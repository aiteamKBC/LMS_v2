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
