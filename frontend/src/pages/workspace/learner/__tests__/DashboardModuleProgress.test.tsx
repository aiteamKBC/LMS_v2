import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import type { DashboardTabsProps } from '../DashboardTabs';
import type { DashboardTrainingPlan } from '../DashboardTrainingPlan';
import DashboardOverviewTab from '../tabs/DashboardOverviewTab';

vi.mock('../DashboardActivities', () => ({ DashboardActivities: () => null }));
vi.mock('../DashboardTrainingPlan', () => ({
  DashboardTrainingPlan: (props: Parameters<typeof DashboardTrainingPlan>[0]) => <div>
    <output data-testid="rows">{JSON.stringify(props.programmeProgress || null)}</output>
    <output data-testid="loading">{String(!!props.learningSubjectsLoading)}</output>
    {props.learningSubjectsError && <div role="alert">{props.learningSubjectsError}</div>}
    <button onClick={props.onRetryLearningSubjects}>Retry modules</button>
  </div>,
}));

const props = { kind: 'apprenticeship', learnerId: '201', real: {}, learningSubjects: [],
  plan: { data: null }, canSeeNavItem: () => false, metrics: {},
} as unknown as DashboardTabsProps;
const row = { id: 'current:M1', title: 'Synthetic', completed: 1, total: 4, percent: 25 };
beforeEach(() => clearAllCachedResources());
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('requests final backend progress after Student records load and retains counts/percent unchanged', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toContain('/module-progress/');
    return new Response(JSON.stringify({ modules: [row] }));
  });
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<MemoryRouter><DashboardOverviewTab {...props} learningSubjectsLoading /></MemoryRouter>);
  expect(fetch).not.toHaveBeenCalled();
  rerender(<MemoryRouter><DashboardOverviewTab {...props} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe(JSON.stringify([row])));
  expect(String(fetch.mock.calls[0]?.[0])).toContain('/learner_api/module-progress/apprenticeship/201/');
  expect(screen.getByTestId('loading')).toHaveTextContent('false');
});

it('does not substitute frontend percentages on failure and retries the read-only endpoint', async () => {
  let failed = true;
  vi.stubGlobal('fetch', vi.fn(async () => failed
    ? new Response(JSON.stringify({ error: 'Offline' }), { status: 503 })
    : new Response(JSON.stringify({ modules: [row] }))));
  render(<MemoryRouter><DashboardOverviewTab {...props} /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByTestId('rows')).toHaveTextContent('null');
  expect(screen.getByTestId('loading')).toHaveTextContent('true');
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry modules' }));
  await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe(JSON.stringify([row])));
});

it('refreshes after learning invalidation and does not reuse another learner snapshot', async () => {
  let percent = 25;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ modules: [
    { ...row, percent: String(input).includes('/202/') ? 0 : percent },
  ] }))));
  const { rerender } = render(<MemoryRouter><DashboardOverviewTab {...props} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('"percent":25'));
  percent = 50;
  act(() => invalidateLearnerReads());
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('"percent":50'));
  rerender(<MemoryRouter><DashboardOverviewTab {...props} learnerId="202" /></MemoryRouter>);
  expect(screen.getByTestId('rows')).not.toHaveTextContent('"percent":50');
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('"percent":0'));
});
