import { beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { adoptMigratedReviewBooking } from '../reviewInstances';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('sends the saved-content guard for a draft-preserving retry', async () => {
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ answerVersion: 'new-version' })));
  expect(await adoptMigratedReviewBooking('imported-review:42', undefined, 'saved-content')).toMatchObject({ answerVersion: 'new-version' });
  expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/reviews/imported-review%3A42/adopt-booking', {
    method: 'POST', signal: undefined, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingAdoptionVersion: 'saved-content' }),
  });
});

it('surfaces a saved-content conflict without retrying or accepting the returned version', async () => {
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ detail: 'This review changed in another session.', code: 'ANSWER_CONFLICT' }), { status: 409 }));
  await expect(adoptMigratedReviewBooking('imported-review:42', undefined, 'stale-content')).rejects.toThrow('This review changed in another session.');
  expect(coachFetch).toHaveBeenCalledOnce();
});
