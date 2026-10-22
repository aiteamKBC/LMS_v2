import { afterEach, expect, it, vi } from 'vitest';
import { createSupportTicket, loadSupportTickets, updateSupportTicket, ticketAttachmentUrl } from '../supportTickets';
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

it('sends files as multipart with CSRF and lets the browser set the boundary', async () => {
  const fetch = vi.fn().mockImplementation(async (_url, init) => ({ ok: true, json: async () => init?.method === 'POST' ? { ticket: { id: 'saved' } } : { csrfToken: 'csrf' } }));
  vi.stubGlobal('fetch', fetch);
  const files = [new File(['image'], 'screenshot.png', { type: 'image/png' }), new File(['error'], 'error.log')];
  const payload = { requestId: 'request', title: 'Issue', description: 'Details', category: 'Technical Issue', priority: 'low' };
  await createSupportTicket(payload, files);
  const init = fetch.mock.calls[1][1];
  expect(init.headers).toMatchObject({ 'X-CSRFToken': 'csrf' });
  expect(init.headers).not.toHaveProperty('Content-Type');
  expect(init.credentials).toBe('include');
  expect(init.body).toBeInstanceOf(FormData);
  expect(JSON.parse(init.body.get('payload'))).toEqual(payload);
  expect(init.body.getAll('attachments')).toEqual(files);
  const reply = { action: 'reply', requestId: 'reply', body: 'See log' };
  await updateSupportTicket('saved', reply, false, files);
  expect(fetch.mock.calls[3][0]).toBe('/learner_api/support/tickets/saved/');
  expect(JSON.parse(fetch.mock.calls[3][1].body.get('payload'))).toEqual(reply);
});

it('uses protected download endpoints for learners and support staff', () => {
  expect(ticketAttachmentUrl('ticket', 'file')).toBe('/learner_api/support/tickets/ticket/attachments/file/');
  expect(ticketAttachmentUrl('ticket', 'file', true)).toBe('/learner_api/support/queue/ticket/attachments/file/');
});
