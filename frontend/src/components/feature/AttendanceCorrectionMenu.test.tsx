import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttendanceCorrectionMenu } from './AttendanceCorrectionMenu';

afterEach(cleanup);
describe('attendance correction menu', () => {
  it('offers present and absent, with reset disabled before a correction exists', () => {
    const save = vi.fn();
    render(<AttendanceCorrectionMenu learnerName="Test learner" onAction={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit attendance for Test learner' }));
    expect(screen.getByRole('button', { name: /Reset manual correction/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Mark present/ }));
    expect(save).toHaveBeenCalledWith('present');
    fireEvent.click(screen.getByRole('button', { name: 'Edit attendance for Test learner' }));
    fireEvent.click(screen.getByRole('button', { name: /Mark absent/ }));
    expect(save).toHaveBeenLastCalledWith('absent');
  });
  it('requires explicit confirmation to reset and permits cancellation', () => {
    const save = vi.fn();
    render(<AttendanceCorrectionMenu learnerName="Test learner" manualStatus="present" onAction={save} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit attendance/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reset manual correction/ }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Edit attendance/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reset manual correction/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(save).toHaveBeenCalledWith('reset');
  });
  it('closes with Escape and prevents duplicate saves while busy', () => {
    const save = vi.fn();
    const { rerender } = render(<AttendanceCorrectionMenu learnerName="Test learner" onAction={save} />);
    const button = screen.getByRole('button', { name: /Edit attendance/ });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('button', { name: /Mark absent/ }), { key: 'Escape' });
    expect(button).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Mark absent/ })).not.toBeInTheDocument();
    rerender(<AttendanceCorrectionMenu learnerName="Test learner" onAction={save} saving />);
    expect(button).toBeDisabled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });
});
