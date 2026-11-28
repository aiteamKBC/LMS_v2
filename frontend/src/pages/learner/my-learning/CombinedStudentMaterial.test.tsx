import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subjectRequest, type SubjectAttemptResult, type SubjectMaterial } from '@/api/studentActivity';
import { CombinedStudentMaterial } from './CombinedStudentMaterial';
import type { SubjectEntry } from './learningSummary';

vi.mock('@/api/studentActivity', () => ({ subjectRequest: vi.fn() }));
vi.mock('./DeferredStudentMaterial', async () => ({ DeferredStudentMaterial: (await import('./StudentMaterial')).StudentMaterial }));
vi.mock('../video-watch/page', () => ({ InlineAttachmentPreview: () => <div>Document preview</div> }));
vi.mock('@/hooks/useManualTimeConfirmation', () => ({ useManualTimeConfirmation: () => ({ confirmTime: async () => true, timeConfirmation: null }) }));

const material = (changes: Partial<SubjectMaterial> = {}): SubjectMaterial => ({
  title: 'Synthetic reading', reading_html: '<p>Chapter text</p>', media: [], quiz: null,
  has_reading: true, available: true, source_live: false, persistence_ready: true,
  can_attempt: true, csrf_token: 'synthetic-csrf', completed: false, history: [],
  historical: { score: null, maximum_score: null, passed: null, attempt_number: null, status: null, answers: [] },
  ...changes,
});
function entry(readingDone: boolean, quizDone: boolean): SubjectEntry {
  const base = { title: 'Synthetic reading', category: 'Reading + Quiz', position: 1, schedule: { date: null } };
  const reading = { activity_id: 'catalogue:50:material:10', source_activity_id: 10, group_id: 50, catalogue_kind: 'material' as const };
  const quiz = { ...reading, activity_id: 'catalogue:50:quiz:60', source_activity_id: 60, catalogue_kind: 'quiz' as const };
  return { ...base, id: reading.activity_id, legacy: reading as SubjectEntry['legacy'], completed: readingDone && quizDone,
    readingCompleted: readingDone, pairedQuiz: { ...base, id: quiz.activity_id, completed: quizDone, legacy: quiz as SubjectEntry['legacy'] } };
}
const requests = vi.mocked(subjectRequest);
const posts = () => requests.mock.calls.filter(([, options]) => options?.method === 'POST');
const starts = () => posts().filter(([url]) => url.includes('/attempts/?'));
function respond(readingDone: boolean, quizDone: boolean, pass = true) {
  const reading = material({ completed: readingDone });
  const quiz = material({ title: 'Synthetic quiz', completed: quizDone, has_reading: false, reading_html: '',
    quiz: { id: '60', body: '', ready: true, message: '', passing_percent: 70,
      questions: [{ id: '1', type: 'single_choice', text: 'Chapter question', options: [{ id: 'a', text: 'Answer A' }] }] },
    ...(quizDone ? { can_attempt: false, historical: { score: 90, maximum_score: 100, passed: true, attempt_number: 1,
      status: 'passed', answers: [{ question_id: 1, question_body: 'Chapter question', learner_answer: ['Answer A'], is_correct: true }] } } : {}),
  });
  requests.mockImplementation(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const part = url.includes('activity_part=reading') ? 'reading' : 'quiz';
    const data = part === 'reading' ? reading : quiz;
    if (options?.method !== 'POST') return structuredClone(data) as T;
    if (url.includes('/attempts/?')) return { attempt_id: `${part}-draft`, definition: {}, timing: {
      trackingToken: `${part}-token`, startedAt: new Date().toISOString(), countingMode: part === 'reading' ? 'visible_page' : 'active_quiz',
    } } as T;
    const body = JSON.parse(options.body as string);
    const saved: SubjectAttemptResult = { completed: part === 'reading' || pass, passed: part === 'quiz' ? pass : null,
      score_percent: part === 'quiz' ? pass ? 100 : 0 : null,
      study_time: { verifiedSeconds: body.timeTakenSeconds, submittedAt: '2026-11-06T12:00:00Z', startedAt: '2026-11-06T11:59:00Z',
        ...(body.declaredCompletedAt ? { declaredCompletedAt: '2026-10-20T10:00:00+01:00' } : {}) } };
    data.completed ||= saved.completed;
    data.history = [{ id: `${part}-draft`, submitted_at: '2026-11-06T12:00:00Z', answers: body.answers, ...saved }];
    return saved as T;
  });
}

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('independent reading and quiz completion in one activity', () => {
  it.each(['commercial', 'apprenticeship'])('finishes only missing reading with its own date and keeps the passed quiz (%s)', async kind => {
    respond(false, true);
    const onProgress = vi.fn();
    render(<CombinedStudentMaterial entry={entry(false, true)} kind={kind} learnerId="9" readOnly={false} onProgress={onProgress} />);
    const reading = within(screen.getByRole('region', { name: 'Reading part' }));
    const quiz = within(screen.getByRole('region', { name: 'Quiz part' }));
    await waitFor(() => expect(reading.getByRole('button', { name: 'Finish' })).toBeEnabled());
    expect(await quiz.findByRole('radio', { name: 'Answer A' })).toBeChecked();
    expect(quiz.getByRole('radio', { name: 'Answer A' })).toBeDisabled();
    fireEvent.click(reading.getByRole('checkbox', { name: 'Use an earlier completion date' }));
    fireEvent.change(reading.getByLabelText('Completion date'), { target: { value: '2026-10-20' } });
    expect(reading.getByRole('button', { name: 'Finish' })).toBeDisabled();
    fireEvent.change(reading.getByLabelText('Completion time (UK)'), { target: { value: '10:00' } });
    fireEvent.click(reading.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: true, passed: null }), 'catalogue:50:material:10'));
    expect(posts()).toHaveLength(2);
    expect(posts().every(([url]) => url.includes('/50/10/attempts/') && url.endsWith('?activity_part=reading'))).toBe(true);
    const submitted = JSON.parse(posts()[1][1]!.body as string);
    expect(submitted).toMatchObject({ reading_confirmed: true, trackingToken: 'reading-token', declaredCompletedAt: '2026-10-20T10:00:00', answers: {} });
    expect(await reading.findByText('Completed on 20/10/2026, 10:00:00 (UK)')).toBeVisible();
    expect(quiz.getByText(/90 \/ 100/)).toBeVisible();
    expect(quiz.queryByRole('button', { name: /Try quiz again|Submit answers/ })).not.toBeInTheDocument();
  });

  it.each(['commercial', 'apprenticeship'])('finishes only the missing quiz and preserves completed reading (%s)', async kind => {
    respond(true, false);
    const onProgress = vi.fn();
    render(<CombinedStudentMaterial entry={entry(true, false)} kind={kind} learnerId="9" readOnly={false} onProgress={onProgress} />);
    const quiz = within(screen.getByRole('region', { name: 'Quiz part' }));
    await waitFor(() => expect(quiz.getByRole('radio', { name: 'Answer A' })).toBeEnabled());
    fireEvent.click(quiz.getByRole('radio', { name: 'Answer A' }));
    fireEvent.click(quiz.getByRole('button', { name: 'Submit answers' }));
    await waitFor(() => expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: true, passed: true }), 'catalogue:50:quiz:60'));
    expect(posts()).toHaveLength(2);
    expect(posts().every(([url]) => url.includes('/50/60/attempts/') && url.endsWith('?catalogue_kind=quiz'))).toBe(true);
    expect(screen.getByText('Reading · Complete')).toBeVisible();
    expect(screen.getByText('Quiz · Complete')).toBeVisible();
    expect(screen.queryByText('No saved attempt is available for this quiz.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it('does not mark a failed quiz complete or change the reading', async () => {
    respond(true, false, false);
    const onProgress = vi.fn();
    render(<CombinedStudentMaterial entry={entry(true, false)} kind="commercial" learnerId="9" readOnly={false} onProgress={onProgress} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Answer A' })).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: 'Answer A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    await waitFor(() => expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: false, passed: false }), 'catalogue:50:quiz:60'));
    expect(screen.getByText('Reading · Complete')).toBeVisible();
    expect(screen.getByText('Quiz · Not complete')).toBeVisible();
  });

  it('times one unfinished part at a time and preserves its draft date when switching or reopening', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    respond(false, false);
    const props = { entry: entry(false, false), kind: 'commercial', learnerId: '9', readOnly: false };
    const view = render(<CombinedStudentMaterial {...props} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    expect(starts()).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use an earlier completion date' }));
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Completion time (UK)'), { target: { value: '10:00' } });
    await act(async () => { vi.advanceTimersByTime(2000); });
    const key = 'legacy-study:v1:commercial:9:50:material:10:reading';
    const before = JSON.parse(localStorage.getItem(key)!);
    expect(before.elapsedSeconds).toBe(2);
    expect(screen.getByText('Reading selected')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reading selected' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to quiz' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Answer A' })).toBeEnabled());
    expect(screen.getByText('Quiz selected')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Quiz selected' })).not.toBeInTheDocument();
    expect(starts()).toHaveLength(2);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(JSON.parse(localStorage.getItem(key)!).elapsedSeconds).toBe(2);
    expect(JSON.parse(localStorage.getItem('legacy-study:v1:commercial:9:50:quiz:60')!).elapsedSeconds).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to reading' }));
    expect(screen.getByLabelText('Completion date')).toHaveValue('2026-10-20');
    view.unmount();
    render(<CombinedStudentMaterial {...props} />);
    expect(await screen.findByLabelText('Completion time (UK)')).toHaveValue('10:00');
    expect(starts()).toHaveLength(2);
  });

  it.each([false, true])('keeps completed work or a read-only view without starting attempts (readOnly=%s)', async readOnly => {
    respond(!readOnly, !readOnly);
    render(<CombinedStudentMaterial entry={entry(!readOnly, !readOnly)} kind="commercial" learnerId="9" readOnly={readOnly} />);
    expect(await screen.findByText('Chapter text')).toBeVisible();
    expect(await within(screen.getByRole('region', { name: 'Activity quiz' })).findByText('Chapter question')).toBeVisible();
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Switch to|Finish|Submit answers/ })).not.toBeInTheDocument();
  });
});
