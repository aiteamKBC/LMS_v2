import { useAuth } from '@/hooks/useAuth';

/**
 * The signed-in staff member's display name + role label, for the
 * `userName`/`userRole` props every staff `WorkspaceShell` page shows in its
 * header, and for attributing an action locally before the server's own
 * response (which now derives the real actor from the session) comes back.
 *
 * Falls back to generic labels when no account is loaded (e.g. the
 * `previewAs` demo mode, which sets `account: null` deliberately).
 */
export function useOperatorIdentity(): { name: string; role: string } {
  const { auth } = useAuth();
  const account = auth.account;
  return {
    name: account?.displayName || account?.email || 'Staff member',
    role: account?.position || 'Staff',
  };
}
