import { useEffect, useRef } from 'react';
import { publishCrossTabWrite, subscribeCrossTabWrites } from '@/lib/crossTabWrites';
import { readModuleLiveState } from './moduleAuthoringData';

/**
 * Hears, within a couple of seconds, that somebody else saved the open module.
 *
 * Polls one cheap endpoint for the counters of this module and its group --
 * not the estate-wide epoch every write moves, which is what made the old
 * global polling expensive. A counter that moved means "read what changed";
 * the caller does that through the changes feed. Same-browser tabs hear each
 * other at once through a BroadcastChannel.
 *
 * - Nothing runs unless the server says live sync is on (`enabled: false`
 *   stops the loop for the module, including the cross-tab path).
 * - A hidden tab does not poll; coming back polls at once.
 * - Two minutes without a key or a click slows it to every 10 seconds.
 * - Errors back off, doubling, up to 30 seconds.
 * - The estate-wide counter is used only as a backstop for writers that do
 *   not move the module counter: at most once a minute it asks "anything?".
 */

const LIVE_SCOPE = 'module-live';
const DEFAULT_POLL_MS = 2_000;
const IDLE_POLL_MS = 10_000;
const IDLE_AFTER_MS = 2 * 60_000;
const BACKSTOP_MS = 60_000;
const MAX_ERROR_BACKOFF_MS = 30_000;

export type ModuleLiveReason = 'scope' | 'backstop' | 'tab';

/** Tell this browser's other tabs that a module was just saved here. */
export function announceModuleWrite(moduleId: string) {
  if (moduleId) publishCrossTabWrite(LIVE_SCOPE, `module:${moduleId}`);
}

export interface ModuleLiveSyncOptions {
  moduleId: string;
  groupId?: string;
  enabled: boolean;
  onChange: (reason: ModuleLiveReason) => void;
}

export function useModuleLiveSync({ moduleId, groupId, enabled, onChange }: ModuleLiveSyncOptions): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || !moduleId) return undefined;
    const scopes = [`module:${moduleId}`, ...(groupId ? [`group:${groupId}`] : [])];
    let stopped = false;
    let serverEnabled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let known: Record<string, number> | null = null;
    let globalAtLastSync: number | null = null;
    let lastSyncAt = Date.now();
    let lastActivity = Date.now();
    let pollMs = DEFAULT_POLL_MS;
    let errors = 0;

    const hidden = () => typeof document !== 'undefined'
      && typeof document.visibilityState === 'string'
      && document.visibilityState !== 'visible';

    const fire = (reason: ModuleLiveReason, epoch?: number) => {
      lastSyncAt = Date.now();
      if (typeof epoch === 'number') globalAtLastSync = epoch;
      onChangeRef.current(reason);
    };

    const nextDelay = () => {
      if (errors) return Math.min(MAX_ERROR_BACKOFF_MS, pollMs * 2 ** errors);
      return Date.now() - lastActivity > IDLE_AFTER_MS ? Math.max(pollMs, IDLE_POLL_MS) : pollMs;
    };

    const schedule = (delay: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void tick(); }, delay);
    };

    async function tick() {
      if (stopped || hidden()) return; // a hidden tab is resumed by visibilitychange
      try {
        const state = await readModuleLiveState(scopes);
        if (stopped) return;
        if (!state.enabled) {
          // Switched off on the server: stop asking for this module.
          stopped = true;
          serverEnabled = false;
          return;
        }
        serverEnabled = true;
        errors = 0;
        pollMs = Math.max(1_000, state.pollMs || DEFAULT_POLL_MS);
        const epochs = state.epochs || {};
        const global = typeof state.epoch === 'number' ? state.epoch : undefined;
        if (known) {
          const previous = known;
          const moved = scopes.some(scope => (epochs[scope] ?? 0) !== (previous[scope] ?? 0));
          if (moved) {
            fire('scope', global);
          } else if (
            global !== undefined && globalAtLastSync !== null && global !== globalAtLastSync
            && Date.now() - lastSyncAt >= BACKSTOP_MS
          ) {
            fire('backstop', global);
          }
        } else if (global !== undefined) {
          globalAtLastSync = global;
        }
        known = epochs;
      } catch {
        errors += 1;
      }
      schedule(nextDelay());
    }

    const onVisible = () => {
      if (!hidden()) schedule(0);
    };
    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity > IDLE_AFTER_MS;
      lastActivity = Date.now();
      if (wasIdle) schedule(0);
    };
    const unsubscribe = subscribeCrossTabWrites(write => {
      if (!serverEnabled || write.scope !== LIVE_SCOPE || write.path !== `module:${moduleId}`) return;
      fire('tab');
    });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('keydown', onActivity, true);
    window.addEventListener('pointerdown', onActivity, true);
    schedule(0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('keydown', onActivity, true);
      window.removeEventListener('pointerdown', onActivity, true);
    };
  }, [enabled, moduleId, groupId]);
}
