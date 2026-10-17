import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Product change: remote curriculum tracking is disabled application-wide.
 * Verify zero polling/remote refresh while retaining local-save invalidation.
 */
const CHANNEL_NAME = 'kbc-lms-writes';
const EPOCH_URL = '/curriculum_api/curriculum/cache-epoch/';
const PROGRAMMES_URL = '/curriculum_api/curriculum/programmes/';

type FakeMessage = { data: unknown };
const registry = new Map<string, Set<FakeChannel>>();

class FakeChannel {
  name: string;
  onmessage: ((event: FakeMessage) => void) | null = null;
  closed = false;
  constructor(name: string) {
    this.name = name;
    const peers = registry.get(name) || new Set<FakeChannel>();
    peers.add(this);
    registry.set(name, peers);
  }
  postMessage(data: unknown) {
    registry.get(this.name)?.forEach(peer => {
      if (peer === this || peer.closed) return;
      peer.onmessage?.({ data: structuredClone(data) });
    });
  }
  close() { this.closed = true; registry.get(this.name)?.delete(this); }
  addEventListener() {}
  removeEventListener() {}
}

/** Stands in for the colleague's tab, next to ours in the same browser. */
function otherTab() {
  return new FakeChannel(CHANNEL_NAME);
}


let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const callsTo = (url: string) => fetchMock.mock.calls.filter(call => String(call[0]) === url).length;
const loadApi = async () => { vi.resetModules(); return import('@/lib/curriculumApi'); };

describe('curriculum remote tracking disabled', () => {
  beforeEach(() => {
    vi.useFakeTimers(); registry.clear(); localStorage.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    fetchMock = vi.fn(async () => json({ results: [{ id: 'p1', name: 'Programme' }] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    registry.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('does not request the epoch on import, subscriptions, timers or browser events', async () => {
    const api = await loadApi();
    const listeners = [vi.fn(), vi.fn(), vi.fn()];
    const stops = listeners.map(listener => api.subscribeCurriculumRemoteWrites(listener));
    await vi.advanceTimersByTimeAsync(120_000);
    for (const type of ['focus', 'online', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.dispatchEvent(new Event(type));
    }
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsTo(EPOCH_URL)).toBe(0);
    listeners.forEach(listener => expect(listener).not.toHaveBeenCalled());
    stops.forEach(stop => { stop(); stop(); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores remote writes and retains its cached snapshot until explicitly refreshed', async () => {
    const api = await loadApi();
    const listener = vi.fn();
    const stop = api.subscribeCurriculumRemoteWrites(listener);
    await api.fetchCurriculumProgrammes();
    otherTab().postMessage({ path: '/curriculum/programmes/p1/', scope: 'curriculum', at: Date.now() });
    await api.fetchCurriculumProgrammes();
    expect(listener).not.toHaveBeenCalled();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);
    await api.fetchCurriculumJson('/curriculum/programmes/', { revalidate: true });
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
    expect(callsTo(EPOCH_URL)).toBe(0);
    stop();
  });

  it('invalidates local saved records without broadcasting or starting a delayed epoch read', async () => {
    const api = await loadApi();
    const listener = vi.fn();
    const stop = api.subscribeCurriculumRemoteWrites(listener);
    const peer = otherTab(); const broadcast = vi.fn(); peer.onmessage = broadcast;
    await api.fetchCurriculumProgrammes();
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);
    await api.fetchCurriculumJson('/curriculum/programmes/p1/', { method: 'PATCH', body: JSON.stringify({ name: 'Updated' }) });
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(callsTo(EPOCH_URL)).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    stop();
  });

  it('does not cache a preview that started before a local save', async () => {
    const api = await loadApi();
    let finish!: (response: ReturnType<typeof json>) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const path = '/curriculum/preview/module-session-plan/';
    const preview = () => api.fetchCurriculumJson(path, { method: 'POST', body: '{}' });
    const stale = preview();
    await api.fetchCurriculumJson('/curriculum/programmes/p1/', { method: 'PATCH', body: '{}' });
    finish(json({ results: [{ id: 'p1', name: 'Old' }] }));
    await stale;
    await preview();
    expect(callsTo(`/curriculum_api${path}`)).toBe(2);
    expect(callsTo(EPOCH_URL)).toBe(0);
  });
});
