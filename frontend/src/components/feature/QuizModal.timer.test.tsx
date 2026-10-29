import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QuizModal } from './QuizModal';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('submits the latest selected answer exactly once when the countdown expires', () => {
  vi.useFakeTimers();
  vi.stubGlobal('AppIcon', () => null);
  const complete = vi.fn();
  render(<MemoryRouter><QuizModal session={{ quizId: 'timer', quizTitle: 'Timed quiz', timeLimit: 2,
    passMark: 50, ksbs: [], questions: [{ id: 1, question: 'Choose the answer', options: ['Correct choice', 'Other choice'],
      correctAnswer: 0, explanation: 'Example', ksbs: [] }] }} onClose={vi.fn()} onComplete={complete} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Start Quiz/ }));
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.click(screen.getByRole('button', { name: /Correct choice/ }));
  act(() => vi.advanceTimersByTime(1000));
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ score: 1, answers: [0] }));
  act(() => vi.advanceTimersByTime(4000));
  expect(complete).toHaveBeenCalledTimes(1);
});
