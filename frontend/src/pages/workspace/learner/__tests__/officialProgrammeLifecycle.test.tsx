import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useDashboardTabsData } from '@/hooks/useDashboardTabsData';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import DashboardOverviewTab from '../tabs/DashboardOverviewTab';
import type { DashboardTabsProps } from '../DashboardTabs';

function Harness() {
  const tabData = useDashboardTabsData('commercial', '265', true, new Set(['overview']));
  const metrics: DashboardTabsProps['metrics'] = {
    attendanceValue: 'Unavailable', attendanceSummary: '', attendanceTotalValue: 'Unavailable', attendancePercent: null,
    otjActualValue: '120h', otjSummary: '', otjTargetValue: '143.61h', otjTargetHours: 143.61, otjPercent: 84,
    ksbValue: 'Unavailable', ksbSummary: '', ksbPercent: null,
  };
  return <DashboardOverviewTab kind="commercial" learnerId="265" plan={tabData.overview.plan}
    tabData={tabData} metrics={metrics} canSeeNavItem={() => true} />;
}
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); });
describe('active Learner Overview official lifecycle', () => {
  it('uses one snapshot and suppresses official successes during invalidation and failed refresh, then retries', async () => {
    const payload = dashboardOverviewFixture();
    payload.metrics.otjh = { actual: 120, officialPlannedHours: 288, targetToDate: 143.61 };
    payload.hours.planned = 400;
    payload.hours.months = [{ key: '2026-10', target: 400, completed: 30, submitted: 5 }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    render(<MemoryRouter><Harness /></MemoryRouter>);
    expect(await screen.findByRole('progressbar', { name: /Training plan off/ })).toHaveAttribute('aria-valuenow', '8');
    expect(screen.queryByRole('progressbar', { name: 'Official programme completion' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Official Programme Completion|Official Planned Hours|Canonical Actual Hours|Official Target Marker|Official Variance/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => invalidateLearnerReads());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Official Programme Completion' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Training plan off/ })).toHaveAttribute('aria-valuenow', '8');
    await act(async () => finish(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByText('Official Planned Hours: 288h')).not.toBeInTheDocument();
    await act(async () => screen.getByRole('button', { name: 'Retry learning modules' }).click());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('progressbar', { name: /Training plan off/ }).querySelector('b')).toHaveStyle({ left: '36%' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
