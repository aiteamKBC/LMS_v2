import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bulkGenerateProgressReviews,
  fetchActiveLearners,
  fetchLatestRun,
  fetchProgressReviewDownloadUrl,
  fetchReviewPack,
  fetchReviewPeriods,
  generateProgressReview,
} from '../progressReviews';

const response = (value: unknown, ok = true, status = ok ? 200 : 400) =>
  ({ ok, status, json: async () => value, text: async () => JSON.stringify(value) }) as Response;

describe('progressReviews api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches active learners from the correct endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ results: [{ learnerId: 42, fullName: 'Jordan Example' }] }));
    vi.stubGlobal('fetch', fetch);

    const learners = await fetchActiveLearners();

    expect(fetch).toHaveBeenCalledWith('/api/progress-reviews/learners/active/', expect.objectContaining({ cache: 'no-store' }));
    expect(learners).toEqual([{ learnerId: 42, fullName: 'Jordan Example' }]);
  });

  it('fetches review periods for a learner', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ results: [{ review_number: 1, review_date: '2026-03-26' }] }));
    vi.stubGlobal('fetch', fetch);

    const periods = await fetchReviewPeriods(42);

    expect(fetch).toHaveBeenCalledWith('/api/progress-reviews/42/periods/', expect.anything());
    expect(periods[0].review_number).toBe(1);
  });

  it('fetches the review pack with an optional review_date query param', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ learner: {}, review: {} }));
    vi.stubGlobal('fetch', fetch);

    await fetchReviewPack(42, '2026-06-15');

    expect(fetch).toHaveBeenCalledWith('/api/progress-reviews/42/pack/?review_date=2026-06-15', expect.anything());
  });

  it('omits the query string when no review_date is given', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ learner: {}, review: {} }));
    vi.stubGlobal('fetch', fetch);

    await fetchReviewPack(42);

    expect(fetch).toHaveBeenCalledWith('/api/progress-reviews/42/pack/', expect.anything());
  });

  it('posts to generate and returns the result', async () => {
    const result = { reviewId: 'run-1', learnerId: 42, generationStatus: 'completed' };
    const fetch = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal('fetch', fetch);

    const generated = await generateProgressReview(42);

    expect(fetch).toHaveBeenCalledWith(
      '/api/progress-reviews/42/generate/',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
    expect(generated).toEqual(result);
  });

  it('surfaces the server error message when generation fails', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: 'Only active learners.' }, false, 409));
    vi.stubGlobal('fetch', fetch);

    await expect(generateProgressReview(42)).rejects.toThrow('Only active learners.');
  });

  it('sends learner_ids and review_date on bulk generate', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ results: [] }));
    vi.stubGlobal('fetch', fetch);

    await bulkGenerateProgressReviews({ learnerIds: [1, 2], reviewDate: '2026-06-15' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/progress-reviews/bulk-generate/',
      expect.objectContaining({ body: JSON.stringify({ learner_ids: [1, 2], review_date: '2026-06-15' }) }),
    );
  });

  it('fetches a download url for a review id', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ url: 'https://example.blob.core.windows.net/x.pptx?sig=1' }));
    vi.stubGlobal('fetch', fetch);

    const url = await fetchProgressReviewDownloadUrl('run-1');

    expect(fetch).toHaveBeenCalledWith('/api/progress-reviews/run-1/download/', expect.anything());
    expect(url).toBe('https://example.blob.core.windows.net/x.pptx?sig=1');
  });

  it('checks for an existing deck scoped to one exact review date', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ exists: true, reviewId: 'run-1', generationStatus: 'completed' }));
    vi.stubGlobal('fetch', fetch);

    const result = await fetchLatestRun(42, '2026-10-26');

    expect(fetch).toHaveBeenCalledWith('/api/progress-reviews/42/runs/latest/?review_date=2026-10-26', expect.anything());
    expect(result).toEqual({ exists: true, reviewId: 'run-1', generationStatus: 'completed' });
  });

  it('throws a clear error when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchActiveLearners()).rejects.toThrow('Could not reach the server');
  });
});
