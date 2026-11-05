import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompletionTimeDialog } from './CompletionTimeDialog';

afterEach(cleanup);

it('offers 08:00 through 17:00 and distinguishes allowed hours from the closing-time warning', () => {
  const onSubmit = vi.fn();
  render(<CompletionTimeDialog reason="outside_working_hours" holidayName="" holidays={[]}
    submitting={false} serverError="" onSubmit={onSubmit} onClose={vi.fn()} />);
  const hours = screen.getByLabelText('Completion time');
  const minutes = screen.getByLabelText('Completion minutes');
  const submit = screen.getByRole('button', { name: 'Final Submit' });
  expect(within(hours).getAllByRole('option').map(option => (option as HTMLOptionElement).value))
    .toEqual(['', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17']);
  expect(screen.getByText(/Official working hours are Monday to Friday, from 08:00 to before 17:00 UK time/))
    .toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-01-15' } });
  fireEvent.change(hours, { target: { value: '08' } });
  expect(submit).toBeDisabled();
  fireEvent.change(minutes, { target: { value: '00' } });
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenLastCalledWith('2026-01-15T08:00:00');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.change(hours, { target: { value: '16' } });
  fireEvent.change(minutes, { target: { value: '59' } });
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenLastCalledWith('2026-01-15T16:59:00');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.change(hours, { target: { value: '17' } });
  expect(minutes).toHaveValue('00');
  expect(within(minutes).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', '00']);
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenLastCalledWith('2026-01-15T17:00:00');
  expect(screen.getByRole('status')).toHaveTextContent(
    'Allowed working hours are Monday to Friday, from 08:00 to before 17:00 UK time.',
  );
  fireEvent.change(hours, { target: { value: '22' } });
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(3);
});
