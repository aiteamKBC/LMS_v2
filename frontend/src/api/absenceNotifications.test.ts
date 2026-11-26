import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/api/auth';
import { fetchAbsenceNotifications } from './absenceNotifications';

const coach = {
  role: 'staff',
  access: 'coach',
  subjectId: 'coach-1',
} as unknown as AuthUser;

describe('coach absence recovery notifications', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows one in-app notification for each selected recovery method only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [
      { id: '1', learner: 'Learner One', sessionTitle: 'Session A', reportedDate: '2026-09-21', recoveryMethod: 'recorded' },
      { id: '2', learner: 'Learner Two', sessionTitle: 'Session B', reportedDate: '2026-09-21', recoveryMethod: 'catch-up' },
      { id: '3', learner: 'Learner Three', sessionTitle: 'Session C', reportedDate: '2026-09-21', recoveryMethod: 'alternative' },
      { id: '4', learner: 'Learner Four', sessionTitle: 'Meeting', reportedDate: '2026-09-21', recoveryMethod: '' },
    ] }), { status: 200 })));

    const result = await fetchAbsenceNotifications(coach);

    expect(result).toHaveLength(3);
    expect(result.map(item => item.text)).toEqual([
      expect.stringContaining('chose to watch the recording'),
      expect.stringContaining('chose to attend a catch-up session'),
      expect.stringContaining('chose to attend an alternative group session'),
    ]);
    expect(result.every(item => item.link === '/coach/absence-reports')).toBe(true);
  });
});
