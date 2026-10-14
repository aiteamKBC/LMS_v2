import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('event feedback API', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

  it('loads only the event access represented by the bearer token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event: {}, recipient: {}, forms: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { eventFeedbackApi } = await import('./eventFeedback');

    await eventFeedbackApi.publicAccess('private token');

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/public-event/', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'read', token: 'private token' }),
      headers: expect.objectContaining({ 'X-CSRFToken': 'csrf-1' }),
    }));
  });

  it('gets CSRF protection before submitting a guest response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: { id: 7, status: 'completed' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { eventFeedbackApi } = await import('./eventFeedback');

    await eventFeedbackApi.savePublicResponse('token-1', 4, { 9: 'Excellent' }, true);

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/public-event/', expect.objectContaining({
      method: 'POST', credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRFToken': 'csrf-1' }),
      body: JSON.stringify({ token: 'token-1', formId: 4, answers: { 9: 'Excellent' }, submit: true }),
    }));
  });

  it('can explicitly replace existing attendee links', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ attempted: 2, sent: 2, failed: 0, remaining: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    const { eventFeedbackApi } = await import('./eventFeedback');

    await eventFeedbackApi.sendInvitations('4', true);

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/events/4/campaign/', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ resendAll: true }),
    }));
  });
});
