// The Coach workspace's door onto the Audit Trail.
//
// Who opened the Coach workspace, whose caseload they opened it as, which pages
// they read, what they searched and exported, and what they changed: meetings,
// absence reports, review answers, marking feedback. The page itself lives in
// `@/features/audit-trail` and is the same component `/admin/audit-trail` and
// `/curriculum/audit-trail` render. This file supplies the scope.
//
// Three audit pages maintained apart would drift, and the one that drifted
// would keep looking authoritative while saying something untrue — so there is
// one implementation, and a scope per door.
import { useMemo } from 'react';
import AuditTrailView from '@/features/audit-trail/AuditTrailView';
import { coachAuditTrailNavItem, coachNavItems } from '@/mocks/navigation';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import type { AuditTrailScope } from '@/features/audit-trail/scope';

export const coachAuditScope: AuditTrailScope = {
  workspace: 'coach',
  basePath: '/coach/audit-trail',
  role: 'coach',
  roleLabel: 'Coach',
  workspaceLabel: 'Coach Workspace',
  navItems: coachNavItems,
  subjectLabel: 'the Coach workspace',
  // Fixed to coach. A page reached from the Coach sidebar that could be
  // switched to show Safeguarding is not a scoped page, it is a mislabelled
  // one. The system-wide door at /admin/audit-trail is where every workspace is
  // read together.
  showWorkspaceFilter: false,
};

/**
 * The same scope, with the rail this page can honestly draw.
 *
 * This is the one Coach destination that reads every coach rather than the
 * selected one, so an administrator can open it from `/workspace/coach` before
 * choosing anybody. The rest of the coach nav cannot come with it: those links
 * read the selected coach, and with none chosen they would open a caseload, a
 * timetable and a marking queue belonging to nobody. Same condition the picker
 * itself uses, so the rail is the picker's rail until a coach is chosen and the
 * full one afterwards.
 */
export function useCoachAuditScope(): AuditTrailScope {
  const { canChooseCoach, isViewingAsCoach } = useCoachIdentity();
  const choosing = canChooseCoach && !isViewingAsCoach;
  return useMemo(
    () => (choosing ? { ...coachAuditScope, navItems: [coachAuditTrailNavItem] } : coachAuditScope),
    [choosing],
  );
}

export default function CoachAuditTrailPage() {
  return <AuditTrailView scope={useCoachAuditScope()} />;
}
