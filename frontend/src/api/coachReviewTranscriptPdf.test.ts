import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoachReviewTranscriptPdf, loadPreviousReviewTranscriptPdf } from './coachReviewTranscriptPdf';

const coachFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));

beforeEach(() => coachFetch.mockReset());

describe('coach Review transcript PDF', () => {
  it('loads the selected review and segment as a PDF', async () => {
    coachFetch.mockResolvedValue(new Response('%PDF-synthetic', {
      headers: { 'content-type': 'application/pdf' },
    }));
    const signal = new AbortController().signal;
    const pdf = await loadCoachReviewTranscriptPdf('imported-review:synthetic', 'combined', signal);
    expect(coachFetch).toHaveBeenCalledWith(
      '/coach_api/coach/timetable/events/imported-review%3Asynthetic/transcript-pdf/combined',
      { signal },
    );
    expect(pdf.type).toBe('application/pdf');
  });

  it('reports a scoped access error instead of treating JSON as a PDF', async () => {
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Review is unavailable.' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    }));
    await expect(loadCoachReviewTranscriptPdf('review:synthetic', 'one', new AbortController().signal))
      .rejects.toThrow('Review is unavailable.');
  });

  it('loads the immediately previous Review transcript PDF by current Review identity', async () => {
    coachFetch.mockResolvedValue(new Response('%PDF-synthetic', {
      headers: { 'content-type': 'application/pdf' },
    }));
    const signal = new AbortController().signal;
    const pdf = await loadPreviousReviewTranscriptPdf('imported-review:current', signal);
    expect(coachFetch).toHaveBeenCalledWith(
      '/coach_api/coach/reviews/imported-review%3Acurrent/previous/transcript-pdf',
      { signal },
    );
    expect(pdf.type).toBe('application/pdf');
  });
});
