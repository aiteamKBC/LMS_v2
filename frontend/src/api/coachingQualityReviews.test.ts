import { beforeEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import { clearAllCachedResources } from './cachedRequest';
import { qualityContext, qualityPdf, saveQualityReview, QualityReviewError, type QualityReview, type QualityForm } from './coachingQualityReviews';
vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
describe('Quality review request limits', () => {
  beforeEach(() => { clearAllCachedResources(); vi.mocked(learningFetch).mockReset(); vi.mocked(coachFetch).mockReset(); });
  it('shares context reads while separating learners and signed meeting references', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => response({ review: null }));
    await Promise.all([qualityContext('event', 'signed', '1'), qualityContext('event', 'signed', '1')]);
    expect(learningFetch).toHaveBeenCalledOnce();
    await qualityContext('event', 'signed', '2'); await qualityContext('event', 'other-signed', '1');
    expect(learningFetch).toHaveBeenCalledTimes(3);
  });
  it('preserves CSRF transport and explicit save ID/version, then invalidates reads', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => response({ review: null }));
    await qualityContext('event', 'signed', '1');
    const payload = { learnerId: '1', expectedVersion: 2, requestId: 'retry-id', status: 'draft', form: {} as QualityForm };
    vi.mocked(coachFetch).mockResolvedValue(response({ review: { id: 'saved', version: 3 } }));
    await saveQualityReview(payload, 'saved');
    expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/reviews/saved'), expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) }));
    await qualityContext('event', 'signed', '1'); expect(learningFetch).toHaveBeenCalledTimes(2);
  });
  it('returns an explicit conflict and does not cache failures', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ error: 'Reload this version' }, 409)).mockResolvedValueOnce(response({ review: null }));
    await expect(qualityContext('event')).rejects.toBeInstanceOf(QualityReviewError);
    await qualityContext('event'); expect(learningFetch).toHaveBeenCalledTimes(2);
  });
  it('reuses the same PDF for preview/download and separates saved revisions', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => new Response('%PDF-1.4 synthetic', { headers: { 'Content-Type': 'application/pdf' } }));
    const review = { id: 'saved', version: 1 } as QualityReview;
    const blobs = await Promise.all([qualityPdf(review), qualityPdf(review)]);
    expect(blobs[0]).toBe(blobs[1]); expect(learningFetch).toHaveBeenCalledOnce();
    await qualityPdf({ ...review, version: 2 }); expect(learningFetch).toHaveBeenCalledTimes(2);
  });
});
