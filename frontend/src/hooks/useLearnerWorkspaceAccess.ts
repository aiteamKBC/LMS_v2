import { useAuth } from './useAuth';

/**
 * Whether the person looking at a learner's workspace may act *as* that learner.
 *
 * Every staff surface that drills into a learner — the workspace overview, the
 * coach case file, the employer portal — reaches the learner's own pages, and
 * those pages were built for the learner: the training-plan rows open the quiz
 * runner, the video player and the component viewer, each of which ends by
 * writing a progress record against the learner. A caseowner opening a learner
 * to *look* at their week could therefore complete components as them, and the
 * progress log would record it as the apprentice's own work.
 *
 * That is not a tidiness problem. These records are the audit trail for
 * off-the-job hours and KSB coverage, so a component ticked off by staff is a
 * false claim about what the learner did, indistinguishable afterwards from the
 * real thing.
 *
 * So a viewer who is not the learner gets the workspace read-only. Booking a
 * coaching session is the single exception — arranging a catch-up is
 * administration, not a claim about the learner's own work.
 *
 * This is the UI half. The boundary that actually holds is
 * `login.permissions.learner_self_only`, which refuses the same writes at the
 * API; a hidden button is not a permission check.
 */
export interface LearnerWorkspaceAccess {
  /**
   * May the viewer open and complete training-plan activities, upload evidence
   * and submit reflections for this learner? True only for the learner
   * themselves.
   */
  canProgress: boolean;
  /**
   * Show the "read-only" explanation. Separate from `!canProgress` so the
   * banner does not flash on the learner's own page during the first render,
   * while the session is still resolving and `canProgress` is fail-closed.
   */
  showReadOnlyNotice: boolean;
}

/**
 * @param learnerId The learner whose workspace is open — the `:id` route param,
 *   or the remembered learner on the paramless self-view pages.
 */
export function useLearnerWorkspaceAccess(
  learnerId?: string | number | null,
): LearnerWorkspaceAccess {
  const { auth, isInitialized } = useAuth();
  const account = auth.account;

  const isSelf = Boolean(
    account
      && account.subjectType === 'learner'
      // Matched on id alone, like the server's gate: ids are unique across the
      // single Created_users table, so the learner kind is not part of it.
      && String(account.subjectId) === String(learnerId ?? ''),
  );

  // No server account once the session has resolved means the landing page's
  // "explore this section" shortcut (`useAuth.previewAs`), which sets local UI
  // state and holds no session. Those pages are a demo of the learner flow, so
  // they keep it — and they cannot write anything regardless, because every
  // progress endpoint now answers an unauthenticated POST with a 401.
  const isDemoPreview = isInitialized && !account;

  // Fail closed until the session resolves: a staff viewer who clicks in the
  // first frame must not get through. The learner loses nothing by it, since
  // every one of these actions is a deliberate click, not an auto-submit.
  const canProgress = isDemoPreview || (isInitialized && isSelf);

  return { canProgress, showReadOnlyNotice: isInitialized && !canProgress };
}
