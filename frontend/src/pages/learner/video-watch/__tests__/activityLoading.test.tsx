import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { clearAllCachedResources } from '@/api/cachedRequest';
import ComponentViewPage from '../page';

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({
  useLearnerWorkspaceAccess: () => ({ canProgress: true, showReadOnlyNotice: false }),
}));
vi.mock('@/hooks/useComponentAccessWindow', () => ({
  useComponentAccessWindow: () => ({ open: true, holidays: [], holidayCalendarReady: true }),
}));
vi.mock('@/api/learnerOverview', () => ({
  learningSchedule: { read: vi.fn().mockResolvedValue({ modules: [] }), peek: () => undefined },
}));

const lesson = {
  id: '7', modules: ['Example module'], week: [{ module: 'Example module', moduleId: 'M1', week: 'Week 1', weekId: 'W1' }],
  components: [{ componentId: 'READ', component: 'Example reading', type: 'reading',
    module: 'Example module', moduleId: 'M1', week: 'Week 1', weekId: 'W1',
    contentHtml: '<p>The selected lesson is available.</p>', expectedOtjh: 1 }],
  quizAttempts: [], videoProgress: [], ksbs: [],
  componentProgress: [{ kind: 'component', componentId: 'READ', timeTaken: '00:20', submittedAt: '2026-11-01T12:00:00Z' }],
};
const reply = () => new Response(JSON.stringify(lesson), { status: 200 });

function mount(kind = 'commercial') {
  render(<MemoryRouter initialEntries={[`/learner/component/${kind}/7/READ`]}>
    <Routes><Route path="/learner/component/:kind/:id/:componentId" element={<ComponentViewPage />} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  clearAllCachedResources();
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('activity content loading', () => {
  it.each(['commercial', 'apprenticeship'])('shows the selected content when the read exceeds 45 seconds (%s)', async kind => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
    mount(kind);
    await act(() => vi.advanceTimersByTimeAsync(85_000));
    expect(screen.queryByText(/Loading is taking longer/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await act(async () => { resolve(reply()); });
    expect(screen.getByText('The selected lesson is available.')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/learner_api/learner-detail/${kind}/7/?content=activity&component_id=READ`);
  });

  it('shows a bounded timeout and loads the content after Try again', async () => {
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(reply());
    mount();
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(screen.getByText(/Loading is taking longer/)).toBeVisible();
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('The selected lesson is available.')).toBeVisible();
    expect(screen.queryByText(/Loading is taking longer/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
