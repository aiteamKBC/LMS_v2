import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { lecturePublicFeedbackApi, type PublicLectureFeedback } from '@/api/lecturePublicFeedback';
import PublicLectureFeedbackPage from './page';

vi.mock('@/api/lecturePublicFeedback', () => ({
  lecturePublicFeedbackApi: {
    discover: vi.fn(), read: vi.fn(), save: vi.fn(), uploadPhoto: vi.fn(), removePhoto: vi.fn(), loadPhoto: vi.fn(),
  },
}));

const completedFeedback: PublicLectureFeedback = {
  lecture: { title: 'Session 4', moduleName: 'Synthetic module', startsAt: '2026-11-04T10:00:00Z' },
  learner: { name: 'Synthetic Learner' },
  form: {
    id: 47, title: 'Live Sessions Feedback', description: '', instructions: '',
    allowSaveContinue: true, allowEditAfterSubmission: false,
    sections: [{ id: 1, title: 'Session feedback', description: '', questions: [
      { id: 21, type: 'long_text', text: 'What could improve?', required: false, helpText: '', config: {} },
    ] }],
    response: { id: 90, status: 'completed', answers: { '21': 'More examples' }, submittedAt: '2026-11-04T11:00:00Z' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lecturePublicFeedbackApi.discover).mockResolvedValue({ token: 'synthetic-selection' });
});

it('uses one stable link to discover the latest lecture and show an existing completed response', async () => {
  vi.mocked(lecturePublicFeedbackApi.read).mockResolvedValue(completedFeedback);
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/lecture-feedback']}><PublicLectureFeedbackPage /></MemoryRouter>);

  await user.type(screen.getByRole('textbox', { name: 'Aptem or LMS email' }), 'learner@example.test');
  await user.click(screen.getByRole('button', { name: 'Open feedback' }));

  expect(lecturePublicFeedbackApi.discover).toHaveBeenCalledWith('learner@example.test');
  expect(lecturePublicFeedbackApi.read).toHaveBeenCalledWith('synthetic-selection', 'learner@example.test');
  expect(await screen.findByText('Session 4')).toBeInTheDocument();
  expect(screen.getByDisplayValue('More examples')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
});

it('allows editing a completed response when the form setting permits it', async () => {
  vi.mocked(lecturePublicFeedbackApi.read).mockResolvedValue({
    ...completedFeedback,
    form: { ...completedFeedback.form, allowEditAfterSubmission: true },
  });
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/lecture-feedback']}><PublicLectureFeedbackPage /></MemoryRouter>);

  await user.type(screen.getByRole('textbox', { name: 'Aptem or LMS email' }), 'learner@example.test');
  await user.click(screen.getByRole('button', { name: 'Open feedback' }));

  expect(await screen.findByRole('button', { name: 'Submit' })).toBeInTheDocument();
  expect(screen.getByDisplayValue('More examples')).toBeInTheDocument();
});

it('rejects an unknown email without opening a lecture', async () => {
  vi.mocked(lecturePublicFeedbackApi.discover).mockRejectedValue(new Error('Invalid email.'));
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/lecture-feedback']}><PublicLectureFeedbackPage /></MemoryRouter>);

  await user.type(screen.getByRole('textbox', { name: 'Aptem or LMS email' }), 'unknown@example.test');
  await user.click(screen.getByRole('button', { name: 'Open feedback' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email.');
  expect(lecturePublicFeedbackApi.read).not.toHaveBeenCalled();
});
