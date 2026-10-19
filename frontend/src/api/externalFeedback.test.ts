import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('external feedback API', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

  it('previews a file without calling the send endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: { valid: [], counts: {} } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { externalFeedbackApi } = await import('./externalFeedback');
    const file = new File(['Name,Email\nGuest,guest@example.test'], 'recipients.csv', { type: 'text/csv' });

    await externalFeedbackApi.preview({ campaignType: 'information_session', name: 'Welcome', sessionDate: '2026-10-17', formId: 4, file });

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/external-campaigns/', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect(body.get('preview')).toBe('true');
    expect(body.get('campaignType')).toBe('information_session');
  });

  it('sends only pending or failed recipients selected by the manager', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ attempted: 1, sent: 1, failed: 0, remaining: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    const { externalFeedbackApi } = await import('./externalFeedback');

    await externalFeedbackApi.send(8, [31]);

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/external-campaigns/8/', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'send', recipientIds: [31] }),
    }));
  });

  it('posts manual recipients for immediate campaign creation and delivery', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ campaign: {}, preview: {}, delivery: { sent: 1, failed: 0 } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { externalFeedbackApi } = await import('./externalFeedback');

    await externalFeedbackApi.createManual({
      campaignType: 'commitment_meeting', name: 'Initial meeting', sessionDate: '2026-10-17', formId: 7,
      manualRecipients: 'Alex Morgan, alex@example.com',
    });

    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect(body.get('manualRecipients')).toBe('Alex Morgan, alex@example.com');
    expect(body.get('file')).toBeNull();
    expect(body.get('preview')).toBe('false');
  });
});
