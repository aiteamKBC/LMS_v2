import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Activity } from '@/features/old-otjh/api';
import { ManualTimeCorrectionDialog } from './ManualTimeCorrectionDialog';
import type { LogDetail } from './api';

afterEach(cleanup);
const row: Activity = { id: 44, title: 'Example reading', category: 'Reading', activity_date: '2026-10-01', activity_time: '10:00',
  planned_hours: 2, actual_hours: 30, accepted: true, timestamp_label: '10:00', completion_note: null, documents: [], results: [],
  manual_time: { progress_id: 1, seconds: 108000, revision: 'original' } };
function changeTime() {
  fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Entered hours instead of minutes' } });
}

it('corrects 30 hours to 30 minutes on the same manual entry with an explicit audit reason', async () => {
  const saved = { month: '2026-10', actual_hours: .5 } as LogDetail;
  const onSave = vi.fn().mockResolvedValue(saved), onSaved = vi.fn();
  render(<ManualTimeCorrectionDialog row={row} onSave={onSave} onSaved={onSaved} onClose={vi.fn()} />);
  expect(screen.getAllByText('30 hours, 0 minutes, 0 seconds')).toHaveLength(2);
  changeTime();
  expect(screen.getByLabelText('Minutes')).toHaveAccessibleDescription('For 30 minutes: enter 0 in Hours, 30 in Minutes and 0 in Seconds.');
  expect(screen.getByText('0 hours, 30 minutes, 0 seconds')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ seconds: 1800, revision: 'original', reason: 'Entered hours instead of minutes' });
});

it('preserves all entered fields after a failed save and allows a deliberate retry', async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error('This entry has changed. Reload it before correcting the time.'))
    .mockResolvedValue({ month: '2026-10' });
  render(<ManualTimeCorrectionDialog row={row} onSave={onSave} onSaved={vi.fn()} onClose={vi.fn()} />);
  changeTime();
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This entry has changed');
  expect(screen.getByLabelText('Hours')).toHaveValue(0);
  expect(screen.getByLabelText('Minutes')).toHaveValue(30);
  expect(screen.getByLabelText('Reason for correction')).toHaveValue('Entered hours instead of minutes');
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});

it('prevents duplicate submissions or dismissal while saving', async () => {
  const onSave = vi.fn().mockReturnValue(new Promise(() => {})), onClose = vi.fn();
  render(<ManualTimeCorrectionDialog row={row} onSave={onSave} onSaved={vi.fn()} onClose={onClose} />);
  changeTime();
  const button = screen.getByRole('button', { name: 'Save correction' });
  fireEvent.click(button); fireEvent.click(button);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

it('keeps manual seconds precise and cancel never saves', () => {
  const onSave = vi.fn(), onClose = vi.fn();
  render(<ManualTimeCorrectionDialog row={{ ...row, manual_time: { ...row.manual_time!, seconds: 317 } }} onSave={onSave} onSaved={vi.fn()} onClose={onClose} />);
  expect(screen.getAllByText('0 hours, 5 minutes, 17 seconds')).toHaveLength(2);
  expect(screen.getByLabelText('Seconds')).toHaveValue(17);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onSave).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce();
});

it.each(['-1', '60', '1.5'])('rejects invalid minutes %s', minutes => {
  render(<ManualTimeCorrectionDialog row={row} onSave={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  changeTime();
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: minutes } });
  expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
});

it('keeps the unsaved reason if the month becomes read-only while the dialog is open', () => {
  const props = { row, onSave: vi.fn(), onSaved: vi.fn(), onClose: vi.fn() };
  const view = render(<ManualTimeCorrectionDialog {...props} />);
  changeTime();
  view.rerender(<ManualTimeCorrectionDialog {...props} canSave={false} />);
  expect(screen.getByLabelText('Reason for correction')).toHaveValue('Entered hours instead of minutes');
  expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('This record is now read-only');
  expect(props.onSave).not.toHaveBeenCalled();
});

it.each([28799, 28800, 28801, 108000])('requires explicit confirmation only above 8 hours for a correction of %s seconds', async seconds => {
  const onSave = vi.fn().mockResolvedValue({ month: '2026-10' });
  render(<ManualTimeCorrectionDialog row={{ ...row, manual_time: { ...row.manual_time!, seconds } }}
    onSave={onSave} onSaved={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Checked the original duration' } });
  const button = screen.getByRole('button', { name: 'Save correction' });
  if (seconds > 28800) {
    expect(screen.getByRole('alert')).toHaveTextContent('This time entry exceeds 8 hours.');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the corrected time/ }));
  } else {
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({ seconds, revision: 'original', reason: 'Checked the original duration' }));
});

it('requires a fresh confirmation after editing any duration field and preserves the reason', () => {
  render(<ManualTimeCorrectionDialog row={row} onSave={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Checked the duration' } });
  for (const [label, value] of [['Hours', '29'], ['Minutes', '1'], ['Seconds', '1']]) {
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the corrected time/ }));
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    expect(screen.getByLabelText('Reason for correction')).toHaveValue('Checked the duration');
  }
  fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '0' } });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled();
  expect(screen.getByLabelText('Reason for correction')).toHaveValue('Checked the duration');
});
