import { afterEach, expect, it, vi } from 'vitest';
import { createQuizWithQuestions } from './createQuizWithQuestions';

afterEach(() => vi.unstubAllGlobals());

it('submits questions with creation so a later questions request cannot leave an orphan quiz', async () => {
  const initialQuestions = [{ text: 'Choose', questionType: 'single_choice', answers: [
    { text: 'Right', isCorrect: true }, { text: 'Wrong', isCorrect: false },
  ] }];
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 7, questions: 1 })));
  vi.stubGlobal('fetch', fetcher);
  expect(await createQuizWithQuestions({ title: 'Generated', initialQuestions })).toEqual({ id: 7, questions: 1 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/quiz_api/quizzes/create-with-questions/');
  expect(JSON.parse(fetcher.mock.calls[0][1].body).initialQuestions).toEqual(initialQuestions);
});

it('surfaces the exact validation failure and makes no follow-up save', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Question 2 needs a valid key.' }), { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(createQuizWithQuestions({ initialQuestions: [] })).rejects.toThrow('Question 2 needs a valid key.');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not report success for a malformed success response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(createQuizWithQuestions({ initialQuestions: [] })).rejects.toThrow('did not return a saved quiz');
});
