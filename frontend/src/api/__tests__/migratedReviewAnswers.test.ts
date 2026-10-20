import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveMigratedReviewPartyAnswers } from '../learnerCalendar';

afterEach(() => vi.unstubAllGlobals());
describe('Aptem respondent answer transport', () => {
  it('sends version and CSRF without accepting a client role or identity', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'synthetic-csrf' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answerVersion: 'v2', sections: [] })));
    vi.stubGlobal('fetch', fetch);
    expect(await saveMigratedReviewPartyAnswers('imported-review:42', { question: 'Draft' }, 'v1')).toMatchObject({ answerVersion: 'v2' });
    expect(fetch).toHaveBeenLastCalledWith('/learner_api/migrated-reviews/imported-review%3A42/party-answers', expect.objectContaining({
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': 'synthetic-csrf' },
      body: JSON.stringify({ answers: { question: 'Draft' }, answerVersion: 'v1' }),
    }));
  });
  it('surfaces a conflict and never retries a stale write automatically', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'synthetic' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'This review changed.' }), { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    await expect(saveMigratedReviewPartyAnswers('imported-review:42', { question: 'Draft' }, 'v1')).rejects.toThrow('This review changed.');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('requires a loaded version before sending any requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(saveMigratedReviewPartyAnswers('imported-review:42', {})).rejects.toThrow('Reopen the review');
    expect(fetch).not.toHaveBeenCalled();
  });
});
