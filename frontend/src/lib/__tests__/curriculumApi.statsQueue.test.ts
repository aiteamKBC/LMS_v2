import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearCurriculumGetCache, fetchProgrammeKsbStats } from '@/lib/curriculumApi';

const responses: Array<(response: Response) => void> = [];
const signals: AbortSignal[] = [];
const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
  responses.push(resolve);
  signals.push(init.signal as AbortSignal);
  init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
}));
const reply = (programmeId: string, status = 200) => new Response(JSON.stringify({ programmeId }), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  vi.useFakeTimers();
  clearCurriculumGetCache();
  responses.length = 0;
  signals.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  clearCurriculumGetCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('dispatches four programmes one at a time and shares a repeated request', async () => {
  const reads = ['A', 'B', 'C', 'D', 'A'].map(id => fetchProgrammeKsbStats(id));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  for (const [index, id] of ['A', 'B', 'C', 'D'].entries()) {
    expect(String(fetchMock.mock.calls[index][0])).toContain(`/programmes/${id}/ksb-stats/`);
    responses[index](reply(id));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(Math.min(index + 2, 4));
  }
  expect((await Promise.all(reads)).map(row => row.programmeId)).toEqual(['A', 'B', 'C', 'D', 'A']);
});

it('allows a cold read past 30 seconds and starts the next timeout at dispatch', async () => {
  const first = fetchProgrammeKsbStats('A');
  const next = fetchProgrammeKsbStats('B');
  await vi.advanceTimersByTimeAsync(90_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(signals[0].aborted).toBe(false);
  responses[0](reply('A'));
  await first;
  await vi.advanceTimersByTimeAsync(90_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(signals[1].aborted).toBe(false);
  responses[1](reply('B'));
  await next;
});

it('releases the queue on failure and still bounds a stalled request', async () => {
  const first = fetchProgrammeKsbStats('A');
  const failure = expect(first).rejects.toThrow(/timed out/);
  const next = fetchProgrammeKsbStats('B');
  await vi.advanceTimersByTimeAsync(120_000);
  await failure;
  expect(signals[0].aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  responses[1](reply('B'));
  expect((await next).programmeId).toBe('B');
});

it('drops a queued read every caller has left, before it is sent', async () => {
  // A page that queued its cards' numbers and was then left: B and C were
  // still waiting behind A when their pages unmounted.
  const leaving = new AbortController();
  const first = fetchProgrammeKsbStats('A');
  const abandoned = fetchProgrammeKsbStats('B', leaving.signal);
  const abandonedTwice = fetchProgrammeKsbStats('C', leaving.signal);
  const next = fetchProgrammeKsbStats('D');
  const leftB = expect(abandoned).rejects.toThrow(/aborted/i);
  const leftC = expect(abandonedTwice).rejects.toThrow(/aborted/i);
  leaving.abort();
  await leftB;
  await leftC;
  responses[0](reply('A'));
  await first;
  await vi.advanceTimersByTimeAsync(0);
  // Straight from A to D: B and C were never sent.
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[1][0])).toContain('/programmes/D/ksb-stats/');
  responses[1](reply('D'));
  expect((await next).programmeId).toBe('D');
});

it('still sends a queued read while any caller is waiting for it', async () => {
  const leaving = new AbortController();
  const first = fetchProgrammeKsbStats('A');
  const left = fetchProgrammeKsbStats('B', leaving.signal);
  const staying = fetchProgrammeKsbStats('B', new AbortController().signal);
  const leftEarly = expect(left).rejects.toThrow(/aborted/i);
  leaving.abort();
  await leftEarly;
  responses[0](reply('A'));
  await first;
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  responses[1](reply('B'));
  expect((await staying).programmeId).toBe('B');
});

it('starts a fresh read for a newcomer rather than joining one that was dropped', async () => {
  const leaving = new AbortController();
  const first = fetchProgrammeKsbStats('A');
  const abandoned = fetchProgrammeKsbStats('B', leaving.signal);
  const left = expect(abandoned).rejects.toThrow(/aborted/i);
  leaving.abort();
  await left;
  // Arrives after B's only caller left, while B is still queued.
  const newcomer = fetchProgrammeKsbStats('B');
  responses[0](reply('A'));
  await first;
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  responses[1](reply('B'));
  expect((await newcomer).programmeId).toBe('B');
});

it('lets a read already sent finish after its caller leaves', async () => {
  const leaving = new AbortController();
  const sent = fetchProgrammeKsbStats('A', leaving.signal);
  const left = expect(sent).rejects.toThrow(/aborted/i);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  leaving.abort();
  await left;
  // The network request itself is not cancelled; its answer warms the cache.
  expect(signals[0].aborted).toBe(false);
  responses[0](reply('A'));
  await vi.advanceTimersByTimeAsync(0);
  expect((await fetchProgrammeKsbStats('A')).programmeId).toBe('A');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
