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
 * lookup once auth is backend-wired. A localStorage override (`my_learner`,
 * JSON {kind,id}) lets you point at a different learner without a rebuild.
 */
const MY_LEARNER: { kind: LearnerKind; id: string } = { kind: 'commercial', id: '2' };

function readOverride(): { kind: LearnerKind; id: string } | null {
  try {
    const raw = localStorage.getItem('my_learner');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if ((parsed.kind === 'commercial' || parsed.kind === 'apprenticeship') && parsed.id) {
      return { kind: parsed.kind, id: String(parsed.id) };
    }
  } catch { /* ignore malformed override */ }
  return null;
}

/** Resolve which real learner the bare /learner/* self-view pages should load. */
export function useMyLearner(): { kind: LearnerKind; id: string } {
  return readOverride() || MY_LEARNER;
}
