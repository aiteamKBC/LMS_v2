/**
 * Tells the other tabs of this browser that a write just landed.
 *
 * Every tab holds its own copy of the caches in `curriculumApi` -- they are
 * plain module-level maps, so the tab that saves is the only one that knows to
 * throw its entries away. A second tab therefore kept serving pre-write rows
 * for the whole tier TTL (30s to 5 minutes), and because pages read once on
 * mount, nothing asked again even after the entry expired. The reader saw a
 * stale screen until they pressed refresh.
 *
 * The server has never been the problem: `invalidate_curriculum_cache()` bumps
 * a shared epoch, so any tab that asks gets current rows. This module is only
 * the missing nudge to ask.
 *
 * Same-origin and same-browser by definition. Two staff on two machines are a
 * different case, covered by the focus/visibility re-read in
 * `useRefreshOnReturn`.
 */

const CHANNEL_NAME = 'kbc-lms-writes';

export interface CrossTabWrite {
  /** The mutated API path, so a receiver can invalidate exactly what the
   *  writing tab invalidated. */
  path: string;
  /** Which API the path belongs to, so unrelated listeners can ignore it. */
  scope: string;
  at: number;
}

type Listener = (write: CrossTabWrite) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let channelReady = false;

function ensureChannel(): BroadcastChannel | null {
  if (channelReady) return channel;
  channelReady = true;
  // Absent in older Safari and in some test environments. A missing channel
  // must degrade to today's behaviour, never to a thrown render.
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = event => {
      const write = event.data as CrossTabWrite | undefined;
      if (!write || typeof write.path !== 'string') return;
      listeners.forEach(listener => {
        // One bad listener must not stop the rest from hearing the write.
        try { listener(write); } catch { /* ignore */ }
      });
    };
  } catch {
    channel = null;
  }
  return channel;
}

/** Announce a write to the other tabs. The posting tab never hears its own
 *  message back, so callers apply their local invalidation as they always did. */
export function publishCrossTabWrite(scope: string, path: string): void {
  const target = ensureChannel();
  if (!target) return;
  try {
    target.postMessage({ path, scope, at: Date.now() } satisfies CrossTabWrite);
  } catch {
    // A closed channel (tab tearing down) is not worth failing the save for.
  }
}

/** Hear writes from the other tabs. Returns the unsubscribe. */
export function subscribeCrossTabWrites(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test seam: drops the channel and every listener. */
export function resetCrossTabWrites(): void {
  listeners.clear();
  try { channel?.close(); } catch { /* ignore */ }
  channel = null;
  channelReady = false;
}
