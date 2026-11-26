import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { learningFetch } from '@/lib/personalLearning';
import { saveTeachingQualityReview, teachingQualityContext } from '../teachingQuality';
import type { QualityForm } from '@/api/coachingQualityReviews';
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
const scope = { moduleId: 'module & one', seriesId: 'series/one', occurrenceId: 'occurrence-one' };
const form: QualityForm = { header: { employer: '', programme: '', activityDate: '', startDate: '', endDate: '' }, criteria: {}, images: {}, sources: [], actions: [] };
describe('Teaching review transport', () => {
  beforeEach(() => vi.clearAllMocks());
  it('loads the exact module, series and occurrence with session authentication and cancellation', async () => {
    vi.mocked(learningFetch).mockResolvedValue(new Response(JSON.stringify({ review: null })));
    const controller = new AbortController();
    await teachingQualityContext(scope, controller.signal);
    const [url, options] = vi.mocked(learningFetch).mock.calls[0];
    expect(Object.fromEntries(new URL(String(url), 'https://lms.invalid').searchParams)).toEqual(scope);
    expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', signal: controller.signal });
  });
  it('saves the existing teaching type through CSRF transport and surfaces partial PDF failure', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ review: { id: 'saved-one' }, document: { state: 'failed', version: 1, message: 'Review saved; PDF unavailable.' } })));
    const payload = { templateVersion: 1, expectedVersion: 0, requestId: 'request-one', status: 'draft' as const, form };
    const saved = await saveTeachingQualityReview(scope, payload);
    const [, options] = vi.mocked(coachFetch).mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({ ...payload, reviewType: 'FORM_TEACHING' });
    expect(saved.document?.state).toBe('failed');
  });
  it('retains a stale save as an explicit conflict', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Reload the saved version.', code: 'review_conflict' }), { status: 409 }));
    await expect(saveTeachingQualityReview(scope, { templateVersion: 1, expectedVersion: 0, requestId: 'request-one', status: 'draft', form })).rejects.toMatchObject({ status: 409, code: 'review_conflict' });
  });
});
