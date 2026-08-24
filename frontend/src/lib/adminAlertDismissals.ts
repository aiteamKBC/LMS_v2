// ============================================================================
// Dismissed attention alerts on the Super Admin dashboard.
//
// Per account, not per browser and not per platform. Two administrators share a
// platform and often a machine; one of them deciding they have seen "3 failed
// sign-ins" must not decide it for the other, and signing out must not leave the
// next person's dashboard pre-silenced. So the store is keyed by the signed-in
// account's id, and an account with no id (nobody signed in) dismisses nothing.
//
// A dismissal is of a STATE, not of a subject. The signature an alert dismisses
// with includes its count, so hiding "1 invitation email failed to send" hides
// exactly that: when a second one fails, the alert is new news and comes back.
// Without that, one click would permanently blind an administrator to a problem
// that was still growing — which is the failure mode that makes dismissable
// alerts worse than no alerts.
//
// localStorage rather than the server because the ask is whose dismissal it is,
// not which devices it follows. If it should follow an administrator between
// machines, this module is the seam to move behind an API — every caller goes
// through read/dismiss/restore.
// ============================================================================

const KEY_PREFIX = 'kbc_admin_alerts_dismissed';

/** Where one account's dismissals live, or null when nobody is signed in. */
function storageKey(accountId: number | null | undefined): string | null {
  return accountId == null ? null : `${KEY_PREFIX}:${accountId}`;
}

/**
 * The signatures this account has dismissed.
 *
 * Never throws: localStorage can be unavailable (private mode, storage
 * disabled) or hold something another version wrote, and a dashboard that fails
 * to render because a preference could not be read would be a worse bug than
 * the one this prevents. An unreadable store means "nothing dismissed".
 */
export function readDismissed(accountId: number | null | undefined): Set<string> {
  const key = storageKey(accountId);
  if (!key) return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function write(accountId: number | null | undefined, signatures: Set<string>): void {
  const key = storageKey(accountId);
  if (!key) return;
  try {
    if (signatures.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...signatures]));
  } catch {
    // Storage full or blocked. The dismissal still applies for this session —
    // the caller holds it in state — it just will not survive a reload.
  }
}

/**
 * Record one dismissal, and drop any that no longer correspond to a live alert.
 *
 * `live` is every signature currently on the dashboard. Pruning against it is
 * what stops the store growing without bound as counts change, and it is why a
 * condition that clears and later returns is not still silenced: its old
 * signature was thrown away the moment the alert stopped firing.
 */
export function dismiss(
  accountId: number | null | undefined,
  signature: string,
  live: Iterable<string>,
): Set<string> {
  const liveSet = new Set(live);
  const next = new Set([...readDismissed(accountId)].filter((s) => liveSet.has(s)));
  next.add(signature);
  write(accountId, next);
  return next;
}

/** Bring everything back — the way out of a dismissal made by mistake. */
export function restoreAll(accountId: number | null | undefined): Set<string> {
  write(accountId, new Set());
  return new Set();
}
