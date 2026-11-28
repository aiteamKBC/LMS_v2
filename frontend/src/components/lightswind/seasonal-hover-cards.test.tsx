import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SeasonalHoverCards } from './seasonal-hover-cards';

const cards = [
  { title: 'Your next action', subtitle: 'Continue assignment', description: 'Business Strategy Report', href: '/one', cta: 'Continue', status: 'Not started' },
  { title: 'Next live session', subtitle: 'Friday · 09:00', description: 'Live Teams Session', href: '/two', cta: 'Join session', status: 'Scheduled' },
  { title: 'Due soon', subtitle: 'Reflective Journal', description: 'Week 7 submission', href: '/three', cta: 'View assignment', status: 'Pending', variant: 'due' as const },
];

describe('SeasonalHoverCards', () => {
  it('keeps the date visible without expanding the card on hover', () => {
    render(<MemoryRouter><SeasonalHoverCards cards={cards} /></MemoryRouter>);
    const groups = screen.getAllByRole('group');
    fireEvent.mouseEnter(groups[1]);
    expect(groups[1]).not.toHaveStyle('--card-flex: 1.35');
    expect(screen.getByText('Live Teams Session')).toBeVisible();
  });

  it('uses focus as the keyboard alternative and preserves the actions', () => {
    render(<MemoryRouter><SeasonalHoverCards cards={cards} /></MemoryRouter>);
    const action = screen.getByRole('link', { name: 'Join session' });
    fireEvent.focus(action);
    expect(screen.getByRole('group', { name: /Next live session/ })).not.toHaveAttribute('aria-expanded');
    expect(screen.queryByRole('link', { name: /Next live session/ })).not.toBeInTheDocument();
    expect(screen.getByText('Live Teams Session')).toBeVisible();
  });

  it('supports direct external meeting links and callback actions', () => {
    const onClick = vi.fn();
    render(<MemoryRouter><SeasonalHoverCards cards={[
      { title: 'Review', subtitle: 'Progress Review', description: '28 September', href: 'https://teams.microsoft.com/l/meetup-join/review', cta: 'Attend', status: 'Scheduled' },
      { title: 'MCM', subtitle: 'Monthly Coaching', description: 'Ready to schedule', onClick, cta: 'Schedule', status: 'Ready to schedule' },
    ]} /></MemoryRouter>);
    const external = screen.getByRole('link', { name: 'Attend' });
    expect(external).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/review');
    expect(external).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: /MCM/ })).not.toBeInTheDocument();
  });
});
