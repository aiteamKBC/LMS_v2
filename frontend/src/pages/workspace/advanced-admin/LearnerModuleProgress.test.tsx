import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advancedAdminMonthlyLogs } from '@/api/advancedAdmin';
import type { AdvancedAdminLearner, AdvancedAdminModuleProgress } from '@/api/advancedAdmin';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import LearnerModuleProgress from './LearnerModuleProgress';
import { buildModuleViews, defaultModuleId, type ModuleView } from './moduleProgressModel';

vi.mock('@/api/advancedAdmin', () => ({ advancedAdminMonthlyLogs: vi.fn() }));

const learner = { id: 1, name: 'Example Learner', programme: 'Project Control', programmeCode: 'PCP',
  programmeStatus: 'Active', cohort: 'October 2026', group: 'G1', coach: 'Coach', lmsLinked: true,
  email: 'example@example.invalid', enrolmentId: 22 } as AdvancedAdminLearner;
const learning = {
  current: { id: '22', modules: [], components: [], quizAttempts: [], activityFeed: [] } as unknown as LearnerDetail,
  historical: { activities: [{ activity_id: 'old-1', source_activity_id: 1, group_id: 9, group_name: 'Historical Module',
    date: '2026-10-01', category: 'reading', activity: 'Read lesson', status: 'completed', completed: true,
    actual: 1, planned: 2, planned_hours_mapped: true, hours_mapped: true, quiz_score: null,
    quiz_maximum_score: null, section_title: 'Week 01' }, { activity_id: 'old-2', source_activity_id: 2, group_id: 9,
    group_name: 'Historical Module', date: null, category: 'reading', activity: 'Unread lesson', status: 'not_started',
    completed: false, actual: 0, planned: 2, planned_hours_mapped: true, hours_mapped: true, quiz_score: null,
    quiz_maximum_score: null, section_title: 'Week 01' }],
    subjects: [{ id: 9, name: 'Historical Module', catalogue_count: 2, accepted_hours: 1 }],
  } as StudentActivityResponse,
};
const progress = { modules: [], moduleLinks: {}, moduleProgress: {}, actual: [], actualAvailable: true,
  sessions: [], months: { '2026-10': { label: 'October 2026', topics: [], planned: 40, source: 'ssot' } },
  programmeStartDate: '2026-10-01', programmeEndDate: '2026-10-31',
  targetAsOfToday: 20 } as AdvancedAdminModuleProgress;

describe('Advanced Admin module progress', () => {
  beforeEach(() => {
    vi.mocked(advancedAdminMonthlyLogs).mockResolvedValue({ months: [
      { month: '2026-10', status: 'needs_review', row_count: 2, planned_hours: 40,
        actual_hours: 12, not_accepted_hours: 3, training_plan_target: 40,
        student_signature: null, coach_signature: null },
    ], totalMonths: 1, completedMonths: 0,
    trainingPlanTotals: { accepted_hours: 12, planned_hours: 40 } });
  });

  it('uses recorded legacy completion and hours without inventing KSB or planned OTH values', () => {
    const modules = buildModuleViews(learning, progress);
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ done: 1, total: 2, hoursActual: 1, hoursPlanned: null,
      ksbDone: null, ksbTotal: null });
  });

  it('shows the learner-wide monthly hours chart in place of the activity type breakdown', async () => {
    const open = vi.fn();
    render(<MemoryRouter><LearnerModuleProgress learner={learner} learning={learning} progress={progress} onOpenActivity={open} /></MemoryRouter>);
    expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue('legacy:9');
    expect(screen.getByText('Weekly Activity Breakdown')).toBeVisible();
    expect(screen.queryByText('Points')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'KSBs' })).not.toBeInTheDocument();
    expect(screen.queryByText('Unread lesson')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not Started' })).not.toBeInTheDocument();
    expect(screen.getAllByText('50%', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.queryByText('Lectures & attendance')).not.toBeInTheDocument();
    expect(screen.queryByText(/KBC lectures without a unique module match/)).not.toBeInTheDocument();
    const chart = await screen.findByRole('region', { name: 'Off-the-job hours by month' });
    expect(screen.queryByRole('region', { name: 'Activity Type Breakdown' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Progress Overview' }).nextElementSibling).toContainElement(chart);
    expect(screen.getByRole('button', { name: 'October 2026: target 40 hours, submitted 3 hours, completed 12 hours' })).toBeVisible();
    expect(chart).toHaveTextContent('12h completed');
    expect(chart).toHaveTextContent('3h submitted');
    expect(chart).toHaveTextContent('Oct');
    expect(screen.getByRole('progressbar', { name: 'Overall off-the-job hours progress' })).toHaveAttribute('aria-valuenow', '30');
    expect(chart).toHaveTextContent('-40% (-8h)');
    expect(advancedAdminMonthlyLogs).toHaveBeenCalledWith(learner.id, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
    expect(open).toHaveBeenCalledWith('legacy:9', 'old-1');
  });

  it('reports monthly hours source failure without showing fabricated zeroes', async () => {
    vi.mocked(advancedAdminMonthlyLogs).mockRejectedValueOnce(new Error('Source unavailable'));
    render(<MemoryRouter><LearnerModuleProgress learner={learner} learning={learning} progress={progress} onOpenActivity={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Off-the-job hours unavailable'));
    expect(screen.queryByRole('region', { name: 'Off-the-job hours by month' })).not.toBeInTheDocument();
  });

  it('prefers the latest recorded activity among in-progress modules', () => {
    const modules = [
      { subject: { id: 'current:a', title: 'Earlier module' }, moduleId: 'a', done: 2, total: 4, lastActivity: '2026-08-01T10:00:00Z' },
      { subject: { id: 'current:b', title: 'Latest module' }, moduleId: 'b', done: 1, total: 3, lastActivity: '2026-09-01T10:00:00Z' },
    ] as ModuleView[];
    expect(defaultModuleId(modules, progress)).toBe('current:b');
  });

  it('does not bring back a stale WordPress module from the stored curriculum', () => {
    const stale = {
      ...learning,
      historical: {
        ...learning.historical,
        subjects: [...(learning.historical.subjects || []),
          { id: 99, name: 'Stale WordPress course', module_id: 'stale-module' }],
      },
    };
    const stored = { ...progress, modules: [
      { id: 'stale-module', title: 'Stale WordPress course' },
    ] } as AdvancedAdminModuleProgress;
    const live = [{ id: 9, title: 'Historical Module', completedActivities: 1, startedActivities: 1,
      activities: [
        { id: 1, title: 'Read lesson', type: 'reading', completed: true, started: true },
        { id: 2, title: 'Unread lesson', type: 'reading', completed: false, started: false },
      ] }];
    expect(buildModuleViews(stale, stored, live).map(module => module.subject.id)).toEqual(['legacy:9']);
  });
});
