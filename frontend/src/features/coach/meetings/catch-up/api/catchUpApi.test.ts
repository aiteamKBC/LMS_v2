import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ calendar: vi.fn(), coachFetch: vi.fn() }));
vi.mock('../../shared/api/meetingApi', () => ({ fetchCoachCalendarEvents: mocks.calendar }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));

import { fetchCoachCatchUpQueue } from './catchUpApi';

describe('catch-up request ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts one timetable and one absence request with the same cancellation signal', async () => {
    const order: string[] = [];
    mocks.calendar.mockImplementation(async (signal: AbortSignal) => {
      order.push('calendar');
      expect(signal).toBe(controller.signal);
      return { events: [
        { id: '1', eventKey: 'catch:1', source: 'catch-up', status: 'scheduled', learner: 'Learner A' },
        { id: '2', eventKey: 'catch:2', source: 'catch-up', status: 'confirmed', learner: 'Learner B' },
      ] };
    });
    mocks.coachFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      order.push('absence');
      expect(options.signal).toBe(controller.signal);
      return new Response(JSON.stringify({ items: [{ recoveryMethod: 'catch-up', catchupEventKey: 'catch:1', sessionTitle: 'Session A' }] }), { status: 200 });
    });
    const controller = new AbortController();
    const result = await fetchCoachCatchUpQueue(controller.signal);
    expect(order).toEqual(['calendar', 'absence']);
    expect(mocks.calendar).toHaveBeenCalledTimes(1);
    expect(mocks.coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/absence-reports', { signal: controller.signal });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: 'catch:1', lecture: 'Session A' });
  });

  it('keeps calendar rows when the optional absence lookup fails', async () => {
    mocks.calendar.mockResolvedValue({ events: [{ id: '1', source: 'catch-up', status: 'completed', email: 'learner@example.test' }] });
    mocks.coachFetch.mockRejectedValue(new Error('unavailable'));
    const result = await fetchCoachCatchUpQueue(new AbortController().signal);
    expect(result.warning).toBe('Missed lecture details could not be loaded.');
    expect(result.rows[0]).toMatchObject({ id: '1', learner: 'learner@example.test' });
  });
});
