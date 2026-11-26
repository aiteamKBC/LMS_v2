import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import EmployerFeedbackPage from './EmployerFeedbackPage';

const viewer = vi.hoisted(() => ({ role: 'employer' }));
vi.mock('./employerPortalNav', () => ({ useEmployerPortalChrome: () => ({ shell: {}, isEmployerViewer: viewer.role === 'employer' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/api/feedback', () => ({ feedbackApi: {
  employerForms: vi.fn(), employerForm: vi.fn(), saveEmployerResponse: vi.fn(), uploadEmployerPhoto: vi.fn(),
}, feedbackUploadUrl: (id: string) => `/uploads/${id}` }));

const form = {
  id: 83, title: 'Employer review feedback', formType: 'post_progress_review_employer',
  relatedLearnerName: 'Synthetic learner', allowSaveContinue: false, allowEditAfterSubmission: false,
  sections: [{ id: 1, title: 'Your review', description: '', questions: [
    { id: 12, type: 'long_text', text: 'How was the review?', required: true, helpText: '', config: {} },
  ] }],
  reviewDelivery: { id: 501, reviewType: 'Progress Review', reviewName: 'Synthetic PR', completedAt: '2026-11-04T10:00:00Z' },
  response: { id: null, status: 'not_started', answers: {}, submittedAt: null },
} as unknown as FeedbackForm & { relatedLearnerName: string };

beforeEach(() => {
  vi.clearAllMocks(); viewer.role = 'employer';
  vi.mocked(feedbackApi.employerForm).mockResolvedValue({ form });
  vi.mocked(feedbackApi.employerForms).mockResolvedValue({ forms: [] });
  vi.mocked(feedbackApi.saveEmployerResponse).mockResolvedValue({ response: { id: 901, status: 'completed' } });
});

function open(path = '/employers/7/feedback/501') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/employers/:employerId/feedback" element={<EmployerFeedbackPage />} />
    <Route path="/employers/:employerId/feedback/:deliveryId" element={<EmployerFeedbackPage />} />
  </Routes></MemoryRouter>);
}

it('opens the assigned review from the employer queue and submits a separate response', async () => {
  vi.mocked(feedbackApi.employerForms).mockResolvedValue({ forms: [{ id: 501, title: form.title,
    learnerName: 'Synthetic learner', reviewName: 'Synthetic PR', completedAt: '2026-11-04T10:00:00Z',
    assignedAt: '2026-11-04T10:00:00Z', status: 'not_started' }] });
  open('/employers/7/feedback');
  fireEvent.click(await screen.findByRole('link', { name: 'Start' }));
  fireEvent.change(await screen.findByRole('textbox', { name: /How was the review/ }), { target: { value: 'Useful meeting' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(feedbackApi.saveEmployerResponse).toHaveBeenCalledWith('7', '501', { '12': 'Useful meeting' }, true));
  expect(await screen.findByText(/Thank you for your feedback/)).toBeInTheDocument();
  expect(feedbackApi.employerForm).toHaveBeenCalledWith('7', '501');
});

it('validates required questions before submission', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
  expect(feedbackApi.saveEmployerResponse).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('This field is required before continuing.');
});

it.each(['admin', 'staff'])('keeps %s previews read-only', async role => {
  viewer.role = role; open();
  expect(await screen.findByRole('textbox', { name: /How was the review/ })).toBeDisabled();
  expect(screen.getByText(/Only the assigned employer/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  expect(feedbackApi.saveEmployerResponse).not.toHaveBeenCalled();
});

it('restores a saved draft and saves for later through the employer endpoint', async () => {
  vi.mocked(feedbackApi.employerForm).mockResolvedValue({ form: { ...form, allowSaveContinue: true,
    response: { id: 901, status: 'in_progress', answers: { '12': 'Existing answer' }, submittedAt: null } } });
  open();
  expect(await screen.findByRole('textbox', { name: /How was the review/ })).toHaveValue('Existing answer');
  fireEvent.click(screen.getByRole('button', { name: 'Save for later' }));
  await waitFor(() => expect(feedbackApi.saveEmployerResponse).toHaveBeenCalledWith('7', '501', { '12': 'Existing answer' }, false));
});

it('keeps answers when saving fails and allows retry', async () => {
  vi.mocked(feedbackApi.saveEmployerResponse).mockRejectedValueOnce(new Error('Could not save'));
  open();
  const input = await screen.findByRole('textbox', { name: /How was the review/ });
  fireEvent.change(input, { target: { value: 'Keep my answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(input).toHaveValue('Keep my answer');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByText(/Thank you for your feedback/)).toBeInTheDocument();
});

it('shows an ownership error and retries without rendering a form', async () => {
  vi.mocked(feedbackApi.employerForm).mockRejectedValueOnce(new Error('Feedback not found.'));
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Feedback not found.');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('textbox', { name: /How was the review/ })).toBeInTheDocument();
});

it('locks an already completed response', async () => {
  vi.mocked(feedbackApi.employerForm).mockResolvedValue({ form: { ...form,
    response: { id: 901, status: 'completed', answers: { '12': 'Submitted answer' }, submittedAt: '2026-11-04T11:00:00Z' } } });
  open();
  expect(await screen.findByRole('textbox', { name: /How was the review/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
});

it('handles an empty queue', async () => {
  open('/employers/7/feedback');
  expect(await screen.findByText('No feedback assigned.')).toBeInTheDocument();
});

it('allows staff to inspect every section without editing or submitting', async () => {
  viewer.role = 'staff';
  vi.mocked(feedbackApi.employerForm).mockResolvedValue({ form: { ...form, sections: [
    ...(form.sections || []), { id: 2, title: 'Follow up', description: '', questions: [
      { id: 13, type: 'long_text', text: 'Any follow up?', required: false, helpText: '', config: {} },
    ] },
  ] } });
  open();
  fireEvent.click(await screen.findByRole('button', { name: /Follow up/ }));
  expect(screen.getByRole('textbox', { name: /Any follow up/ })).toBeDisabled();
  expect(feedbackApi.saveEmployerResponse).not.toHaveBeenCalled();
});

it('autosaves the latest changed answer without submitting', async () => {
  vi.mocked(feedbackApi.employerForm).mockResolvedValue({ form: { ...form, allowSaveContinue: true } });
  open();
  fireEvent.change(await screen.findByRole('textbox', { name: /How was the review/ }), { target: { value: 'Draft answer' } });
  await waitFor(() => expect(feedbackApi.saveEmployerResponse).toHaveBeenCalledWith('7', '501', { '12': 'Draft answer' }), { timeout: 2000 });
  expect(await screen.findByText('All changes saved')).toBeInTheDocument();
});
