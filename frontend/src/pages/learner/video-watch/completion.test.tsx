import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { submitComponentProgress, type ComponentProgressResponse } from '@/api/components';
import { startTimeTracking } from '@/api/timeTracking';
import ComponentViewPage from './page';

const session = vi.hoisted(() => ({
  account: { role: 'learner' as 'learner' | 'admin' | 'staff', subjectType: 'learner', subjectId: 1 },
  isInitialized: true,
}));

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
vi.mock('@/api/components', () => ({ submitComponentProgress: vi.fn() }));
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: vi.fn() }));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: session.account }, isInitialized: session.isInitialized }) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({ useComponentAccessWindow: () => ({ open: true, outsideWorkingHours: true, currentTimeLabel: 'Sunday, 14:02 BST' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children, pageSubtitle }: { children: ReactNode; pageSubtitle: string }) => <main><p>{pageSubtitle}</p>{children}</main> }));
vi.mock('./AssignmentSubmissionWizard', () => ({ AssignmentSubmissionWizard: () => null }));

const component = (id: string, weekId: string, date: string) => ({
  componentId: id, component: 'Live Session · Live Teams Session 1', type: 'live_session',
  module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId,
  sessionDate: date, sessionTime: '12:00', durationMinutes: 60,
  expectedOtjh: 2.5, reflectionRequired: false,
});
const first = component('C1', 'W1', '2026-10-22');
const second = component('C2', 'W2', '2026-10-29');
const empty = { ...first, componentId: 'EMPTY', component: 'Video · Recorded Session P1', type: 'video' };
const progress = { kind: 'component', componentId: 'C1', timeTaken: '00:20', submittedAt: '2026-09-13T12:58:12Z', passed: null };
const detail = (done = false) => ({
  modules: ['Marketing'],
  week: [{ module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId: 'W1' }, { module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId: 'W2' }],
  components: [first, empty, second], quizAttempts: [], videoProgress: [], componentProgress: done ? [progress] : [], ksbs: [],
}) as unknown as LearnerDetail;

function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
function mount(id = 'C1') {
  return render(<MemoryRouter initialEntries={[`/learner/component/apprenticeship/1/${id}`]}>
    <Location /><Routes><Route path="/learner/component/:kind/:id/:componentId" element={<ComponentViewPage />} /></Routes>
  </MemoryRouter>);
}

async function finish() {
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /outside UK working hours/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm', exact: true }));
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(session.account, { role: 'learner', subjectType: 'learner', subjectId: 1 });
  session.isInitialized = true;
  localStorage.clear();
  vi.mocked(fetchLearnerDetail).mockResolvedValue(detail());
  vi.mocked(startTimeTracking).mockResolvedValue({
    sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'visible_page',
  });
  vi.mocked(submitComponentProgress).mockResolvedValue({ record: progress } as unknown as ComponentProgressResponse);
});
afterEach(cleanup);

it('opens and completes the selected learner activity for an admin using the real permission hook', async () => {
  Object.assign(session.account, { role: 'admin', subjectType: 'staff', subjectId: 999 });
  mount();
  await finish();
  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(screen.queryByText('You are viewing this learner read-only')).not.toBeInTheDocument();
  expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({ timeTakenSeconds: 1200 }));
  expect(session.account.role).toBe('admin');
  expect(session.account.subjectId).toBe(999);
});

it('keeps an ordinary staff preview read-only without starting or saving learner progress', async () => {
  Object.assign(session.account, { role: 'staff', subjectType: 'staff', subjectId: 999 });
  mount();
  expect(await screen.findByText('You are viewing this learner read-only')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  expect(startTimeTracking).not.toHaveBeenCalled();
  expect(submitComponentProgress).not.toHaveBeenCalled();
});

it('keeps the saved completion visible and asks before moving to the next same-named activity', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce(detail()).mockResolvedValue(detail(true));
  mount();
  await finish();

  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(screen.getByRole('status')).toHaveTextContent('00:20');
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
  expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  expect(screen.getByText(/Locked activities have no learning content/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Recorded Session P1/ })).toBeDisabled();
  expect(submitComponentProgress).toHaveBeenCalledWith('C1', 'apprenticeship', '1', expect.objectContaining({ timeTakenSeconds: 1200, outsideWorkingHoursConfirmed: true }));
  expect(startTimeTracking).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: /Next activity:.*Week 2/ }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/C2'));
  expect(await screen.findByRole('button', { name: 'Finish' })).toBeDisabled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(/1 done/)).not.toBeInTheDocument();
});

it('restores completion on reopening and expands only the selected repeated week', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValue(detail(true));
  mount();
  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(startTimeTracking).not.toHaveBeenCalled();
  const weekOne = screen.getByRole('button', { name: /^Week 1 · Marketing Week/ });
  const weekTwo = screen.getByRole('button', { name: /^Week 2 · Marketing Week/ });
  fireEvent.click(weekTwo);
  expect(weekTwo).toHaveAttribute('aria-expanded', 'true');
  expect(weekOne).toHaveAttribute('aria-expanded', 'false');
  expect(within(weekOne).getByText('Current')).toBeInTheDocument();
  expect(within(weekTwo).queryByText('Current')).not.toBeInTheDocument();
  fireEvent.click(weekOne);
  expect(weekOne).toHaveAttribute('aria-expanded', 'true');
  expect(weekTwo).toHaveAttribute('aria-expanded', 'false');
});

it('retains a successful save when reloading the activity list fails', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce(detail()).mockRejectedValue(new Error('Network error'));
  mount();
  await finish();
  expect(await screen.findByRole('status')).toHaveTextContent('Completed');
  expect(await screen.findByRole('alert')).toHaveTextContent('Your completion was saved');
  expect(screen.queryByRole('button', { name: 'Confirm', exact: true })).not.toBeInTheDocument();
  expect(submitComponentProgress).toHaveBeenCalledTimes(1);
});

it('keeps a failed save open for retry without marking it complete', async () => {
  vi.mocked(submitComponentProgress).mockRejectedValue(new Error('Could not save progress'));
  mount();
  await finish();
  expect(await screen.findByText('Could not save progress')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  expect(screen.getByTestId('location')).toHaveTextContent('/C1');
});
