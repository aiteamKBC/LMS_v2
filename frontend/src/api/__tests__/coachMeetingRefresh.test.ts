import { beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCoachMeetingArtifacts } from '@/pages/coach/shared/calendarEvents';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ artifacts: [] })));
});
it('uses one explicit POST for refresh without a mutating GET query', async () => {
  await fetchCoachMeetingArtifacts('meeting:1', undefined, { refresh: true });
  expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/timetable/events/meeting%3A1/artifacts', {
    signal: undefined, method: 'POST',
  });
});
it('keeps passive reads as GET with abort support', async () => {
  const signal = new AbortController().signal;
  await fetchCoachMeetingArtifacts('meeting:1', signal);
  expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/timetable/events/meeting%3A1/artifacts', { signal });
});
