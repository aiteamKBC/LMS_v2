import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActivitySidebar } from '../ActivitySidebar';
import type { JourneyComponent } from '@/utils/learnerJourney';

const rows: JourneyComponent[] = [
  { componentId: 'WELCOME', title: 'Welcome', type: 'reading', contentHtml: '<p>Welcome</p>', expectedOtjh: 0 },
  { componentId: 'READ', title: 'Read the case', type: 'reading', pointNumber: 1, contentHtml: '<p>Case</p>', expectedOtjh: 1 },
  { componentId: 'QUIZ', title: 'Check understanding', type: 'quiz', pointNumber: 1, isQuiz: true, expectedOtjh: 0,
    quizMeta: { quizId: 3, questions: 10, duration: null, timeUnit: null } },
  { componentId: 'AUDIO', title: 'Listen to the case', type: 'podcast', pointNumber: 1, audioUrl: 'https://example.org/audio.mp3', expectedOtjh: 0 },
  { componentId: 'LOCKED', title: 'Later reading', type: 'reading', pointNumber: 2, expectedOtjh: 1 },
];
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function sidebar(current = 'AUDIO', accessOpen = true, blocked = vi.fn(), components = rows) {
  return <MemoryRouter initialEntries={['/learner/component/commercial/132/AUDIO']}><ActivitySidebar
    weekComponents={components} weekTitle="Week 1" moduleTitle="AI" weeks={[]}
    completedIds={new Set(['READ'])} currentComponentId={current}
    routeFor={row => `/learner/component/commercial/132/${row.componentId}`}
    accessOpen={accessOpen} onAccessBlocked={blocked} /><Location /></MemoryRouter>;
}
describe('flat week sidebar', () => {
  it('shows all activities directly in saved order and retains native routes', () => {
    const { container } = render(sidebar());
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText(/^Point \d+$/)).not.toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('button').map(button => button.textContent))
      .toEqual(['ReadingWelcome', 'ReadingRead the caseRequiredPlanned time: 1h', 'QuizCheck understanding', 'PodcastListen to the case', 'ReadingLater readingRequiredPlanned time: 1h']);
    expect(screen.getByRole('button', { name: /Welcome/ })).toBeVisible();
    fireEvent.click(within(list).getByRole('button', { name: /Read the case/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/commercial/132/READ');
  });

  it('keeps access and unavailable-content gates on the child buttons', () => {
    const blocked = vi.fn();
    render(sidebar('READ', false, blocked));
    const audio = screen.getByRole('button', { name: /Listen to the case/ });
    expect(audio).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(audio);
    expect(blocked).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent('/AUDIO');
    expect(screen.getByRole('button', { name: /Later reading/ })).toBeDisabled();
  });

  it('keeps an activity already outside a Point once without merging distinct activities with the same title', () => {
    const components = [{ ...rows[1], pointNumber: null }, ...rows, { ...rows[1], componentId: 'READ-OTHER' }];
    const before = JSON.stringify(components);
    render(sidebar('AUDIO', true, vi.fn(), components));
    expect(screen.getAllByRole('button', { name: /Read the case/ })).toHaveLength(2);
    expect(screen.getByText(/6 components/)).toHaveTextContent('1 done');
    expect(JSON.stringify(components)).toBe(before);
  });

  it('flattens and deduplicates another week without removing the same activity from the current week', () => {
    const duplicates = [...rows, { ...rows[1], pointNumber: null }];
    render(<MemoryRouter><ActivitySidebar weekComponents={rows} weekTitle="Week 1" moduleTitle="AI"
      weeks={[
        { week: 'Week 1', count: rows.length, completed: 1, active: true, components: rows },
        { week: 'Week 2', count: duplicates.length, completed: 2, active: false, components: duplicates },
      ]} completedIds={new Set(['READ'])} routeFor={row => `/activity/${row.componentId}`} /></MemoryRouter>);
    const weekButton = screen.getByRole('button', { name: /^Week 2, 5 components/ });
    fireEvent.click(weekButton);
    const week = weekButton.closest('li')!;
    expect(within(week).getAllByRole('button', { name: /Read the case/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Read the case/ })).toHaveLength(2);
    expect(week.querySelector('details')).toBeNull();
  });
});
