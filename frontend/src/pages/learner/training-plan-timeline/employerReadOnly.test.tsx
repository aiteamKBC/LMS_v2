import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { buildPlanModules } from './model';
import { ModuleTimeline } from './ModuleTimeline';
import { ModuleOverview } from './ModuleOverview';

// The employer portal renders the learner's timeline and module overview
// read-only. These pin the two switches it relies on, and that the learner's
// own defaults are unchanged.

const review = { id: 'r1', eventKey: 'evt-1', title: 'Progress review', source: 'progress-review', status: 'scheduled',
  date: '2026-09-20', scheduledDate: '2026-09-20' } as unknown as TrainingPlanDashboard['reviews'][number];
const data: TrainingPlanDashboard = { months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [],
  reviews: [review], coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '' };
const subjects = [{ id: 'current:1', title: 'Aya Modual', source: 'current' as const, activities: [] }];
const modules = buildPlanModules(subjects, data).map(module => ({ ...module, start: '2026-08-03', end: '2026-10-09',
  ksbCodes: ['K1', 'S2'], activityCounts: { video: 3 } }));

function timeline(canOpenCalendar?: boolean) {
  return render(<MemoryRouter><ModuleTimeline data={data} modules={modules} kind="commercial" learnerId="101" today="2026-09-12"
    selectedMonth="2026-09" canOpenActivities={false} canOpenCalendar={canOpenCalendar}
    onMonthChange={vi.fn()} onModuleSelect={vi.fn()} /></MemoryRouter>);
}

function overview(simple?: boolean) {
  return render(<MemoryRouter><ModuleOverview module={modules[0]} hasModules coachName="Test coach" href=""
    canOpenActivities={false} simple={simple} /></MemoryRouter>);
}

afterEach(cleanup);

describe('employer read-only timeline', () => {
  it('links review markers to the learner calendar by default', () => {
    timeline();
    expect(screen.getByRole('link', { name: /Progress review on/ })).toHaveAttribute('href', expect.stringContaining('/learner/calendar'));
  });

  it('shows review markers without a calendar link when the viewer cannot open it', () => {
    timeline(false);
    expect(screen.getByRole('img', { name: /Progress review on/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Progress review on/ })).not.toBeInTheDocument();
  });
});

describe('simple module overview', () => {
  it('keeps the full overview by default', () => {
    overview();
    expect(screen.getByText('Teaching weeks')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Learning activities/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Knowledge, skills/ })).toBeInTheDocument();
  });

  it('shows only dates, staff, hours and progress', () => {
    overview(true);
    for (const label of ['Start date', 'Planned end', 'Coach', 'Tutor', 'Planned OTJH', 'Hours recorded', 'Activity progress']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Aya Modual' })).toBeInTheDocument();
    expect(screen.queryByText('Teaching weeks')).not.toBeInTheDocument();
    expect(screen.queryByText('Weekly timetable')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Module schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Learning activities/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Knowledge, skills/ })).not.toBeInTheDocument();
  });
});
