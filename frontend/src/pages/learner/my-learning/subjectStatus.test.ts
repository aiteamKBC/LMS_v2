import { describe, expect, it } from 'vitest';
import type { StudentActivityItem } from '@/api/studentActivity';
import type { JourneyComponent } from '@/utils/learnerJourney';
import type { Subject, SubjectEntry } from './SubjectWorkspace';
import { subjectLearningStatus } from './subjectLearning';

const entry = (overrides: Partial<SubjectEntry> = {}): SubjectEntry => ({
  id: 'activity-1', title: 'Reading', category: 'reading', completed: false,
  position: 0, schedule: { date: null, month: 'undated' }, ...overrides,
});
const subject = (activities: SubjectEntry[]): Subject => ({ id: 'current:1', title: 'Enrolled course', source: 'current', activities });

describe('enrolled subject status', () => {
  it('labels unstarted courses Upcoming without requiring a future date or an activity', () => {
    expect(subjectLearningStatus(subject([]))).toBe('Upcoming');
    expect(subjectLearningStatus(subject([entry()]))).toBe('Upcoming');
    expect(subjectLearningStatus(subject([entry({ schedule: { date: '2020-01-01', month: '2020-01' } })]))).toBe('Upcoming');
    expect(subjectLearningStatus(subject([entry({ legacy: { status: 'not_started' } as StudentActivityItem })]))).toBe('Upcoming');
  });

  it.each([
    { video_started: true }, { reading_viewed: true }, { quiz_attempted: true },
    { new_attempt_count: 1 }, { status: 'In progress' }, { status: 'Submitted' },
  ])('keeps incomplete, started legacy learning In progress: %j', legacy => {
    expect(subjectLearningStatus(subject([entry({ legacy: legacy as StudentActivityItem })]))).toBe('In progress');
  });

  it('recognises a failed native attempt as started learning', () => {
    const native = { quizAttempts: [{ passed: false }] } as JourneyComponent;
    expect(subjectLearningStatus(subject([entry({ native })]))).toBe('In progress');
  });

  it('preserves completion and partial completion', () => {
    expect(subjectLearningStatus(subject([entry({ completed: true }), entry()]))).toBe('In progress');
    expect(subjectLearningStatus(subject([entry({ completed: true })]))).toBe('Completed');
  });
});
