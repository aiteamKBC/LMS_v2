import { useAuth } from './useAuth';
import { parsePersonalLearning } from '@/lib/personalLearning';

/**
 * Whether the person looking at a learner's workspace may act *as* that learner.
 *
 * Learners can work on their own record. Administrators can use the same
 * actions for a selected learner, with their own account retained in the
 * server audit trail. Other staff and employer previews remain read-only.
 * `login.permissions.learner_self_or_admin` enforces the same rule at the API.
 */
export interface LearnerWorkspaceAccess {
  /**
   * May the viewer open and complete training-plan activities, upload evidence
   * and submit reflections for this learner? Available to the owner and admin.
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
  const personal = parsePersonalLearning(learnerId);

  const isSelf = Boolean(
    account
      && account.role === 'learner'
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
  const isAdmin = account?.role === 'admin'
    && Number.isSafeInteger(Number(learnerId)) && Number(learnerId) > 0;
  const canProgress = personal
    ? isInitialized && account?.role === 'admin' && account.id === personal.accountId
    : isDemoPreview || (isInitialized && (isSelf || isAdmin));

  return { canProgress, showReadOnlyNotice: isInitialized && !canProgress };
}
