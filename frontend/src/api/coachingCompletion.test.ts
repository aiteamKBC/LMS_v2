import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import type { AuthUser } from '@/api/auth';
import { clearAllCachedResources } from './cachedRequest';
import { hasCoachAccess, loadCompletionNotifications, updateCompletionNotifications } from './coachingCompletion';
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const account = { id: 1, role: 'staff', access: 'coach' } as AuthUser;
const item = { id: 'completion:1', reminderId: 1, text: 'Synthetic MCM session', unread: true,
  createdAt: '2026-10-24T12:00:00Z', link: '/coach/coaching-recordings?date=2026-10-23' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('completion reminders client', () => {
  beforeEach(() => { clearAllCachedResources(); vi.mocked(coachFetch).mockReset(); });
  it('coalesces reads and keeps accounts separate without polling or document requests', async () => {
    vi.mocked(coachFetch).mockImplementation(async () => response({ items: [item] }));
    await Promise.all([loadCompletionNotifications(account), loadCompletionNotifications(account)]);
    await loadCompletionNotifications(account);
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/completion-notifications', expect.any(Object));
    await loadCompletionNotifications({ ...account, id: 2 }); expect(coachFetch).toHaveBeenCalledTimes(2);
    await loadCompletionNotifications(account, true); expect(coachFetch).toHaveBeenCalledTimes(3);
  });
  it('invalidates only after successful read/dismiss mutation', async () => {
    vi.mocked(coachFetch).mockImplementation(async (_url, init) => response(init?.method === 'POST' ? { updated: 1 } : { items: [item] }));
    await loadCompletionNotifications(account);
    await updateCompletionNotifications(account, [1], 'read');
    await loadCompletionNotifications(account);
    expect(coachFetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(coachFetch).mock.calls[1][1]?.body).toBe(JSON.stringify({ ids: [1], action: 'read' }));
  });
  it('rejects malformed data, external targets and permission failures without caching success', async () => {
    for (const body of [null, { items: [{ ...item, link: 'https://other.invalid' }] }, { items: [{ ...item, reminderId: '1' }] }]) {
      vi.mocked(coachFetch).mockResolvedValueOnce(response(body));
      await expect(loadCompletionNotifications(account)).rejects.toThrow('could not be loaded');
    }
    vi.mocked(coachFetch).mockResolvedValueOnce(response({ error: 'Coach access is required.' }, 403));
    await expect(loadCompletionNotifications(account)).rejects.toThrow('Coach access');
    expect(coachFetch).toHaveBeenCalledTimes(4);
  });
  it('requires a real coach grant, including additional grants', () => {
    expect(hasCoachAccess(account)).toBe(true);
    expect(hasCoachAccess({ ...account, access: 'tutor', accesses: ['tutor', 'coach'] })).toBe(true);
    expect(hasCoachAccess({ ...account, access: 'curriculum', accesses: ['curriculum'] })).toBe(false);
    expect(hasCoachAccess({ ...account, role: 'learner' })).toBe(false);
  });
});
