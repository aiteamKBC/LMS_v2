import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { HOME_RETURN_REFRESH_MS, type CurriculumHomeSummary } from './useCurriculumHome';
import { clearAttentionCache } from './useCurriculumAttention';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumJson: mocks.fetch }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: (refresh: () => void) => { mocks.refresh = refresh; } }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

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

const record = (id: string, name: string, extra: Partial<{ programme: string; cohort: string; group: string }> = {}) => ({ id, name, programme: 'Synthetic programme', cohort: '', group: '', ...extra });

/** Routes the mocked client by path: summary, issue details and programme details. */
function serve(details: Record<string, unknown> = {}) {
  mocks.fetch.mockImplementation((path: string) => {
    if (path === '/curriculum/home-summary/') return Promise.resolve(summary);
    if (path in details) return Promise.resolve(details[path]);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}
const calls = (path: string) => mocks.fetch.mock.calls.filter(([called]) => called === path).length;

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.refresh = undefined;
  clearAttentionCache();
  vi.restoreAllMocks();
});

describe('Curriculum Home summary', () => {
  it('loads only the bounded summary and preserves counts, actions and canonical links', async () => {
    mocks.fetch.mockResolvedValue(summary);
    showHome();
    expect(await screen.findByText('174 open actions')).toBeInTheDocument();
    expect(screen.getByText('113 groups across all cohorts')).toBeInTheDocument();
    // Continue Working row is now a button that opens a module detail modal.
    expect(screen.getByRole('button', { name: /Synthetic module/ })).toBeInTheDocument();
    // Programme Review card is now a button; matched by its unique issue text.
    expect(screen.getByRole('button', { name: /26 mapping gaps/ })).toBeInTheDocument();
    // Attention rows are now buttons; count badges confirm the right issue is shown.
    expect(screen.getByRole('button', { name: /Modules have no KSB mappings/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Groups have no coach/ })).toBeInTheDocument();
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
      ...summary, stats: { ...summary.stats, groups: 114 },
    });
    showHome();
    await screen.findByText('113 groups across all cohorts');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + HOME_RETURN_REFRESH_MS + 1);
    await act(async () => { mocks.refresh?.(); });
    expect(screen.getByText('113 groups across all cohorts')).toBeInTheDocument();
    expect(screen.getByText(/Curriculum data could not be refreshed: Offline/)).toBeInTheDocument();
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * HOME_RETURN_REFRESH_MS + 2);
    await act(async () => { mocks.refresh?.(); });
    expect(screen.getByText('114 groups across all cohorts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('joins an in-flight read on return and aborts it after unmount', async () => {
    let resolve!: (value: CurriculumHomeSummary) => void;
    mocks.fetch.mockReturnValue(new Promise<CurriculumHomeSummary>(done => { resolve = done; }));
    const view = showHome();
    await act(async () => { mocks.refresh?.(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    await act(async () => { await new Promise(done => setTimeout(done, 0)); });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(summary));
  });

  it('sends one summary request under StrictMode and none on a recent return', async () => {
    serve();
    render(<StrictMode><MemoryRouter><CurriculumStudio /></MemoryRouter></StrictMode>);
    expect(await screen.findByText('174 open actions')).toBeInTheDocument();
    await act(async () => { mocks.refresh?.(); });
    expect(calls('/curriculum/home-summary/')).toBe(1);
  });
});

describe('Curriculum Home details', () => {
  const mappingPath = '/curriculum/home-attention/?issue=module-mapping';
  const programmePath = '/curriculum/home-attention/?programme=P%2F1';

  it('reads issue records only when the modal opens and reuses them on reopen', async () => {
    const user = userEvent.setup();
    serve({ [mappingPath]: { issue: 'module-mapping', count: 1, records: [record('M/1', 'Synthetic module', { cohort: 'Cohort A', group: 'Group 1' })] } });
    showHome();
    await screen.findByText('174 open actions');
    expect(calls(mappingPath)).toBe(0);

    await user.click(screen.getByRole('button', { name: /Modules have no KSB mappings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Modules have no KSB mappings' });
    expect(await within(dialog).findByText('Synthetic module')).toBeInTheDocument();
    expect(within(dialog).getByText('Synthetic programme · Cohort A · Group 1')).toBeInTheDocument();
    expect(within(dialog).getByText('No KSBs mapped to this module')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Map KSBs/ })).toHaveAttribute('href', '/curriculum/module-builder?module=M%2F1');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Modules have no KSB mappings/ }));
    expect(await screen.findByText('Synthetic module', { selector: 'p' })).toBeInTheDocument();
    expect(calls(mappingPath)).toBe(1);
    expect(calls('/curriculum/home-summary/')).toBe(1);
  });

  it('re-reads details after a new summary, so a later visit never shows pre-write rows', async () => {
    const user = userEvent.setup();
    serve({ [mappingPath]: { issue: 'module-mapping', count: 1, records: [record('M/1', 'Synthetic module')] } });
    const first = showHome();
    await screen.findByText('174 open actions');
    await user.click(screen.getByRole('button', { name: /Modules have no KSB mappings/ }));
    await screen.findByRole('link', { name: /Map KSBs/ });
    first.unmount();
    showHome();
    await screen.findByText('174 open actions');
    await user.click(screen.getByRole('button', { name: /Modules have no KSB mappings/ }));
    await screen.findByRole('link', { name: /Map KSBs/ });
    expect(calls('/curriculum/home-summary/')).toBe(2);
    expect(calls(mappingPath)).toBe(2);
  });

  it('names the affected modules and groups in the programme review', async () => {
    const user = userEvent.setup();
    serve({ [programmePath]: { programme: { id: 'P/1', name: 'Synthetic programme' }, sections: [
      { key: 'module-mapping', count: 1, records: [record('M/1', 'Synthetic module')] },
      { key: 'group-coach', count: 2, records: [record('G/1', 'Group one', { cohort: 'Cohort A' }), record('G/2', 'Group two', { cohort: 'Cohort A' })] },
    ] } });
    showHome();
    await user.click(await screen.findByRole('button', { name: /26 mapping gaps/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic programme' });
    expect(await within(dialog).findByText('Synthetic module')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Groups without a coach/ }));
    expect(within(dialog).getByText('Group two')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('link', { name: /Assign coach/ })[0]).toHaveAttribute('href', '/curriculum/groups/G%2F1');
    expect(calls(programmePath)).toBe(1);
  });

  it('shows module details without any extra request', async () => {
    const user = userEvent.setup();
    serve();
    showHome();
    await user.click(await screen.findByRole('button', { name: /Synthetic module/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic module' });
    expect(within(dialog).getByText('16 weeks')).toBeInTheDocument();
    expect(within(dialog).getByText('Published')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Open in Module Builder/ })).toHaveAttribute('href', '/curriculum/module-builder?module=M%2F1');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
