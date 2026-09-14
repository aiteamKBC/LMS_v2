import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { DashboardRewards } from '../DashboardRewards';

beforeEach(clearAllCachedResources);
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); });
const payload = () => ({ points: { learnerId: '125', balance: 250, earned: 400, committed: 150 },
  rewards: [{ id: '1', name: 'Learning voucher', description: 'Choose your next book', category: 'Learning', points: 300, remaining: 4 }] });
describe('dashboard rewards', () => {
  it('shows the selected learner balance and refreshes reward affordability after a points update', async () => {
    const data = payload();
    const fetch = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0]) => new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><DashboardRewards kind="commercial" learnerId="125" /></MemoryRouter>);
    expect(await screen.findByText('50 more points')).toBeVisible();
    expect(screen.getByText('400')).toBeVisible();
    expect(fetch.mock.calls[0][0]).toBe('/learner_api/rewards-summary/commercial/125/');
    data.points.balance = 350;
    await act(async () => invalidateLearnerReads());
    expect(screen.getByText('Within reach')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View rewards' })).toHaveAttribute('href', '/learner/rewards');
  });
  it('keeps staff previews read-only and rejects a different learner balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...payload(), points: { ...payload().points, learnerId: '999' } }))));
    render(<MemoryRouter><DashboardRewards kind="commercial" learnerId="125" canOpenRewards={false} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your rewards and points');
    expect(screen.queryByText('250')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('retries failed reads and distinguishes an empty catalogue from an unavailable one', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockImplementation(async () => new Response(JSON.stringify({ points: payload().points, rewards: [] })));
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><DashboardRewards kind="commercial" learnerId="125" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry rewards' }));
    expect(await screen.findByText(/New rewards will appear/)).toBeVisible();
  });
});
