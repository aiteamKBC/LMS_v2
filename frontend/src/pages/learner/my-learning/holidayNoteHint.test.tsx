import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { PlanCurriculumSlot } from '@/api/trainingPlanDashboard';
import { weekHolidayNotes } from '@/pages/learner/training-plan-timeline/model';
import { SubjectTimeline } from './SubjectTimeline';
import { subjectWeeks, type LearningWeek } from './subjectLearning';
import type { Subject, SubjectEntry } from './SubjectWorkspace';

const NOTE = 'No live session this week. Use the workshop days to finish Assignment 2.';

const activity = (id: string, weekId: string, week: string, date: string): SubjectEntry => ({
  id, title: `Reading ${id}`, category: 'reading', completed: false, position: 0, week,
  schedule: { date, month: date.slice(0, 7), week_start: date, week_end: date },
  native: { title: `Reading ${id}`, componentId: id, weekId, type: 'reading', expectedOtjh: null },
});

const subject: Subject = {
  id: 'current:M1', title: 'Leadership', source: 'current',
  activities: [activity('C3', 'WK3', 'Week 3', '2026-09-11'), activity('C9', 'WK9', 'Week 9', '2026-10-02')],
};

const timelineWeeks: LearningWeek[] = subjectWeeks(subject);

const slot = (weekId: string, date: string, note?: string): PlanCurriculumSlot => ({
  slotNumber: 1, date, day: 'Friday', type: 'live-session', sessionNumber: 1, holidays: [], weekId, holidayNote: note,
});

describe("the curriculum team's holiday hint in My Learning", () => {
  it('keeps each authored week on its own card', () => {
    expect(timelineWeeks.map(week => week.weekId)).toEqual(['WK3', 'WK9']);
  });

  it('shows the hint on the week it was written for and on no other', () => {
    const notes = weekHolidayNotes([slot('WK3', '2026-09-11'), slot('WK9', '2026-10-02', NOTE)]);
    render(<MemoryRouter><SubjectTimeline subject={subject} weeks={timelineWeeks} search="" onOpen={() => {}} holidayNotes={notes} /></MemoryRouter>);
    const hints = screen.getAllByTestId('learner-week-holiday-note');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveTextContent(NOTE);
    expect(hints[0].closest('li')).toHaveTextContent('Week 9');
  });

  it('shows nothing when the team published no hint', () => {
    const notes = weekHolidayNotes([slot('WK3', '2026-09-11'), slot('WK9', '2026-10-02')]);
    expect(notes.size).toBe(0);
    render(<MemoryRouter><SubjectTimeline subject={subject} weeks={timelineWeeks} search="" onOpen={() => {}} holidayNotes={notes} /></MemoryRouter>);
    expect(screen.queryByTestId('learner-week-holiday-note')).toBeNull();
  });

  it('ignores a served note that names no week, so nothing can surface against the wrong one', () => {
    expect(weekHolidayNotes([{ ...slot('', '2026-10-02', NOTE) }]).size).toBe(0);
    expect(weekHolidayNotes(undefined).size).toBe(0);
  });
});
