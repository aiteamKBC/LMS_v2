import { beforeEach, describe, expect, it, vi } from 'vitest';

const coachFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));
import { fetchCoachAttendance, fetchCoachAttendanceDetails } from './attendanceApi';

describe('Coach Attendance API ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses one cancellable bulk overview request', async () => {
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ learners: [], attendanceRecords: [] }), { status: 200 }));
    const controller = new AbortController();
    await fetchCoachAttendance(controller.signal);
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/attendance', { signal: controller.signal });
  });

  it('loads detail by stable learner id without name or email parameters', async () => {
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ sessions: [] }), { status: 200 }));
    await fetchCoachAttendanceDetails('42');
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/attendance/details?learner_id=42');
  });
});
