import { afterEach, expect, it, vi } from 'vitest';
import { fetchBulkAttendanceLearners } from '../bulkAttendanceLearners';

afterEach(() => vi.unstubAllGlobals());

it('reads learner names with the authenticated transport and abort signal', async () => {
  const learners = [{ id: '42', name: 'Alex Example', email: 'alex@example.invalid' }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ learners })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await fetchBulkAttendanceLearners(controller.signal)).toEqual(learners);
  expect(fetch).toHaveBeenCalledWith('/curriculum_api/curriculum/bulk-attendance/learners/',
    expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('shows source failures instead of returning an empty directory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Directory unavailable' }), { status: 503 })));
  await expect(fetchBulkAttendanceLearners()).rejects.toThrow('Directory unavailable');
});

it('rejects an invalid directory response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(fetchBulkAttendanceLearners()).rejects.toThrow('invalid response');
});
