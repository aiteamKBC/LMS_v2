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

  it('shows the meeting status on each timeline step', () => {
    const onSelect = vi.fn();
    render(<MemoryRouter><ProgrammeReviewTimeline label="Monthly coaching" showStatus items={[{
      id: 'mcm-1', title: 'MCM 1', date: '2026-10-01', status: 'in-progress',
    }]} activeId="mcm-1" onSelect={onSelect} /></MemoryRouter>);

    const timeline = screen.getByRole('region', { name: 'Monthly coaching programme timeline' });
    expect(within(timeline).getAllByText('In Progress')).toHaveLength(2);
    expect(within(timeline).getByRole('button', { name: 'MCM 1, 1 Oct 2026, In Progress' })).toBeInTheDocument();
  });

  it('scrolls the compact booking timeline vertically when more MCMs are available', () => {
    const items: TimelineReview[] = Array.from({ length: 9 }, (_, index) => ({
      id: `mcm-${index + 1}`, title: `MCM ${index + 1}`, date: null, status: 'planned',
    }));
    render(<ProgrammeReviewTimeline label="Monthly coaching" items={items} activeId="mcm-1" targetId="mcm-2" compact showStatus />);
    const viewport = screen.getByRole('region', { name: 'Scroll through monthly coaching meetings' });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 150 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 600 });
    fireEvent.resize(window);

    const previous = screen.getByRole('button', { name: 'Scroll to previous monthly coaching meetings' });
    const next = screen.getByRole('button', { name: 'Scroll to next monthly coaching meetings' });
    expect(previous).toBeDisabled();
    fireEvent.click(next);
    expect(viewport.scrollTop).toBe(120);
    expect(previous).toBeEnabled();
    for (let index = 0; index < 3; index += 1) fireEvent.click(next);
    expect(viewport.scrollTop).toBe(450);
    expect(next).toBeDisabled();
  });
});
