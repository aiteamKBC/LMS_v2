import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HistoricalAssignmentCards } from './HistoricalAssignmentCards';
import { MONTHLY_STEPS } from '@/api/monthlyAssignment';
import type { HistoricalAssignmentContent } from '@/api/reflectionSubmission';

afterEach(cleanup);
const content: HistoricalAssignmentContent = {
  method: 'source-extracts', notices: [],
  cards: MONTHLY_STEPS.map((title, index) => ({ title, emptyMessage: 'Not recorded in the source',
    sections: index === 0 ? [{ label: 'Original assignment content', source: 'Answer.pdf', kind: 'original', text: 'I created the WBS.' }] :
      index === 6 ? [{ label: 'Original tutor feedback', source: 'Tutor feedback', kind: 'feedback', text: 'Good work.' }] : [] })),
};

it('shows all eight populated-source cards in preview and distinguishes feedback', () => {
  render(<HistoricalAssignmentCards content={content} files={[]} onPreviewFile={() => {}} />);
  expect(screen.getAllByRole('heading')).toHaveLength(8);
  expect(screen.getByText('I created the WBS.')).toBeInTheDocument();
  expect(screen.getByText('Original tutor feedback')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded in the source')).toHaveLength(6);
});

it('shows only the selected wizard card and opens its original file', () => {
  const onPreviewFile = vi.fn();
  const file = { id: 'legacy:1:file', filename: 'Assignment.zip', contentType: '', sizeBytes: 0, status: 'approved', scanResult: null, sectionRef: '', uploadedAt: null, trainingPlanDetails: null };
  render(<HistoricalAssignmentCards content={content} step={1} files={[file]} onPreviewFile={onPreviewFile} />);
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  expect(screen.queryByText('I created the WBS.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Assignment.zip/ }));
  expect(onPreviewFile).toHaveBeenCalledWith(file);
});
