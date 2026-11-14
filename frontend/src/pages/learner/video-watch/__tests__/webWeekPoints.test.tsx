import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivitySidebar } from '../ActivitySidebar';
import { ActivitiesTableModern } from '@/pages/workspace/learner/WeeklyLearningPlan';
import { webPointGroups } from '@/utils/webPointActivities';
import type { WebPointPlan } from '@/api/webWeekPoints';
import type { JourneyComponent } from '@/utils/learnerJourney';

const state = vi.hoisted(() => ({ data: null as WebPointPlan | null, error: '', loading: false, refresh: vi.fn() }));
vi.mock('@/hooks/useWebPointPlan', () => ({ useWebPointPlan: () => state }));
const plan: WebPointPlan = { weeks: { W1: { moduleId: 'M1', points: [
  { id: 'P1', title: 'Understand the topic', componentIds: ['READ', 'QUIZ'] },
  { id: 'P2', title: 'Apply the topic', componentIds: ['VIDEO'] },
] } } };
const rows: JourneyComponent[] = [
  { componentId: 'FREE', title: 'Week introduction', type: 'reading', moduleId: 'M1', weekId: 'W1', expectedOtjh: 0, contentHtml: '<p>Welcome</p>' },
  { componentId: 'READ', title: 'Read the topic', type: 'reading', moduleId: 'M1', weekId: 'W1', expectedOtjh: 0, contentHtml: '<p>Read</p>' },
  { componentId: 'QUIZ', title: 'Topic quiz', type: 'quiz', moduleId: 'M1', weekId: 'W1', expectedOtjh: 0, isQuiz: true, quizMeta: { quizId: 3, questions: 2, duration: null, timeUnit: null } },
  { componentId: 'VIDEO', title: 'Watch the demonstration', type: 'video', moduleId: 'M1', weekId: 'W1', expectedOtjh: 0, videoUrl: 'https://example.org/video.mp4' },
];
beforeEach(() => { state.data = structuredClone(plan); state.error = ''; state.refresh.mockClear(); });
function sidebar() {
  return render(<MemoryRouter><ActivitySidebar weekTitle="Week 1" moduleTitle="Module" weeks={[]}
    weekComponents={rows} completedIds={new Set()} currentComponentId="READ"
    routeFor={row => `/activity/${row.componentId}`} /></MemoryRouter>);
}

describe('optional curriculum Points', () => {
  it('shows assigned activities only inside their named Point and keeps other activities outside', () => {
    sidebar();
    const point = screen.getByRole('list', { name: 'Understand the topic activities' });
    expect(within(point).getByRole('button', { name: /Read the topic/ })).toBeVisible();
    expect(point.closest('details')).toHaveAttribute('open');
    expect(screen.getAllByText('Read the topic')).toHaveLength(1);
    expect(screen.getByText('Read the topic')).toHaveAttribute('title', 'Read the topic');
    const free = screen.getByRole('button', { name: /Week introduction/ });
    expect(free.closest('details')).toBeNull();
    expect(free).toBeEnabled();
    const otherActivities = screen.getByRole('list', { name: 'Other activities' });
    expect(within(otherActivities).getByRole('button', { name: /Week introduction/ })).toBe(free);
    expect(within(point).queryByText('Week introduction')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Other activities' })).toBeVisible();
    const firstPoint = screen.getByText('Understand the topic');
    const secondPoint = screen.getByText('Apply the topic');
    expect(firstPoint.compareDocumentPosition(secondPoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(secondPoint.compareDocumentPosition(free) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByText('Apply the topic'));
    expect(screen.getByRole('button', { name: /Watch the demonstration/ })).toBeEnabled();
  });

  it('keeps all activities available if grouping fails, with a visible retry', () => {
    state.data = null; state.error = 'Unavailable';
    sidebar();
    expect(screen.queryByRole('heading', { name: 'Other activities' })).toBeNull();
    expect(screen.getByRole('button', { name: /Watch the demonstration/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Points' }));
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it('does not group another week/module or duplicate an activity, and supports catalogue identities', () => {
    const before = JSON.stringify(rows);
    const other = { ...rows[1], moduleId: 'M2', weekId: 'W2' };
    const groups = webPointGroups([...rows, other], plan);
    expect(groups.map(group => group.point?.id ?? null)).toEqual(['P1', 'P2', null]);
    expect(groups[2].components).toEqual([rows[0], other]);
    expect(groups.flatMap(group => group.components)).toHaveLength(5);
    const catalogue = { ...rows[1], componentId: 'native:READ' };
    expect(webPointGroups([catalogue], plan, () => 'READ')[0].components).toEqual([catalogue]);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('shows the same named grouping on the dashboard without changing totals or search', () => {
    render(<MemoryRouter><ActivitiesTableModern components={rows} completedIds={new Set()} kind="commercial"
      learnerId="7" week="Week 1" canOpenActivities /></MemoryRouter>);
    expect(screen.getByRole('rowheader', { name: 'Understand the topic' })).toBeVisible();
    expect(screen.getByRole('rowheader', { name: 'Apply the topic' })).toBeVisible();
    expect(screen.getAllByText('Read the topic')).toHaveLength(1);
    expect(screen.getByText('Showing 4 of 4 activities')).toBeVisible();
    expect(screen.getAllByRole('rowheader').map(header => header.textContent)).toEqual([
      'Understand the topic', 'Apply the topic', 'Other activities',
    ]);
    const free = screen.getByText('Week introduction');
    expect(screen.getByRole('rowheader', { name: 'Other activities' }).compareDocumentPosition(free) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search activities' }), { target: { value: 'demonstration' } });
    expect(screen.queryByRole('rowheader', { name: 'Understand the topic' })).toBeNull();
    expect(screen.getByRole('rowheader', { name: 'Apply the topic' })).toBeVisible();
    expect(screen.getByText('Showing 1 of 1 activities')).toBeVisible();
  });
});
