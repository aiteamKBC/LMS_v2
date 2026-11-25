import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import QuizWorkspace from './page';
import ManualQuizPage from './manual/page';
import { defaultQuizGradeSettings } from '@/lib/quizGradeSettings';

// Author now means the authenticated creator. The previous editable-author
// cases are replaced by this explicitly requested read-only contract.
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const quizzes = [1, 2].map(id => ({ id, title: `Sample quiz ${id}`, module: 'Sample module', programme: 'Sample programme',
  questions: 1, status: 'draft', packageType: 'csv', author: id === 1 ? 'Historic author' : 'Curriculum Team', schemaValid: true,
  updatedAt: '2026-11-13T12:00:00Z', linkedCourses: 0 }));
const fetcher = vi.fn();
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let saveStatus: number;

beforeEach(() => {
  saveStatus = 201;
  fetcher.mockReset().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/quiz_api/quizzes/create-with-questions/') return Promise.resolve(response({ ...quizzes[0], id: 3 }, 201));
    if (init?.method === 'POST' && url === '/quiz_api/quizzes/') return Promise.resolve(saveStatus === 201
      ? response({ ...quizzes[0], id: 3, title: 'New quiz', author: 'Server-confirmed creator' }, 201)
      : response({ error: 'Authentication required.' }, saveStatus));
    if (url.startsWith('/quiz_api/quizzes/')) return Promise.resolve(response({ results: quizzes }));
    if (url === '/quiz_api/training-plan-options/') return Promise.resolve(response({ programmes: [], modulesByProgramme: {} }));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('AppIcon', AppIcon);
});

it('has no global settings controls or requests after retiring the defaults store', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: /More/ }));
  expect(screen.queryByRole('button', { name: 'General Settings' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Grade Settings' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url.includes('/defaults/'))).toBe(false);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  render(<MemoryRouter initialEntries={['/curriculum/quiz-xml']}><Routes>
    <Route path="/curriculum/quiz-xml" element={<QuizWorkspace />} />
    <Route path="/curriculum/quiz-xml/manual" element={<ManualQuizPage />} />
  </Routes></MemoryRouter>);
  await waitFor(() => expect(document.querySelectorAll('article')).toHaveLength(2));
}
function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Add New Quiz' }));
  fireEvent.change(screen.getByPlaceholderText('Quiz title'), { target: { value: 'New quiz' } });
}

it('shows saved historical creators in cards and table without editable author controls', async () => {
  await mount();
  const card = within(document.querySelectorAll('article')[0]);
  expect(card.getByText('Historic author')).toBeVisible();
  expect(card.queryByRole('button', { name: 'Historic author' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Historic author')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Curriculum Team')).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url.includes('staff-users'))).toBe(false);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
});

it('shows the highest grade for administrators while retaining the lower latest attempt', async () => {
  const original = fetcher.getMockImplementation()!;
  const latest = { attempt: 2, grade: '50%', gradePercent: 50, score: '1/2', passed: false,
    submittedAt: '2026-11-19T10:00:00Z', timeTaken: '00:30', questions: [], ksbs: [] };
  fetcher.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/students/') ? Promise.resolve(response({
    quiz: quizzes[0], summary: { students: 1, attempts: 2, passed: 1, averageBest: 100 },
    students: [{ id: 1, name: 'Synthetic learner', email: '', attemptCount: 2, bestGrade: 100,
      latestAttempt: latest, attempts: [latest, { ...latest, attempt: 1, passed: true, grade: '100%', gradePercent: 100, score: '2/2' }] }],
  })) : original(url, init));
  await mount();
  fireEvent.click(screen.getAllByTitle('Manage students')[0]);
  expect(await screen.findByText('Best: 100%')).toBeVisible();
  expect(screen.getByText('Latest: 1/2')).toBeVisible();
  expect(screen.getByText('2 attempts')).toBeVisible();
});

it('creates without a client author and displays the creator confirmed by the server', async () => {
  await mount();
  openCreate();
  expect(screen.queryByPlaceholderText('Author')).not.toBeInTheDocument();
  expect(screen.getByText('Your account will be recorded as the author.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save Quiz' }));
  await waitFor(() => expect(document.querySelectorAll('article')).toHaveLength(3));
  const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(init.body)).not.toHaveProperty('author');
  expect(within(document.querySelectorAll('article')[0]).getByText('Server-confirmed creator')).toBeVisible();
  expect(within(document.querySelectorAll('article')[1]).getByText('Historic author')).toBeVisible();
});

it('does not show a created quiz when the session has expired', async () => {
  saveStatus = 401;
  await mount();
  openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Save Quiz' }));
  expect(await screen.findByText('Authentication required.')).toBeVisible();
  expect(document.querySelectorAll('article')).toHaveLength(2);
  expect(screen.queryByText('Server-confirmed creator')).not.toBeInTheDocument();
});

it('opens the manual builder with automatic creator attribution', async () => {
  await mount();
  fireEvent.click(screen.getByRole('link', { name: 'Manual Quiz' }));
  expect(screen.getByRole('heading', { name: 'Manual Quiz Builder' })).toBeVisible();
  expect(screen.queryByPlaceholderText('Author')).not.toBeInTheDocument();
  expect(screen.getByText('Your account will be recorded as the author.')).toBeVisible();
});

it('creates a manual quiz and its questions without global defaults and with per-quiz overrides', async () => {
  await mount();
  fireEvent.click(screen.getByRole('link', { name: 'Manual Quiz' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save Manual Quiz' })[0]).toBeEnabled());
  fireEvent.change(screen.getByPlaceholderText('Quiz title'), { target: { value: 'Configured manual quiz' } });
  fireEvent.change(screen.getByPlaceholderText('Write the question learners will answer'), { target: { value: 'Choose the first option' } });
  for (const label of ['A', 'B', 'C', 'D']) fireEvent.change(screen.getByPlaceholderText(`Option ${label}`), { target: { value: label } });
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Limited attempts to retake quizzes' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Retake After Pass' }));
  expect(screen.getByLabelText('Maximum attempts')).toHaveValue(3);
  fireEvent.change(screen.getByLabelText('Maximum attempts'), { target: { value: '4' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save Manual Quiz' })[0]);
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
  const [url, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(url).toBe('/quiz_api/quizzes/create-with-questions/');
  expect(JSON.parse(init.body)).toMatchObject({ title: 'Configured manual quiz', limitAttempts: true, attemptLimit: 4,
    retakeAfterPass: false, gradeSettings: { ...defaultQuizGradeSettings, resultDisplay: 'grade_percentage', coursePageDisplay: 'inside_quiz' },
    initialQuestions: [{ text: 'Choose the first option', answers: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }, { text: 'C', isCorrect: false }, { text: 'D', isCorrect: false }] }] });
  expect(fetcher.mock.calls.some(([url]) => url.includes('/defaults/'))).toBe(false);
});

it('uploads without a multipart author override and retains the server attribution', async () => {
  await mount();
  const file = new File(['<quiz/>'], 'synthetic.xml', { type: 'text/xml' });
  fireEvent.change(document.querySelector('input[accept=".xml,.zip,.xlsx,.xlsm,.csv"]')!, { target: { files: [file] } });
  expect(screen.queryByPlaceholderText('Author')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Quiz' }));
  await waitFor(() => expect(document.querySelectorAll('article')).toHaveLength(3));
  const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(init.body).toBeInstanceOf(FormData);
  expect(init.body.has('author')).toBe(false);
  expect(init.body.get('file').name).toBe('synthetic.xml');
  expect(within(document.querySelectorAll('article')[0]).getByText('Server-confirmed creator')).toBeVisible();
});
