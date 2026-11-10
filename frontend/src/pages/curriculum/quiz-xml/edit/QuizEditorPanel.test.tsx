import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuizEditorPanel } from './QuizEditorPanel';
import { AppIcon } from '@/components/feature/AppIcon';

vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const types = ['single_choice', 'multiple_choice', 'true_false', 'matching', 'image_matching', 'keywords', 'fill_gap', 'ordering'];

describe('question diagrams in the quiz editor', () => {
  it.each(types)('saves and reloads an optional image for %s without changing text or answers', async (questionType) => {
    // Vite auto-imports this in shared controls; the standalone test config does not.
    vi.stubGlobal('AppIcon', AppIcon);
    const questions = [{ id: 31, text: 'Read the diagram', questionType, explanation: 'Feedback', isArchived: false,
      answers: [{ id: 41, text: 'A -> B', isCorrect: true }, { id: 42, text: 'C -> D', isCorrect: false }] }];
    let saved: { questions: typeof questions } | undefined;
    const quiz = { id: 7, title: 'Diagram quiz', packageType: 'xml', status: 'draft', quizStyle: 'default', duration: 10 };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/course-links/')) return new Response(JSON.stringify({ courses: [] }));
      if (init?.method === 'POST') saved = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ quiz, questions: saved?.questions || questions }));
    });
    vi.stubGlobal('fetch', fetcher);
    const first = render(<MemoryRouter><QuizEditorPanel quizId={7} /></MemoryRouter>);
    const save = await screen.findByRole('button', { name: 'Save question changes' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Question image'), { target: { files: [new File(['diagram'], 'diagram.png', { type: 'image/png' })] } });
    await screen.findByAltText('Question diagram');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(saved?.questions[0]).toEqual({ ...questions[0], imageUrl: 'data:image/png;base64,ZGlhZ3JhbQ==' }));
    await waitFor(() => expect(save).toBeDisabled());
    first.unmount();
    render(<MemoryRouter><QuizEditorPanel quizId={7} /></MemoryRouter>);
    expect(await screen.findByAltText('Question diagram')).toHaveAttribute('src', 'data:image/png;base64,ZGlhZ3JhbQ==');
    fireEvent.click(screen.getByRole('button', { name: 'Remove question image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save question changes' }));
    await waitFor(() => expect(saved?.questions[0]).toEqual({ ...questions[0], imageUrl: '' }));
  });
});

describe('canonical Free Course quiz editing', () => {
  it('uses the ownership-scoped endpoint and carries the latest revision', async () => {
    vi.stubGlobal('AppIcon', AppIcon);
    const quiz = { id: 7, title: 'Free quiz', packageType: 'xml', status: 'draft', quizStyle: 'default', duration: 10 };
    const questions = [{ id: 31, text: 'Question', questionType: 'single_choice', explanation: '', isArchived: false,
      answers: [{ id: 41, text: 'Yes', isCorrect: true }, { id: 42, text: 'No', isCorrect: false }] }];
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ quiz: { quiz, questions }, course: { revision: 'fcv1:next' } }));
      }
      return new Response(JSON.stringify({ quiz, questions }));
    }));
    render(<MemoryRouter><QuizEditorPanel quizId={7} freeCourseContext={{ courseId: 'FREE-1', componentId: 'FREECOMP-1', expectedRevision: 'fcv1:first' }} /></MemoryRouter>);
    const save = await screen.findByRole('button', { name: 'Save question changes' });
    fireEvent.change(screen.getByLabelText('Question image'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    await screen.findByAltText('Question diagram');
    fireEvent.click(save);
    await waitFor(() => expect(requests.some(request => request.init?.method === 'PATCH')).toBe(true));
    expect(requests.some(request => request.url.endsWith('/course-links/'))).toBe(false);
    const mutation = requests.find(request => request.init?.method === 'PATCH');
    expect(mutation?.url).toBe('/curriculum_api/curriculum/free-courses/FREE-1/quizzes/7/');
    expect(JSON.parse(String(mutation?.init?.body))).toMatchObject({
      expectedRevision: 'fcv1:first', componentId: 'FREECOMP-1', removeMissing: true,
    });
  });
});
