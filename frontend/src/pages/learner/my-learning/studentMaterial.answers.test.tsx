import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subjectRequest, type SubjectMaterial } from '@/api/studentActivity';
import { StudentMaterial } from './StudentMaterial';

vi.mock('@/api/studentActivity', () => ({ subjectRequest: vi.fn() }));

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
  beforeEach(() => vi.resetAllMocks());

  it('selects historical answers for read-only review and starts a blank retake', async () => {
    const quiz = await open(material());
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeChecked();
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeDisabled();
    vi.mocked(subjectRequest).mockResolvedValueOnce({ attempt_id: 'new', definition: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Try quiz again' }));
    await screen.findByRole('button', { name: 'Submit answers' });
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).not.toBeChecked();
    expect(quiz.getByRole('checkbox', { name: 'First answer' })).toBeEnabled();
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
});
