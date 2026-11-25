import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { EmployerReviewJourneys } from './EmployerReviewJourneys';

afterEach(cleanup);

describe('employer review journey next marker', () => {
  it.each(['apprenticeship', 'commercial'] as const)('follows attendance and booking changes for a %s learner', kind => {
    const learner: EmployerLearnerCard = {
      id: '11', kind, name: 'Alex Learner', email: 'alex@example.test', programme: 'Example programme',
      cohort: 'Example cohort', programmeStatus: 'Active', onboardingStatus: '', isActive: true,
      outstandingCount: 0, documentsTotal: 0, otjhProgress: null,
    };
    const events = Array.from({ length: 6 }, (_, index): LearnerCalendarEvent => ({
      id: `pr-${index + 1}`, eventKey: `pr-${index + 1}`, title: `Review ${index + 1}`,
      source: 'progress-review', type: 'review', sequence: index + 1, status: 'not-scheduled',
      date: null, targetDate: `2027-0${index + 1}-01`, scheduledDate: null, scheduledTime: null,
      durationMinutes: 60, coachName: '', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '',
    }));
    const view = () => <MemoryRouter><EmployerReviewJourneys employerId="8" learners={[learner]}
      totalLearners={1} reviews={{ [`${kind}:11`]: { status: 'ready', data: [...events].reverse() } }}
      onRetry={vi.fn()} onClearFilters={vi.fn()} /></MemoryRouter>;
    const current = () => within(screen.getByRole('region', { name: 'Alex Learner review timeline' }))
      .getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'step');
    const expectNext = (number: number) => {
      expect(current()).toHaveLength(1);
      expect(current()[0]).toHaveAttribute('href', `/employers/8/learner/${kind}/11?tab=reviews&reviewId=pr-${number}`);
    };

    events[0].reviewAttendance = 'attended';
    const { rerender } = render(view());
    expectNext(2);
    events[3] = { ...events[3], status: 'scheduled', scheduledDate: '2027-02-10' };
    rerender(view());
    expectNext(4);
    events[3].reviewAttendance = 'attended';
    rerender(view());
    expectNext(5);
    events[5] = { ...events[5], status: 'scheduled', scheduledDate: '2027-05-10' };
    rerender(view());
    expectNext(6);
    events[5].status = 'completed';
    rerender(view());
    expect(current()).toHaveLength(0);
  });
});
