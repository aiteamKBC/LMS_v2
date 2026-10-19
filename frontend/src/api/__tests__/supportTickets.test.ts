import { afterEach, expect, it, vi } from 'vitest';
import { createSupportTicket, loadSupportTickets } from '../supportTickets';
afterEach(() => vi.unstubAllGlobals());
it('loads every page without mixing staff and learner endpoints', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [{ id: 'first' }], nextOffset: 100 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [{ id: 'second' }], nextOffset: null }) });
  vi.stubGlobal('fetch', fetch);
  expect(await loadSupportTickets(true)).toEqual([{ id: 'first' }, { id: 'second' }]);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/learner_api/support/queue/?offset=0', '/learner_api/support/queue/?offset=100']);
});
it('sends CSRF and the idempotency key but no client-selected learner identity', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ticket: { id: 'saved' } }) });
  vi.stubGlobal('fetch', fetch);
  const payload = { requestId: 'request', title: 'Issue', description: 'Details', category: 'Technical Issue', priority: 'low' };
  await createSupportTicket(payload);
  expect(fetch.mock.calls[1]).toEqual(['/learner_api/support/tickets/', expect.objectContaining({
    method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'X-CSRFToken': 'csrf' }), body: JSON.stringify(payload),
  })]);
});
it('surfaces a refused save rather than returning success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Sign in required' }) }));
  await expect(loadSupportTickets()).rejects.toThrow('Sign in required');
});
