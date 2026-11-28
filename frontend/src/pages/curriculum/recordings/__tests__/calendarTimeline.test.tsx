import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CalendarTimeline from '../components/CalendarTimeline';
import type { Lecture } from '../types';

const lecture: Lecture = { id: 'A', moduleId: 'M', title: 'First lecture', date: '2026-10-15', startTime: '11:00', endTime: '13:00',
  programme: 'Level 4', cohort: 'October', group: 'Group A', module: 'Data', week: 1, weekTitle: '', archived: false,
  programmeActive: true, status: 'unsynced', recordings: [] };

describe('Hourly recordings calendar', () => {
  it('spreads overlapping meetings without hiding either event and selects the original occurrence', () => {
    const select = vi.fn();
    const second = { ...lecture, id: 'B', title: 'Second lecture', startTime: '12:00', endTime: '14:00' };
    render(<CalendarTimeline startDate={lecture.date} endDate={lecture.date} lectures={[lecture, second]} selectedLectureId={null}
      onSelectLecture={select} expanded={false} emptyMessage="No sessions" />);
    const firstButton = screen.getByRole('button', { name: /First lecture/ });
    const secondButton = screen.getByRole('button', { name: /Second lecture/ });
    expect(firstButton.style.left).not.toBe(secondButton.style.left);
    expect(firstButton.style.top).toBe('704px');
    expect(secondButton.style.top).toBe('768px');
    fireEvent.click(secondButton);
    expect(select).toHaveBeenCalledWith(second);
    expect(screen.getByRole('region', { name: 'Hourly lecture calendar' }).scrollTop).toBe(640);
  });

  it('retains early and overnight sessions and clips the overnight block at midnight', () => {
    const overnight = { ...lecture, id: 'NIGHT', title: 'Overnight lecture', startTime: '23:00', endTime: '01:00' };
    const early = { ...lecture, id: 'EARLY', title: 'Early lecture', startTime: '00:15', endTime: '01:00' };
    const select = vi.fn();
    render(<CalendarTimeline startDate={lecture.date} endDate="2026-10-16" lectures={[overnight, early]} selectedLectureId={null}
      onSelectLecture={select} expanded emptyMessage="No sessions" />);
    const button = screen.getByRole('button', { name: /Overnight lecture/ });
    expect(button.style.top).toBe('1472px');
    expect(button.style.height).toBe('64px');
    expect(screen.getByRole('button', { name: /Early lecture/ }).style.top).toBe('16px');
    expect(screen.getByRole('region', { name: 'Lectures on 2026-10-16' })).toBeInTheDocument();
    fireEvent.click(button);
    expect(select).toHaveBeenCalledWith(overnight);
    expect(select.mock.calls[0][0].endTime).toBe('01:00');
  });
});
