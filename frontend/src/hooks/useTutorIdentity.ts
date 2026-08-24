import { useSyncExternalStore } from 'react';
import { useAuth } from './useAuth';
import { subscribeTutorViewAs, tutorViewAs, type TutorViewAs } from '@/lib/tutorViewAs';

const SUPER_ADMIN_ACCESS = 'super-admin';
const TUTOR_ACCESS = 'tutor';

/** The tutor whose workspace an administrator currently has open, or null. */
export function useTutorViewAs(): TutorViewAs | null {
  return useSyncExternalStore(subscribeTutorViewAs, tutorViewAs, () => null);
}

/**
 * Whose workspace the tutor pages should show.
 *
 * The same shape as `useCoachIdentity`, and the same rule: a tutor is always
 * themselves — the signed-in account is the single source of truth — while an
 * administrator, who teaches nothing, picks a tutor and reads that workspace
 * instead. A selection made by a different admin is ignored here as well as
 * cleared in the store, so the render before the account resolves cannot show
 * somebody else's choice.
 */
export function useTutorIdentity() {
  const { auth, isInitialized } = useAuth();
  const viewAs = useTutorViewAs();
  const account = auth.account;
  const access = String(account?.access || '').trim().toLowerCase();
  const ownsTutorWorkspace = access === TUTOR_ACCESS;
  const canChooseTutor = access === SUPER_ADMIN_ACCESS;
  const viewingAs = canChooseTutor && viewAs?.adminEmail === String(account?.email || '').trim().toLowerCase()
    ? viewAs
    : null;

  return {
    /**
     * The selected tutor's address, which may be blank — a tutor added under
     * Curriculum with no email is resolved by name instead, and the workspace
     * endpoint accepts either.
     */
    viewingEmail: viewingAs?.email || '',
    email: viewingAs?.email || (ownsTutorWorkspace ? account?.email || '' : ''),
    name: viewingAs?.name || account?.displayName || auth.user?.fullName || 'Tutor',
    /** True while an admin reads somebody else's workspace. */
    isViewingAsTutor: Boolean(viewingAs),
    /** True for an admin, who picks whose workspace to open. */
    canChooseTutor,
    ownsTutorWorkspace,
    isInitialized,
  };
}
