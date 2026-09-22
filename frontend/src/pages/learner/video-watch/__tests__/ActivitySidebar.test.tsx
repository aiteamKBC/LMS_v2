import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivitySidebar } from '../ActivitySidebar';
import { componentRoute } from '../componentRoute';
import type { SidebarWeek } from '../weekPreview';
import { overviewSchedule } from '@/api/learnerOverview';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

const weeks: SidebarWeek[] = Array.from({ length: 10 }, (_, index) => ({
  key: `W${index + 1}`, week: `Week ${index + 1}`, count: 1, completed: index === 0 ? 1 : 0, active: index === 5,
  components: [{ title: `Reading: Lesson ${index + 1}`, componentId: `C${index + 1}`, type: 'reading',
    expectedOtjh: null, contentHtml: '<p>Lesson content</p>' }],
}));

function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }

afterEach(() => vi.restoreAllMocks());

describe('module activity sidebar', () => {
  it('loads month names from the matching training-plan module even when another module has the same title', async () => {
    const plan = { modules: [
      { id: 'OTHER', title: 'Leadership', start_date: '2026-01-01' },
      { id: 'M1', title: 'Leadership', start_date: '2026-08-03' },
    ] } as TrainingPlanDashboard;
    vi.spyOn(overviewSchedule, 'peek').mockReturnValue(undefined);
    const read = vi.spyOn(overviewSchedule, 'read').mockResolvedValue(plan);
    const assignedWeeks = weeks.map(week => ({ ...week, components: week.components.map(component => ({ ...component, moduleId: 'M1' })) }));
    render(<MemoryRouter><ActivitySidebar kind="commercial" id="132" weekComponents={assignedWeeks[5].components} weekTitle="Week 6"
      moduleTitle="Leadership" weeks={assignedWeeks} completedIds={new Set()} currentComponentId="C6" routeFor={c => `/activity/${c.componentId}`} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeVisible();
    expect(screen.getAllByRole('heading').map(heading => heading.textContent))
      .toEqual(['Week 6', 'Leadership', 'August 2026', 'September 2026', 'October 2026']);
    expect(read).toHaveBeenCalledWith('commercial', '132', expect.any(AbortSignal), false);
  });

  it('shows the open week above all ten weeks with a month heading for each four weeks', () => {
    render(<MemoryRouter><ActivitySidebar weekComponents={weeks[5].components} weekTitle="Week 6" moduleTitle="Leadership"
      weeks={weeks} completedIds={new Set(['C1'])} currentComponentId="C6" routeFor={c => `/activity/${c.componentId}`} /></MemoryRouter>);
    const sidebar = screen.getByRole('complementary', { name: 'Module activities' });
    expect(within(sidebar).getAllByRole('heading').map(heading => heading.textContent))
      .toEqual(['Week 6', 'Leadership', 'Month 1', 'Month 2', 'Month 3']);
    for (let number = 1; number <= 10; number++) {
      expect(within(sidebar).getByRole('button', { name: new RegExp(`^Week ${number}\\b`) })).toBeVisible();
    }
    expect(within(sidebar).getByText('Current week')).toBeVisible();
  });

  it('expands another week in place and opens its chosen activity within the same learner', () => {
    render(<MemoryRouter initialEntries={['/learner/component/commercial/132/C6']}>
      <ActivitySidebar weekComponents={weeks[5].components} weekTitle="Week 6" moduleTitle="Leadership" weeks={weeks}
        completedIds={new Set()} currentComponentId="C6" routeFor={(c, week) => componentRoute('commercial', '132', c, 'Leadership', week)} />
      <Location />
    </MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Week 9\b/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/commercial/132/C6');
    expect(screen.getByRole('button', { name: /^Week 9\b/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Lesson 9/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/commercial/132/C9');
  });
  describe("the curriculum team's published holiday hint", () => {
    const NOTE = 'No live session this week. Use the workshop days to finish Assignment 2.';
    const planWith = (slots: unknown[]) => ({ modules: [{ id: 'M1', title: 'Leadership', start_date: '2026-08-03', curriculumSlots: slots }] }) as TrainingPlanDashboard;
    const planWeeks = weeks.map((week, index) => ({
      ...week,
      weekId: `WK${index + 1}`,
      components: week.components.map(component => ({ ...component, moduleId: 'M1', weekId: `WK${index + 1}` })),
    }));
    const renderSidebar = (active: number) => render(<MemoryRouter><ActivitySidebar kind="commercial" id="132"
      weekComponents={planWeeks[active].components} weekTitle={`Week ${active + 1}`} moduleTitle="Leadership"
      weeks={planWeeks.map((week, index) => ({ ...week, active: index === active }))} completedIds={new Set()}
      currentComponentId={`C${active + 1}`} routeFor={c => `/activity/${c.componentId}`} /></MemoryRouter>);

    it('shows it against the week it was written for and no other', async () => {
      vi.spyOn(overviewSchedule, 'peek').mockReturnValue(undefined);
      vi.spyOn(overviewSchedule, 'read').mockResolvedValue(planWith([
        { slotNumber: 3, date: '2026-09-11', sessionNumber: 3, type: 'live-session', holidays: [], weekId: 'WK3' },
        { slotNumber: 9, date: '2026-10-02', sessionNumber: 9, type: 'live-session', holidays: [], weekId: 'WK9', holidayNote: NOTE },
      ]));
      renderSidebar(5);
      const hint = await screen.findByTestId('learner-week-holiday-note');
      expect(screen.getAllByTestId('learner-week-holiday-note')).toHaveLength(1);
      expect(hint).toHaveTextContent(NOTE);
      expect(hint.closest('li')).toHaveTextContent('Week 9');
    });

    it('repeats it in the current-week card when that week is the one open', async () => {
      vi.spyOn(overviewSchedule, 'peek').mockReturnValue(undefined);
      vi.spyOn(overviewSchedule, 'read').mockResolvedValue(planWith([
        { slotNumber: 9, date: '2026-10-02', sessionNumber: 9, type: 'live-session', holidays: [], weekId: 'WK9', holidayNote: NOTE },
      ]));
      renderSidebar(8);
      await screen.findAllByTestId('learner-week-holiday-note');
      expect(screen.getAllByTestId('learner-week-holiday-note')).toHaveLength(2);
      expect(screen.getByText('Current week').closest('div')).toHaveTextContent(NOTE);
    });

    it('shows nothing when the team published no hint for any week', async () => {
      vi.spyOn(overviewSchedule, 'peek').mockReturnValue(undefined);
      const read = vi.spyOn(overviewSchedule, 'read').mockResolvedValue(planWith([
        { slotNumber: 9, date: '2026-10-02', sessionNumber: 9, type: 'live-session', holidays: [], weekId: 'WK9' },
      ]));
      renderSidebar(8);
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      expect(screen.queryByTestId('learner-week-holiday-note')).toBeNull();
    });
  });
});
