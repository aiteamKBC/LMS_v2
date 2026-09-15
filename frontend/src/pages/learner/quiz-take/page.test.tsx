import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuizTakePage from './page';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(), quiz: vi.fn(), start: vi.fn(), submit: vi.fn(),
  generateReading: vi.fn(), completeReading: vi.fn(),
}));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: mocks.detail }));
vi.mock('@/api/quizzes', () => ({
  fetchQuiz: mocks.quiz,
  submitQuizAttempt: mocks.submit,
  generateQuizReading: mocks.generateReading,
  completeQuizReading: mocks.completeReading,
}));
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: mocks.start }));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: true }) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({ useComponentAccessWindow: () => ({ open: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/feature/ReflectionWindow', () => ({
  ReflectionWindow: () => <div>Reflection form</div>,
  formatClock: (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
}));
const detail = { modules: [], week: [], ksbs: [], componentProgress: [], videoProgress: [], quizAttempts: [], components: [{ quizMeta: { quizId: 1 }, reflectionRequired: false }] };
const renderPage = () => render(<MemoryRouter initialEntries={['/quiz/commercial/501/1']}><Routes><Route path="/quiz/:kind/:id/:quizId" element={<QuizTakePage />} /></Routes></MemoryRouter>);

describe('quiz requirements loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quiz.mockResolvedValue({ id: 1, title: 'Campaign quiz', questions: [{ id: 1, text: 'Choose an outcome', points: 1, type: 'single_choice', answers: [{ id: 1, text: 'Measured outcome' }] }] });
    mocks.start.mockResolvedValue({ trackingToken: 'test', startedAt: '2026-09-13T00:00:00Z' });
    mocks.submit.mockImplementation(() => new Promise(() => {}));
    mocks.generateReading.mockResolvedValue({
      id: 10, quizId: 1, attempt: 2, completed: false, startedAt: null, completedAt: null,
      timeTaken: null, verifiedSeconds: null,
      material: {
        title: 'Your focused revision reading',
        summary: 'Review the concepts behind your missed questions.',
        sections: [{ heading: 'Core concept', body: 'Read this focused explanation.' }],
        keyTakeaways: ['Apply the concept in context.'],
      },
    });
    mocks.completeReading.mockResolvedValue({
      id: 10, quizId: 1, attempt: 2, completed: true,
      startedAt: '2026-09-13T11:00:00Z', completedAt: '2026-09-13T11:05:00Z',
      timeTaken: '05:00', verifiedSeconds: 300,
      material: {
        title: 'Your focused revision reading',
        summary: 'Review the concepts behind your missed questions.',
        sections: [{ heading: 'Core concept', body: 'Read this focused explanation.' }],
        keyTakeaways: ['Apply the concept in context.'],
      },
    });
  });
  it('waits for the authored reflection requirement before allowing a quick quiz attempt', async () => {
    let resolve!: (value: unknown) => void;
    mocks.detail.mockReturnValue(new Promise(done => { resolve = done; }));
    renderPage();
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Start Quiz' })).not.toBeInTheDocument();
    await act(async () => resolve(detail));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Quiz' }));
    expect(screen.getByText(/Your current answers will be deleted/)).toBeVisible();
    const refresh = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Measured outcome/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish Quiz' }));
    await act(async () => {});
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.queryByText('Reflection form')).not.toBeInTheDocument();
  });
  it('offers retry when learner requirements fail instead of guessing the completion flow', async () => {
    mocks.detail.mockRejectedValueOnce(new Error('Requirements unavailable')).mockResolvedValue(detail);
    renderPage();
    expect(await screen.findByText('Requirements unavailable')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start Quiz' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry quiz' }));
    expect(await screen.findByRole('button', { name: 'Start Quiz' })).toBeEnabled();
  });

  it('restores the latest saved result and keeps a separate retake action after refresh', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      quizAttempts: [{
        kind: 'quiz',
        quizId: 1,
        attempt: 2,
        grade: 0,
        achievedScore: 0,
        totalScore: 1,
        passed: false,
        questions: [{ questionId: 1, earned: 0, correct: false, chosenAnswerId: 1, correctAnswerId: [2] }],
        startedAt: '2026-09-13T10:00:00Z',
        submittedAt: '2026-09-13T10:05:00Z',
        timeTaken: '05:00',
      }],
    });
    mocks.quiz.mockResolvedValue({
      id: 1,
      title: 'Campaign quiz',
      questions: [{
        id: 1,
        text: 'Choose an outcome',
        points: 1,
        type: 'single_choice',
        answers: [{ id: 1, text: 'Measured outcome' }, { id: 2, text: 'Business outcome' }],
      }],
    });

    renderPage();

    expect(await screen.findByText('0% · Not passed')).toBeVisible();
    expect(screen.getByText('Attempt 2 · 0/1 correct · 05:00')).toBeVisible();
    expect(screen.getByRole('button', { name: /View Result Details/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Retake Quiz/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /View Result Details/ }));
    expect(await screen.findByText('Quiz Not Passed')).toBeVisible();
    expect(screen.getByText('Measured outcome')).toBeVisible();
    expect(screen.getByText('Business outcome')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Retake Quiz/ }));
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Finish Quiz' })).toBeVisible();
  });

  it('starts signed timing when the AI reading opens and records it once on finish', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      quizAttempts: [{
        kind: 'quiz', quizId: 1, attempt: 2, grade: 0, achievedScore: 0, totalScore: 1,
        passed: false, questions: [], startedAt: '2026-09-13T10:00:00Z',
        submittedAt: '2026-09-13T10:05:00Z', timeTaken: '05:00',
      }],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /View Result Details/ }));

    const openReading = await screen.findByRole('button', { name: /Open Reading & Start Time/ });
    fireEvent.click(openReading);
    const activeReadingTime = await screen.findByText('Active reading time');
    expect(activeReadingTime).toBeVisible();
    expect(activeReadingTime.parentElement?.textContent).toContain('05:00');
    expect(mocks.start).toHaveBeenCalledWith(
      'component', 'quiz-reading:1:2', 'commercial', '501', 'visible_page',
    );

    fireEvent.click(screen.getByRole('button', { name: /Finish Reading & Add Actual Time/ }));
    expect(await screen.findByRole('dialog', { name: 'Confirm reading completion?' })).toBeVisible();
    expect(screen.getByText('AI Assessted learning')).toBeVisible();
    const stoppedTimer = screen.getByRole('button', { name: /Timer/ }).textContent;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(screen.getByRole('button', { name: /Timer/ }).textContent).toBe(stoppedTimer);
    fireEvent.click(screen.getByRole('button', { name: /Input/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reading time (minutes)' }), { target: { value: '2.5' } });
    expect(screen.getByText('07:30')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/05:00 added to actual time/)).toBeVisible();
    expect(mocks.completeReading).toHaveBeenCalledWith(1, 'commercial', '501', 2, 'test', 150, 'manual');
  });
});
