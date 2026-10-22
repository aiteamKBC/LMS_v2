import { useSyncExternalStore } from 'react';
import type { AuthUser } from '@/api/auth';
import { clearAllCachedResources } from '@/api/cachedRequest';

let revision = 0;
const resets = new Set<() => void>();
const listeners = new Set<() => void>();
export const getAuthCacheRevision = () => revision;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useAuthCacheRevision = () => useSyncExternalStore(subscribe, getAuthCacheRevision, getAuthCacheRevision);

/** Register module caches without coupling the auth provider to their hooks. */
export function registerAuthCacheReset(reset: () => void): void {
  resets.add(reset);
}

export function invalidateAuthCaches(): void {
  revision += 1;
  clearAllCachedResources();
  // Clear persisted hints even if the navigation hook has not been loaded yet.
  try {
    const prefixes = ['learner_status:', 'learner_kind:', 'learner_previous_learning:',
      'learner_ready_for_learning:', 'learner_onboarding_status:', 'learner_first_session_unlocked:'];
    Object.keys(sessionStorage).forEach(key => {
      if (prefixes.some(prefix => key.startsWith(prefix))) sessionStorage.removeItem(key);
    });
  } catch { /* storage is optional */ }
  resets.forEach(reset => reset());
  listeners.forEach(notify => notify());
}

/** Only identity/access fields: display-name and last-login updates are not boundaries. */
export function authCacheIdentity(account: AuthUser): string {
  return JSON.stringify([
    account.id, account.role, account.subjectType, account.subjectId, account.learnerType,
    [...account.permissions].sort(), account.access, [...(account.accesses ?? [])].sort(),
    account.accessHome, account.accessNavRole, account.accessWorkspaces,
    account.learnerRecordId, account.learnerRecordKind, account.hasLegacyRecord,
    [...(account.organisationIds ?? [])].sort(), account.programme,
  ]);
}
