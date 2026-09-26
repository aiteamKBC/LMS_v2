import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackFormInput } from './feedback';

afterEach(() => vi.unstubAllGlobals());

describe('feedback API write protection', () => {
  it('gets a CSRF token and sends it with form saves', async () => {
    const input: FeedbackFormInput = {
      title: 'Learner feedback', formType: 'post_lecture', deliveryScope: 'module', programmeId: 'PROG-1',
      cohortId: 'COHORT-1', groupId: 'GROUP-1', moduleCatalogueId: 'MOD-1',
      description: '', instructions: '', startDate: null, dueDate: null,
      anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
      sections: [{ title: 'Learning', description: '', questions: [] }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'verified-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ form: { id: 1 } }) });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.createForm(input);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/engagement_api/feedback/csrf/', { credentials: 'include' });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      'X-CSRFToken': 'verified-token',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });

  it('loads the named recipients for a form with search and pagination', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipients: [], total: 0, page: 2, pageSize: 25 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.recipients(19, 'Martech learner', 2, 25);

    expect(fetchMock).toHaveBeenCalledWith(
      '/engagement_api/feedback/forms/19/recipients/?search=Martech+learner&page=2&pageSize=25',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('scopes staff learner-feedback preview reads to the selected learner', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ forms: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.myForms('125');
    await feedbackApi.myDelivery(21, '125');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/engagement_api/feedback/my-forms/?learnerId=125', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/my-deliveries/21/?learnerId=125', expect.objectContaining({ credentials: 'include' }));
  });
});
