import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProgrammeReviewTimeline, { type TimelineReview } from './ProgrammeReviewTimeline';

describe('programme review timeline scrolling', () => {
  it('offers working scroll controls when later meetings are outside the visible area', () => {
    const items: TimelineReview[] = Array.from({ length: 8 }, (_, index) => ({
      id: `mcm-${index + 1}`, title: `MCM ${index + 1}`, date: `2026-${String(index + 1).padStart(2, '0')}-15`,
      status: 'planned',
    }));
    const onSelect = vi.fn();
    render(<MemoryRouter><ProgrammeReviewTimeline label="Monthly coaching" items={items} activeId="mcm-2" onSelect={onSelect} /></MemoryRouter>);
    const viewport = screen.getByRole('region', { name: 'Scroll through monthly coaching meetings' });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 1240 });
    fireEvent.resize(window);

    const previous = screen.getByRole('button', { name: 'Scroll to previous monthly coaching meetings' });
    const next = screen.getByRole('button', { name: 'Scroll to next monthly coaching meetings' });
    expect(previous).toBeDisabled();
    fireEvent.click(next);
    expect(viewport.scrollLeft).toBe(240);
    expect(previous).toBeEnabled();
    for (let index = 0; index < 3; index += 1) fireEvent.click(next);
    expect(viewport.scrollLeft).toBe(940);
    expect(next).toBeDisabled();
    const current = screen.getByRole('button', { name: 'MCM 2, 15 Feb 2026, Planned' });
    expect(current).toHaveAttribute('aria-pressed', 'true');
    expect(current.closest('[data-active]')).toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'MCM 8, 15 Aug 2026, Planned' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('mcm-8');
    expect(within(viewport).queryByText('Planned')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Timeline status colours' })).getByText('Planned')).toBeInTheDocument();
  });
});
