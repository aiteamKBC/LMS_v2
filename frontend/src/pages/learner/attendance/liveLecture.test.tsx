import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import type { PlanModule } from '@/api/trainingPlanDashboard';
import AttendanceLectureList from './components/AttendanceLectureList';
import FeaturedLecture from './components/FeaturedLecture';
import { featuredLecture, isLectureJoinable, isLectureLive, lectureJoinUrl, lectureToday, useLectureClock } from './liveLecture';

const lecture: AttendanceLecture = {
  id: 'live', sessionId: 'teams:live', reportId: '123', date: '2026-09-14', title: 'Live lecture',
  moduleId: 'business', module: 'Business', source: 'microsoft-teams', startTime: '10:00', endTime: '11:00',
  startsAt: '2026-09-14T10:00:00+01:00', endsAt: '2026-09-14T11:00:00+01:00', joinUrl: 'https://teams.microsoft.com/l/meetup-join/live',
  componentHref: '/learner/component/apprenticeship/12/live-week-one',
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
    expect(featuredLecture([{ ...lecture, date: '2026-09-06', status: 'absent', startsAt: null, endsAt: null }], current)).toBeNull();
  });
  it('offers Join from 15 minutes before the start until the end without a fetch, including the grouped view', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T08:44:59Z'));
    render(<MemoryRouter><AttendanceLectureList lectures={[lecture]} moduleId="all" onModuleChange={vi.fn()}
      filter="all" onFilterChange={vi.fn()} tabs={[]} onOpen={vi.fn()} onReport={vi.fn()} onCatchup={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Open Activities' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('link', { name: 'Join session' })).toHaveAttribute('href', lecture.joinUrl);
    expect(screen.queryByRole('button', { name: 'Open Activities' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Group by month' }));
    expect(screen.getByRole('link', { name: 'Join session' })).toHaveAttribute('rel', 'noopener noreferrer');
    act(() => { vi.advanceTimersByTime(75 * 60 * 1000); });
    expect(screen.queryByRole('link', { name: 'Join session' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Activities' })).toBeInTheDocument();
  });

  it('shares one join window between the list and the featured lecture', () => {
    expect(isLectureJoinable(lecture, Date.parse('2026-09-14T08:44:59Z'))).toBe(false);
    expect(isLectureJoinable(lecture, Date.parse('2026-09-14T08:45:00Z'))).toBe(true);
    expect(isLectureJoinable(lecture, Date.parse('2026-09-14T09:59:59Z'))).toBe(true);
    expect(isLectureJoinable(lecture, Date.parse('2026-09-14T10:00:00Z'))).toBe(false);
    expect(isLectureJoinable({ ...lecture, endsAt: lecture.startsAt }, Date.parse('2026-09-14T08:50:00Z'))).toBe(false);
    expect(isLectureJoinable({ ...lecture, startsAt: null }, Date.parse('2026-09-14T09:30:00Z'))).toBe(false);
    const teams = { ...lecture, joinUrl: '/learner_api/session-results/apprenticeship/12/S/sessions/1/join/' };
    const featured = (now: string) => render(<MemoryRouter><FeaturedLecture lecture={teams} now={Date.parse(now)} timeZone="Europe/London"
      error="" notice="" /></MemoryRouter>);
    featured('2026-09-14T08:00:00Z');
    expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
    cleanup();
    featured('2026-09-14T08:50:00Z');
    expect(screen.getByRole('link', { name: 'Join meeting' })).toHaveAttribute('href', teams.joinUrl);
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

  it.each(['kbc-attendance', 'microsoft-teams'] as const)('keeps one component link before and after a %s lecture', source => {
    const session = { ...lecture, source };
    const show = (now: string) => render(<MemoryRouter><FeaturedLecture lecture={session} now={Date.parse(now)}
      error="" notice="" /></MemoryRouter>);
    show('2026-09-14T08:00:00Z');
    expect(screen.getByRole('link', { name: 'View session' })).toHaveAttribute('href', lecture.componentHref);
    expect(screen.queryByRole('button', { name: 'Attend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report Absence' })).not.toBeInTheDocument();
    cleanup();
    show('2026-09-14T09:30:00Z');
    expect(screen.getByRole('link', { name: 'Join meeting' })).toHaveAttribute('href', lecture.joinUrl);
    cleanup();
    show('2026-09-16T12:00:00Z');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'View session' })).toHaveAttribute('href', lecture.componentHref);
    expect(screen.getByText('Session ended')).toBeInTheDocument();
    expect(screen.getByText(/recording when published/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Join|View recording/ })).not.toBeInTheDocument();
  });

  it('withholds direct Join when timing or a safe link is unavailable', () => {
    for (const session of [{ ...lecture, startsAt: null, endsAt: null }, { ...lecture, joinUrl: 'javascript:alert(1)' }]) {
      render(<MemoryRouter><FeaturedLecture lecture={session} now={Date.parse('2026-09-14T09:30:00Z')} error="" notice="" /></MemoryRouter>);
      expect(screen.getByRole('link', { name: 'View session' })).toHaveAttribute('href', lecture.componentHref);
      expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('featured training week', () => {
  const moduleId = 'native:business';
  const first = { ...lecture, moduleId, id: 'week-one', weekId: 'authored-one', date: '2026-09-17',
    startsAt: '2026-09-17T10:00:00+01:00', endsAt: '2026-09-17T11:00:00+01:00',
    joinUrl: '/learner_api/session-results/apprenticeship/12/series/sessions/1/join/' };
  const next = { ...first, id: 'week-two', weekId: 'authored-two', date: '2026-09-24',
    startsAt: '2026-09-24T10:00:00+01:00', endsAt: '2026-09-24T11:00:00+01:00',
    joinUrl: '/learner_api/session-results/apprenticeship/12/series/sessions/2/join/',
    componentHref: '/learner/component/apprenticeship/12/live-week-two' };
  const modules: Pick<PlanModule, 'id' | 'curriculumSlots'>[] = [{ id: 'business', curriculumSlots: [first, next].map((row, index) => ({
    slotNumber: index + 1, weekId: row.weekId, date: row.date, day: 'Thursday', type: 'live-session', sessionNumber: index + 1, holidays: [],
  })) }];

  it('retains the finished lecture across Monday until its next training week starts in the business zone', () => {
    const rows = [{ ...first, status: 'completed' as const }, next];
    expect(featuredLecture(rows, Date.parse('2026-09-21T12:00:00Z'), 'Europe/London', modules)?.id).toBe(first.id);
    expect(featuredLecture(rows, Date.parse('2026-09-23T22:59:59Z'), 'Europe/London', modules)?.id).toBe(first.id);
    expect(featuredLecture(rows, Date.parse('2026-09-23T23:00:00Z'), 'Europe/London', modules)?.id).toBe(next.id);
  });

  it('prioritizes live, then the next lecture within the authored week, then its last finished lecture', () => {
    const extra = { ...first, id: 'extra', date: '2026-09-19', startsAt: '2026-09-19T10:00:00+01:00', endsAt: '2026-09-19T11:00:00+01:00' };
    const rows = [next, extra, first];
    expect(featuredLecture(rows, Date.parse('2026-09-17T09:30:00Z'), undefined, modules)?.id).toBe(first.id);
    expect(featuredLecture(rows, Date.parse('2026-09-18T12:00:00Z'), undefined, modules)?.id).toBe(extra.id);
    expect(featuredLecture(rows, Date.parse('2026-09-20T12:00:00Z'), undefined, modules)?.id).toBe(extra.id);
    expect(rows.map(row => row.id)).toEqual([next.id, extra.id, first.id]);
  });

  it.each([
    { name: 'later', actual: '2026-11-09', nextActual: '2026-11-16', current: '2026-11-15' },
    { name: 'earlier', actual: '2026-11-05', nextActual: '2026-11-13', current: '2026-11-08' },
    { name: 'before the next moved week', actual: '2026-11-09', nextActual: '2026-11-12', current: '2026-11-11' },
  ])('anchors a rescheduled $name occurrence to its actual date and next actual delivery', ({ actual, nextActual, current }) => {
    const moved = { ...first, date: actual, startsAt: `${actual}T10:00:00Z`, endsAt: `${actual}T11:00:00Z` };
    const following = { ...next, date: nextActual, startsAt: `${nextActual}T10:00:00Z`, endsAt: `${nextActual}T11:00:00Z` };
    const plans = [{ ...modules[0], curriculumSlots: modules[0].curriculumSlots!.map((slot, index) => ({
      ...slot, date: index === 0 ? '2026-11-06' : '2026-11-13',
    })) }];
    const before = structuredClone(plans);
    expect(featuredLecture([moved, following], Date.parse(`${current}T12:00:00Z`), undefined, plans)?.id).toBe(moved.id);
    expect(featuredLecture([moved, following], Date.parse(`${nextActual}T00:00:00Z`), undefined, plans)?.id).toBe(following.id);
    expect(plans).toEqual(before);
  });

  it('keeps module week windows separate and excludes cancelled and expired lectures', () => {
    const other = { ...first, id: 'other', moduleId: 'native:other', date: '2026-09-20', startsAt: null, endsAt: null };
    const plans = [...modules, { id: 'other', curriculumSlots: [{ ...modules[0].curriculumSlots![0], date: '2026-09-20' }] }];
    const now = Date.parse('2026-09-18T12:00:00Z');
    expect(featuredLecture([first, other], now, undefined, plans)?.id).toBe(first.id);
    expect(featuredLecture([{ ...first, status: 'cancelled' }, other], now, undefined, plans)?.id).toBe(other.id);
    expect(featuredLecture([first, { ...next, status: 'cancelled' }], Date.parse('2026-09-24T12:00:00Z'), undefined, modules)).toBeNull();
  });

  it('does not stretch a delivered week over a reading week or a schedule gap', () => {
    const plans = [{ ...modules[0], curriculumSlots: [modules[0].curriculumSlots![0], {
      ...modules[0].curriculumSlots![1], type: 'reading-week' as const, sessionNumber: null,
    }] }];
    expect(featuredLecture([first], Date.parse('2026-09-24T12:00:00Z'), undefined, plans)).toBeNull();
    expect(featuredLecture([first], Date.parse('2026-09-28T12:00:00Z'), undefined, modules)).toBeNull();
    expect(featuredLecture([first], Date.parse('2026-09-21T12:00:00Z'))?.id).toBe(first.id);
    expect(featuredLecture([first], Date.parse('2026-09-24T12:00:00Z'))).toBeNull();
  });

  it('rolls the displayed component into the next training week while the page stays open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T22:59:59Z'));
    const rows = [first, next];
    function WeeklyCard() {
      const now = useLectureClock(rows);
      return <FeaturedLecture lecture={featuredLecture(rows, now, 'Europe/London', modules)} now={now} error="" notice="" />;
    }
    render(<MemoryRouter><WeeklyCard /></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: first.title })).getByRole('link', { name: 'View session' }))
      .toHaveAttribute('href', first.componentHref);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('link', { name: 'View session' })).toHaveAttribute('href', next.componentHref);
    expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument();
  });
});
