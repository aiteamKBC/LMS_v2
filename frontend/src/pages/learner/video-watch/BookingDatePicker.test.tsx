import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingDatePicker } from './BookingDatePicker';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows the full calendar above a date field near the bottom of the viewport', () => {
  const originalRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('aria-label') === 'Date') return { top: 600, bottom: 644, left: 80, right: 330, width: 250, height: 44 } as DOMRect;
    if (this.getAttribute('aria-label') === 'Booking calendar') return { top: 0, bottom: 340, left: 0, right: 320, width: 320, height: 340 } as DOMRect;
    return originalRect.call(this);
  });
  const onChange = vi.fn();
  render(<div className="h-40 overflow-y-auto"><BookingDatePicker value="" onChange={onChange} dates={['2026-11-30']} /></div>);
  fireEvent.click(screen.getByRole('button', { name: 'Date' }));
  const calendar = screen.getByRole('group', { name: 'Booking calendar' });
  expect(calendar).toHaveClass('fixed');
  expect(Number.parseInt(calendar.style.top, 10)).toBeLessThan(600);
  expect(Number.parseInt(calendar.style.top, 10) + 340).toBeLessThanOrEqual(window.innerHeight);
  fireEvent.click(screen.getByRole('button', { name: '2026-11-30' }));
  expect(onChange).toHaveBeenCalledWith('2026-11-30');
  expect(screen.queryByRole('group', { name: 'Booking calendar' })).not.toBeInTheDocument();
});

it('closes only the calendar on Escape and returns focus to the date field', () => {
  const onParentKeyDown = vi.fn();
  render(<div onKeyDown={onParentKeyDown}><BookingDatePicker value="" onChange={vi.fn()} dates={['2026-11-30']} /></div>);
  fireEvent.click(screen.getByRole('button', { name: 'Date' }));
  fireEvent.keyDown(screen.getByRole('group', { name: 'Booking calendar' }), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Booking calendar' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Date' })).toHaveFocus();
  expect(onParentKeyDown).not.toHaveBeenCalled();
});
