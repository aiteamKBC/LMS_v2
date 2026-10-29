import { coachAuditScope, useCoachAuditScope } from './page.helpers';
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

export default function CoachAuditTrailPage() {
  return <AuditTrailView scope={useCoachAuditScope()} />;
}
