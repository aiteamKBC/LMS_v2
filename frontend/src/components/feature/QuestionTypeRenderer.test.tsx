import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuestionAnswersView } from './QuestionTypeRenderer';
import { parseQuizPairAnswer, serializeQuizPairAnswer } from '@/lib/quizPairAnswers';

describe('book image quiz answers', () => {
  it('preserves a saved image through editing and renders the whole image in preview', () => {
    const imageUrl = 'data:image/webp;base64,UklGRg==';
    const saved = JSON.stringify({ kind: 'image_matching_pair', imageUrl, label: '', match: 'Awareness' });
    const edited = serializeQuizPairAnswer('image_matching', { ...parseQuizPairAnswer(saved, 'image_matching'), right: 'Brand awareness' });
    render(<QuestionAnswersView type="image_matching" answers={[{ id: 1, text: edited, isCorrect: true }]} />);
    const image = screen.getByRole('img', { name: 'Image A' });
    expect(image).toHaveAttribute('src', imageUrl);
    expect(image).toHaveClass('object-contain');
    expect(screen.getByText('Brand awareness')).toBeVisible();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
