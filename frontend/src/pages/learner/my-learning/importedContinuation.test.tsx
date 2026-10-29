import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { subjectsFrom, type CoverMetadata } from './learningSummary';
import { currentLearningWeek, subjectWeeks } from './subjectLearning';
import { SubjectActivityWorkspace } from './SubjectActivityWorkspace';

vi.mock('@/hooks/useLiveLearnerRead', () => ({ useLiveLearnerRead: () => ({ data: null, loading: false, error: null }) }));

const history = {
  subjects: [{ id: 50, name: 'Owned course' }],
  activities: [{ activity_id: 'catalogue:50:quiz:1', group_id: 50, source_activity_id: 1,
    activity: 'Earlier unfinished quiz', category: 'quiz', catalogue_kind: 'quiz', completed: false,
    position: 1, date: '2026-10-14', month: '2026-10', date_source: 'title',
    source_section: { id: 'OLD', title: 'Earlier teaching week', order: 1 } }],
} as unknown as StudentActivityResponse;
const real = { modules: ['Owned course'], components: [
  { componentId: 'COPY', moduleId: 'M1', module: 'Owned course', component: 'Imported copy', type: 'reading', week: 'Earlier teaching week' },
  { componentId: 'NEW21', moduleId: 'M1', module: 'Owned course', component: '21 October material', type: 'reading', week: '21 October week' },
  { componentId: 'NEW28', moduleId: 'M1', module: 'Owned course', component: '28 October material', type: 'reading', week: '28 October week' },
], componentProgress: [], quizAttempts: [], videoProgress: [] } as unknown as LearnerDetail;
const metadata: CoverMetadata = {
  covers: {}, current_subjects: [{ id: 'M1', title: 'Owned course' }],
  imported_courses: { 'current:M1': 'legacy:50' },
  imported_continuations: { 'current:M1': { courseRef: 'legacy:50', afterDate: '2026-10-14', componentIds: ['NEW21', 'NEW28'] } },
  activity_dates: Object.fromEntries(['COPY', 'NEW21', 'NEW28'].map((id, index) => [id,
    { date: ['2026-10-14', '2026-10-21', '2026-10-28'][index], date_source: 'builder_week' }])),
};
afterEach(() => vi.useRealTimers());

describe('new weeks on an owned imported course', () => {
  it('keeps the old activity and progress once and adds only server-confirmed new components', () => {
    const before = JSON.stringify({ history, real, metadata });
    const subjects = subjectsFrom(history, real, metadata);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].id).toBe('legacy:50');
    expect(subjects[0].activities.map(a => a.id)).toEqual(['catalogue:50:quiz:1', 'NEW21', 'NEW28']);
    expect(subjects[0].activities[0].legacy).toEqual(history.activities[0]);
    expect(currentLearningWeek(subjects[0], '2026-10-29')?.activities.map(a => a.id)).toEqual(['NEW28']);
    expect(JSON.stringify({ history, real, metadata })).toBe(before);
  });

  it('does not supplement a different course or a response without a confirmed continuation', () => {
    for (const extension of [undefined, { 'current:M1': { ...metadata.imported_continuations!['current:M1'], courseRef: 'legacy:99' } }]) {
      expect(subjectsFrom(history, real, { ...metadata, imported_continuations: extension })[0].activities).toHaveLength(1);
    }
  });

  it.each(['commercial', 'apprenticeship'])('opens the current week and respects an explicit older week for %s', kind => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    const subject = subjectsFrom(history, real, metadata)[0];
    const weeks = subjectWeeks(subject);
    const props = { subject, weeks, kind, learnerId: '7', search: '', progress: <span>Progress retained</span>,
      renderActivity: (entry: typeof subject.activities[number]) => <p>{entry.title}</p>, renderWeekProgress: () => <span>Week progress</span> };
    const view = render(<MemoryRouter><SubjectActivityWorkspace {...props} /></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: /materials/ })).getByRole('heading', { name: /28 October week/ })).toBeVisible();
    expect(screen.getByText('28 October material', { selector: 'p' })).toBeVisible();
    view.rerender(<MemoryRouter><SubjectActivityWorkspace {...props} requestedWeek={weeks.find(w => w.sourceSection)!.id} /></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: /materials/ })).getByRole('heading', { name: /Earlier teaching week/ })).toBeVisible();
    expect(screen.getByText('Earlier unfinished quiz', { selector: 'p' })).toBeVisible();
  });
});
