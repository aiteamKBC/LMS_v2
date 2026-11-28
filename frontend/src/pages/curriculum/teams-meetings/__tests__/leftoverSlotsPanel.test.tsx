import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeftoverSlotsPanel } from '../LeftoverSlotsPanel';

// A slot on Teams that the module plan does not hold is only ever reported.
// The one way it reaches Microsoft's cancellation is its own Cancel button.
describe('LeftoverSlotsPanel', () => {
  const slots = [
    { kind: 'occurrence' as const, eventId: 'instance-extra', startDateTimeUtc: '2026-09-14T10:00:00Z' },
    { kind: 'series' as const, eventId: 'thursday-series', day: 'Thursday' },
  ];

  it('lists each slot and cancels nothing until its own button is pressed', () => {
    const onCancel = vi.fn();
    render(<LeftoverSlotsPanel slots={slots} cancelling="" disabled={false} onCancel={onCancel} />);

    expect(screen.getByText('On Teams, but not a session of this module')).toBeTruthy();
    expect(screen.getByText('The whole Thursday Teams series')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /Cancel on Teams/ })[1]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(slots[1]);
  });

  it('renders nothing when Teams holds no extra slot', () => {
    const { container } = render(<LeftoverSlotsPanel slots={[]} cancelling="" disabled={false} onCancel={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('locks every Cancel while one is under way', () => {
    render(<LeftoverSlotsPanel slots={slots} cancelling="instance-extra" disabled={false} onCancel={vi.fn()} />);
    for (const button of screen.getAllByRole('button', { name: /Cancel on Teams/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
