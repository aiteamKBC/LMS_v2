import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two ways a tab finds out that somebody else changed the curriculum: a
 * BroadcastChannel message from another tab of this browser, and the epoch
 * counter moving on the server when the writer is on another machine entirely.
 *
 * Every case here is really asserting one thing. After somebody else writes,
 * the next read goes to the network instead of being answered out of this tab's
 * cache -- which is the whole of the bug these were built for.
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

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

let serverEpoch: number;
/** The server's log of which path moved the counter, as the endpoint returns it. */
let serverChanges: unknown[];
let epochResponder: (() => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(call => String(call[0]) === url).length;
}

async function loadApi() {
  vi.resetModules();
  return import('@/lib/curriculumApi');
}

describe('curriculum cache invalidation across tabs and machines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registry.clear();
    serverEpoch = 1;
    serverChanges = [];
    epochResponder = null;
    setVisibility('visible');
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      const respond = String(url) === EPOCH_URL
        ? (epochResponder ? epochResponder() : json({ epoch: serverEpoch, changes: serverChanges }))
        : json({ results: [{ id: 'p1', name: 'Programme' }] });
      const signal = init?.signal;
      if (!signal) return respond;
      // Real fetch rejects when its signal aborts; a mock that ignores the
      // signal would let a hung read look like a healthy one.
      return Promise.race([
        respond,
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        }),
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    registry.clear();
    setVisibility('visible');
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -- BroadcastChannel: the other tab of this browser ----------------------

  it('answers a repeat read from cache while nobody has written', async () => {
    const api = await loadApi();
    await api.fetchCurriculumProgrammes();
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);
  });

  it('re-reads from the network after another tab writes', async () => {
    const api = await loadApi();
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);

    otherTab().postMessage({ path: '/curriculum/programmes/p1/', scope: 'curriculum', at: Date.now() });

    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
  });

  it('tells subscribed pages which path another tab wrote', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));

    otherTab().postMessage({ path: '/curriculum/groups/g1/', scope: 'curriculum', at: Date.now() });

    expect(heard).toEqual(['/curriculum/groups/g1/']);
    stop();
  });

  it('ignores a write broadcast by some other part of the app', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));

    otherTab().postMessage({ path: '/learner/notes/1/', scope: 'learner', at: Date.now() });

    expect(heard).toEqual([]);
    stop();
  });

  it("announces this tab's own writes to the others", async () => {
    const api = await loadApi();
    const heardElsewhere: unknown[] = [];
    const listener = otherTab();
    listener.onmessage = event => heardElsewhere.push(event.data);

    await api.fetchCurriculumJson('/curriculum/programmes/', {
      method: 'POST',
      body: JSON.stringify({ name: 'New' }),
    });

    expect(heardElsewhere).toEqual([
      expect.objectContaining({ path: '/curriculum/programmes/', scope: 'curriculum' }),
    ]);
  });

  it("does not fire a page's own remote-write listener for its own save", async () => {
    // The saving page refreshes on the save path already; firing here as well
    // would read everything back twice for one click.
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));

    await api.fetchCurriculumJson('/curriculum/programmes/', { method: 'POST', body: '{}' });

    expect(heard).toEqual([]);
    stop();
  });

  // -- Epoch poll: the colleague on another machine -------------------------

  it('records where the counter is without refreshing anything on first read', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));

    await vi.advanceTimersByTimeAsync(0);

    expect(callsTo(EPOCH_URL)).toBe(1);
    expect(heard).toEqual([]);
    stop();
  });

  it('says nothing while the counter sits still', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(25_000);

    expect(callsTo(EPOCH_URL)).toBe(3);
    expect(heard).toEqual([]);
    stop();
  });

  it('refreshes when a write on another machine moves the counter', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);

    serverEpoch = 2; // the user in Egypt saved
    await vi.advanceTimersByTimeAsync(25_000);

    // A counter cannot say which record moved, so the listener is told only
    // that something did, and the cache goes in full.
    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
    stop();
  });

  // -- the change log: refreshing what moved, not everything -----------------

  it('refreshes only the collection the server says was written', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);

    // Somebody edited a KSB set, which has nothing to do with the programme
    // list this tab is holding.
    serverEpoch = 2;
    serverChanges = [{ path: '/curriculum/ksb-sets/', lo: 1, hi: 2 }];
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual(['/curriculum/ksb-sets/']);
    // The point of the whole exercise: the programme list was not thrown away,
    // so this is still answered from cache rather than costing a rebuild.
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(1);
    stop();
  });

  it('reports every path in the span, once each', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    serverEpoch = 4;
    serverChanges = [
      { path: '/curriculum/ksb-sets/', lo: 1, hi: 2 },
      { path: '/curriculum/programmes/', lo: 2, hi: 3 },
      { path: '/curriculum/ksb-sets/', lo: 3, hi: 4 },
    ];
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual(['/curriculum/ksb-sets/', '/curriculum/programmes/']);
    stop();
  });

  it('refreshes everything when the log does not account for every epoch', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    await api.fetchCurriculumProgrammes();

    // Three writes happened; the log only accounts for the last one. The
    // missing entry could have been anything, so nothing may be trusted.
    serverEpoch = 4;
    serverChanges = [{ path: '/curriculum/ksb-sets/', lo: 3, hi: 4 }];
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);
    await api.fetchCurriculumProgrammes();
    expect(callsTo(PROGRAMMES_URL)).toBe(2);
    stop();
  });

  it('refreshes everything when the log entries are unusable', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    serverEpoch = 2;
    serverChanges = [{ path: 42, lo: 'one', hi: null }, null, 'nonsense'];
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);
    stop();
  });

  it('refreshes everything when the counter has gone backwards', async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    serverEpoch = 6;
    serverChanges = [{ path: '/curriculum/ksb-sets/', lo: 1, hi: 6 }];
    await vi.advanceTimersByTimeAsync(25_000);
    heard.length = 0;

    // A restarted cache counts from zero again. Our entries were built against
    // a numbering that no longer exists, so none of them can be reasoned about.
    serverEpoch = 2;
    serverChanges = [{ path: '/curriculum/ksb-sets/', lo: 1, hi: 2 }];
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);
    stop();
  });

  it("does not read our own save back as somebody else's work", async () => {
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    await api.fetchCurriculumJson('/curriculum/programmes/', { method: 'POST', body: '{}' });
    serverEpoch = 2; // our own write moved it

    await vi.advanceTimersByTimeAsync(1_500);  // the quiet resync lands
    await vi.advanceTimersByTimeAsync(25_000); // the next ordinary tick

    expect(heard).toEqual([]);
    stop();
  });

  it('does not lose the quiet resync when a poll is already in flight', async () => {
    // Our save can land while an ordinary tick is still waiting on the wire.
    // Dropping the resync there leaves the counter behind, and the next tick
    // reads our own write back as though a stranger had made it.
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    let release: (value: unknown) => void = () => {};
    epochResponder = () => new Promise(resolve => { release = resolve; });
    await vi.advanceTimersByTimeAsync(25_000); // a tick, now hanging

    await api.fetchCurriculumJson('/curriculum/programmes/', { method: 'POST', body: '{}' });
    serverEpoch = 2;
    await vi.advanceTimersByTimeAsync(1_500);  // the resync fires mid-flight

    epochResponder = null;
    release(json({ epoch: 1 }));               // that read predates our write
    await vi.advanceTimersByTimeAsync(0);      // the deferred resync runs

    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual([]);
    stop();
  });

  it('recovers from a read that never comes back', async () => {
    // Without a deadline the in-flight guard would stay set and this tab would
    // never poll again -- silently, for as long as it stayed open.
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    epochResponder = () => new Promise(() => {}); // never settles
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(10_000);    // the read gives up

    epochResponder = null;
    serverEpoch = 4;
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);
    stop();
  });

  it('stops polling once the last page has gone', async () => {
    const api = await loadApi();
    const stop = api.subscribeCurriculumRemoteWrites(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(callsTo(EPOCH_URL)).toBe(1);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(callsTo(EPOCH_URL)).toBe(1);
  });

  it('keeps one timer however many pages are subscribed', async () => {
    const api = await loadApi();
    const stops = [1, 2, 3, 4].map(() => api.subscribeCurriculumRemoteWrites(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    // Four subscribers, one seeding read.
    expect(callsTo(EPOCH_URL)).toBe(1);

    await vi.advanceTimersByTimeAsync(25_000);
    expect(callsTo(EPOCH_URL)).toBe(2);
    stops.forEach(stop => stop());
  });

  it('gives up when the backend does not serve the counter yet', async () => {
    // The frontend can ship ahead of the backend. Calling a 404 every 25s for
    // the life of the tab is not an acceptable way to find that out.
    epochResponder = () => json({ detail: 'Not Found' }, 404);
    const api = await loadApi();
    const stop = api.subscribeCurriculumRemoteWrites(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(callsTo(EPOCH_URL)).toBe(3);

    await vi.advanceTimersByTimeAsync(100_000);
    expect(callsTo(EPOCH_URL)).toBe(3);
    stop();
  });

  it('keeps polling across a server restart and reports the write after it', async () => {
    // A dropped connection is the server coming back, not the endpoint being
    // absent. A tab left open across a deploy has to still be live afterwards.
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    epochResponder = () => { throw new TypeError('Failed to fetch'); };
    for (let tick = 0; tick < 4; tick += 1) await vi.advanceTimersByTimeAsync(25_000);
    expect(heard).toEqual([]);

    epochResponder = null;
    serverEpoch = 9;
    await vi.advanceTimersByTimeAsync(25_000);

    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);
    stop();
  });

  it("treats a login page answering in the endpoint's place as absent", async () => {
    // A proxy that returns index.html with a 200 is the deployment gap again.
    epochResponder = () => json({ notAnEpoch: true });
    const api = await loadApi();
    const stop = api.subscribeCurriculumRemoteWrites(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(100_000);

    expect(callsTo(EPOCH_URL)).toBe(3);
    stop();
  });

  it('does not poll a tab that is not on screen', async () => {
    setVisibility('hidden');
    const api = await loadApi();
    const stop = api.subscribeCurriculumRemoteWrites(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(75_000);

    expect(callsTo(EPOCH_URL)).toBe(0);
    stop();
  });

  it('catches the counter up quietly when the tab is looked at again', async () => {
    // Coming back to the tab triggers its own re-read. The poll only has to
    // avoid treating what happened while it was hidden as fresh news on top.
    setVisibility('hidden');
    const api = await loadApi();
    const heard: string[] = [];
    const stop = api.subscribeCurriculumRemoteWrites(path => heard.push(path));
    await vi.advanceTimersByTimeAsync(0);

    serverEpoch = 5;
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(callsTo(EPOCH_URL)).toBe(1);
    expect(heard).toEqual([]);

    // ...and from there the next real change is reported normally.
    serverEpoch = 6;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(heard).toEqual([api.UNKNOWN_WRITE_PATH]);

    stop();
  });
});
