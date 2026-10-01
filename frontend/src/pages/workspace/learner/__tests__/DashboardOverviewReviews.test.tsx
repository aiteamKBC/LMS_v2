import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { DashboardTabsProps } from '../DashboardTabs';
import DashboardOverviewTab from '../tabs/DashboardOverviewTab';

vi.mock('../DashboardTrainingPlan', () => ({ DashboardTrainingPlan: () => null }));

const reviews = [
  { eventKey: 'mcm-1', source: 'mcr', status: 'completed' },
  { eventKey: 'pr-1', source: 'progress-review', status: 'scheduled' },
  { eventKey: 'pr-2', source: 'progress-review', status: 'awaiting-signature' },
  { eventKey: 'mcm-2', source: 'mcr', status: 'completed' },
  { eventKey: 'pr-1', source: 'progress-review', status: 'scheduled' },
  { eventKey: 'support', source: 'student-support', status: 'completed' },
  { eventKey: 'cancelled', source: 'mcr', status: 'cancelled' },
] as TrainingPlanDashboard['reviews'];

const props = {
  kind: 'apprenticeship', learnerId: '125', plan: { data: { reviews } }, canSeeNavItem: () => true,
  metrics: { programmeValue: '0 / 0', programmeSummary: '', programmePercent: null, attendanceValue: '0', attendanceSummary: '',
    attendanceTotalValue: '0', attendancePercent: null, otjActualValue: '0', otjSummary: '', otjPlannedValue: '0',
    otjPercent: null, ksbValue: '0', ksbSummary: '', ksbPercent: null },
} as unknown as DashboardTabsProps;

afterEach(cleanup);

describe('dashboard programme reviews card', () => {
  it('counts MCM and Progress Reviews across the programme and opens the combined calendar', () => {
    render(<MemoryRouter><DashboardOverviewTab {...props} /></MemoryRouter>);
    const card = screen.getByRole('link', { name: 'Open Reviews' });
    expect(card).toHaveAttribute('href', '/learner/calendar/apprenticeship/125');
    expect(within(card).getByRole('img', { name: 'Reviews: 50%' })).toBeVisible();
    expect(within(card).getByText('2 / 4')).toBeVisible();
  });

  it('keeps the review total unavailable until the schedule loads', () => {
    render(<MemoryRouter><DashboardOverviewTab {...props} plan={{ data: null } as DashboardTabsProps['plan']} /></MemoryRouter>);
    const card = screen.getByRole('link', { name: 'Open Reviews' });
    expect(within(card).getByText('— / —')).toBeVisible();
  });
});
