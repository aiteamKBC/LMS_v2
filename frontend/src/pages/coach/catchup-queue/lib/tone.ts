// ============================================================================
// Tone mapping for the catch-up queue.
//
// `status` values ('scheduled' / 'overdue' / 'completed') already match keys
// in the shared STATUS_TONE table 1:1 — statusTone() from '@/lib/statusTone'
// resolves them directly, so no local map is needed for status.
//
// `priority` ('high' / 'medium' / 'low') is not a status word the shared table
// knows about, so it gets its own small mapping here rather than a duplicate
// colour record. High priority carries the same urgency as "at risk", medium
// the same as "needs attention", and low priority reads as a genuinely fine
// state — the same choice the pre-refactor page made with its colour record.
// ============================================================================
import type { StatusTone } from '@/lib/statusTone';
import type { CatchUpItem } from '@/mocks/catchup-queue';

export function priorityTone(priority: CatchUpItem['priority']): StatusTone {
  if (priority === 'high') return 'critical';
  if (priority === 'medium') return 'caution';
  return 'positive';
}

/** "high" → "High". Used for both priority and status labels — neither the
 * mock data nor the calendar-derived items capitalise these for display. */
export function titleCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
