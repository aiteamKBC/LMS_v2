import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthlyAnswerField } from './MonthlyAssignmentSteps';
import { proofreadLearningReflection } from '@/api/reflectionVoice';

vi.mock('@/api/reflectionVoice', () => ({ proofreadLearningReflection: vi.fn(), transcribeVoiceReflection: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('assignment proofreading requirements', () => {
  it('sends field requirements and prevents accepting a shortened answer', async () => {
    vi.mocked(proofreadLearningReflection).mockResolvedValue({ text: 'A short suggestion.', language: 'en-GB' });
    const onChange = vi.fn();
    render(<MonthlyAnswerField label="Answer" title="Assignment" value="My original answer" onChange={onChange} disabled={false} minimumWords={120} onePointPerLine />);
    fireEvent.click(screen.getByText('AI proofread & improve'));
    expect(await screen.findByText('Suggestion: 3 words / 120 minimum')).toBeInTheDocument();
    expect(proofreadLearningReflection).toHaveBeenCalledWith('My original answer', expect.objectContaining({ minimumWords: 120, onePointPerLine: true }));
    expect(screen.getByText('Use suggestion')).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves separate lines and only replaces the answer after acceptance', async () => {
    const suggestion = Array.from({ length: 3 }, () => Array(40).fill('word').join(' ')).join('\n');
    vi.mocked(proofreadLearningReflection).mockResolvedValue({ text: suggestion, language: 'en-GB' });
    const onChange = vi.fn();
    render(<MonthlyAnswerField label="Answer" title="Assignment" value="Original answer" onChange={onChange} disabled={false} minimumWords={120} onePointPerLine />);
    fireEvent.click(screen.getByText('AI proofread & improve'));
    await screen.findByText('Suggestion: 120 words / 120 minimum');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Use suggestion'));
    expect(onChange).toHaveBeenCalledWith(suggestion);
  });
});
