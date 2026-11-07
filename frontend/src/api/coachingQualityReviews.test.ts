import { beforeEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import { clearAllCachedResources } from './cachedRequest';
import { qualityContext, qualityForms, createQualityForm, qualityDefinition, qualityReview, saveQualityDefinition, uploadQualityEvidence, qualityEvidenceFileUrl, qualityPdf, saveQualityReview, QualityReviewError, type QualityReview, type QualityForm, type QualityTemplate } from './coachingQualityReviews';
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
  it('separates form, context and saved-review cache keys by selected type', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => response({ review: null }));
    for (const kind of ['MCM', 'PR'] as const) {
      await qualityDefinition(undefined, kind);
      await qualityContext('event', 'signed', '1', undefined, kind);
      await qualityReview('saved', undefined, kind);
    }
    expect(learningFetch).toHaveBeenCalledTimes(6);
    await qualityDefinition(undefined, 'MCM'); await qualityContext('event', 'signed', '1', undefined, 'PR');
    expect(learningFetch).toHaveBeenCalledTimes(6);
    expect(vi.mocked(learningFetch).mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      expect.stringContaining('/form?reviewType=MCM'), expect.stringContaining('/form?reviewType=PR'),
      expect.stringContaining('/reviews/saved?reviewType=PR'),
    ]));
    await qualityContext('event', 'signed', '1', undefined, undefined, 'MCM');
    expect(String(vi.mocked(learningFetch).mock.lastCall?.[0])).toContain('titleType=MCM');
  });
  it('publishes only the selected form with the existing CSRF transport', async () => {
    vi.mocked(coachFetch).mockResolvedValue(response({ template: { revision: 1 } }));
    const payload = { definition: { reviewType: 'PR' } as QualityTemplate, expectedRevision: 0, requestId: 'request', publish: true };
    await saveQualityDefinition(payload);
    expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/form?reviewType=PR'), expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) }));
  });
  it('returns an explicit conflict and does not cache failures', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ error: 'Reload this version' }, 409)).mockResolvedValueOnce(response({ review: null }));
    await expect(qualityContext('event')).rejects.toBeInstanceOf(QualityReviewError);
    await qualityContext('event'); expect(learningFetch).toHaveBeenCalledTimes(2);
  });
  it('retains the calendar-reference error code on reads and first saves', async () => {
    const failure = { error: 'Refresh the calendar to renew this meeting reference.', code: 'invalid_calendar_reference' };
    vi.mocked(learningFetch).mockResolvedValue(response(failure, 400));
    vi.mocked(coachFetch).mockResolvedValue(response(failure, 400));
    await expect(qualityContext('', 'expired', '1')).rejects.toMatchObject({ status: 400, code: failure.code, message: failure.error });
    await expect(saveQualityReview({ learnerId: '1', expectedVersion: 0, requestId: 'stable-id', status: 'draft', form: {} as QualityForm }, undefined, '', 'expired'))
      .rejects.toMatchObject({ status: 400, code: failure.code });
  });
  it('reuses the same PDF for preview/download and separates saved revisions', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => new Response('%PDF-1.4 synthetic', { headers: { 'Content-Type': 'application/pdf' } }));
    const review = { id: 'saved', version: 1 } as QualityReview;
    const blobs = await Promise.all([qualityPdf(review), qualityPdf(review)]);
    expect(blobs[0]).toBe(blobs[1]); expect(learningFetch).toHaveBeenCalledOnce();
    await qualityPdf({ ...review, version: 2 }); expect(learningFetch).toHaveBeenCalledTimes(2);
  });
  it('shares form-library reads, separates the editor catalog and invalidates on custom form creation', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => response({ forms: [] }));
    await Promise.all([qualityForms(), qualityForms()]); expect(learningFetch).toHaveBeenCalledOnce();
    await qualityForms(undefined, true); expect(learningFetch).toHaveBeenCalledTimes(2);
    vi.mocked(coachFetch).mockResolvedValue(response({ template: { reviewType: 'FORM_CUSTOM_TEST' } }, 201));
    await createQualityForm('Custom form', 'stable-save-id');
    expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/quality/forms'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Custom form', requestId: 'stable-save-id' }) }));
    await qualityForms(); expect(learningFetch).toHaveBeenCalledTimes(3);
  });
  it('uploads original file bytes via multipart CSRF transport and scopes download URLs to the review', async () => {
    vi.mocked(coachFetch).mockResolvedValue(response({ id: 'evidence' }, 201));
    const file = new File(['original bytes'], 'evidence.zip', { type: 'application/zip' });
    await uploadQualityEvidence('review/one', 'evidence', file);
    const [url, init] = vi.mocked(coachFetch).mock.calls[0];
    expect(url).toContain('/reviews/review%2Fone/files'); expect(init?.method).toBe('POST');
    const body = init?.body as FormData;
    expect(body.get('section')).toBe('evidence'); expect(body.get('file')).toBe(file);
    expect(qualityEvidenceFileUrl('review/one', 'file/id', true)).toContain('/review%2Fone/files/file%2Fid?preview=1');
    expect(learningFetch).not.toHaveBeenCalled();
  });
});
