import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
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
  it.each(['commercial', 'apprenticeship'])('retains authored Points and attendance requirements together (%s)', async kind => {
    clearAllCachedResources();
    const live: SubjectEntry = { ...entries[0], id: 'catalogue:session', title: 'Live workshop', category: 'live_session',
      native: { ...entries[0].native!, componentId: 'SESSION', title: 'Live workshop', type: 'live_session', expectedOtjh: 2 } };
    const groupedSubject = { ...subject, activities: [live, ...entries] };
    const groupedWeeks = [{ ...weeks[0], activities: groupedSubject.activities }];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === `/learner_api/web-points/${kind}/132/`) return new Response(JSON.stringify({ weeks: {
        W1: { moduleId: 'M1', points: [{ id: 'P1', title: 'Workshop', componentIds: ['SESSION'] }] },
      } }));
      if (url === `/learner_api/attendance/${kind}/132/mode/`) return new Response(JSON.stringify({ mode: 'lazy' }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<MemoryRouter><SubjectActivityWorkspace {...props} kind={kind} subject={groupedSubject} weeks={groupedWeeks} requestedActivity={live.id} search="" /></MemoryRouter>);
      const point = await screen.findByRole('list', { name: 'Workshop activities' });
      expect(within(point).getByText('Live workshop')).toBeVisible();
      expect(await within(point).findByText('Required: Recording')).toBeVisible();
      expect(within(screen.getByRole('list', { name: 'Other activities' })).getByTitle('Reading')).toBeVisible();
      expect(fetchMock.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
        `/learner_api/web-points/${kind}/132/`, `/learner_api/attendance/${kind}/132/mode/`,
      ]));
    } finally {
      cleanup(); vi.unstubAllGlobals(); clearAllCachedResources();
    }
  });
  it.each(['commercial', 'apprenticeship'])('shows the supplied week dates in the subject sidebar (%s)', kind => {
    const datedWeeks = [{ ...weeks[0], start: '2026-10-20', end: '2026-10-26' }];
    const { rerender } = render(<MemoryRouter><SubjectActivityWorkspace {...props} kind={kind} weeks={datedWeeks} search="" /></MemoryRouter>);
    const sidebar = screen.getByRole('complementary', { name: 'Module activities' });
    expect(within(sidebar).getAllByText('20 Oct 2026 – 26 Oct 2026')).toHaveLength(2);
    rerender(<MemoryRouter><SubjectActivityWorkspace {...props} kind={kind} search="" /></MemoryRouter>);
    expect(within(sidebar).queryByText('20 Oct 2026 – 26 Oct 2026')).not.toBeInTheDocument();
    expect(sidebar).not.toHaveTextContent('Invalid Date');
  });
  it('opens the exact deep-linked activity directly in its week without replacing its player', () => {
    render(<MemoryRouter><SubjectActivityWorkspace {...props} requestedActivity="Audio" search="" /></MemoryRouter>);
    expect(screen.getByRole('article', { name: 'Audio player' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Point 1 activities' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PodcastAudio' })).toBeVisible();
  });
  it('search selects matching content and keeps all week activities in saved order', () => {
    const { rerender } = render(<MemoryRouter><SubjectActivityWorkspace {...props} search="Reading" /></MemoryRouter>);
    expect(screen.getByRole('article', { name: 'Reading player' })).toBeVisible();
    rerender(<MemoryRouter><SubjectActivityWorkspace {...props} search="Audio" /></MemoryRouter>);
    expect(screen.getByRole('article', { name: 'Audio player' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Reading player', hidden: true })).not.toBeVisible();
    const point = screen.getByRole('button', { name: 'ReadingReading' }).closest('ul')!;
    expect(within(point).getAllByRole('button').map(button => button.textContent))
      .toEqual(['ReadingReading', 'QuizQuiz', 'PodcastAudio']);
  });
});
