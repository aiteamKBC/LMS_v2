import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import AttendanceLectureList from './components/AttendanceLectureList';
import { featuredLecture, isLectureLive, lectureJoinUrl, lectureToday } from './liveLecture';

const lecture: AttendanceLecture = {
  id: 'live', sessionId: 'teams:live', reportId: '123', date: '2026-09-14', title: 'Live lecture',
  moduleId: 'business', module: 'Business', source: 'microsoft-teams', startTime: '10:00', endTime: '11:00',
  startsAt: '2026-09-14T10:00:00+01:00', endsAt: '2026-09-14T11:00:00+01:00', joinUrl: 'https://teams.microsoft.com/l/meetup-join/live',
  durationMinutes: 60, contentSummary: '', ksbs: [], activities: [], status: 'upcoming', catchupStatus: null,
  updatedAt: null, canReportAbsence: true, absenceReport: null,
};

beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('live lecture action', () => {
  it('uses the business date across midnight and prefers a live lecture to an earlier completed one', () => {
    const now = Date.parse('2026-09-13T23:30:00Z');
    expect(lectureToday(now, 'Europe/London')).toBe('2026-09-14');
    expect(featuredLecture([lecture], now, 'Europe/London')?.id).toBe('live');
    const current = Date.parse('2026-09-14T09:30:00Z');
    expect(featuredLecture([{ ...lecture, id: 'completed', status: 'completed' }, lecture], current)?.id).toBe('live');
    expect(featuredLecture([{ ...lecture, date: '2026-09-13', status: 'absent' }], current)).toBeNull();
  });
  it('changes at the start and end without a fetch, including the grouped view', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T08:59:59Z'));
    render(<MemoryRouter><AttendanceLectureList lectures={[lecture]} moduleId="all" onModuleChange={vi.fn()}
      filter="all" onFilterChange={vi.fn()} tabs={[]} onOpen={vi.fn()} onReport={vi.fn()} onCatchup={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Open Activities' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('link', { name: 'Join session' })).toHaveAttribute('href', lecture.joinUrl);
    expect(screen.queryByRole('button', { name: 'Open Activities' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Group by month' }));
    expect(screen.getByRole('link', { name: 'Join session' })).toHaveAttribute('rel', 'noopener noreferrer');
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
    expect(screen.queryByRole('link', { name: 'Join session' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Activities' })).toBeInTheDocument();
  });

  it('uses timestamp offsets and excludes incomplete or invalid time windows', () => {
    expect(isLectureLive(lecture, Date.parse('2026-09-14T09:30:00Z'))).toBe(true);
    expect(isLectureLive(lecture, Date.parse('2026-09-14T10:00:00Z'))).toBe(false);
    expect(isLectureLive({ ...lecture, endsAt: null }, Date.parse('2026-09-14T09:30:00Z'))).toBe(false);
    expect(isLectureLive({ ...lecture, endsAt: lecture.startsAt }, Date.parse('2026-09-14T09:00:00Z'))).toBe(false);
  });

  it('does not turn an unsafe or missing meeting URL into a link', () => {
    expect(lectureJoinUrl({ ...lecture, joinUrl: 'javascript:alert(1)' })).toBeNull();
    expect(lectureJoinUrl({ ...lecture, joinUrl: '' })).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T09:30:00Z'));
    render(<MemoryRouter><AttendanceLectureList lectures={[{ ...lecture, joinUrl: '' }]} moduleId="all" onModuleChange={vi.fn()}
      filter="all" onFilterChange={vi.fn()} tabs={[]} onOpen={vi.fn()} onReport={vi.fn()} onCatchup={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Join session' })).toBeDisabled();
    expect(screen.getByText('Joining link not available yet')).toBeInTheDocument();
  });
});
