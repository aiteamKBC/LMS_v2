import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FormRenderer } from './FormRenderer';
import type { FeedbackAnswerValue, FeedbackSection } from '@/api/feedback';

const sections: FeedbackSection[] = [{
  id: 1, title: 'Learning Experience', description: 'Tell us about your learning.',
  questions: [
    { id: 10, type: 'rating', text: 'How would you rate it?', required: true, helpText: '', config: { min: 1, max: 5 } },
    { id: 11, type: 'multiple_choice', text: 'What helped?', required: false, helpText: '', config: { options: ['Tutor', 'Resources'] } },
    { id: 12, type: 'name', text: 'Your name', required: true, helpText: '', config: {} },
    { id: 13, type: 'email', text: 'Email', required: true, helpText: '', config: {} },
    { id: 14, type: 'photo_upload', text: 'Your picture', required: false, helpText: '', config: {} },
  ],
}];

describe('FormRenderer', () => {
  it('renders the shared learner/preview structure and emits typed answers', async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    function Harness() {
      const [answers, setAnswers] = useState<Record<number, FeedbackAnswerValue>>({});
      return <FormRenderer sections={sections} answers={answers} onChange={(id, value) => {
        setAnswers((current) => ({ ...current, [id]: value }));
        onChange(id, value);
      }} />;
    }
    render(<Harness />);
    expect(screen.getByText('Learning Experience')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(onChange).toHaveBeenCalledWith(10, 5);
    await user.click(screen.getByRole('checkbox', { name: 'Tutor' }));
    expect(onChange).toHaveBeenCalledWith(11, ['Tutor']);
    await user.type(screen.getByText('First Name').previousElementSibling!.querySelector('input')!, 'Ava');
    expect(onChange).toHaveBeenCalledWith(12, { firstName: 'Ava', lastName: '' });
    expect(screen.getByText('Choose JPG, PNG or WebP')).toBeTruthy();
  });
});
