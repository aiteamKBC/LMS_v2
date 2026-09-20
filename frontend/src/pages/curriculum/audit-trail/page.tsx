// Curriculum Studio's door onto the Audit Trail.
//
// The page itself lives in `@/features/audit-trail` and is the same component
// `/admin/audit-trail` renders. This file supplies the scope: the workspace to
// read, and the chrome to draw it inside. Two audit pages that looked alike but
// were maintained apart would eventually stop agreeing, and the one that drifted
// would keep looking authoritative while saying something untrue — so there is
// one implementation, and two scopes.
import AuditTrailView from '@/features/audit-trail/AuditTrailView';
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

export default function CurriculumAuditTrailPage() {
  return <AuditTrailView scope={curriculumAuditScope} />;
}
