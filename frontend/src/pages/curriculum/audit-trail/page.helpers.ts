import { curriculumNavItems } from '@/mocks/navigation';
import type { AuditTrailScope } from '@/features/audit-trail/scope';


export const curriculumAuditScope: AuditTrailScope = {
  workspace: 'curriculum',
  basePath: '/curriculum/audit-trail',
  role: 'curriculum',
  roleLabel: 'Curriculum Designer',
  workspaceLabel: 'Curriculum Studio',
  navItems: curriculumNavItems,
  subjectLabel: 'Curriculum Studio',
  // Fixed to curriculum, so no filter. A page reached from Curriculum's own
  // sidebar that could be switched to show Safeguarding is not a scoped page,
  // it is a mislabelled one.
  showWorkspaceFilter: false,
};
