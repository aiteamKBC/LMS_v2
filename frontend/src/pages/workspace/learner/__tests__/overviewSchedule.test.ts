import { describe, expect, it } from 'vitest';
import type { PlanSession } from '@/api/trainingPlanDashboard';
import { weekSessions } from '../overviewSchedule';

const now = Date.parse('2026-09-12T10:00:00Z');
const session = (id: string, start: string, status = 'scheduled'): PlanSession => ({ id, moduleId: 'M1', title: id, start, end: null, minutes: 60, joinUrl: null, status, attended: null });

describe('overview dates', () => {
  it('places a late UTC occurrence in the correct UK teaching week', () => {
    const late = session('late', '2026-09-13T23:30:00Z');
    expect(weekSessions([late], '2026-09-07', '2026-09-13', now)).toBeNull();
    expect(weekSessions([late], '2026-09-14', '2026-09-20', now)?.id).toBe('late');
  });
  it('keeps the current week session available after it has completed', () => {
    const sessions = [session('this-week', '2026-09-09T13:00:00Z', 'completed'), session('next-week', '2026-09-16T13:00:00Z')];
    expect(weekSessions(sessions, '2026-09-07', '2026-09-13', now)?.id).toBe('this-week');
  });
});
