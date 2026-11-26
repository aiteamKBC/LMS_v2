import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TransitionDialog } from './TransitionDialog';
import type { Summary } from './api';

afterEach(cleanup);
function show(booking?: string | null) {
  const summary: Summary = {
    is_legacy: true, state: 'in_progress', can_access_lms: false, months: [],
    learner: { id: 7, aptem_id: 42, name: 'Learner', programme: 'Programme',
      coach_name: 'Assigned coach', coach_email: 'coach@example.org', coach_booking_url: booking },
  };
  render(<TransitionDialog summary={summary} checking={false} onClose={vi.fn()} onReview={vi.fn()} onRetry={vi.fn()} />);
}

it('opens the assigned coach booking in another tab and keeps email contact', () => {
  show('https://example.org/book/assigned-coach');
  const booking = screen.getByRole('link', { name: 'Book a session with Assigned coach (opens in a new tab)' });
  expect(booking).toHaveAttribute('href', 'https://example.org/book/assigned-coach');
  expect(booking).toHaveAttribute('target', '_blank');
  expect(booking).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByRole('link', { name: 'Email your coach' })).toHaveAttribute('href', 'mailto:coach%40example.org');
});

it.each([undefined, null, '', 'javascript:alert(1)', 'https://user:pass@example.org'])('keeps email fallback without a valid booking link: %s', booking => {
  show(booking);
  expect(screen.queryByRole('link', { name: /Book a session/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contact your coach' })).toHaveAttribute('href', 'mailto:coach%40example.org');
});
