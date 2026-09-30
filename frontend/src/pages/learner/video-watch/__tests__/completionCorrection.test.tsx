import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { submitComponentProgress, type ComponentProgressResponse } from '@/api/components';
import { startTimeTracking } from '@/api/timeTracking';
import { CompletionValidationError, workingRuleFailure } from '@/lib/completionValidation';
import ComponentViewPage from '../page';

// ============================================================================
// The Finish correction flow.
//
// Learning is unobstructed; the rules are put to the learner once, after the
// server refuses a Finish click, and that refusal wrote nothing.
// ============================================================================

(globalThis as Record<string, unknown>).AppIcon = ({ className }: { className?: string }) => <i className={className} />;

const session = vi.hoisted(() => ({
  account: { role: 'learner' as const, subjectType: 'learner', subjectId: 1 },
  holidays: [] as { start: string; end: string; label?: string }[],
}));

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn(), invalidateLearnerDetailCache: vi.fn() }));
vi.mock('@/api/components', async () => {
  const actual = await vi.importActual<typeof import('@/api/components')>('@/api/components');
  return { ...actual, submitComponentProgress: vi.fn() };
});
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: vi.fn() }));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: session.account }, isInitialized: true }) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({
  useComponentAccessWindow: () => ({
    open: true, outsideWorkingHours: true, holidays: session.holidays,
    holidayCalendarReady: true, currentTimeLabel: 'Sunday, 22:30 BST',
  }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('../AssignmentSubmissionWizard', () => ({ AssignmentSubmissionWizard: () => null }));

// Mirrors completion.test.tsx: a live-session component renders the manual
// "Minutes spent" field, which is the shortest route to a Finish click.
const first = {
  componentId: 'C1', component: 'Live Session · Live Teams Session 1', type: 'live_session',
  module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId: 'W1',
  sessionDate: '2026-10-22', sessionTime: '12:00', durationMinutes: 60,
  expectedOtjh: 2.5, reflectionRequired: false,
};
const progress = { kind: 'component', componentId: 'C1', timeTaken: '00:20', submittedAt: '2026-09-29T22:30:00Z', passed: null };
const detail = () => ({
  modules: ['Marketing'],
  week: [{ module: 'Marketing', moduleId: 'M1', week: 'Marketing Week', weekId: 'W1' }],
  components: [first], quizAttempts: [], videoProgress: [], componentProgress: [], ksbs: [],
}) as unknown as LearnerDetail;

function mount() {
  return render(<MemoryRouter initialEntries={['/learner/component/apprenticeship/1/C1']}>
    <Routes><Route path="/learner/component/:kind/:id/:componentId" element={<ComponentViewPage />} /></Routes>
  </MemoryRouter>);
}

async function pressFinish() {
  fireEvent.change(await screen.findByLabelText('Minutes spent'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  session.holidays = [];
  localStorage.clear();
  vi.mocked(fetchLearnerDetail).mockResolvedValue(detail());
  vi.mocked(startTimeTracking).mockResolvedValue({
    sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'visible_page',
  });
});
afterEach(cleanup);

describe('the correction dialog', () => {
  it('opens on a weekend refusal instead of reporting a failure', async () => {
    vi.mocked(submitComponentProgress).mockRejectedValue(
      new CompletionValidationError('Sunday is not a working day.', 'weekend'),
    );
    mount();
    await pressFinish();

    const dialog = await screen.findByRole('dialog', { name: /review your completion date and time/i });
    expect(dialog).toBeVisible();
    expect(screen.getByText(/Outside official working days/)).toBeInTheDocument();
    expect(screen.getByText(/has not been completed yet/i)).toBeInTheDocument();
  });

  it('opens on an out-of-hours refusal', async () => {
    vi.mocked(submitComponentProgress).mockRejectedValue(
      new CompletionValidationError('Outside official working hours.', 'outside_working_hours'),
    );
    mount();
    await pressFinish();
    expect(await screen.findByText(/Outside official working hours/)).toBeInTheDocument();
  });

  it('names the college holiday it refused on', async () => {
    vi.mocked(submitComponentProgress).mockRejectedValue(
      new CompletionValidationError('College holiday: Easter closure.', 'holiday', 'Easter closure'),
    );
    mount();
    await pressFinish();
    expect(await screen.findByText(/College holiday: Easter closure/)).toBeInTheDocument();
  });

  it('keeps Final Submit unavailable until a valid date and time is chosen', async () => {
    vi.mocked(submitComponentProgress).mockRejectedValue(
      new CompletionValidationError('Sunday is not a working day.', 'weekend'),
    );
    mount();
    await pressFinish();
    await screen.findByRole('dialog', { name: /review your completion date and time/i });

    const finalSubmit = screen.getByRole('button', { name: /Final Submit/ });
    expect(finalSubmit).toBeDisabled();

    // A weekend selection stays refused and the dialog stays open.
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-27' } });
    fireEvent.change(screen.getByLabelText('Completion time'), { target: { value: '14:30' } });
    expect(finalSubmit).toBeDisabled();
    expect(screen.getByText(/cannot be selected because it is outside official working rules/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /review your completion date and time/i })).toBeVisible();

    // An out-of-hours time on a working day is refused too.
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-29' } });
    fireEvent.change(screen.getByLabelText('Completion time'), { target: { value: '22:30' } });
    expect(finalSubmit).toBeDisabled();

    // A working instant enables it.
    fireEvent.change(screen.getByLabelText('Completion time'), { target: { value: '14:30' } });
    expect(finalSubmit).toBeEnabled();
  });

  it('refuses a date closed by this learner’s own college holiday', async () => {
    session.holidays = [{ start: '2026-09-29', end: '2026-09-29', label: 'Reading week' }];
    vi.mocked(submitComponentProgress).mockRejectedValue(
      new CompletionValidationError('Sunday is not a working day.', 'weekend'),
    );
    mount();
    await pressFinish();
    await screen.findByRole('dialog', { name: /review your completion date and time/i });

    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-29' } });
    fireEvent.change(screen.getByLabelText('Completion time'), { target: { value: '14:30' } });
    expect(screen.getByRole('button', { name: /Final Submit/ })).toBeDisabled();
    expect(screen.getByText(/Reading week/)).toBeInTheDocument();
  });

  it('sends the declared instant on Final Submit and completes', async () => {
    vi.mocked(submitComponentProgress)
      .mockRejectedValueOnce(new CompletionValidationError('Sunday is not a working day.', 'weekend'))
      .mockResolvedValueOnce({ record: progress } as unknown as ComponentProgressResponse);
    mount();
    await pressFinish();
    await screen.findByRole('dialog', { name: /review your completion date and time/i });

    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-29' } });
    fireEvent.change(screen.getByLabelText('Completion time'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: /Final Submit/ }));

    await waitFor(() => expect(submitComponentProgress).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitComponentProgress).mock.calls[1][3]).toMatchObject({
      declaredCompletedAt: '2026-09-29T14:30:00',
    });
    await waitFor(() => expect(
      screen.queryByRole('dialog', { name: /review your completion date and time/i }),
    ).not.toBeInTheDocument());
  });

  it('stays open and shows the server’s refusal of a declared instant', async () => {
    vi.mocked(submitComponentProgress)
      .mockRejectedValueOnce(new CompletionValidationError('Sunday is not a working day.', 'weekend'))
      .mockRejectedValueOnce(new CompletionValidationError('This date and time cannot be selected.', 'holiday', 'Bank holiday'));
    mount();
    await pressFinish();
    await screen.findByRole('dialog', { name: /review your completion date and time/i });

    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-29' } });
    fireEvent.change(screen.getByLabelText('Completion time'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: /Final Submit/ }));

    expect(await screen.findByText('This date and time cannot be selected.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /review your completion date and time/i })).toBeVisible();
  });
});

describe('the browser copy of the rules', () => {
  const holidays = [{ start: '2026-12-25', end: '2026-12-25', label: 'Christmas Day' }];

  it('accepts a weekday inside hours', () => {
    expect(workingRuleFailure('2026-09-29', '14:30', holidays)).toBeNull();
    expect(workingRuleFailure('2026-09-29', '07:00', holidays)).toBeNull();
    expect(workingRuleFailure('2026-09-29', '18:59', holidays)).toBeNull();
  });

  it('refuses the hour boundaries the server refuses', () => {
    expect(workingRuleFailure('2026-09-29', '06:59', holidays)?.reason).toBe('outside_working_hours');
    expect(workingRuleFailure('2026-09-29', '19:00', holidays)?.reason).toBe('outside_working_hours');
  });

  it('refuses both weekend days', () => {
    expect(workingRuleFailure('2026-09-26', '12:00', holidays)?.reason).toBe('weekend');
    expect(workingRuleFailure('2026-09-27', '12:00', holidays)?.reason).toBe('weekend');
  });

  it('refuses a holiday and names it, ahead of the clock', () => {
    const failure = workingRuleFailure('2026-12-25', '12:00', holidays);
    expect(failure?.reason).toBe('holiday');
    expect(failure?.holidayName).toBe('Christmas Day');
  });

  it('ignores a holiday that is not in this learner’s list', () => {
    expect(workingRuleFailure('2026-12-25', '12:00', [])).toBeNull();
  });

  it('asks for the missing half of an incomplete selection', () => {
    expect(workingRuleFailure('', '14:30', holidays)?.message).toMatch(/completion date/i);
    expect(workingRuleFailure('2026-09-29', '', holidays)?.message).toMatch(/completion time/i);
  });
});
