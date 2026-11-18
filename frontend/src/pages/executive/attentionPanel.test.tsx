import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExecutiveOverview from './page';
import { loadLiveQmsData, type LiveQmsData } from './qualityData';
import { clearOverviewCache } from './overviewCache';

vi.mock('./qualityData', () => ({ loadLiveQmsData: vi.fn() }));

afterEach(() => { cleanup(); clearOverviewCache(); });

describe('Quality notifications in the overview', () => {
  it('shows only the skeleton until dashboard data loads, then displays notifications', async () => {
    let resolveData!: (data: LiveQmsData) => void;
    vi.mocked(loadLiveQmsData).mockReturnValue(new Promise(resolve => { resolveData = resolve; }));
    render(<MemoryRouter><ExecutiveOverview attentionPanel={<section aria-label="Needs Attention">Synthetic quality alert</section>} /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /Loading live quality/ })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('region', { name: 'Needs Attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Executive Overview' })).not.toBeInTheDocument();

    await act(async () => resolveData({
      forms: [], records: [], actions: [], concerns: [], feedbackTypes: [],
      periodLabel: 'Synthetic period', lastRefresh: 'Synthetic refresh', notice: 'Synthetic data',
      availability: { actions: true, criticalIssues: true, concerns: true, feedback: true, feedbackScores: true },
    }));
    expect(screen.queryByRole('status', { name: /Loading live quality/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Executive Overview' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toHaveTextContent('Synthetic quality alert');
  });

  it('shows notifications on failure and hides them again while retrying', async () => {
    vi.mocked(loadLiveQmsData).mockRejectedValue(new Error('Quality data unavailable'));
    render(<MemoryRouter><ExecutiveOverview attentionPanel={<section aria-label="Needs Attention">Synthetic quality alert</section>} /></MemoryRouter>);
    expect(screen.queryByRole('region', { name: 'Needs Attention' })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Quality data unavailable');
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toHaveTextContent('Synthetic quality alert');
    expect(screen.getByRole('button', { name: 'Retry quality data' })).toBeInTheDocument();
    vi.mocked(loadLiveQmsData).mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Retry quality data' }));
    expect(screen.getByRole('status', { name: /Loading live quality/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs Attention' })).not.toBeInTheDocument();
  });
});
