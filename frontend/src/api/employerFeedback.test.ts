import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('employer feedback transport', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('loads only the selected employer queue and delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ forms: [], form: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    const { feedbackApi } = await import('./feedback');
    await feedbackApi.employerForms('7');
    await feedbackApi.employerForm('7', '501');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/engagement_api/feedback/employers/7/', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/employers/7/501/', expect.objectContaining({ credentials: 'include' }));
  });

  it('sends draft and submit answers with CSRF and no client-supplied respondent identity', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-token' }) })
      .mockResolvedValue({ ok: true, json: async () => ({ response: { id: 901 } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { feedbackApi } = await import('./feedback');
    await feedbackApi.saveEmployerResponse('7', '501', { '12': 'Draft' });
    await feedbackApi.saveEmployerResponse('7', '501', { '12': 'Complete' }, true);
    expect(fetchMock.mock.calls[1]).toEqual(['/engagement_api/feedback/employers/7/501/response/', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ answers: { '12': 'Draft' }, submit: false }),
      headers: expect.objectContaining({ 'X-CSRFToken': 'synthetic-token' }),
    })]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ answers: { '12': 'Complete' }, submit: true });
  });

  it('uploads photos through the assigned employer delivery with CSRF', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ answer: { uploadId: 'photo-1', filename: 'synthetic.png' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { feedbackApi } = await import('./feedback');
    await feedbackApi.uploadEmployerPhoto('7', '501', 12, new File(['synthetic'], 'synthetic.png', { type: 'image/png' }));
    expect(fetchMock.mock.calls[1][0]).toBe('/engagement_api/feedback/employers/7/501/questions/12/photo/');
    expect(fetchMock.mock.calls[1][1].headers['X-CSRFToken']).toBe('synthetic-token');
    expect(fetchMock.mock.calls[1][1].body).toBeInstanceOf(FormData);
  });

  it('surfaces API ownership errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Feedback not found.' }) }));
    const { feedbackApi } = await import('./feedback');
    await expect(feedbackApi.employerForm('7', '999')).rejects.toThrow('Feedback not found.');
  });
});
