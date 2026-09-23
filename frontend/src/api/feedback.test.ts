import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackFormInput } from './feedback';

afterEach(() => vi.unstubAllGlobals());

describe('feedback API write protection', () => {
  it('gets a CSRF token and sends it with form saves', async () => {
    const input: FeedbackFormInput = {
      title: 'Learner feedback', formType: 'post_lecture', programmeId: 'PROG-1',
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
});
