import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumHomeSummary } from './useCurriculumHome';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumJson: mocks.fetch }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: (refresh: () => void) => { mocks.refresh = refresh; } }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

vi.mock('./LiveTotalsSection', () => ({ LiveTotalsSection: () => <div data-testid="live-totals" /> }));

import CurriculumStudio from './page';

const summary: CurriculumHomeSummary = {
  stats: { programmes: 7, activeCohorts: 11, groups: 113, openIssues: 174 },
  attentionCounts: { 'programme-ksb-source': 0, 'module-mapping': 94, 'draft-content': 0, 'group-coach': 79, 'module-tutor': 1 },
  continueModules: [{ id: 'M/1', name: 'Synthetic module', programme: 'Synthetic programme', weeks: 16, status: 'published' }],
  programmeFocus: [{ programme: { id: 'P/1', name: 'Synthetic programme' }, issues: ['26 mapping gaps', '29 without coach'], issueCount: 2 }],
};

function showHome() {
  return render(<MemoryRouter><CurriculumStudio /></MemoryRouter>);
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.refresh = undefined;
});

describe('Curriculum Home summary', () => {
  it('loads only the bounded summary and preserves counts, actions and canonical links', async () => {
    mocks.fetch.mockResolvedValue(summary);
    showHome();
    expect(await screen.findByText('174 open actions')).toBeInTheDocument();
    expect(screen.getByTestId('live-totals')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Synthetic module/ })).toHaveAttribute('href', '/curriculum/module-builder?module=M%2F1');
    expect(screen.getByRole('link', { name: /Synthetic programme.*26 mapping gaps/ })).toHaveAttribute('href', '/curriculum/programmes/P%2F1');
    expect(screen.getByRole('link', { name: /Modules have no KSB mappings/ })).toHaveAttribute('href', '/curriculum/ksb-mapping');
    expect(screen.getByRole('link', { name: /Groups have no coach/ })).toHaveAttribute('href', '/curriculum/groups');
    expect(screen.getByRole('link', { name: /Modules have no tutor/ })).toHaveAttribute('href', '/curriculum/module-builder');
    expect(screen.getByRole('link', { name: /Set up cohorts/ })).toHaveAttribute('href', '/curriculum/cohorts');
    expect(screen.queryByText('Modules are still in draft')).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith('/curriculum/home-summary/', {
      signal: expect.any(AbortSignal), revalidate: true, timeoutMs: 30000,
    });
  });

  it('keeps loading distinct from genuinely empty data', async () => {
    let resolve!: (value: CurriculumHomeSummary) => void;
    mocks.fetch.mockReturnValue(new Promise<CurriculumHomeSummary>(done => { resolve = done; }));
    showHome();
    expect(screen.queryByText('Everything looks clear')).not.toBeInTheDocument();
    expect(screen.queryByText('No modules yet')).not.toBeInTheDocument();
    await act(async () => resolve({
      stats: { programmes: 0, activeCohorts: 0, groups: 0, openIssues: 0 },
      attentionCounts: { 'programme-ksb-source': 0, 'module-mapping': 0, 'draft-content': 0, 'group-coach': 0, 'module-tutor': 0 },
      continueModules: [], programmeFocus: [],
    }));
    expect(screen.getByText('Everything looks clear')).toBeInTheDocument();
    expect(screen.getByText('No modules yet')).toBeInTheDocument();
    expect(screen.getByText('All programmes are clear')).toBeInTheDocument();
  });

  it('shows a retryable error without claiming there are no blockers', async () => {
    const user = userEvent.setup();
    mocks.fetch.mockRejectedValueOnce(new Error('Summary unavailable')).mockResolvedValueOnce(summary);
    showHome();
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByText('Everything looks clear')).not.toBeInTheDocument();
    expect(screen.queryByText('No curriculum blockers found')).not.toBeInTheDocument();
    expect(screen.queryByText('All programmes are clear')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('174 open actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('retains the last summary during refresh failures and updates after a remote write', async () => {
    mocks.fetch.mockResolvedValueOnce(summary).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({
      ...summary, stats: { ...summary.stats, openIssues: 175 },
    });
    showHome();
    await screen.findByText('174 open actions');
    await act(async () => { mocks.refresh?.(); });
    expect(screen.getByText('174 open actions')).toBeInTheDocument();
    expect(screen.getByText(/Curriculum data could not be refreshed: Offline/)).toBeInTheDocument();
    await act(async () => { mocks.refresh?.(); });
    expect(screen.getByText('175 open actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('ignores superseded responses and aborts its request on unmount', async () => {
    let first!: (value: CurriculumHomeSummary) => void;
    mocks.fetch.mockReturnValueOnce(new Promise<CurriculumHomeSummary>(resolve => { first = resolve; })).mockResolvedValueOnce(summary);
    const view = showHome();
    const initialSignal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { mocks.refresh?.(); });
    expect(initialSignal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByText('174 open actions')).toBeInTheDocument());
    await act(async () => first({ ...summary, stats: { ...summary.stats, openIssues: 999 } }));
    expect(screen.queryByText('999 open actions')).not.toBeInTheDocument();
    expect(within(view.container).getByText('174 open actions')).toBeInTheDocument();
    const latestSignal = mocks.fetch.mock.calls[1][1].signal as AbortSignal;
    view.unmount();
    expect(latestSignal.aborted).toBe(true);
  });
});
