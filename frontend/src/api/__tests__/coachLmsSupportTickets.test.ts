import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { clearCoachViewAs, setCoachViewAs } from '@/lib/coachViewAs';
import { coachLmsAttachmentUrl, loadCoachLmsTickets, replyToCoachLmsTicket } from '../coachLmsSupportTickets';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const fetch = vi.mocked(coachFetch);
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => fetch.mockReset());
afterEach(() => clearCoachViewAs());

it('loads all pages through the coach scoped transport and forwards cancellation', async () => {
  fetch.mockResolvedValueOnce(response({ tickets: [{ id: 'first' }], readOnly: false, nextOffset: 100 }))
    .mockResolvedValueOnce(response({ tickets: [{ id: 'second' }], readOnly: false, nextOffset: null }));
  const signal = new AbortController().signal;
  expect(await loadCoachLmsTickets(signal)).toEqual({ tickets: [{ id: 'first' }, { id: 'second' }], readOnly: false });
  expect(fetch.mock.calls).toEqual([
    ['/coach_api/coach/lms-support-tickets?offset=0', { signal }],
    ['/coach_api/coach/lms-support-tickets?offset=100', { signal }],
  ]);
});

it('sends text and the retry key through the CSRF-aware coach transport', async () => {
  fetch.mockResolvedValue(response({ ticket: { id: 'ticket' } }));
  expect(await replyToCoachLmsTicket('ticket', 'Reply', 'retry-key')).toEqual({ id: 'ticket' });
  expect(fetch).toHaveBeenCalledWith('/coach_api/coach/lms-support-tickets/ticket', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Reply', requestId: 'retry-key' }),
  });
});

it('surfaces a refused reply and a missing save confirmation', async () => {
  fetch.mockResolvedValueOnce(response({ error: 'Ticket not found.' }, 404)).mockResolvedValueOnce(response({}));
  await expect(replyToCoachLmsTicket('ticket', 'Reply', 'key')).rejects.toThrow('Ticket not found.');
  await expect(replyToCoachLmsTicket('ticket', 'Reply', 'key')).rejects.toThrow('did not confirm');
});

it('retains the selected coach for protected attachment downloads in admin view-as', () => {
  setCoachViewAs({ email: 'coach@example.invalid' }, 'admin@example.invalid');
  const url = new URL(coachLmsAttachmentUrl('ticket', 'file'), 'https://example.invalid');
  expect(url.pathname).toBe('/coach_api/coach/lms-support-tickets/ticket/attachments/file');
  expect(url.searchParams.get('viewAsCoach')).toBe('coach@example.invalid');
});
