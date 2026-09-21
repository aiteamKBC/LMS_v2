import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { WeeklyLearningPlan } from '../WeeklyLearningPlan';

vi.mock('@/hooks/useLearnerDetailParam', () => ({
  useLearnerDetailParam: () => ({
    real: { components: [], videoProgress: [], componentProgress: [] },
    loading: false,
    loadError: null,
    refresh: vi.fn(),
  }),
}));

afterEach(cleanup);

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
