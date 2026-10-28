import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizEditorPanel } from './QuizEditorPanel';
import { AppIcon } from '@/components/feature/AppIcon';

vi.mock("@/hooks/useToast.helpers", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const QUIZ_LIST = '/curriculum/quiz-xml?status=draft&q=diagram&page=2';

function List() {
  const location = useLocation();
  return <output data-testid="list-address">{location.pathname}{location.search}</output>;
}

function openEditor(state?: unknown) {
  const router = createMemoryRouter([
    { path: '/curriculum/quiz-xml/:quizId/edit', element: <QuizEditorPanel quizId={7} /> },
    { path: '*', element: <List /> },
  ], { initialEntries: [QUIZ_LIST, { pathname: '/curriculum/quiz-xml/7/edit', state }], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Back from the quiz editor', () => {
  beforeEach(() => {
    // Vite auto-imports this in shared controls; the standalone test config does not.
    vi.stubGlobal('AppIcon', AppIcon);
    const quiz = { id: 7, title: 'Diagram quiz', packageType: 'xml', status: 'draft', quizStyle: 'default', duration: 10 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/course-links/')
      ? new Response(JSON.stringify({ courses: [] }))
      : new Response(JSON.stringify({ quiz, questions: [] })))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('steps back to the list that opened it, with that list\'s filters', async () => {
    const router = openEditor({ backLabel: 'Back to Checkpoints' });
    fireEvent.click(await screen.findByRole('link', { name: /Back to Checkpoints/ }));
    await waitFor(() => expect(screen.getByTestId('list-address')).toHaveTextContent(QUIZ_LIST));
    expect(router.state.historyAction).toBe('POP');
  });

  it('opens the quiz workspace when nothing named a list to return to', async () => {
    openEditor();
    const back = await screen.findByRole('link', { name: /Back to Quiz Workspace/ });
    expect(back).toHaveAttribute('href', '/curriculum/quiz-xml');
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByTestId('list-address')).toHaveTextContent(/^\/curriculum\/quiz-xml$/));
  });
});
