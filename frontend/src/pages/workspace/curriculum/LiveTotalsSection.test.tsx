import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumLiveTotals } from './useCurriculumLiveTotals';

const mock = vi.hoisted(() => ({ data: null as CurriculumLiveTotals | null, loading: false, refreshing: false, error: null as string | null, reload: vi.fn() }));
vi.mock('./useCurriculumLiveTotals', () => ({ useCurriculumLiveTotals: () => mock }));
import { LiveTotalsSection } from './LiveTotalsSection';

const snapshot: CurriculumLiveTotals = {
  checkedAt: '2026-10-20T10:00:00Z',
  metrics: {
    modules: { active: 12, total: 15 }, cohorts: { active: 3, total: 5 },
    groups: { active: 4, total: 8 }, sessions: { active: 6, total: 10 },
    programmes: { active: 2, total: 3 },
  },
};
function show() { return render(<MemoryRouter><LiveTotalsSection /></MemoryRouter>); }
beforeEach(() => { mock.data = null; mock.loading = false; mock.refreshing = false; mock.error = null; mock.reload.mockReset(); });

describe('Live totals cards', () => {
  it('renders all five supplied counts, raw totals, source tables and canonical links', () => {
    mock.data = snapshot;
    show();
    for (const [label, value, total, href] of [
      ['Modules', 12, 15, '/curriculum/modules'], ['Cohorts', 3, 5, '/curriculum/cohorts'],
      ['Groups', 4, 8, '/curriculum/groups'], ['Sessions', 6, 10, '/curriculum/session-calendar'],
      ['Programmes', 2, 3, '/curriculum/programmes'],
    ]) {
      const card = screen.getByRole('link', { name: label + ': ' + value + ' of ' + total });
      expect(card).toHaveAttribute('href', href);
      expect(within(card).getByText(String(value), { exact: true })).toBeInTheDocument();
      expect(within(card).getByText('of ' + total)).toBeInTheDocument();
    }
    expect(screen.getByText('curriculum.live_sessions')).toBeInTheDocument();
    expect(screen.getByText(/Last verified:/)).toHaveTextContent('2026-10-20 10:00:00 UTC');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live totals' }));
    expect(mock.reload).toHaveBeenCalledOnce();
  });

  it('shows placeholders during loading and genuine zeroes after a verified empty read', () => {
    mock.loading = true;
    mock.refreshing = true;
    const view = show();
    expect(screen.getByRole('link', { name: 'Modules: totals unavailable' })).not.toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Refresh live totals' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading verified');
    mock.loading = false;
    mock.refreshing = false;
    mock.data = { ...snapshot, metrics: Object.fromEntries(Object.keys(snapshot.metrics).map(key => [key, { active: 0, total: 0 }])) as CurriculumLiveTotals['metrics'] };
    view.rerender(<MemoryRouter><LiveTotalsSection /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Modules: 0 of 0' })).toBeInTheDocument();
  });

  it('makes initial failure retryable without pretending the database is empty', () => {
    mock.error = 'Offline';
    show();
    expect(screen.getByRole('alert')).toHaveTextContent('Live totals are unavailable: Offline');
    expect(screen.getByRole('link', { name: 'Modules: totals unavailable' })).not.toHaveTextContent('0');
    expect(screen.queryByText(/Last verified:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry live totals' }));
    expect(mock.reload).toHaveBeenCalledOnce();
  });

  it('labels retained values and their timestamp honestly after a refresh failure', () => {
    mock.data = snapshot;
    mock.error = 'Offline';
    show();
    expect(screen.getByText('Last verified values')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the last verified totals. Refresh failed: Offline');
    expect(screen.getByRole('link', { name: 'Modules: 12 of 15' })).toBeInTheDocument();
    expect(screen.getByText(/Last verified:/)).toHaveTextContent('2026-10-20 10:00:00 UTC');
  });
});
