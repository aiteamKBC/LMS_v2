import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ActivitySidebar } from '../ActivitySidebar';
import { sidebarWeekRanges, weekMonthHeadings, type SidebarWeek } from '../weekPreview';
import type { PlanCurriculumSlot } from '@/api/trainingPlanDashboard';

const weeks: SidebarWeek[] = ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06']
  .map((sessionDate, index) => ({ key: `W${index + 1}`, weekId: `W${index + 1}`, week: `Week ${index + 1}`,
    active: index === 4, count: 1, completed: 0, components: [{ title: `Live ${index + 1}`, type: 'live_session',
      componentId: `LIVE-${index + 1}`, moduleId: 'M1', weekId: `W${index + 1}`, expectedOtjh: 1, sessionDate }] }));

describe('native component and quiz delivery weeks', () => {
  it('keeps five Friday weeks in October instead of moving the fifth to November', () => {
    expect(weekMonthHeadings(weeks)).toEqual(['October 2026', null, null, null, null, 'November 2026']);
  });

  it('does not use a separate meeting or a recording date as the week anchor', () => {
    const current = { ...weeks[4], components: [
      { title: 'Extra', type: 'live_session', expectedOtjh: 0, sessionDate: '2026-09-30', additionalMeeting: true },
      { title: 'Recording', type: 'recording_placeholder', expectedOtjh: 0, recordingDate: '2026-11-03' },
      ...weeks[4].components,
      { title: 'Second live', type: 'live_session', expectedOtjh: 1, sessionDate: '2026-11-02' },
    ] };
    expect(sidebarWeekRanges([current, weeks[5]])[0]).toEqual({ start: '2026-10-30', end: '2026-11-05' });
    expect(weekMonthHeadings([current, weeks[5]])).toEqual(['October 2026', 'November 2026']);
  });

  it('uses matching curriculum slots for reading weeks and refuses ambiguous title matches', () => {
    const slots: PlanCurriculumSlot[] = [
      { slotNumber: 1, date: '2026-10-30', day: 'Friday', type: 'reading-week', sessionNumber: null, holidays: [], weekId: 'W5', weekTitle: 'Workshop' },
      { slotNumber: 2, date: '2026-11-06', day: 'Friday', type: 'live-session', sessionNumber: 6, holidays: [], weekId: 'W6', weekTitle: 'Workshop' },
    ];
    expect(sidebarWeekRanges([{ week: 'Workshop', weekId: 'W5' }], slots)[0].start).toBe('2026-10-30');
    expect(sidebarWeekRanges([{ week: 'Workshop' }], slots)[0].start).toBe('');
  });

  it.each(['component', 'quiz'])('shows the same dated week and all material identities in the %s player', mode => {
    const before = JSON.stringify(weeks);
    render(<MemoryRouter><ActivitySidebar weeks={weeks} weekComponents={weeks[4].components}
      weekTitle="Week 5" moduleTitle="Synthetic module" completedIds={new Set()}
      currentComponentId={mode === 'component' ? 'LIVE-5' : undefined} currentQuizId={mode === 'quiz' ? 9 : undefined}
      routeFor={component => `/learner/component/commercial/synthetic/${component.componentId}`} /></MemoryRouter>);
    const sidebar = screen.getByRole('complementary', { name: 'Module activities' });
    expect(within(sidebar).getAllByText('30 Oct 2026 – 5 Nov 2026')).toHaveLength(2);
    const fifth = within(sidebar).getByRole('button', { name: /^Week 5\b/ });
    const sixth = within(sidebar).getByRole('button', { name: /^Week 6\b/ });
    expect(fifth.closest('li')).not.toHaveTextContent('November 2026');
    expect(sixth.closest('li')).toHaveTextContent('November 2026');
    fireEvent.click(sixth);
    expect(within(sixth.closest('li')!).getByRole('button', { name: /Live 6/ })).toBeVisible();
    expect(JSON.stringify(weeks)).toBe(before);
  });
});
