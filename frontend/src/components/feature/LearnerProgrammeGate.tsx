import type { ReactNode } from 'react';

// The cohort-start restriction was removed. Keep this route wrapper transparent:
// an additional learner-summary read used to prevent the activity's own request
// from starting, or freeze an open assignment after an unrelated summary timeout.
// Pages own their data loading/errors; RequireAuth, FirstSessionGate and the API
// continue to enforce session, access and ownership checks.
export function LearnerProgrammeGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
