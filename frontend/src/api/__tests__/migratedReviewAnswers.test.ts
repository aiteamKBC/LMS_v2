import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryMigratedMonthlyLogSignature, saveMigratedReviewPartyAnswers, signMigratedReviewAsParty } from '../learnerCalendar';

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

describe('Aptem MCM signature transport', () => {
  it.each([true, false])('sends the learner choice (%s) and preserves partial success', async applyMonthlyLogSignature => {
    const result = { signed: true, role: 'participant', monthlyLogSync: { status: 'failed', month: '2026-10' } };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'synthetic' })))
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    expect(await signMigratedReviewAsParty('imported-review:42', 'saved-image', { applyMonthlyLogSignature })).toEqual(result);
    expect(fetch).toHaveBeenLastCalledWith('/learner_api/migrated-reviews/imported-review%3A42/party-sign', expect.objectContaining({
      credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': 'synthetic' },
      body: JSON.stringify({ signature: 'saved-image', applyMonthlyLogSignature }),
    }));
  });

  it('retries the saved request without sending a new image, month or learner identity', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'synthetic' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ signed: true, role: 'participant', monthlyLogSync: { status: 'synced' } })));
    vi.stubGlobal('fetch', fetch);
    await retryMigratedMonthlyLogSignature('imported-review:42');
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ retryMonthlyLogSignature: true }));
  });

  it('preserves the existing PR signing payload', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'synthetic' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ signed: true, role: 'participant' })));
    vi.stubGlobal('fetch', fetch);
    await signMigratedReviewAsParty('imported-review:42', 'image');
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ signature: 'image' }));
  });

  it('surfaces a retry authorization failure without automatic requests', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'synthetic' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Not permitted.' }), { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(retryMigratedMonthlyLogSignature('imported-review:42')).rejects.toThrow('Not permitted.');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
