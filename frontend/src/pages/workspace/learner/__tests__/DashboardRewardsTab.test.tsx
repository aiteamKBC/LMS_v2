import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import DashboardRewardsTab from '../tabs/DashboardRewardsTab';

beforeEach(clearAllCachedResources);
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('dashboard Rewards tab preview', () => {
  it('shows the coming soon message and keeps reward actions inaccessible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      points: { learnerId: '125', balance: 250, earned: 400, committed: 150 }, rewards: [],
    }))));
    render(<MemoryRouter><DashboardRewardsTab kind="commercial" learnerId="125" canOpenRewards /></MemoryRouter>);

    expect(screen.getByRole('status')).toHaveTextContent('Coming soon');
    const preview = (await screen.findByText('Available points')).closest('[inert]');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('link', { name: 'View rewards' })).not.toBeInTheDocument();
  });
});
