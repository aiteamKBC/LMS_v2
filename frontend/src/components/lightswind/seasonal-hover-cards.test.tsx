import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SeasonalHoverCards } from './seasonal-hover-cards';

const cards = [
  { title: 'Your next action', subtitle: 'Continue assignment', description: 'Business Strategy Report', href: '/one', cta: 'Continue', status: 'Not started' },
  { title: 'Next live session', subtitle: 'Friday · 09:00', description: 'Live Teams Session', href: '/two', cta: 'Join session', status: 'Scheduled' },
  { title: 'Due soon', subtitle: 'Reflective Journal', description: 'Week 7 submission', href: '/three', cta: 'View assignment', status: 'Pending', variant: 'due' as const },
];

describe('SeasonalHoverCards', () => {
  it('uses compact flex expansion while revealing the lower panel on hover', () => {
    render(<MemoryRouter><SeasonalHoverCards cards={cards} /></MemoryRouter>);
    const links = screen.getAllByRole('link');
    fireEvent.mouseEnter(links[1]);
    expect(links[1]).toHaveStyle('--card-flex: 1.35');
    expect(links[0]).toHaveStyle('--card-flex: 1');
    fireEvent.mouseLeave(links[1].parentElement!);
    expect(links[1]).toHaveStyle('--card-flex: 1');
  });

  it('uses focus as the keyboard alternative and preserves the actions', () => {
    render(<MemoryRouter><SeasonalHoverCards cards={cards} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /Next live session/ });
    fireEvent.focus(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Join session')).not.toBeInTheDocument();
    expect(screen.getByText('Live Teams Session')).toBeVisible();
  });
});
