import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { KsbChips, WeeklyLearningPlan } from '../WeeklyLearningPlan';

const learnerDetail = vi.hoisted(() => ({ real: {
  components: [] as { componentId: string; moduleId: string; weekId: string; component: string; type: string }[],
  videoProgress: [] as { componentId: string }[], componentProgress: [] as { componentId: string }[],
} }));

vi.mock('@/hooks/useLearnerDetailParam', () => ({
  useLearnerDetailParam: () => ({
    real: learnerDetail.real,
    loading: false,
    loadError: null,
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  learnerDetail.real.components = [];
  learnerDetail.real.videoProgress = [];
  learnerDetail.real.componentProgress = [];
});

const sessionSchedule = (attended: boolean | null): TrainingPlanDashboard => ({
  modules: [{
    id: 'M1', title: 'Marketing', description: '', start_date: '2026-09-07', end_date: '2026-09-13',
    tutor_name: '', coach_name: '', curriculumSlots: [{ slotNumber: 1, date: '2026-09-07', day: 'Monday',
      type: 'live-session', sessionNumber: 1, holidays: [], weekId: 'W1', weekTitle: 'Plan week 1' }],
  }],
  moduleLinks: { 'current:M1': { id: 'M1', title: 'Marketing' } },
  sessions: [{ id: 'S1', moduleId: 'M1', title: 'Live lecture', start: '2026-09-07T09:00:00Z',
    end: '2026-09-07T10:00:00Z', minutes: 60, status: 'scheduled',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/example', attended }],
}) as unknown as TrainingPlanDashboard;

describe('weekly live session attendance', () => {
  it('explains the session colours and the activity progress ring', () => {
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(null)} scheduleLoading={false} /></MemoryRouter>);

    const key = within(screen.getByRole('group', { name: 'Week marker key' }));
    for (const label of ['Attended', 'Not attended', 'Upcoming', 'Current week']) {
      expect(key.getByText(label)).toBeVisible();
    }
    expect(key.getByText('Outer ring shows activity progress.')).toBeVisible();
  });

  it.each([
    { at: '2026-09-07T07:59:59Z', attended: null, label: 'upcoming', state: 'current' },
    { at: '2026-09-07T10:00:00Z', attended: null, label: 'not attended', state: 'current' },
    { at: '2026-09-07T10:01:00Z', attended: false, label: 'not attended', state: 'current' },
    { at: '2026-09-07T10:01:00Z', attended: true, label: 'attended', state: 'attended' },
    { at: '2026-09-14T12:00:00Z', attended: null, label: 'not attended', state: 'missed' },
    { at: '2026-09-14T12:00:00Z', attended: true, label: 'attended', state: 'attended' },
  ])('shows $label and disables joining at $at', ({ at, attended, label, state }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at));
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(attended)} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('img', { name: `Plan week 1 session: ${label}` })).toHaveAttribute('data-state', state);
    expect(screen.getByRole('button', { name: 'Join session' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Join session' })).not.toBeInTheDocument();
  });

  it('uses purple for the current week, red for a past missed week, and gray for an upcoming week', () => {
    const schedule = sessionSchedule(null);
    schedule.modules[0].curriculumSlots?.push({ slotNumber: 2, date: '2026-09-14', day: 'Monday',
      type: 'live-session', sessionNumber: 2, holidays: [], weekId: 'W2', weekTitle: 'Plan week 2' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00Z'));
    const view = render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={schedule} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('img', { name: 'Plan week 1 session: upcoming' })).toHaveAttribute('data-state', 'current');
    expect(screen.getByRole('img', { name: 'Plan week 2 session: not scheduled' })).toHaveAttribute('data-state', 'unscheduled');

    view.unmount();
    vi.setSystemTime(new Date('2026-09-14T08:00:00Z'));
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={schedule} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('img', { name: 'Plan week 1 session: not attended' })).toHaveAttribute('data-state', 'missed');
    expect(screen.getByRole('img', { name: 'Plan week 2 session: not scheduled' })).toHaveAttribute('data-state', 'current');
  });

  it('returns the final week to the missed colour when the week ends in UK time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T22:59:30Z'));
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(null)} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('img', { name: 'Plan week 1 session: not attended' })).toHaveAttribute('data-state', 'current');
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('img', { name: 'Plan week 1 session: not attended' })).toHaveAttribute('data-state', 'missed');
  });

  it('allows joining during the session while attendance is pending', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T09:30:00Z'));
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(null)} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('img', { name: 'Plan week 1 session: in progress' })).toHaveAttribute('data-state', 'current');
    expect(screen.getByRole('link', { name: 'Join session' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/example');
  });

  it('allows joining exactly 1 hour before the session without marking it in progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T08:00:00Z'));
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(null)} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('img', { name: 'Plan week 1 session: upcoming' })).toHaveAttribute('data-state', 'current');
    expect(screen.getByRole('link', { name: 'Join session' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/example');
  });

  it('keeps the coach read-only view free of learner actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T09:30:00Z'));
    learnerDetail.real.components = [
      { componentId: 'C1', moduleId: 'M1', weekId: 'W1', component: 'First reading', type: 'reading' },
    ];

    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(null)} scheduleLoading={false} canOpenActivities={false} /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: 'Join session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Action' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    expect(screen.getByPlaceholderText('Search activities...')).toBeVisible();
  });

  it('updates the indicator and join action as the session starts and ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T07:59:30Z'));
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(null)} scheduleLoading={false} /></MemoryRouter>);

    expect(screen.getByRole('button', { name: 'Join session' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('link', { name: 'Join session' })).toBeVisible();
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(screen.getByRole('img', { name: 'Plan week 1 session: in progress' })).toBeVisible();
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(screen.getByRole('img', { name: 'Plan week 1 session: not attended' })).toHaveAttribute('data-state', 'current');
    expect(screen.getByRole('button', { name: 'Join session' })).toBeDisabled();
  });

  it('keeps the outer ring for activity progress while the centre shows attendance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T10:01:00Z'));
    learnerDetail.real.components = [
      { componentId: 'C1', moduleId: 'M1', weekId: 'W1', component: 'First reading', type: 'reading' },
      { componentId: 'C2', moduleId: 'M1', weekId: 'W1', component: 'Second reading', type: 'reading' },
    ];
    learnerDetail.real.componentProgress = [{ componentId: 'C1' }];
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(true)} scheduleLoading={false} /></MemoryRouter>);

    const indicator = screen.getByRole('img', { name: 'Plan week 1 session: attended' });
    expect(indicator).toHaveAttribute('data-state', 'attended');
    expect(indicator.querySelectorAll('circle')[1]).toHaveAttribute('stroke-dasharray', '50 100');
    expect(screen.getByRole('progressbar', { name: 'Plan week 1 activity progress' }))
      .toHaveAttribute('aria-valuenow', '50');
  });

  it('adds KSB and expected OTJH cards for the selected week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T10:01:00Z'));
    learnerDetail.real.components = [
      { componentId: 'C1', moduleId: 'M1', weekId: 'W1', component: 'First reading', type: 'reading', durationMinutes: 60, ksbCodes: ['K1', 'S2'] },
      { componentId: 'C2', moduleId: 'M1', weekId: 'W1', component: 'Second reading', type: 'reading', durationMinutes: 30, ksbCodes: ['S2', 'B1'] },
    ] as unknown as typeof learnerDetail.real.components;
    learnerDetail.real.componentProgress = [{ componentId: 'C1' }];
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125"
      schedule={sessionSchedule(true)} scheduleLoading={false} /></MemoryRouter>);

    const ksbCard = screen.getByText('KSBs this week').closest('div')!.parentElement!;
    expect(ksbCard).toHaveTextContent('66.67%');
    expect(ksbCard).toHaveTextContent('2 of 3 KSBs');
    const otjhCard = screen.getByText('OTJH this week').closest('div')!.parentElement!;
    expect(otjhCard).toHaveTextContent('66.67%');
    expect(otjhCard).toHaveTextContent('1h of 1h 30m hours');
  });
});

describe('activity KSB mapping', () => {
  it('shows only two codes in the table and reveals the remaining codes in a dialog', () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: showModal },
      close: { configurable: true, value: close },
    });
    try {
      render(<KsbChips codes={['K15', 'K2', 'S13', 'B8']} />);
      const trigger = screen.getByRole('button', { name: 'Show 2 more KSBs' });
      expect(trigger).toHaveTextContent('+2');
      expect(screen.getByText('K15')).toBeVisible();
      expect(screen.getByText('K2')).toBeVisible();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'More KSBs' });
      expect(within(dialog).getByText('S13')).toBeVisible();
      expect(within(dialog).getByText('B8')).toBeVisible();
      expect(showModal).toHaveBeenCalledOnce();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(close).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });

  it('keeps zero and two KSB mappings readable without an extra control', () => {
    const { rerender } = render(<KsbChips codes={[]} />);
    expect(screen.getByText('No KSB mapped')).toBeVisible();
    rerender(<KsbChips codes={['K1', 'S2']} />);
    expect(screen.getByText('K1')).toBeVisible();
    expect(screen.getByText('S2')).toBeVisible();
    expect(screen.queryByRole('button', { name: /more KSBs/i })).not.toBeInTheDocument();
  });
});

describe('weekly learning plan navigation', () => {
  it('shows every scheduled week in one internally scrollable list without pagination', () => {
    const schedule = {
      modules: [{
        id: 'M1', title: 'Marketing', description: '', start_date: '2026-09-07', end_date: '2026-12-13',
        tutor_name: '', coach_name: '', curriculumSlots: Array.from({ length: 14 }, (_, index) => {
          const date = new Date('2026-09-07T12:00:00Z');
          date.setUTCDate(date.getUTCDate() + index * 7);
          return { slotNumber: index + 1, date: date.toISOString().slice(0, 10), day: 'Monday', type: 'live-session' as const,
            sessionNumber: index + 1, holidays: [], weekId: `W${index + 1}`, weekTitle: `Plan week ${index + 1}` };
        }),
      }],
      moduleLinks: { 'current:M1': { id: 'M1', title: 'Marketing' } },
      sessions: [],
    } as unknown as TrainingPlanDashboard;

    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125" schedule={schedule} scheduleLoading={false} /></MemoryRouter>);

    const weeklyPlan = within(screen.getByRole('region', { name: 'Weekly learning plan' }));
    expect(weeklyPlan.getAllByRole('listitem')).toHaveLength(14);
    expect(weeklyPlan.getByText('Plan week 1')).toBeVisible();
    expect(weeklyPlan.getByText('Plan week 14')).toBeInTheDocument();
    expect(weeklyPlan.queryByRole('navigation', { name: 'weeks pagination' })).not.toBeInTheDocument();
  });
});

describe("the curriculum team's holiday hint on the dashboard weeks panel", () => {
  const NOTE = 'No live session this week. Use the workshop days to finish Assignment 2.';
  const scheduleWith = (note?: string) => ({
    modules: [{
      id: 'M1', title: 'Marketing', description: '', start_date: '2026-09-07', end_date: '2026-11-15',
      tutor_name: '', coach_name: '', curriculumSlots: Array.from({ length: 3 }, (_, index) => {
        const date = new Date('2026-09-07T12:00:00Z');
        date.setUTCDate(date.getUTCDate() + index * 7);
        return { slotNumber: index + 1, date: date.toISOString().slice(0, 10), day: 'Monday', type: 'live-session' as const,
          sessionNumber: index + 1, holidays: index === 1 ? [{ label: 'Workshop Oct', startDate: '2026-09-14', endDate: '2026-09-20' }] : [],
          weekId: `W${index + 1}`, weekTitle: `Plan week ${index + 1}`, holidayNote: index === 1 ? note : undefined };
      }),
    }],
    moduleLinks: { 'current:M1': { id: 'M1', title: 'Marketing' } },
    sessions: [],
  }) as unknown as TrainingPlanDashboard;

  it('shows it on the week it was written for and on no other', () => {
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125" schedule={scheduleWith(NOTE)} scheduleLoading={false} /></MemoryRouter>);
    const weeklyPlan = within(screen.getByRole('region', { name: 'Weekly learning plan' }));
    const railHint = weeklyPlan.getAllByTestId('learner-week-holiday-note')
      .find(hint => hint.closest('li')?.textContent?.includes('Plan week 2'));
    expect(railHint).toHaveTextContent(NOTE);
    expect(weeklyPlan.getAllByTestId('learner-week-holiday-note')
      .filter(hint => hint.closest('li')?.textContent?.includes('Plan week 1'))).toHaveLength(0);
  });

  it('shows nothing when the team published no hint for that week', () => {
    render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125" schedule={scheduleWith()} scheduleLoading={false} /></MemoryRouter>);
    const weeklyPlan = within(screen.getByRole('region', { name: 'Weekly learning plan' }));
    expect(weeklyPlan.queryByTestId('learner-week-holiday-note')).toBeNull();
  });
});
