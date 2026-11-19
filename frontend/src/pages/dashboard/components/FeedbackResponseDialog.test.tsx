import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackResponse } from '@/api/feedback';
import FeedbackResponseDialog from './FeedbackResponseDialog';

const response: FeedbackResponse = {
  id: 14, formId: 3, formTitle: 'Synthetic feedback', formType: 'post_lecture', templateKey: 'synthetic',
  learnerId: null, learnerName: 'Anonymous learner', programme: 'Synthetic programme', status: 'completed',
  deliveryId: 1, sessionTitle: 'Synthetic session', sessionStartsAt: null, tutorName: 'Synthetic tutor',
  startedAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z', submittedAt: '2026-11-17T10:00:00Z',
  sections: [{ id: 1, title: 'Saved feedback answers', description: '', questions: [{
    id: 5, type: 'long_text', text: 'What needs improvement?', required: false, helpText: '', config: {},
    answer: 'Synthetic original answer from the API.',
  }] }],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('original feedback response details', () => {
  it('fetches the selected original response and displays saved answers as read only', async () => {
    vi.spyOn(feedbackApi, 'response').mockResolvedValue({ response });
    const close = vi.fn();
    render(<FeedbackResponseDialog responseId={14} onClose={close} />);
    const answer = await screen.findByRole('textbox', { name: 'What needs improvement?' });
    expect(answer).toHaveValue('Synthetic original answer from the API.');
    expect(answer).toBeDisabled();
    expect(screen.getByText('Anonymous learner')).toBeInTheDocument();
    expect(feedbackApi.response).toHaveBeenCalledExactlyOnceWith(14);
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });

  it('shows a recoverable error when the original response cannot be loaded', async () => {
    vi.spyOn(feedbackApi, 'response').mockRejectedValueOnce(new Error('Response unavailable')).mockResolvedValueOnce({ response });
    render(<FeedbackResponseDialog responseId={14} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Response unavailable');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry feedback response' }));
    expect(await screen.findByRole('textbox')).toHaveValue('Synthetic original answer from the API.');
  });

  it('ignores an older request after the selected response changes', async () => {
    let resolveEarlier: (value: { response: FeedbackResponse }) => void;
    vi.spyOn(feedbackApi, 'response').mockImplementationOnce(() => new Promise(resolve => { resolveEarlier = resolve; }))
      .mockResolvedValueOnce({ response: { ...response, id: 15, learnerName: 'Synthetic second respondent' } });
    const { rerender } = render(<FeedbackResponseDialog responseId={14} onClose={vi.fn()} />);
    rerender(<FeedbackResponseDialog responseId={15} onClose={vi.fn()} />);
    await screen.findByText('Synthetic second respondent');
    await act(async () => { resolveEarlier!({ response }); });
    expect(screen.queryByText('Anonymous learner')).not.toBeInTheDocument();
    expect(screen.getByText('Synthetic second respondent')).toBeInTheDocument();
  });
});
