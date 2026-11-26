import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ProgressMetric } from '@/api/learnerMetrics';
import { SubjectCard, type Subject } from './SubjectWorkspace';

afterEach(cleanup);

const subject: Subject = { id: 'current:M1', title: 'Synthetic subject', source: 'current', activities: [],
  card: { activityCount: 4, completedActivityCount: 2, progress: 50, status: 'In progress', finalTestPassed: false } };

function card(metric: ProgressMetric | null, onOpen = vi.fn()) {
  return <MemoryRouter><SubjectCard subject={subject} ksbProgress={metric} onOpen={onOpen}
    template={null} csrfToken="" planModule={{ id: 'M1', title: subject.title, total_otjh: 10,
      start_date: null, end_date: null, tutor_name: null }}
    moduleProgress={{ hours: { actual: 2 } }} /></MemoryRouter>;
}

describe('My Learning subject KSB progress', () => {
  it('replaces completed component counts with KSB percentage and preserves hours and opening', () => {
    const onOpen = vi.fn();
    render(card({ completed: 3, total: 4, percent: 75, status: 'ready' }, onOpen));
    expect(screen.getByText('KSBs achieved')).toBeVisible();
    expect(screen.getByText('75%')).toBeVisible();
    expect(screen.queryByText('2 of 4 completed')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: /activities progress/ })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Synthetic subject KSBs achieved' })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByRole('progressbar', { name: 'Synthetic subject hours progress' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByText('In progress')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Open subject/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each([0, 100])('displays a genuine %s%% KSB achievement', percent => {
    render(card({ completed: percent ? 4 : 0, total: 4, percent, status: 'ready' }));
    expect(screen.getByRole('progressbar', { name: /KSBs achieved/ })).toHaveAttribute('aria-valuenow', String(percent));
  });

  it.each([null, { completed: null, total: null, percent: null, status: 'unavailable' },
    { completed: 1, total: 1, percent: 101, status: 'ready' }] as (ProgressMetric | null)[])('keeps missing or invalid KSB data separate from zero progress (%j)', metric => {
    render(card(metric));
    expect(screen.getByText('KSB progress unavailable')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /KSBs achieved/ })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('explains an empty KSB mapping instead of claiming zero achievement', () => {
    render(card({ completed: 0, total: 0, percent: null, status: 'empty' }));
    expect(screen.getByText('No KSBs mapped')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /KSBs achieved/ })).not.toHaveAttribute('aria-valuenow');
  });

  it.each([null, { completed: 3, total: 4, percent: 75, status: 'ready' }] as (ProgressMetric | null)[])(
    'keeps verified previous learning visible separately from KSB achievement (%j)', metric => {
      const onOpen = vi.fn();
      render(<MemoryRouter><SubjectCard subject={{ ...subject, id: 'legacy:50', source: 'legacy', acceptedHours: 2 }}
        ksbProgress={metric} onOpen={onOpen} template={null} csrfToken="" /></MemoryRouter>);
      expect(screen.getByText('2 of 4 completed')).toBeVisible();
      expect(screen.getByRole('progressbar', { name: 'Synthetic subject previous learning activities progress' }))
        .toHaveAttribute('aria-valuenow', '50');
      const ksb = screen.getByRole('progressbar', { name: 'Synthetic subject KSBs achieved' });
      if (metric) expect(ksb).toHaveAttribute('aria-valuenow', '75');
      else {
        expect(ksb).not.toHaveAttribute('aria-valuenow');
        expect(screen.getByText('KSB progress unavailable')).toBeVisible();
      }
      expect(screen.getByText('Completed 2h')).toBeVisible();
      expect(screen.getByText('Planned Unavailable')).toBeVisible();
      expect(screen.getByText('Review only')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: /Open subject/ }));
      expect(onOpen).toHaveBeenCalledOnce();
    });
});
