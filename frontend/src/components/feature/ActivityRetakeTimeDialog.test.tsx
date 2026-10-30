import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityRetakeTimeDialog, ActivityTimeLimitNotice } from './ActivityRetakeTimeDialog';
afterEach(cleanup);
it.each(['correct', 'add', 'retry'] as const)('requires an explicit %s decision and a correction reason', choice => {
  const choose = vi.fn(); render(<ActivityRetakeTimeDialog previousSeconds={3600} onChoose={choose} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: choice === 'correct' ? /^Correct recorded time/ : choice === 'add' ? /^Add more learning time/ : /^Record another attempt/ }));
  if (choice === 'correct') {
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for time correction' }), { target: { value: 'Entered hours instead of minutes.' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(choose).toHaveBeenCalledExactlyOnceWith(choice, choice === 'correct' ? 'Entered hours instead of minutes.' : '');
});
it('cancels without changing time and contains keyboard focus', () => {
  const close = vi.fn(), choose = vi.fn(); render(<ActivityRetakeTimeDialog previousSeconds={3600} onChoose={choose} onClose={close} />);
  const first = screen.getAllByRole('radio')[0], cancel = screen.getByRole('button', { name: 'Cancel' });
  expect(first).toHaveFocus(); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce(); expect(choose).not.toHaveBeenCalled();
});
it('returns to editing from the limit notice without claiming a save', () => {
  const edit = vi.fn(); render(<ActivityTimeLimitNotice message="Adding 3 hours would make 9 hours. Enter less time." onEdit={edit} />);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('make 9 hours');
  const button = screen.getByRole('button', { name: 'Edit time and try again' }); expect(button).toHaveFocus();
  fireEvent.click(button); expect(edit).toHaveBeenCalledOnce();
});
