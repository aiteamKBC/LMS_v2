import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverviewWeek } from '@/api/learnerOverview';
import { ContinueLearning } from './ContinueLearning';

const subject = (id: string, title: string, completed = 0): OverviewWeek['modules'][number] => ({
  id, title, weekLabels: ['Week 2'], completed, total: 3, percent: completed / 3 * 100,
  ksbCodes: [], ksbMappingMissing: false,
});
const week: OverviewWeek = {
  weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', modules: [], deadlines: [],
  undatedActivities: 0, expectedHours: 0, missingExpectedHours: 0,
  otjh: { actual: 0, historical: 0, new: 0, undatedHistoricalRows: 0 },
};
const retry = vi.fn();
function Location() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }
function view(modules: OverviewWeek['modules'], overrides: Partial<Parameters<typeof ContinueLearning>[0]> = {}) {
  return <MemoryRouter initialEntries={['/workspace/learner']}>
    <ContinueLearning kind="apprenticeship" learnerId="71" enabled week={{ ...week, modules }}
      loading={false} error="" onRetry={retry} {...overrides}/><Location/>
  </MemoryRouter>;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('home Continue Learning', () => {
  it.each(['current:M1', 'legacy:17'])('opens the only current subject directly, including completed weeks (%s)', id => {
    render(view([subject(id, 'Leadership', 3)]));
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('destination')).toHaveTextContent(`/learner/my-learning/apprenticeship/71?subject=${encodeURIComponent(id)}&week=2026-09-07`);
  });

  it('offers all concurrent subjects and opens the chosen one in the current week', () => {
    render(view([subject('current:M1', 'Leadership', 3), subject('legacy:22', 'Marketing')]));
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Continue learning' }));
    expect(dialog.getAllByRole('link')).toHaveLength(2);
    expect(dialog.getByRole('link', { name: /Leadership/ })).toBeVisible();
    expect(screen.getByTestId('destination')).toHaveTextContent(/^\/workspace\/learner$/);
    fireEvent.click(dialog.getByRole('link', { name: /Marketing/ }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/my-learning/apprenticeship/71?subject=legacy%3A22&week=2026-09-07');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('allows Escape to dismiss the choice and restores focus to Continue Learning', () => {
    render(view([subject('current:M1', 'Leadership'), subject('current:M2', 'Marketing')]));
    const trigger = screen.getByRole('button', { name: 'Continue Learning' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(screen.getByTestId('destination')).toHaveTextContent(/^\/workspace\/learner$/);
  });

  it('shows an empty week without choosing an unrelated module', () => {
    render(view([]));
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('No learning activities are scheduled for this week.')).toBeVisible();
    expect(dialog.getByRole('link', { name: 'View all my learning' })).toHaveAttribute('href', '/learner/my-learning/apprenticeship/71');
    expect(screen.getByTestId('destination')).toHaveTextContent(/^\/workspace\/learner$/);
  });

  it('waits for the schedule before enabling the action', () => {
    const { rerender } = render(view([], { loading: true, week: null }));
    expect(screen.getByRole('button', { name: 'Continue Learning' })).toBeDisabled();
    rerender(view([subject('current:M1', 'Leadership')]));
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('subject=current%3AM1&week=2026-09-07');
  });

  it('offers a retry when refreshing the schedule fails instead of following cached modules', () => {
    const modules = [subject('current:M1', 'Leadership')];
    const { rerender } = render(view(modules, { error: 'Network unavailable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('alert')).toHaveTextContent('We could not check your learning for this week.');
    fireEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByTestId('destination')).toHaveTextContent(/^\/workspace\/learner$/);
    rerender(view(modules));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Leadership/ }));
    expect(screen.getByTestId('destination')).toHaveTextContent('subject=current%3AM1&week=2026-09-07');
  });

  it('refreshes an earlier week when the UK week has changed', () => {
    // Still Sunday in UTC; already Monday in the learner calendar.
    vi.setSystemTime(new Date('2026-09-13T23:30:00Z'));
    render(view([subject('current:M1', 'Leadership')]));
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByTestId('destination')).toHaveTextContent(/^\/workspace\/learner$/);
  });

  it('keeps the selected learner identity when learning prerequisites still apply', () => {
    render(view([], { kind: 'commercial', learnerId: '502', enabled: false, week: null }));
    expect(screen.getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', '/learner/my-learning/commercial/502');
  });
});
