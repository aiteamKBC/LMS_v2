import { beforeEach, describe, expect, it, vi } from 'vitest';

const coachFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));
import { deleteManualAttendance, deleteSourceAttendance, fetchCoachAttendance, fetchCoachAttendanceDetails, saveManualAttendance, updateSourceAttendance } from './attendanceApi';

describe('Coach Attendance API ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses one cancellable bulk overview request', async () => {
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ learners: [], attendanceRecords: [] }), { status: 200 }));
    const controller = new AbortController();
    await fetchCoachAttendance(controller.signal);
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/attendance', { signal: controller.signal });
  });

  it('loads cancellable detail by stable learner id without name or email parameters', async () => {
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    const controller = new AbortController();
    await fetchCoachAttendanceDetails('42', controller.signal);
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/attendance/details?learner_id=42&page=1&pageSize=20', { signal: controller.signal });
  });

  it('creates, updates and deletes only the manual attendance resource', async () => {
    coachFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ manualId: '9' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ manualId: '9' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const input = { learnerId: '42', date: '2026-10-01', module: 'Module A', sessionTitle: 'Session A', status: 'absent' as const };

    await saveManualAttendance(input);
    await saveManualAttendance({ ...input, status: 'present' }, '9');
    await deleteManualAttendance('9');

    expect(coachFetch.mock.calls[0][0]).toBe('/coach_api/coach/attendance/manual');
    expect(coachFetch.mock.calls[0][1]?.method).toBe('POST');
    expect(coachFetch.mock.calls[1][0]).toBe('/coach_api/coach/attendance/manual/9');
    expect(coachFetch.mock.calls[1][1]?.method).toBe('PATCH');
    expect(coachFetch.mock.calls[2]).toEqual(['/coach_api/coach/attendance/manual/9', { method: 'DELETE' }]);
  });

  it('updates and deletes a source attendance row for one learner', async () => {
    coachFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const input = {
      learnerId: '42', source: 'microsoft-teams', sourceId: 'occ-8', date: '2026-10-01',
      module: 'Module A', sessionTitle: 'Session A', status: 'present' as const,
    };

    await updateSourceAttendance(input);
    await deleteSourceAttendance(input);

    expect(coachFetch.mock.calls[0][0]).toBe('/coach_api/coach/attendance/source');
    expect(coachFetch.mock.calls[0][1]?.method).toBe('PATCH');
    expect(coachFetch.mock.calls[1][0]).toBe('/coach_api/coach/attendance/source');
    expect(coachFetch.mock.calls[1][1]?.method).toBe('DELETE');
  });
});
