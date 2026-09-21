import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormRenderer } from './FormRenderer';
import type { FeedbackSection } from '@/api/feedback';

const sections: FeedbackSection[] = [{
  id: 1, title: 'Learning Experience', description: 'Tell us about your learning.',
  questions: [
    { id: 10, type: 'rating', text: 'How would you rate it?', required: true, helpText: '', config: { min: 1, max: 5 } },
    { id: 11, type: 'multiple_choice', text: 'What helped?', required: false, helpText: '', config: { options: ['Tutor', 'Resources'] } },
  ],
}];

describe('FormRenderer', () => {
  it('renders the shared learner/preview structure and emits typed answers', async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    render(<FormRenderer sections={sections} answers={{}} onChange={onChange} />);
    expect(screen.getByText('Learning Experience')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(onChange).toHaveBeenCalledWith(10, 5);
    await user.click(screen.getByRole('checkbox', { name: 'Tutor' }));
    expect(onChange).toHaveBeenCalledWith(11, ['Tutor']);
  });
});
