import { describe, expect, it } from 'vitest';
import type { AdvancedAdminCoachingSession, AdvancedAdminReview } from '@/api/advancedAdmin';
import { matchCoachingSessions } from './coachingMatch';

const review = (id: string, date: string): AdvancedAdminReview => ({
  id, completedDate: date, plannedDate: null,
} as AdvancedAdminReview);
const session = (id: string, date: string, family: 'pr' | 'mcm' = 'pr'): AdvancedAdminCoachingSession => ({
  id, family, componentId: null, actualStartAt: date, plannedDate: null,
  status: 'completed', aiStatus: 'completed', report: { summary: 'Report' },
});

describe('coaching report matching', () => {
  it('matches one review to one same-family session on the exact day', () => {
    const result = matchCoachingSessions({ pr: [review('a', '2026-09-10')], mcm: [] },
      [session('s', '2026-09-10T12:00:00Z')]);
    expect(result.matched.get('pr:a')?.id).toBe('s');
    expect(result.unmatched).toHaveLength(0);
  });

  it('leaves duplicate dates and other families unmatched', () => {
    const result = matchCoachingSessions({ pr: [review('a', '2026-09-10'), review('b', '2026-09-10')], mcm: [] },
      [session('s', '2026-09-10'), session('m', '2026-09-10', 'mcm')]);
    expect(result.matched.size).toBe(0);
    expect(result.unmatched).toHaveLength(2);
  });

  it('uses the UK business day when the session crosses UTC midnight in summer', () => {
    const result = matchCoachingSessions({ pr: [review('a', '2026-07-02')], mcm: [] },
      [session('s', '2026-07-01T23:30:00Z')]);
    expect(result.matched.get('pr:a')?.id).toBe('s');
  });

  it('links a finished meeting without an AI report but ignores a failed match', () => {
    const reviews = { pr: [review('a', '2026-09-10')], mcm: [] };
    const finished = { ...session('finished', '2026-09-10'), actualStartAt: null,
      plannedDate: '2026-09-10', status: 'finished', report: null };
    const failed = { ...finished, id: 'failed', status: 'matching_failed' };
    const result = matchCoachingSessions(reviews, [finished, failed], false);
    expect(result.matched.get('pr:a')?.id).toBe('finished');
  });

  it('uses the source component ID when review and meeting dates differ', () => {
    const reviews = { pr: [{ ...review('component', '2026-09-10'), componentId: 41 }], mcm: [] };
    const linked = { ...session('linked', '2026-09-11'), componentId: 41 };
    const sameDay = { ...session('same-day', '2026-09-10'), componentId: 42 };
    const result = matchCoachingSessions(reviews, [linked, sameDay]);
    expect(result.matched.get('pr:component')?.id).toBe('linked');
  });

  it('opens a source-linked session with failed meeting matching without treating an empty report as ready', () => {
    const reviews = { pr: [{ ...review('component', '2025-09-24'), componentId: 41 }], mcm: [] };
    const unmatched = { ...session('unmatched', '2025-09-24'), componentId: 41,
      actualStartAt: null, status: 'matching_failed', report: null };
    const other = { ...session('other', '2025-09-24'), componentId: 42 };
    expect(matchCoachingSessions(reviews, [unmatched, other], false).matched.get('pr:component')?.id)
      .toBe('unmatched');
    expect(matchCoachingSessions(reviews, [unmatched, other]).matched.has('pr:component')).toBe(false);
  });
});
