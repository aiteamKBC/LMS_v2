import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingErrorBoundary } from '../BookingErrorBoundary';

function Boom(): never {
  throw new Error('field blew up during render');
}

describe('BookingErrorBoundary', () => {
  const originalError = console.error;
  afterEach(() => { console.error = originalError; vi.restoreAllMocks(); });

  it('contains a booking-form render crash inline and keeps the rest of the page mounted', () => {
    console.error = vi.fn();
    const onClose = vi.fn();
    render(
      <div>
        <h1>Monthly Coaching Meeting</h1>
        <BookingErrorBoundary resetKey="s1" onClose={onClose}>
          <Boom />
        </BookingErrorBoundary>
      </div>,
    );

    // The surrounding page survives instead of being blanked by the route boundary.
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeVisible();
    const alert = screen.getByRole('alertdialog', { name: 'Booking could not be opened' });
    expect(alert).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders its children unchanged when nothing throws', () => {
    render(
      <BookingErrorBoundary resetKey="s1" onClose={vi.fn()}>
        <p>Choose a date and time</p>
      </BookingErrorBoundary>,
    );
    expect(screen.getByText('Choose a date and time')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
