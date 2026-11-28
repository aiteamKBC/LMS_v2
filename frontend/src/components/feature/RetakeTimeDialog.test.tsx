import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RetakeTimeDialog } from './RetakeTimeDialog';

afterEach(cleanup);

it.each(['keep', 'new'] as const)('requires an explicit %s choice', selection => {
  const choose = vi.fn();
  render(<RetakeTimeDialog onChoose={choose} onClose={vi.fn()} />);
  expect(choose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: selection === 'keep'
    ? 'Keep current date and duration' : 'Use new attempt date and duration' }));
  expect(choose).toHaveBeenCalledWith(selection);
});

it('cancels without starting an attempt and keeps keyboard focus in the dialog', () => {
  const close = vi.fn(), choose = vi.fn();
  render(<RetakeTimeDialog onChoose={choose} onClose={close} />);
  const first = screen.getByRole('button', { name: 'Keep current date and duration' });
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  expect(choose).not.toHaveBeenCalled();
});
