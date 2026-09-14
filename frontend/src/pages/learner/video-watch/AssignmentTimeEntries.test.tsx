import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentTimeEntries, assignmentMonthBounds, assignmentTimeHours } from './AssignmentTimeEntries';
afterEach(cleanup);
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn().mockResolvedValue({ bookingCalendar: {
  coveredYears: [2026], bankHolidays: [{ date: '2026-12-25', title: 'Christmas Day' }, { date: '2026-12-28', title: 'Boxing Day (substitute day)' }],
} }) }));
it('limits dates to the assignment month, including leap years', () => {
  expect(assignmentMonthBounds('2028-02')).toEqual({ min: '2028-02-01', max: '2028-02-29' });
  expect(assignmentMonthBounds('2026-02')?.max).toBe('2026-02-28');
  expect(assignmentMonthBounds('2026-13')).toBeNull();
});
it('adds and removes topics, totals decimal hours, and restricts the calendar', async () => {
  function Form() {
    const [entries, setEntries] = useState([{ topic: 'Research', hours: '1.5', date: '2026-09-01' }]);
    return <AssignmentTimeEntries kind="commercial" learnerId="1" month="2026-09" entries={entries} onChange={setEntries} disabled={false} />;
  }
  render(<Form />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date 1', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Date 1', exact: true }));
  expect(screen.getByRole('button', { name: '2026-09-05' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '2026-09-06' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '2026-10-01' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2026-09-15' }));
  fireEvent.click(screen.getByText('Add topic'));
  fireEvent.change(screen.getByLabelText('Topic 2'), { target: { value: 'Writing' } });
  fireEvent.change(screen.getByLabelText('Hours 2'), { target: { value: '2.25' } });
  expect(screen.getByText('Total learning time: 3.75 hours')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Date 2', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '2026-09-16' }));
  fireEvent.click(screen.getByText('Remove topic 1'));
  expect(screen.getByLabelText('Topic 1')).toHaveValue('Writing');
  expect(screen.getByText('Total learning time: 2.25 hours')).toBeVisible();
});
it('disables bank holidays and substitute days in the month', async () => {
  const change = vi.fn();
  render(<AssignmentTimeEntries kind="commercial" learnerId="1" month="2026-12" entries={[]} onChange={change} disabled={false} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date 1', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Date 1', exact: true }));
  expect(screen.getByRole('button', { name: '2026-12-25' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '2026-12-28' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '2026-12-25' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '2026-12-24' }));
  expect(change).toHaveBeenCalledWith([{ topic: '', hours: '', date: '2026-12-24' }]);
});
it('does not count negative or non-finite hours', () => {
  expect(assignmentTimeHours([{ topic: '', hours: '-1', date: '' }, { topic: '', hours: 'Infinity', date: '' }])).toBe(0);
});
