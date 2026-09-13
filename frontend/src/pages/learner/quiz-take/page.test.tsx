import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuizTakePage from './page';

const mocks = vi.hoisted(() => ({ detail: vi.fn(), quiz: vi.fn(), start: vi.fn(), submit: vi.fn() }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: mocks.detail }));
vi.mock('@/api/quizzes', () => ({ fetchQuiz: mocks.quiz, submitQuizAttempt: mocks.submit }));
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: mocks.start }));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: true }) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({ useComponentAccessWindow: () => ({ open: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/feature/ReflectionWindow', () => ({ ReflectionWindow: () => <div>Reflection form</div>, formatClock: () => '00:00' }));
const detail = { modules: [], week: [], ksbs: [], componentProgress: [], videoProgress: [], quizAttempts: [], components: [{ quizMeta: { quizId: 1 }, reflectionRequired: false }] };
const renderPage = () => render(<MemoryRouter initialEntries={['/quiz/commercial/501/1']}><Routes><Route path="/quiz/:kind/:id/:quizId" element={<QuizTakePage />} /></Routes></MemoryRouter>);

describe('quiz requirements loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quiz.mockResolvedValue({ id: 1, title: 'Campaign quiz', questions: [{ id: 1, text: 'Choose an outcome', points: 1, type: 'single_choice', answers: [{ id: 1, text: 'Measured outcome' }] }] });
    mocks.start.mockResolvedValue({ trackingToken: 'test', startedAt: '2026-09-13T00:00:00Z' });
    mocks.submit.mockImplementation(() => new Promise(() => {}));
  });
  it('waits for the authored reflection requirement before allowing a quick quiz attempt', async () => {
    let resolve!: (value: unknown) => void;
    mocks.detail.mockReturnValue(new Promise(done => { resolve = done; }));
    renderPage();
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Start Quiz' })).not.toBeInTheDocument();
    await act(async () => resolve(detail));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Quiz' }));
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
});
