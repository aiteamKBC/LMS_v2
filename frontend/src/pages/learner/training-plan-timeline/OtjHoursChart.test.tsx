import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OtjHoursChart } from './OtjHoursChart';

it('shows historical hours needing verification separately from tutor submissions', () => {
  render(<OtjHoursChart points={[{ key: '2026-08', label: 'August 2026',
    target: 20, submitted: 0, completed: 10, verification: 8 }]} plannedHours={20} />);
  const month = screen.getByRole('button', { name: /August 2026:.*submitted 0 hours.*needs verification 8 hours/ });
  fireEvent.focus(month);
  expect(within(screen.getByRole('tooltip')).getByText('Needs verification:')).toBeInTheDocument();
  expect(screen.getByText('10h completed · 8h need verification')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  expect(screen.getByText('Hours needing verification are not accepted hours or work awaiting tutor marking.')).toBeInTheDocument();
});
