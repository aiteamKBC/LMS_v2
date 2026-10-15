import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardTabsProps } from '../DashboardTabs';
import DashboardWeeklyTab from '../tabs/DashboardWeeklyTab';
const weekly = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/hooks/useWeeklyLearning', () => ({ useWeeklyLearning: () => ({ real: null, loading: false, loadError: 'Offline', refresh: weekly.refresh }),
  useWeeklyLearningWeek: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }) }));

afterEach(cleanup);

describe('weekly dashboard tab errors', () => {
  it('shows a retry instead of an endless weekly skeleton when plan loading fails', () => {
    const refresh = weekly.refresh;
    refresh.mockClear();
    const props = {
      kind: 'commercial', learnerId: '125',
      plan: {
        data: null, subjects: undefined, error: 'Offline', refresh,
        schedule: { data: null, loading: true, error: '' },
      },
    } as unknown as DashboardTabsProps;

    render(<DashboardWeeklyTab {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Offline');
    expect(screen.queryByRole('region', { name: 'Weekly learning plan' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Loading your weekly learning plan')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
