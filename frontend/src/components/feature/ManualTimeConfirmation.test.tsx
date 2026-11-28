import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useManualTimeConfirmation } from '@/hooks/useManualTimeConfirmation';
import { ManualTimeConfirmation } from './ManualTimeConfirmation';

afterEach(cleanup);

function Form({ save, initialHours = '49' }: { save: (seconds: number) => void; initialHours?: string }) {
  const [hours, setHours] = useState(initialHours);
  const { confirmTime, timeConfirmation } = useManualTimeConfirmation();
  return <><label>Hours<input value={hours} onChange={event => setHours(event.target.value)} /></label>
    <button onClick={async () => {
      const seconds = Math.round(Number(hours) * 3600);
      if (await confirmTime(seconds)) save(seconds);
    }}>Save learning</button>{timeConfirmation}</>;
}

it('holds 49 hours until confirmed and lets the learner correct it to 4.9 hours', async () => {
  const save = vi.fn();
  render(<Form save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('49 hours and 0 minutes');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
  expect(screen.getByLabelText('Hours')).toHaveValue('49');
  fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '4.9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('4.9 hours');
  expect(screen.getByRole('alertdialog')).toHaveTextContent('4 hours and 54 minutes');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(17640));
});

it('keeps seconds visible for fractional minutes', () => {
  render(<Form save={vi.fn()} initialHours={String(150 / 3600)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('0 hours and 2 minutes and 30 seconds');
});

it('focuses Edit time, traps keyboard focus, and treats Escape as editing', async () => {
  const save = vi.fn();
  render(<Form save={save} />);
  const trigger = screen.getByRole('button', { name: 'Save learning' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('alertdialog');
  const edit = within(dialog).getByRole('button', { name: 'Edit time' });
  const confirm = within(dialog).getByRole('button', { name: 'Confirm time' });
  expect(edit).toHaveFocus();
  fireEvent.keyDown(edit, { key: 'Tab', shiftKey: true });
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(confirm, { key: 'Tab' });
  expect(edit).toHaveFocus();
  fireEvent.keyDown(edit, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(trigger).toHaveFocus();
  await waitFor(() => expect(save).not.toHaveBeenCalled());
});

it('does not submit a pending confirmation after the form is unmounted', async () => {
  const save = vi.fn();
  const view = render(<Form save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  view.unmount();
  await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
  expect(document.body.style.overflow).toBe('');
});

it('does not duplicate a submission when the save action is clicked twice', async () => {
  const save = vi.fn();
  render(<Form save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
});

it.each([
  { seconds: 28799, warning: false },
  { seconds: 28800, warning: false },
  { seconds: 28801, warning: true },
  { seconds: 108000, warning: true },
])('reviews $seconds seconds with high-duration warning=$warning without changing the saved duration', async ({ seconds, warning }) => {
  const save = vi.fn();
  render(<Form save={save} initialHours={String(seconds / 3600)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save learning' }));
  if (warning) expect(screen.getByRole('alert')).toHaveTextContent('This time entry exceeds 8 hours.');
  else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(seconds));
});

it.each([
  { duration: '8 hours', warning: false },
  { duration: '480 minutes', warning: false },
  { duration: '8 hours and 1 second', warning: true },
  { duration: '8h 1m', warning: true },
  { duration: '481 minutes', warning: true },
  { duration: '49 hours', warning: true },
  { duration: '4.9 hours', warning: false },
  { duration: '30', warning: false },
  { duration: '30 minutes', warning: false },
])('checks explicitly named units in "$duration" without guessing unitless values', ({ duration, warning }) => {
  const onConfirm = vi.fn(), onEdit = vi.fn();
  render(<ManualTimeConfirmation duration={duration} onConfirm={onConfirm} onEdit={onEdit} />);
  expect(screen.getByRole('alertdialog')).toHaveTextContent(`You entered ${duration}`);
  expect(Boolean(screen.queryByRole('alert'))).toBe(warning);
  fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
});
