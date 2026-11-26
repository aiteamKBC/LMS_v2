import { describe, expect, it } from 'vitest';
import { headerItems } from '../headerItems';
import type { DashboardHeader } from '@/test/dashboardHeaderFixture';

const empty: DashboardHeader = { learner: { id: '7' } as DashboardHeader['learner'],
  coach: { name: '' }, modules: [], moduleLabel: 'Module', initialWeeklyModuleId: null, nextReview: null, nextLiveSession: null, nextAssignment: null };

describe('card-ready Header values', () => {
  it('preserves navigation and the selected records without sorting or mapping', () => {
    const header: DashboardHeader = { ...empty,
      nextLiveSession: { title: 'Session', date: '2026-10-20T09:00:00Z', href: '/learner/component/commercial/7/C1' },
      nextAssignment: { title: 'Assignment', date: '2026-10-25', href: '/learner/monthly-submission' },
      nextReview: { sessionId: 'R1', eventKey: 'event-1', source: 'mcr', title: 'MCM', date: '2026-10-20',
        scheduledDate: '2026-10-20', scheduledTime: '10:00', meetingLink: 'https://example.test/meeting' } };
    const result = headerItems(header, Date.parse('2026-10-17T09:00:00Z'));
    expect(result.lecture).toBe(header.nextLiveSession);
    expect(result.assignment).toBe(header.nextAssignment);
    expect(result.review).toBe(header.nextReview);
  });

  it('keeps date-only deadlines for the whole UK day across daylight saving', () => {
    const header = { ...empty, nextAssignment: { title: 'Assignment', date: '2026-10-25', href: '/learner/monthly-submission' } };
    expect(headerItems(header, Date.parse('2026-10-25T23:59:00Z')).assignment.date).toBe('2026-10-25');
    expect(headerItems(header, Date.parse('2026-10-26T00:00:00Z')).assignment.date).toBeNull();
  });

  it('expires a booked review using UK time and keeps an unbooked review until day end', () => {
    const review = { sessionId: 'R1', eventKey: 'R1', source: 'progress-review' as const, title: 'Review', date: '2026-10-20',
      scheduledDate: '2026-10-20', scheduledTime: '10:00' };
    expect(headerItems({ ...empty, nextReview: review }, Date.parse('2026-10-20T09:00:00Z')).review).toBe(review);
    expect(headerItems({ ...empty, nextReview: review }, Date.parse('2026-10-20T09:01:00Z')).review).toBeNull();
    expect(headerItems({ ...empty, nextReview: { ...review, scheduledDate: undefined } }, Date.parse('2026-10-20T22:59:00Z')).review).not.toBeNull();
  });

  it('supports missing optional data and malformed cached dates', () => {
    expect(headerItems(null, Date.now()).review).toBeNull();
    expect(headerItems(empty, Date.now()).lecture.href).toBe('/learner/attendance');
    expect(headerItems({ ...empty, nextAssignment: { title: 'Bad date', date: 'invalid', href: '/learner/monthly-submission' } }, Date.now()).assignment.date).toBeNull();
  });
});
