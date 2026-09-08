import { lazy, type ComponentType } from 'react';

// ============================================================================
// Loading a code-split page after a deploy.
//
// Every route is its own chunk, named by content hash. A deploy replaces
// `/assets/*` with newly hashed files and the old ones stop existing — so a tab
// that was open across the deploy still holds an index.html referring to chunks
// that have gone. The next navigation asks for one, gets a 404, and React
// throws "Failed to fetch dynamically imported module".
//
// The page the reader wants does exist; only the name they were given is out of
// date, and the current name is in the index.html a reload would fetch. So a
// stale chunk reloads once, silently, and lands on the page that was asked for.
//
// Once, deliberately: if the chunk is missing for any other reason — a broken
// deploy, a purged CDN path, a network that fails on that one file — reloading
// forever would trap the reader in a flicker with nothing to read. The second
// failure is left to RouteErrorBoundary, which explains it and offers the
// reload as a choice.
// ============================================================================

const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i;

/** Marks that this tab has already reloaded for a missing chunk. */
const RELOAD_MARKER = 'lms:chunk-reload';

/**
 * How long to wait for the reload to take the page away before giving up on it.
 *
 * A reload can be refused — an unsaved-changes prompt, an extension, a browser
 * that throttles a backgrounded tab — and the loader promise deliberately never
 * settles, so without this the reader would sit in front of a skeleton for ever.
 * Rejecting hands them the error screen instead, which at least explains itself.
 */
const RELOAD_GRACE_MS = 5000;

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return STALE_CHUNK.test(message);
}

/** sessionStorage, but never throwing — private modes can refuse it. */
function marker(): { read: () => string | null; write: (value: string) => void; clear: () => void } {
  return {
    read: () => {
      try {
        return window.sessionStorage.getItem(RELOAD_MARKER);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        window.sessionStorage.setItem(RELOAD_MARKER, value);
      } catch {
        // A tab that cannot remember it reloaded is still better off reloading
        // than showing an error for a page that exists.
      }
    },
    clear: () => {
      try {
        window.sessionStorage.removeItem(RELOAD_MARKER);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

/**
 * Reload once for a stale chunk. Returns true when a reload was started, so
 * the caller can stop rather than surfacing an error the reader will never see.
 */
export function recoverFromStaleChunk(path = window.location.pathname): boolean {
  const store = marker();
  // Scoped to the path, not the whole URL: ?tab=x and ?tab=y are the same page
  // and the same chunk, so they must share one reload budget or a page with
  // query state could reload repeatedly. A genuinely different page whose chunk
  // is also stale still gets its own.
  if (store.read() === path) return false;
  store.write(path);
  window.location.reload();
  return true;
}

/**
 * Forget that this tab reloaded, so the next deploy gets the same one silent
 * recovery. Called when a chunk actually arrives — see lazyRoute.
 *
 * Deliberately not called when a route *renders*: the route tree suspends below
 * this, so an effect up there runs while the skeleton is on screen and the chunk
 * is still in flight. Clearing then would spend the loop guard before the retry
 * could fail, and a chunk missing for good would reload for ever.
 */
export function clearStaleChunkMarker(): void {
  marker().clear();
}

type Loader<T> = () => Promise<{ default: T }>;

/**
 * `lazy()` for a route, with the deploy case handled.
 *
 * On a stale chunk this reloads and returns a promise that does not settle while
 * the page is being replaced: resolving would render a component into a document
 * that is going away, and rejecting immediately would flash the error screen on
 * the way out. If the reload never happens, it rejects after RELOAD_GRACE_MS so
 * the reader gets that screen rather than an endless skeleton.
 *
 * A load that succeeds clears the marker — that, and not a route rendering, is
 * the moment a chunk is known to have arrived.
 */
export function lazyRoute<T extends ComponentType<never>>(loader: Loader<T>) {
  return lazy(() => loader()
    .then((loaded) => {
      // Here, and nowhere earlier: the chunk is now in hand. Clearing before
      // the load — which is what an effect on the router did, since the route
      // tree suspends below it — spent the loop guard while the skeleton was
      // still up, and a chunk missing for good then reloaded for ever.
      clearStaleChunkMarker();
      return loaded;
    })
    .catch((error: unknown) => {
      if (isStaleChunkError(error) && recoverFromStaleChunk()) {
        return new Promise<{ default: T }>((_resolve, reject) => {
          window.setTimeout(() => reject(error), RELOAD_GRACE_MS);
        });
      }
      throw error;
    }));
}
