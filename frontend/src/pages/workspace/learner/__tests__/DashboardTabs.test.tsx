import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardTabs, type DashboardTabsProps } from '../DashboardTabs';

vi.mock('../tabs/DashboardOverviewTab', () => ({ default: () => <p>Overview panel</p> }));
vi.mock('../tabs/DashboardWeeklyTab', () => ({ default: () => <p>Weekly panel</p> }));
vi.mock('../tabs/DashboardMonthlyTab', () => ({ default: () => <p>Monthly panel</p> }));
vi.mock('../tabs/DashboardTrainingTab', () => ({ default: () => <p>Training panel</p> }));
vi.mock('../tabs/DashboardRewardsTab', () => ({ default: () => <p>Rewards panel</p> }));

const props = { kind: 'apprenticeship', learnerId: '1', plan: {}, canSeeNavItem: () => true, metrics: {} } as unknown as DashboardTabsProps;

afterEach(cleanup);

describe('learner dashboard tabs', () => {
  it('orders Overview just before Rewards and opens on Weekly Learning by default', async () => {
    render(<DashboardTabs {...props} />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Weekly Learning', 'Monthly Plan', 'Training Plan', 'Overview', 'Rewards']);
    expect(screen.getByRole('tab', { name: 'Weekly Learning' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Weekly panel')).toBeVisible();
    expect(screen.queryByText('Overview panel')).not.toBeInTheDocument();
  });
});
