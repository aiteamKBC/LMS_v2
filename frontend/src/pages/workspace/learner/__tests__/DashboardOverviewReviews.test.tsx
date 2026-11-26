import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { DashboardTabsProps } from '../DashboardTabs';
import DashboardOverviewTab from '../tabs/DashboardOverviewTab';

vi.mock('../DashboardTrainingPlan', () => ({ DashboardTrainingPlan: () => null }));

const reviews = [
  { eventKey: 'mcm-1', source: 'mcr', status: 'completed', targetDate: '2000-01-01' },
  { eventKey: 'pr-1', source: 'progress-review', status: 'scheduled', targetDate: '2000-02-01' },
  { eventKey: 'pr-2', source: 'progress-review', status: 'awaiting-signature', targetDate: '2999-01-01' },
  { eventKey: 'mcm-2', source: 'mcr', status: 'completed', targetDate: '2999-02-01' },
  { eventKey: 'pr-1', source: 'progress-review', status: 'scheduled', targetDate: '2000-02-01' },
  { eventKey: 'support', source: 'student-support', status: 'completed', targetDate: '2000-01-01' },
  { eventKey: 'cancelled', source: 'mcr', status: 'cancelled', targetDate: '2000-01-01' },
] as TrainingPlanDashboard['reviews'];

const props = {
  kind: 'apprenticeship', learnerId: '125', plan: { data: { reviews } }, canSeeNavItem: () => true,
  metrics: { programmeValue: '0 / 0', programmeSummary: '', programmePercent: null, attendanceValue: '0', attendanceSummary: '',
    attendanceTotalValue: '0', attendancePercent: null, otjActualValue: '0', otjSummary: '', otjTargetValue: '0',
    otjPercent: null, ksbValue: '0', ksbSummary: '', ksbPercent: null },
} as unknown as DashboardTabsProps;

afterEach(cleanup);

describe('dashboard programme reviews card', () => {
  it('does not show programme progress in the learner dashboard summary', () => {
    render(<MemoryRouter><DashboardOverviewTab {...props} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Open Programme Progress' })).not.toBeInTheDocument();
  });

  it('counts only MCM and Progress Reviews due to date and opens the combined calendar', () => {
    render(<MemoryRouter><DashboardOverviewTab {...props} /></MemoryRouter>);
    const card = screen.getByRole('link', { name: 'Open Reviews' });
    expect(card).toHaveAttribute('href', '/learner/calendar/apprenticeship/125');
    expect(within(card).getByRole('img', { name: 'Reviews: 50%' })).toBeVisible();
    expect(within(card).getByText('1 / 2')).toBeVisible();
  });

  it('keeps the review total unavailable until the schedule loads', () => {
    render(<MemoryRouter><DashboardOverviewTab {...props} plan={{ data: null } as DashboardTabsProps['plan']} /></MemoryRouter>);
    const card = screen.getByRole('link', { name: 'Open Reviews' });
    expect(within(card).getByText('— / —')).toBeVisible();
  });
});
