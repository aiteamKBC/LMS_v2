import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompletionTimeDialog } from './CompletionTimeDialog';

afterEach(cleanup);

it('limits clock choices and submits both inclusive boundaries without changing the date', () => {
  const onSubmit = vi.fn();
  render(<CompletionTimeDialog reason="outside_working_hours" holidayName="" holidays={[]}
    submitting={false} serverError="" onSubmit={onSubmit} onClose={vi.fn()} />);
  const hours = screen.getByLabelText('Completion time');
  const minutes = screen.getByLabelText('Completion minutes');
  const submit = screen.getByRole('button', { name: 'Final Submit' });
  expect(within(hours).getAllByRole('option').map(option => (option as HTMLOptionElement).value))
    .toEqual(['', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
  fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-01-15' } });
  fireEvent.change(hours, { target: { value: '07' } });
  expect(submit).toBeDisabled();
  fireEvent.change(minutes, { target: { value: '00' } });
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenLastCalledWith('2026-01-15T07:00:00');
  fireEvent.change(hours, { target: { value: '18' } });
  fireEvent.change(minutes, { target: { value: '59' } });
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenLastCalledWith('2026-01-15T18:59:00');
  fireEvent.change(hours, { target: { value: '19' } });
  expect(minutes).toHaveValue('00');
  expect(within(minutes).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', '00']);
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenLastCalledWith('2026-01-15T19:00:00');
  fireEvent.change(hours, { target: { value: '22' } });
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(3);
});
