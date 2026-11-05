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
function sidebar(current = 'AUDIO', accessOpen = true, blocked = vi.fn()) {
  return <MemoryRouter initialEntries={['/learner/component/commercial/132/AUDIO']}><ActivitySidebar
    weekComponents={rows} weekTitle="Week 1" moduleTitle="AI" weeks={[]}
    completedIds={new Set(['READ'])} currentComponentId={current}
    routeFor={row => `/learner/component/commercial/132/${row.componentId}`}
    accessOpen={accessOpen} onAccessBlocked={blocked} /><Location /></MemoryRouter>;
}
describe('point sidebar', () => {
  it('expands the deep-linked point, leaves another point collapsed, and retains native routes', () => {
    render(sidebar());
    const point = screen.getByRole('list', { name: 'Point 1 activities' });
    expect(point.closest('details')).toHaveAttribute('open');
    expect(within(point).getAllByRole('button').map(button => button.textContent))
      .toEqual(['ReadingRead the case', 'PodcastListen to the case', 'QuizCheck understanding']);
    expect(screen.getByText('Point 2').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: /Welcome/ })).toBeVisible();
    fireEvent.click(within(point).getByRole('button', { name: /Read the case/ }));
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
    fireEvent.click(screen.getByText('Point 2'));
    expect(screen.getByRole('button', { name: /Later reading/, hidden: true })).toBeDisabled();
  });
});
