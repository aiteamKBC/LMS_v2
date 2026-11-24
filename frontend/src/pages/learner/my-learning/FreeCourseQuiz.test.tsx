import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchFreeCourseQuiz, submitFreeCourseQuiz, type FreeCourseQuizData } from '@/api/freeCourses';
import { FreeCourseQuiz } from './FreeCourseQuiz';

vi.mock('@/api/freeCourses', () => ({ fetchFreeCourseQuiz: vi.fn(), submitFreeCourseQuiz: vi.fn() }));
vi.mock('@/pages/learner/quiz-take/page', () => ({ QuestionInput: () => <div>Question input</div> }));

it('keeps withdrawn history read-only even without a preview prop', async () => {
  vi.mocked(fetchFreeCourseQuiz).mockResolvedValue({ ...quiz, historyOnly: true, questions: [] });
  render(<FreeCourseQuiz kind="commercial" learnerId="19" componentId="COMP" quizId={0} onPassed={vi.fn()} />);
  expect(await screen.findByText('Previous attempts')).toBeVisible();
  expect(screen.getByText(/This learner is withdrawn/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument();
});
const quiz: FreeCourseQuizData = {
  id: 7, title: 'Quiz', module: null, programme: null, weekId: null, duration: null, timeUnit: null,
  passingGrade: 80, randomizeQuestions: false, randomizeAnswers: false,
  questions: [{ id: 1, text: 'Question', type: 'single_choice', points: 1, sortOrder: 1, explanation: null, answers: [] }],
  attempts: [{ attemptId: 'historical', grade: 60, passed: false, completed: false, submittedAt: '2026-10-01T12:00:00Z' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchFreeCourseQuiz).mockResolvedValue(quiz);
});
it('shows preserved history without replaying it as a submission or completion', async () => {
  const passed = vi.fn();
  render(<FreeCourseQuiz kind="commercial" learnerId="19" componentId="COMP" quizId={7} onPassed={passed} />);
  expect(await screen.findByRole('region', { name: 'Previous quiz attempts' })).toHaveTextContent('60%');
  expect(submitFreeCourseQuiz).not.toHaveBeenCalled();
  expect(passed).not.toHaveBeenCalled();
});
it('keeps the same submission identity after a failed network response', async () => {
  vi.mocked(submitFreeCourseQuiz).mockRejectedValueOnce(new Error('Retry the same submission'))
    .mockResolvedValueOnce({ componentId: 'COMP', grade: 100, passed: true, passingGrade: 80, breakdown: [] });
  const passed = vi.fn();
  render(<FreeCourseQuiz kind="commercial" learnerId="19" componentId="COMP" quizId={7} onPassed={passed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Submit quiz' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry');
  fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }));
  await waitFor(() => expect(passed).toHaveBeenCalledTimes(1));
  expect(vi.mocked(submitFreeCourseQuiz).mock.calls[0][4]).toBe(vi.mocked(submitFreeCourseQuiz).mock.calls[1][4]);
});
it('keeps staff history read-only', async () => {
  render(<FreeCourseQuiz kind="apprenticeship" learnerId="19" componentId="COMP" quizId={7} onPassed={vi.fn()} readOnly />);
  expect(await screen.findByText('Previous attempts')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument();
});
it('shows saved results for a completed quiz without allowing another submission', async () => {
  render(<FreeCourseQuiz kind="commercial" learnerId="19" componentId="COMP" quizId={7} onPassed={vi.fn()} readOnly completed />);
  expect(await screen.findByText('Previous attempts')).toBeVisible();
  expect(screen.getByText(/This quiz is complete/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit quiz' })).not.toBeInTheDocument();
});
it('does not apply a delayed submission to a different activity', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof submitFreeCourseQuiz>>) => void;
  vi.mocked(submitFreeCourseQuiz).mockReturnValue(new Promise(done => { resolve = done; }));
  const passed = vi.fn();
  const view = render(<FreeCourseQuiz kind="commercial" learnerId="19" componentId="COMP" quizId={7} onPassed={passed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Submit quiz' }));
  view.rerender(<FreeCourseQuiz kind="commercial" learnerId="19" componentId="OTHER" quizId={8} onPassed={passed} />);
  await screen.findByText('Previous attempts');
  resolve({ componentId: 'COMP', grade: 100, passed: true, passingGrade: 80, breakdown: [] });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeEnabled());
  expect(passed).not.toHaveBeenCalled();
});
