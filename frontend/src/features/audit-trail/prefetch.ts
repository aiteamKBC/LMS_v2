/**
 * Fetching a person's activity before it is asked for.
 *
 * The People list is the fast read — one aggregated row per person. A person's
 * own activity is the slow one: every visit, every page in it, every action on
 * each page. Loading all of it up front to fill a list nobody has clicked yet
 * would make the list itself late, so the list loads alone and the detail is
 * warmed behind it.
 *
 * Two triggers, because they cover different ways of arriving:
 *
 * * **Intent** — the pointer crosses a row, or it takes keyboard focus. The
 *   gap between that and the click is usually enough for the whole request.
 * * **Idle** — the first few rows, warmed once the list has settled. The top of
 *   a list sorted by "last seen" is where people actually click.
 *
 * Nothing is stored here. `fetchPersonActivity` is a cached GET, so a prefetch
 * simply fills the same cache entry the person page will read, keyed by the
 * same path — which is why the window has to match, and why the link carries
 * it. A prefetch that fails is forgotten: the person page will ask again and
 * report the failure itself, where there is somewhere to show it.
 */

import { fetchPersonActivity } from '@/lib/curriculumApi';

/** How many rows are warmed without being asked for. */
export const IDLE_PREFETCH_ROWS = 8;

/** Spacing between idle prefetches, so they queue behind anything the reader does. */
const IDLE_GAP_MS = 300;

export interface PrefetchKey {
  email: string;
  days: number;
  workspace: string;
}

function keyOf({ email, days, workspace }: PrefetchKey): string {
  return `${email.toLowerCase()}|${days}|${workspace}`;
}

/**
 * Remembers what has already been asked for.
 *
 * Row intent fires every time the pointer crosses a row, and a list of two
 * hundred people is easy to sweep across; without this, one pass of the mouse
 * would be two hundred requests.
 */
export class ActivityPrefetcher {
  private readonly seen = new Set<string>();

  private timers: ReturnType<typeof setTimeout>[] = [];

  /** Warms one person. Safe to call repeatedly; only the first call fetches. */
  prefetch(key: PrefetchKey): void {
    if (!key.email) return;
    const id = keyOf(key);
    if (this.seen.has(id)) return;
    this.seen.add(id);
    fetchPersonActivity(key.email, { days: key.days, workspace: key.workspace || undefined })
      .catch(() => {
        // Forgotten rather than remembered as done, so the next intent retries.
        // The page that actually needs this will ask again and say so if it
        // fails; a prefetch has nowhere to report to and must stay silent.
        this.seen.delete(id);
      });
  }

  /** Warms the top of the list, spaced out, once it has settled. */
  prefetchTop(emails: string[], days: number, workspace: string): void {
    this.cancelIdle();
    emails.slice(0, IDLE_PREFETCH_ROWS).forEach((email, index) => {
      this.timers.push(setTimeout(() => this.prefetch({ email, days, workspace }), index * IDLE_GAP_MS));
    });
  }

  /** Drops queued idle work — the window changed, or the page is leaving. */
  cancelIdle(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Forgets what was warmed. Used when the window or workspace changes. */
  reset(): void {
    this.cancelIdle();
    this.seen.clear();
  }
}
