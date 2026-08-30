// Exactly 3 dedicated demo accounts — one per programme — replacing the
// earlier 9 cohort-style accounts (learner-me-l4-jul25@learner.local and
// friends). Those 9 no longer define this flow; see
// backend/login/management/commands/seed_inspection_demo_learners.py for how
// these 3 are provisioned, and demoProgrammeMaterials.ts for the
// programme/material structure each one shows.
const LEARNER_FLOW_EMAILS = new Set([
  'learner-me@learner.local',
  'learner-mm@learner.local',
  'learner-pcp@learner.local',
]);

/** Accounts provisioned for the focused post-enrolment learner flow. */
export function isLearnerFlowAccount(email: string | null | undefined): boolean {
  return LEARNER_FLOW_EMAILS.has((email || '').trim().toLowerCase());
}

/**
 * The same 3 provisioned accounts also carry a programme-inspection/demo
 * overlay (material-level and programme-level expected vs. actual time, and an
 * editable "demo time" for showing off the full flow). Kept as its own name —
 * even though the account list is identical to the focused flow above — so
 * call sites read as "is this the inspection-demo layer" rather than reusing
 * the flow-routing check for an unrelated purpose.
 */
export function isInspectionDemoAccount(email: string | null | undefined): boolean {
  return isLearnerFlowAccount(email);
}

/**
 * The focused flow has one materials landing page and one visual content runner.
 * Video and quiz use their own route implementations behind that runner, while
 * reflection and results are phases on those same pages.
 */
export function isLearnerFlowPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/learner/materials') return true;

  return /^\/learner\/(?:component|video|quiz)\/(?:apprenticeship|commercial)\/[^/]+\/[^/]+$/.test(path);
}
