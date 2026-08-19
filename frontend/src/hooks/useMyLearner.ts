import type { LearnerKind } from '@/api/learnerDetail';

/**
 * Bridges the (mock) logged-in auth user to a REAL DB learner (Active_users /
 * Commercial_users) so the learner's own sidebar pages — /learner/this-week,
 * /learner/training-plan (no :kind/:id in the URL) — can show real data.
 *
 * The auth layer is still mock (Sophie Williams @ learner@kbc.test) with no
 * link to a real learner id, so we map to a concrete real learner here. The
 * bare /learner/* routes ARE the learner's own workspace, so this always
 * resolves (not gated on role) — a viewer on those routes is looking at "the
 * learner's" pages by definition. Swap MY_LEARNER for a real session→learner
 * lookup once auth is backend-wired.
 *
 * WHICH learner the bare pages resolve to is "the last learner you opened by
 * URL": when a page loads /workspace/learner/:kind/:id (or any /learner/:kind/:id
 * page), it calls rememberLearner() to persist that learner to localStorage
 * (`my_learner`). Paramless sidebar navigation then follows that same learner
 * instead of a hardcoded default — otherwise clicking "Training Plan" while
 * viewing learner A would jump to the pinned default learner.
 */
// Current source id for the default demo learner after the enrolment-table
// merge. Explicitly selected learners still override this value.
const MY_LEARNER: { kind: LearnerKind; id: string } = { kind: 'commercial', id: '19' };
const STORAGE_KEY = 'my_learner';

function isKind(v: unknown): v is LearnerKind {
  return v === 'commercial' || v === 'apprenticeship';
}

function readOverride(): { kind: LearnerKind; id: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isKind(parsed.kind) && parsed.id) {
      return { kind: parsed.kind, id: String(parsed.id) };
    }
  } catch { /* ignore malformed override */ }
  return null;
}

/** Return the selected learner, falling back to the default demo learner. */
export function getRememberedLearner(): { kind: LearnerKind; id: string } | null {
  return readOverride() || MY_LEARNER;
}

/**
 * Pin the *signed-in* learner as the active one.
 *
 * Called from the auth layer for every sign-in, session restore and refresh.
 * Without it, a learner opening /workspace/learner resolved to whatever was
 * last in localStorage — or, on a fresh browser, the hardcoded MY_LEARNER demo
 * record — so they were shown a different learner's dashboard entirely. That is
 * the "swap MY_LEARNER for a real session→learner lookup" note above: the
 * account now carries the real subject id, so this is that lookup.
 *
 * Only learner accounts are pinned. Staff and admins keep the
 * remembered-by-URL behaviour, which is what lets them page through learners.
 *
 * The kind is nominal: ids are unique across the single Created_users table and
 * every learner-scoped endpoint maps both kinds to the same model (see
 * learner_detail.SOURCE_MODELS), so it only has to be a valid value. A later
 * navigation carrying the real kind in the URL overwrites it anyway.
 */
export function rememberSignedInLearner(
  subjectType: string | undefined,
  subjectId: number | string | undefined,
  learnerType?: string | null,
): void {
  if (subjectType !== 'learner' || subjectId == null || subjectId === '') return;
  rememberLearner(learnerType === 'commercial' ? 'commercial' : 'apprenticeship', String(subjectId));
}

/** Persist the active learner so paramless /learner/* pages resolve to it. */
export function rememberLearner(kind: string | undefined, id: string | undefined): void {
  if (!isKind(kind) || !id) return;
  const current = readOverride();
  if (current && current.kind === kind && current.id === String(id)) return; // no-op if unchanged
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind, id: String(id) }));
  } catch { /* storage unavailable — fall back to default */ }
}

/** Resolve which real learner the bare /learner/* self-view pages should load. */
export function useMyLearner(): { kind: LearnerKind; id: string } {
  return readOverride() || MY_LEARNER;
}

/**
 * Resolve the learner a page should show: URL params win and, when present, are
 * persisted as the active learner (so subsequent paramless sidebar navigation
 * follows the same learner). Falls back to the remembered/default learner.
 *
 * Replaces the `urlId ?? myLearner?.id` idiom at every learner-page call site.
 */
export function useResolvedLearner(
  urlKind: string | undefined,
  urlId: string | undefined,
): { kind: LearnerKind | undefined; id: string | undefined } {
  // Persist synchronously while the URL still carries the learner — an effect
  // could fire after the user has already clicked a paramless sidebar link, so
  // the write must happen during this render (rememberLearner is idempotent).
  if (isKind(urlKind) && urlId) {
    rememberLearner(urlKind, urlId);
    return { kind: urlKind, id: urlId };
  }
  // No params — fall back to the remembered/default learner. (readOverride is
  // called directly, not via the useMyLearner hook, to keep this branch-safe.)
  const my = readOverride() || MY_LEARNER;
  return { kind: my.kind, id: my.id };
}
