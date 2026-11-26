import { beforeEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import { loadLectureTranscriptPdf } from '../lectureTranscript';

vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
const scope = { moduleId: 'module & one', seriesId: 'series/one', occurrenceId: 'occurrence-one' };

describe('Lecture transcript PDF transport', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads only the selected lecture with session authentication and cancellation', async () => {
    vi.mocked(learningFetch).mockResolvedValue(new Response('%PDF-synthetic', { headers: { 'Content-Type': 'application/pdf' } }));
    const controller = new AbortController();
    expect(await (await loadLectureTranscriptPdf(scope, controller.signal)).text()).toBe('%PDF-synthetic');
    const [url, options] = vi.mocked(learningFetch).mock.calls[0];
    expect(Object.fromEntries(new URL(String(url), 'https://lms.invalid').searchParams)).toEqual(scope);
    expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', signal: expect.any(AbortSignal) });
    controller.abort();
    expect(options?.signal?.aborted).toBe(true);
  });
  it.each([401, 403, 404, 409, 503])('surfaces the %s response without presenting it as a PDF', async status => {
    vi.mocked(learningFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Transcript unavailable.' }),
      { status, headers: { 'Content-Type': 'application/json' } }));
    await expect(loadLectureTranscriptPdf(scope, new AbortController().signal)).rejects.toThrow('Transcript unavailable.');
  });
  it('rejects an HTML login response and invalid PDF bytes', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('invalid', { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(loadLectureTranscriptPdf(scope, new AbortController().signal)).rejects.toThrow('could not be loaded');
    await expect(loadLectureTranscriptPdf(scope, new AbortController().signal)).rejects.toThrow('valid transcript PDF');
  });
  it('does not start a cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadLectureTranscriptPdf(scope, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(learningFetch).not.toHaveBeenCalled();
  });
});
