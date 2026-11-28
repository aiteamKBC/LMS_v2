import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardHeader } from '../dashboardHeader';
import { clearAllCachedResources } from '../cachedRequest';
import { invalidateLearnerReads, readLearnerJson } from '../learnerRead';

beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });
const reply = (name: string) => new Response(JSON.stringify({ learner: { id: '7', name }, coach: { name: 'Example Coach', email: 'coach@example.test', phone: '000000000' }, modules: [], moduleLabel: 'Module', initialWeeklyModuleId: null, nextReview: null, nextLiveSession: null, nextAssignment: null }), { status: 200 });

describe('Canonical Header presentation transport', () => {
  it('rejects a legacy response instead of silently using it', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ learner: { name: 'Learner' }, schedule: {} })));
    await expect(dashboardHeader.read('commercial', '7')).rejects.toThrow('Header response required');
  });
  it('shares one initial request and snapshot across callers', async () => {
    vi.mocked(fetch).mockResolvedValue(reply('Learner'));
    const [first, second] = await Promise.all([dashboardHeader.read('commercial', '7'), dashboardHeader.read('commercial', '7')]);
    expect(first).toBe(second);
    expect(first.coach).toEqual({ name: 'Example Coach', email: 'coach@example.test', phone: '000000000' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('X-LMS-Header-Version')).toBeNull();
    expect(dashboardHeader.peek('commercial', '7')).toBe(first);
  });

  it('isolates bootstrap, learner kinds and learner IDs', async () => {
    vi.mocked(fetch).mockImplementation(async () => reply('Learner'));
    await Promise.all([dashboardHeader.read('commercial', '7'), dashboardHeader.read('commercial', '8'),
      dashboardHeader.read('apprenticeship', '7'), readLearnerJson('/learner_api/dashboard/commercial/7/bootstrap/', { ttlMs: 30_000 })]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('uses existing invalidation after mutations rather than retaining a stale Header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply('Before')).mockResolvedValueOnce(reply('After'));
    await dashboardHeader.read('commercial', '7');
    invalidateLearnerReads();
    expect(dashboardHeader.peek('commercial', '7')).toBeUndefined();
    expect((await dashboardHeader.read('commercial', '7')).learner.name).toBe('After');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
