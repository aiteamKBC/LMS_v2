import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import StructuredRecord from './StructuredRecord';

it('shows imported eligibility and support fields as readable labels and values', () => {
  render(<StructuredRecord value={{ supportPlan: [{ actionOwner: 'Coach', nextStep: 'Weekly check-in' }],
    priorityActions: ['Follow up with learner'] }} />);
  expect(screen.getByText('Support Plan')).toBeVisible();
  expect(screen.getByText('Action Owner')).toBeVisible();
  expect(screen.getByText('Weekly check-in')).toBeVisible();
  expect(screen.getByText('Follow up with learner')).toBeVisible();
});
