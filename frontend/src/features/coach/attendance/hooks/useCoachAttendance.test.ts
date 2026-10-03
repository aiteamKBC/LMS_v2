import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchCoachAttendance } from '../api/attendanceApi';
import { useCoachAttendance } from './useCoachAttendance';
import { coachSessionKey, readCoachSessionCache } from '@/features/coach/shared/coachSessionCache';

vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.test' }) }));
vi.mock('../api/attendanceApi', () => ({ fetchCoachAttendance: vi.fn() }));

describe('bulk attendance local replacement', () => {
  it.each(['present', 'absent'])('replaces one occurrence with %s, including old duplicate representations', async status => {
    const old = { learnerId: '42', sessionId: 'teams:morning', sessionDate: '2026-09-16', status: status === 'present' ? 'absent' : 'present' };
    const afternoon = { ...old, sessionId: 'teams:afternoon' };
    const otherLearner = { ...old, learnerId: '9' };
    vi.mocked(fetchCoachAttendance).mockClear();
    vi.mocked(fetchCoachAttendance).mockResolvedValue({ learners: [], attendanceRecords: [old, old, afternoon, otherLearner] });
    const { result } = renderHook(() => useCoachAttendance(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const updated = { ...old, status, effectiveStatus: status, counted: true };
    act(() => result.current.replaceAttendance([updated]));
    expect(result.current.records.filter(row => row.learnerId === '42' && row.sessionId === old.sessionId)).toEqual([updated]);
    expect(result.current.records).toHaveLength(3);
    expect(result.current.records).toContainEqual(afternoon);
    expect(result.current.records).toContainEqual(otherLearner);
    expect(fetchCoachAttendance).toHaveBeenCalledTimes(1);
    expect(readCoachSessionCache(coachSessionKey('attendance', 'coach@example.test'))).toEqual({ learners: [], records: result.current.records });
    act(() => result.current.replaceAttendance([{ ...updated, status: old.status }]));
    expect(result.current.records).toHaveLength(3);
  });
});
