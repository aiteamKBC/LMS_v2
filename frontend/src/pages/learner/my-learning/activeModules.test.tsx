import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningCatalogue } from './LearningCatalogue';
import type { Subject, UnifiedLearningSummary } from './learningSummary';
import { moduleTeachingActive } from './teachingActivity';
import { learningToday } from './subjectLearning';

const subject = (id: string, source: Subject['source'], progress = 0): Subject => ({ id, title: id, source, activities: [],
  card: { activityCount: 1, completedActivityCount: progress === 100 ? 1 : 0, progress, status: progress === 100 ? 'Completed' : 'Upcoming', finalTestPassed: false } });
const subjects = [subject('active-new', 'current', 100), subject('active-old', 'legacy'), subject('past', 'current'), subject('future', 'current'), subject('undated', 'legacy')];
const moduleActivity = { 'active-new': { startDate: '2026-09-01', lastLiveDate: '2026-11-05' },
  'active-old': { startDate: '2026-11-05', lastLiveDate: '2026-12-01' },
  past: { startDate: '2026-01-01', lastLiveDate: '2026-11-04' }, future: { startDate: '2026-11-06', lastLiveDate: '2027-01-01' } };
function catalogue(rows = subjects, activity = moduleActivity) {
  const summary: UnifiedLearningSummary = { subjects: rows, subjectCount: rows.length, activityCount: 5, completedActivityCount: 1, percent: 20 };
  return render(<MemoryRouter><LearningCatalogue summary={summary} search="" onSearch={vi.fn()} total={5} done={1} percent={20}
    moduleStartDate={() => null} moduleActivity={activity} onContinue={vi.fn()} renderCard={row => <article key={row.id}><h3>{row.title}</h3></article>} /></MemoryRouter>);
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-05T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('active teaching in My Learning', () => {
  it('opens on active teaching independently of progress and preserves Old/New filters', () => {
    catalogue();
    expect(screen.getByRole('combobox', { name: 'Teaching status' })).toHaveValue('active');
    expect(screen.getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(['active-new','active-old']);
    fireEvent.click(screen.getByRole('tab', { name: 'New LMS' }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'active-new' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    expect(screen.getByRole('heading', { name: 'active-old' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Teaching status' }), { target: { value: 'all' } });
    expect(screen.getByRole('heading', { name: 'undated' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'All modules' }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(5);
    expect(screen.getByText('5 subjects · 5 activities')).toBeVisible();
  });
  it('offers All instead of silently hiding undated or finished subjects', () => {
    catalogue([subjects[2], subjects[4]]);
    expect(screen.getByText('No active modules match your filters.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View all modules' }));
    expect(screen.getByRole('heading', { name: 'past' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'undated' })).toBeVisible();
  });
  it('keeps grouped previous learning with its active current module', () => {
    catalogue([subjects[0], { ...subjects[2], source: 'legacy', previousLearningFor: 'active-new' }]);
    expect(screen.getByRole('heading', { name: 'active-new' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'past' })).toBeVisible();
  });
  it('uses inclusive curriculum boundaries and the UK day across daylight saving', () => {
    for (const today of ['2026-09-01','2026-10-25','2026-11-05']) expect(moduleTeachingActive(moduleActivity['active-new'],today)).toBe(true);
    for (const today of ['2026-08-31','2026-11-06']) expect(moduleTeachingActive(moduleActivity['active-new'],today)).toBe(false);
    expect(moduleTeachingActive(undefined,'2026-11-05')).toBe(false);
    expect(moduleTeachingActive({ startDate: '2026-01-01', lastLiveDate: '' },'2026-11-05')).toBe(false);
    vi.setSystemTime(new Date('2026-10-24T23:30:00Z')); expect(learningToday()).toBe('2026-10-25');
    vi.setSystemTime(new Date('2026-10-25T23:30:00Z')); expect(learningToday()).toBe('2026-10-25');
  });
});
