import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subjectRequest, type SubjectMaterial } from '@/api/studentActivity';
import { StudentMaterial } from './StudentMaterial';

vi.mock('@/api/studentActivity', () => ({ subjectRequest: vi.fn() }));
vi.mock('@/components/feature/CompletionTimeDialog', () => ({ CompletionTimeDialog: ({ onSubmit }: { onSubmit: (at: string) => void }) =>
  <button onClick={() => onSubmit('2026-10-21T10:00:00Z')}>Confirm completion time</button> }));

function material(): SubjectMaterial {
  return {
    title: 'Example', reading_html: '', media: [], has_reading: false,
    available: true, source_live: false, persistence_ready: true, can_attempt: true, csrf_token: '',
    quiz: { id: '1', body: '', ready: true, message: '', passing_percent: 80, questions: [
      { id: '12', text: '<p>Example question?</p>', type: 'multi_choice', options: [
        { id: '2', text: 'First answer' }, { id: '1', text: 'Second answer' },
      ] },
    ] },
    history: [], historical: { score: 100, maximum_score: 100, passed: true, attempt_number: 1, status: 'passed', answers: [
      { question_id: 12, question_body: 'Example question?', learner_answer: ['First answer'], is_correct: true },
    ] },
  };
}

async function open(data: SubjectMaterial) {
  vi.mocked(subjectRequest).mockResolvedValueOnce(data);
  render(<StudentMaterial kind="apprenticeship" learnerId="123" groupId={50} activityId={60} />);
  return within(await screen.findByRole('region', { name: 'Activity quiz' }));
}

describe('previous quiz answers in the main quiz', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });

  it.each(['commercial', 'apprenticeship'])('saves an unfinished standalone quiz with its typed identity and reloads completion (%s)', async kind => {
    const data = { ...material(), completed: false, csrf_token: 'synthetic-csrf',
      historical: { score: null, maximum_score: null, passed: null, attempt_number: null, status: null, answers: [] } };
    const saved = { score_percent: 100, passed: true, completed: true };
    vi.mocked(subjectRequest).mockResolvedValueOnce(data);
    const onProgress = vi.fn();
    render(<StudentMaterial kind={kind} learnerId="123" groupId={50} activityId={60} catalogueQuiz onProgress={onProgress} />);
    vi.mocked(subjectRequest).mockResolvedValueOnce({ attempt_id: 'new', definition: {}, timing: { trackingToken: 'synthetic-token', startedAt: new Date().toISOString(), countingMode: 'active_quiz' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await screen.findByRole('button', { name: 'Submit answers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'First answer' }));
    vi.mocked(subjectRequest).mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...data, completed: true, can_attempt: false });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    expect(await screen.findByText('Complete')).toBeVisible();
    expect(onProgress).toHaveBeenCalledWith(saved);
    const base = `/learner_api/student-activity/${kind}/123`;
    expect(subjectRequest).toHaveBeenCalledWith(`${base}/50/60/attempts/?catalogue_kind=quiz`, expect.objectContaining({ method: 'POST' }));
    expect(subjectRequest).toHaveBeenCalledWith(`${base}/50/60/attempts/new/?catalogue_kind=quiz`, expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': 'synthetic-csrf' },
      body: JSON.stringify({ answers: { '12': ['2'] }, reading_confirmed: false, trackingToken: 'synthetic-token', timeTakenSeconds: 0 }),
    }));
    expect(screen.queryByRole('button', { name: /Start quiz|Try quiz again|Submit/ })).not.toBeInTheDocument();
  });

  it('selects historical answers for read-only review and starts a blank retake', async () => {
    const quiz = await open(material());
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeChecked();
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeDisabled();
    vi.mocked(subjectRequest).mockResolvedValueOnce({ attempt_id: 'new', definition: {}, timing: { trackingToken: 'synthetic-token', startedAt: new Date().toISOString(), countingMode: 'active_quiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Try quiz again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use new attempt date and duration' }));
    await screen.findByRole('button', { name: 'Submit answers' });
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).not.toBeChecked();
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeEnabled();
    const started = vi.mocked(subjectRequest).mock.calls.find(([url, options]) => url.includes('/attempts/') && options?.method === 'POST');
    expect(JSON.parse(started![1]!.body as string)).toMatchObject({ retakeTimeChoice: 'new' });
  });

  it('keeps the timed attempt and answers when completion needs a corrected date', async () => {
    await open({ ...material(), has_reading: true });
    vi.mocked(subjectRequest).mockResolvedValueOnce({ attempt_id: 'new', definition: {},
      timing: { trackingToken: 'synthetic-token', startedAt: new Date().toISOString(), countingMode: 'active_quiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Try quiz again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use new attempt date and duration' }));
    await screen.findByRole('button', { name: 'Submit answers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'First answer' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have completed the reading material.' }));
    vi.mocked(subjectRequest).mockRejectedValueOnce(Object.assign(new Error('Choose a completion time'),
      { validation: { reason: 'outside_working_hours', holidayName: '' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm completion time' });
    expect(screen.getByRole('checkbox', { name: 'First answer' })).toBeChecked();
    vi.mocked(subjectRequest).mockResolvedValueOnce({ completed: true, passed: true, score_percent: 100 })
      .mockResolvedValueOnce({ ...material(), completed: true });
    fireEvent.click(confirm);
    await screen.findByText('Complete');
    const submissions = vi.mocked(subjectRequest).mock.calls.filter(([url]) => url.includes('/attempts/new/'));
    expect(submissions).toHaveLength(2);
    expect(JSON.parse(submissions[1][1]!.body as string)).toMatchObject({ answers: { '12': ['2'] },
      reading_confirmed: true, trackingToken: 'synthetic-token', declaredCompletedAt: '2026-10-21T10:00:00Z' });
  });

  it('prefers the latest submitted review and matches text despite reordered option IDs', async () => {
    const data = material();
    data.history = [{ id: 'latest', score_percent: 0, passed: false, completed: false,
      submitted_at: '2026-09-23T10:00:00Z', answers: { '12': ['2'] },
      answer_review: [{ question: 'Example question?', selected: ['Second answer'], correct: false }] }];
    const quiz = await open(data);
    expect(quiz.getByRole('checkbox', { name: 'Second answer' })).toBeChecked();
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).not.toBeChecked();
  });

  it('does not guess changed questions or ambiguous options', async () => {
    const data = material();
    data.quiz!.questions[0].options[1].text = 'First answer';
    const quiz = await open(data);
    for (const input of quiz.getAllByRole('checkbox')) expect(input).not.toBeChecked();
  });

  it('selects every recorded multi-choice answer', async () => {
    const data = material();
    data.historical.answers[0].learner_answer = ['First answer', 'Second answer'];
    const quiz = await open(data);
    for (const input of quiz.getAllByRole('checkbox')) expect(input).toBeChecked();
  });

  it.each(['commercial', 'apprenticeship'])('reviews original quiz questions and results without changing completion (%s)', async kind => {
    const data = { ...material(), completed: true, can_attempt: false, persistence_ready: false };
    vi.mocked(subjectRequest).mockResolvedValueOnce(data);
    const onProgress = vi.fn();
    render(<StudentMaterial kind={kind} learnerId="123" groupId={50} activityId={60} completed readOnly reviewQuiz onProgress={onProgress} />);
    const quiz = within(await screen.findByRole('region', { name: 'Activity quiz' }));
    expect(subjectRequest).toHaveBeenCalledWith(`/learner_api/student-activity/${kind}/123/?group_id=50&activity_id=60&catalogue_kind=quiz`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeChecked();
    for (const input of quiz.getAllByRole('checkbox')) expect(input).toBeDisabled();
    expect(screen.getByText('Complete')).toBeVisible();
    expect(screen.getByText(/Previous learning.*100 \/ 100/)).toBeVisible();
    expect(screen.getByText('Attempt 1 · Passed')).toBeVisible();
    expect(screen.getByText('Previous answers are shown for review.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Start quiz|Try quiz again|Submit/ })).not.toBeInTheDocument();
    expect(subjectRequest).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('retries a failed review without creating an attempt', async () => {
    vi.mocked(subjectRequest).mockRejectedValueOnce(new Error('Could not load the saved quiz.'));
    render(<StudentMaterial kind="commercial" learnerId="123" groupId={50} activityId={60} completed readOnly reviewQuiz />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the saved quiz.');
    vi.mocked(subjectRequest).mockResolvedValueOnce(material());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'Activity quiz' });
    expect(subjectRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(subjectRequest).mock.calls.every(([, options]) => !options?.method)).toBe(true);
    expect(screen.queryByRole('button', { name: /Start quiz|Try quiz again|Submit/ })).not.toBeInTheDocument();
  });

  it('aborts the previous learner review when the owner changes', async () => {
    let finishOld: (value: SubjectMaterial) => void = () => {};
    vi.mocked(subjectRequest).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    const view = render(<StudentMaterial kind="commercial" learnerId="123" groupId={50} activityId={60} readOnly reviewQuiz />);
    const previousSignal = vi.mocked(subjectRequest).mock.calls[0][1]?.signal;
    vi.mocked(subjectRequest).mockResolvedValueOnce({ ...material(), historical: { ...material().historical, score: 50, answers: [] } });
    view.rerender(<StudentMaterial kind="commercial" learnerId="456" groupId={50} activityId={60} readOnly reviewQuiz />);
    await screen.findByText(/Previous learning.*50 \/ 100/);
    expect(previousSignal?.aborted).toBe(true);
    finishOld(material());
    expect(screen.queryByText(/Previous learning.*100 \/ 100/)).not.toBeInTheDocument();
  });
});
