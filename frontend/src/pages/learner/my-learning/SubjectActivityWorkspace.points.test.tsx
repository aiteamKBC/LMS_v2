import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SubjectActivityWorkspace } from './SubjectActivityWorkspace';
import type { Subject, SubjectEntry } from './learningSummary';
import type { LearningWeek } from './subjectLearning';

const entries: SubjectEntry[] = ['Reading', 'Quiz', 'Audio'].map((title, position) => ({
  id: title, title, category: title === 'Audio' ? 'podcast' : title.toLowerCase(), completed: false,
  position, week: 'Week 1', schedule: { date: null, month: 'undated' },
  native: { title, componentId: title, moduleId: 'M1', weekId: 'W1', pointNumber: 1, expectedOtjh: 0,
    type: title === 'Audio' ? 'podcast' : title.toLowerCase(), contentHtml: '<p>Read</p>',
    audioUrl: title === 'Audio' ? 'https://example.org/audio.mp3' : null,
    ...(title === 'Quiz' ? { isQuiz: true, quizMeta: { quizId: 3, questions: 10, duration: null, timeUnit: null } } : {}) },
}));
const subject: Subject = { id: 'current:M1', title: 'Module', source: 'current', activities: entries };
const weeks: LearningWeek[] = [{ id: 'W1', label: 'Week 1', title: 'Case', start: null, end: null, activities: entries }];
const props = { subject, weeks, kind: 'commercial', learnerId: '132', progress: null,
  renderActivity: (entry: SubjectEntry) => <article aria-label={`${entry.id} player`}>{entry.title}</article>,
  renderWeekProgress: () => null };

describe('catalogue point navigation', () => {
  it('opens the exact deep-linked activity inside its point without replacing its player', () => {
    render(<MemoryRouter><SubjectActivityWorkspace {...props} requestedActivity="Audio" search="" /></MemoryRouter>);
    expect(screen.getByRole('article', { name: 'Audio player' })).toBeVisible();
    expect(screen.getByRole('list', { name: 'Point 1 activities' }).closest('details')).toHaveAttribute('open');
  });
  it('search selects matching content and keeps the complete point navigation, with quiz last', () => {
    const { rerender } = render(<MemoryRouter><SubjectActivityWorkspace {...props} search="Reading" /></MemoryRouter>);
    expect(screen.getByRole('article', { name: 'Reading player' })).toBeVisible();
    rerender(<MemoryRouter><SubjectActivityWorkspace {...props} search="Audio" /></MemoryRouter>);
    expect(screen.getByRole('article', { name: 'Audio player' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Reading player', hidden: true })).not.toBeVisible();
    const point = screen.getByRole('list', { name: 'Point 1 activities' });
    expect(within(point).getAllByRole('button').map(button => button.textContent))
      .toEqual(['ReadingReading', 'PodcastAudio', 'QuizQuiz']);
  });
});
