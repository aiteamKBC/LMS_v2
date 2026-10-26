import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { feedbackApi } from '@/api/feedback';
import StudentHome from './page';

const state = vi.hoisted(() => ({ status: 'Active', role: 'learner' }));
vi.mock('@/api/feedback', () => ({ feedbackApi: { myForms: vi.fn() } }));
vi.mock('lottie-react', () => ({ Lottie: () => null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: {
  id: 3, subjectId: 71, learnerType: 'apprenticeship', role: state.role, displayName: 'Synthetic Learner',
} }, logout: vi.fn(), retryInitialization: vi.fn() }) }));
vi.mock('@/hooks/useLearnerSummaryParam', () => ({ useLearnerSummaryParam: () => ({
  real: { id: 71, name: 'Synthetic Learner', programmeStatus: state.status }, loadError: '', refresh: vi.fn(),
}) }));

const summary = {
  weekStart: '2026-10-19', weekEnd: '2026-10-25', modules: [], homeProgress: {
    period: { start: null, end: '2026-10-25' },
    otjh: { actual: 0, submitted: 0, planned: null, percent: null, missingPlannedActivities: 0 },
    activities: null, assignments: null, lectures: null, modules: { completed: 0, total: 0 }, undatedActivities: 0,
  },
};
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.includes('section=home-summary') && !url.includes('section=upcoming')) {
    throw new Error(`Unexpected Home request: ${url}`);
  }
  return new Response(JSON.stringify(url.includes('section=home-summary') ? summary : { events: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});

beforeEach(() => {
  state.status = 'Active';
  state.role = 'learner';
  invalidateLearnerReads();
  fetchMock.mockClear();
  vi.mocked(feedbackApi.myForms).mockReset().mockResolvedValue({ forms: [] });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); invalidateLearnerReads(); vi.unstubAllGlobals(); });

function openHome(preview = false) {
  render(<StrictMode><MemoryRouter initialEntries={[preview ? '/workspace/learner/apprenticeship/71' : '/learner/home']}>
    <Routes>
      <Route path="/learner/home" element={<StudentHome />} />
      <Route path="/workspace/learner/:kind/:id" element={<StudentHome />} />
      <Route path="/workspace/learner/dashboard" element={<p>Existing onboarding destination</p>} />
    </Routes>
  </MemoryRouter></StrictMode>);
}

describe('Home card transport after identity resolves', () => {
  it.each([false, true])('shares exactly two initial card requests under StrictMode (preview=%s)', async preview => {
    if (preview) state.role = 'staff';
    openHome(preview);
    await waitFor(() => expect(screen.getByText('No sessions, assignments or reviews next week.')).toBeInTheDocument());
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      '/learner_api/overview-week/apprenticeship/71/?section=home-summary',
      '/learner_api/training-plan-dashboard/apprenticeship/71/?section=upcoming',
    ]);
  });

  it.each(['Delivery', 'Ready to enrol'])('starts no card transport before redirecting %s', async status => {
    state.status = status;
    openHome();
    await act(async () => {});
    expect(screen.getByText('Existing onboarding destination')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(feedbackApi.myForms).not.toHaveBeenCalled();
  });
});
