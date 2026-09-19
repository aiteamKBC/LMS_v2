import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { TrainingPlanDashboard, PlanReview } from '@/api/trainingPlanDashboard';
import type { PlanSubjectSummary } from '@/api/learnerOverview';
import type { Subject } from '../my-learning/SubjectWorkspace';
import { TrainingPlanDetails } from './TrainingPlanDetails';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../reviews/MeetingBookingDialog', () => ({
  default: ({ title }: { title: string }) => <div role="dialog" aria-label="Calendar booking">{title}</div>,
}));

const subjects: Subject[] = [{ id: 'legacy:10', title: 'Marketing', source: 'legacy', activities: [1, 8, 15, 22].map((day, index) => ({
  id: `A${index}`, title: `Activity ${index}`, category: 'reading', position: index, completed: index < 2,
  schedule: { date: `2026-09-${String(day).padStart(2, '0')}` },
})) }, { id: 'current:NEW', title: 'New module', source: 'current', activities: [] }];

const summarySubjects: PlanSubjectSummary[] = [{
  id: 'legacy:10', title: 'Marketing', source: 'legacy', total: 7, completed: 3,
  dates: ['2026-09-01', '2026-09-08', '2026-09-15'], moduleIds: ['M10'], sessionTitles: [],
  activityCounts: { reading: 4, assignment: 2, live_session: 1 }, ksbCodes: ['K1', 'S4'],
  ksbCodesByMonth: { '2026-09': ['K1', 'S4'] }, ksbMappingMissing: false,
  monthlyActivities: [
    { id: 'native:essay', componentId: 'essay', title: 'Professional Practice Essay', type: 'assignment', date: '2026-09-08',
      weekTitle: 'Assignment 1', expectedHours: 10, completed: false, ksbCodes: ['K1'] },
    { id: 'native:case-study', componentId: 'case-study', title: 'Case Study Analysis', type: 'assignment', date: '2026-09-15',
      weekTitle: 'Assignment 2', expectedHours: 8, completed: true, ksbCodes: ['S4'] },
    { id: 'native:lecture', componentId: 'lecture', title: 'Attended session', type: 'live_session', date: '2026-09-01',
      weekTitle: 'Week 1', expectedHours: 1, completed: true, ksbCodes: ['K1', 'S4'] },
  ],
}, { id: 'current:NEW', title: 'New module', source: 'current', total: 0, completed: 0,
  dates: [], moduleIds: ['NEW'], sessionTitles: [], activityCounts: {}, ksbCodes: [], ksbCodesByMonth: {}, ksbMappingMissing: false,
  monthlyActivities: [] }];

const review = (id: string, date: string, status = 'not-scheduled', source = 'progress-review'): PlanReview => ({
  id, eventKey: id, title: 'Progress Review', source, sequence: 1, status, date, targetDate: date,
  scheduledDate: null, scheduledTime: null, durationMinutes: 60, coachName: 'Review coach', invited: false,
});

const fixture = (): TrainingPlanDashboard => ({
  months: {
    '2026-09': { label: '', topics: ['Brand strategy'], planned: 18, source: 'contract' },
    '2026-10': { label: '', topics: ['Research'], planned: 20, source: 'contract' },
  },
  actual: [{ month: '2026-09', groupId: '10', hours: 7, count: 2 }, { month: '2026-09', groupId: null, hours: 4.5, count: 1 }],
  actualAvailable: true,
  modules: [
    { id: 'M10', title: 'Marketing', description: 'Builder description', start_date: '2026-09-01', end_date: '2026-10-31', tutor_name: 'Assigned tutor', coach_name: 'Assigned coach' },
    { id: 'NEW', title: 'New module', description: 'Just assigned', start_date: null, end_date: null, tutor_name: '', coach_name: '' },
  ],
  moduleLinks: { 'legacy:10': { id: 'M10', title: 'Marketing' }, 'current:NEW': { id: 'NEW', title: 'New module' } },
  sessions: [
    { id: 'attended', moduleId: 'M10', title: 'Attended session', start: '2026-09-01T10:00:00Z', end: '2026-09-01T11:00:00Z', minutes: 60, joinUrl: null, status: 'completed', attended: true },
    { id: 'missed', moduleId: 'M10', title: 'Missed session', start: '2026-09-08T10:00:00Z', end: null, minutes: 60, joinUrl: null, status: 'completed', attended: false },
    { id: 'next', moduleId: 'M10', title: 'Next session', start: '2026-09-15T10:00:00Z', end: null, minutes: 45, joinUrl: 'https://teams.microsoft.com/l/meetup-join/verified', status: 'scheduled', attended: null },
  ],
  reviews: [review('future', '2026-09-22'), review('overdue', '2026-09-08'), review('done', '2026-09-01', 'completed'), review('booked', '2026-09-15', 'scheduled')],
  coach: { name: 'Assigned coach', bookingUrl: 'https://outlook.office.com/book/assigned-coach' },
  contractStatus: 'ready', generatedAt: '2026-09-10T08:00:00Z',
});

function Destination() {
  const route = useLocation();
  return <output data-testid="destination">{route.pathname}{route.search}{route.hash}</output>;
}

function renderBoard(data = fixture(), planSubjects: (Subject | PlanSubjectSummary)[] = subjects, onRefresh = vi.fn()) {
  return render(<MemoryRouter initialEntries={['/plan']}><Routes>
    <Route path="/plan" element={<TrainingPlanDetails data={data} subjects={planSubjects} kind="commercial" learnerId="125"
      onRefresh={onRefresh} onRetryContract={onRefresh} />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>);
}

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T08:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe('Dashboard training plan controls', () => {
  it('renders the reference monthly layout with dynamic progress, reviews, assignments and lectures', () => {
    renderBoard(fixture(), summarySubjects);
    const panel = within(screen.getByRole('region', { name: 'Monthly study plan' }));
    for (const name of ['Progress this month', 'Reviews this month', 'Assignments this month', 'Lectures this month']) {
      expect(panel.getByRole('region', { name })).toBeVisible();
    }
    const progress = within(panel.getByRole('region', { name: 'Progress this month' }));
    expect(progress.getByText('Required hours').nextElementSibling).toHaveTextContent('18 hrs');
    expect(progress.getByText('Achieved hours').nextElementSibling).toHaveTextContent('11.5 hrs');
    expect(progress.getByText('Difference').nextElementSibling).toHaveTextContent('-6.5 hrs');
    expect(progress.getByText('K1')).toBeVisible();
    expect(progress.getByText('S4')).toBeVisible();
  });

  it('shows monthly assignments with hours, progress and their real component links', () => {
    renderBoard(fixture(), summarySubjects);
    const panel = within(screen.getByRole('region', { name: 'Assignments this month' }));
    const essay = panel.getByText('Professional Practice Essay').closest('article')!;
    expect(within(essay).getByText('Assignment 1')).toBeVisible();
    expect(within(essay).getByText('Required').parentElement).toHaveTextContent('10 hrs');
    expect(within(essay).getByLabelText('0% complete')).toBeVisible();
    expect(within(essay).getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/learner/component/commercial/125/essay?week=Assignment%201');
    const completed = panel.getByText('Case Study Analysis').closest('article')!;
    expect(within(completed).getByLabelText('100% complete')).toBeVisible();
    expect(within(completed).getByRole('link', { name: 'View' })).toBeVisible();
  });

  it('filters assignments and all summary values by the selected month', () => {
    renderBoard(fixture(), summarySubjects);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    const monthly = within(screen.getByRole('region', { name: 'Monthly study plan' }));
    expect(monthly.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(within(monthly.getByRole('region', { name: 'Assignments this month' })).getByText('No assignments found for this month.')).toBeVisible();
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-10');
  });

  it('offers Schedule and Attend from each review dynamic state', () => {
    const data = fixture();
    data.reviews = [review('book', '2026-09-12'),
      { ...review('join', '2026-09-15', 'scheduled'), meetingLink: 'https://teams.microsoft.com/l/meetup-join/review', invited: true }];
    renderBoard(data);
    const panel = within(screen.getByRole('region', { name: 'Reviews this month' }));
    fireEvent.click(panel.getByRole('button', { name: 'Schedule' }));
    expect(screen.getByRole('dialog', { name: 'Calendar booking' })).toHaveTextContent('Progress Review');
    expect(panel.getByRole('link', { name: 'Attend' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/review');
    expect(panel.getByRole('link', { name: 'Attend' })).toHaveAttribute('target', '_blank');
  });

  it('hides cancelled reviews and presents completed reviews as attended', () => {
    const data = fixture();
    data.reviews = [review('finished', '2026-09-01', 'completed'), review('cancelled', '2026-09-02', 'cancelled')];
    renderBoard(data);
    const panel = within(screen.getByRole('region', { name: 'Reviews this month' }));
    expect(panel.getAllByRole('article')).toHaveLength(1);
    expect(panel.getByText('Attended')).toBeVisible();
  });

  it('shows lecture KSB badges from the activity delivered on that date', () => {
    renderBoard(fixture(), summarySubjects);
    const panel = within(screen.getByRole('region', { name: 'Lectures this month' }));
    const lecture = panel.getByText('Attended session').closest('article')!;
    expect(within(lecture).getByText('Assigned tutor')).toBeVisible();
    expect(within(lecture).getByText('K1')).toBeVisible();
    expect(within(lecture).getByText('S4')).toBeVisible();
  });

  it('keeps month selection while selecting modules from the timeline', () => {
    renderBoard();
    fireEvent.change(screen.getByLabelText('Focus month'), { target: { value: '2026-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show Marketing overview' }));
    expect(screen.getByLabelText('Focus month')).toHaveValue('2026-12');
    expect(screen.getByRole('combobox', { name: 'Focus module' })).toHaveValue('legacy:10');
    fireEvent.click(screen.getByRole('button', { name: 'New module' }));
    expect(within(screen.getByRole('region', { name: 'Module overview' })).getByRole('heading', { name: 'New module' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Focus module' })).toHaveValue('current:NEW');
  });

  it('keeps module selection when opening and closing the full-screen timeline', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show New module overview' }));
    expect(within(screen.getByRole('complementary')).getByRole('heading', { name: 'New module' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Focus module' })).toHaveValue('current:NEW');
  });

  it('restores module plan facts and mapped KSBs from compact summaries', () => {
    const data = fixture();
    data.modules[0] = { ...data.modules[0], programme_name: 'Marketing Level 4', cohort_name: 'October 2026', group_name: 'G1',
      total_otjh: 140, weeks_number: 16, sessions_number: 16, session_week_day: 'Thursday', session_start_time: '09:00', session_end_time: '11:00',
      coach_name: 'Module coach', learning_outcomes: ['Plan a campaign', 'Measure campaign results'] };
    renderBoard(data, summarySubjects);
    const panel = within(screen.getByRole('region', { name: 'Module overview' }));
    for (const value of ['140 hours', 'Cohort: October 2026', 'Group: G1', 'Marketing Level 4', 'Module coach', 'Assigned tutor']) {
      expect(panel.getByText(value)).toBeVisible();
    }
    fireEvent.click(panel.getByText('View 2 mapped KSBs'));
    expect(panel.getByText('S4')).toBeVisible();
    fireEvent.click(panel.getByText('Learning outcomes (2)'));
    expect(panel.getByText('Measure campaign results')).toBeVisible();
  });

  it('keeps the plan read-only when activities cannot be opened', () => {
    render(<MemoryRouter><TrainingPlanDetails data={fixture()} subjects={summarySubjects} kind="commercial" learnerId="499"
      onRefresh={vi.fn()} onRetryContract={vi.fn()} canOpenActivities={false} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Monthly study plan' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Module timeline' })).toBeVisible();
    expect([...document.querySelectorAll('a')].filter(link => link.getAttribute('href')?.startsWith('/learner/modules/'))).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('supports month navigation across year boundaries', () => {
    renderBoard();
    fireEvent.change(screen.getByLabelText('Focus month'), { target: { value: '2026-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(within(screen.getByRole('region', { name: 'Monthly study plan' })).getByRole('heading', { name: 'January 2027' })).toBeVisible();
    expect(screen.getByLabelText('Focus month')).toHaveValue('2027-01');
  });

  it('opens the selected module and monthly footer for the displayed learner', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('link', { name: 'View all activities for September 2026' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/modules/commercial/125?subject=legacy%3A10');
    cleanup();
    renderBoard();
    fireEvent.change(screen.getByRole('combobox', { name: 'Focus module' }), { target: { value: 'current:NEW' } });
    fireEvent.click(within(screen.getByRole('region', { name: 'Module overview' })).getByRole('link', { name: 'Go to module' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/modules/commercial/125?subject=current%3ANEW');
  });

  it('refreshes monthly learning from the toolbar', () => {
    const refresh = vi.fn();
    renderBoard(fixture(), subjects, refresh);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh monthly learning' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
