import { describe, expect, it } from 'vitest';

import { placeActivity, toggleExpandedWeek, weekComponentRows, weekMonthHeadings, type SidebarWeek } from '../weekPreview';
import type { JourneyComponent } from '@/utils/learnerJourney';
import type { LearnerDetail } from '@/api/learnerDetail';

// ---------------------------------------------------------------------------
// The week list beside an open activity. Picking a week used to navigate
// straight into one of its components, so a learner looking ahead landed in an
// activity they never chose; it now drops down under the row instead.
// ---------------------------------------------------------------------------

const reading = (title: string, extra: Partial<JourneyComponent> = {}): JourneyComponent =>
  ({
    title,
    componentId: `COMP-${title}`,
    type: 'reading',
    contentHtml: '<p>Something to read</p>',
    ...extra,
  } as JourneyComponent);

const week = (overrides: Partial<SidebarWeek> = {}): SidebarWeek => ({
  week: 'Week 4',
  count: 2,
  completed: 0,
  active: false,
  components: [reading('Reading Material 2'), reading('Reading Material 3')],
  ...overrides,
});

describe('weekComponentRows', () => {
  it('lists the week in plan order', () => {
    const rows = weekComponentRows(week(), new Set());

    expect(rows.map((row) => row.component.title)).toEqual([
      'Reading Material 2', 'Reading Material 3',
    ]);
  });

  it('marks what the learner has already finished', () => {
    const rows = weekComponentRows(week(), new Set(['COMP-Reading Material 2']));

    expect(rows[0].complete).toBe(true);
    expect(rows[1].complete).toBe(false);
  });

  it('still lists an activity that cannot be opened, and says so', () => {
    // Looking ahead is the point; hiding half the week would leave the count on
    // the row above disagreeing with the list under it.
    const empty = reading('Reading Material 9', { contentHtml: null, resourceUrl: null });
    const rows = weekComponentRows(week({ components: [empty], count: 1 }), new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0].openable).toBe(false);
  });

  it('treats a quiz with content as openable', () => {
    const quiz = {
      title: 'QUIZE SOCIAL MEDIA',
      componentId: 'COMP-QUIZ',
      type: 'quiz',
      isQuiz: true,
      // A quiz counts as having content only once it has questions.
      quizMeta: { quizId: 12, questions: 5 },
    } as unknown as JourneyComponent;

    const rows = weekComponentRows(week({ components: [quiz], count: 1 }), new Set());

    expect(rows[0].openable).toBe(true);
  });

  it('has nothing to show for a week with no components', () => {
    expect(weekComponentRows(week({ components: [], count: 0 }), new Set())).toEqual([]);
    expect(weekComponentRows(null, new Set())).toEqual([]);
  });
});

describe('toggleExpandedWeek', () => {
  it('opens the week that was clicked', () => {
    expect(toggleExpandedWeek(null, 'Week 4')).toBe('Week 4');
  });

  it('closes it when it is already open', () => {
    expect(toggleExpandedWeek('Week 4', 'Week 4')).toBeNull();
  });

  it('moves to another week directly, without a closed step in between', () => {
    expect(toggleExpandedWeek('Week 4', 'Week 6')).toBe('Week 6');
  });
});

describe('module month headings', () => {
  it('groups each four teaching weeks and leaves assessments and introduction separate', () => {
    const weeks = ['Introduction', ...Array.from({ length: 10 }, (_, index) => `Week ${index + 1}`), 'Module assessments'];
    expect(weekMonthHeadings(weeks.map(week => ({ week })), '2026-08-03')).toEqual([
      null, 'August 2026', null, null, null, 'September 2026', null, null, null, 'October 2026', null, null,
    ]);
  });

  it.each([
    ['2026-12-31', ['December 2026', 'January 2027', 'February 2027']],
    ['2026-01-31', ['January 2026', 'February 2026', 'March 2026']],
    ['2026-02-30', ['Month 1', 'Month 2', 'Month 3']],
  ])('preserves calendar month order for training-plan start %s', (start, expected) => {
    const weeks = Array.from({ length: 10 }, (_, index) => ({ week: `Week ${index + 1}` }));
    expect(weekMonthHeadings(weeks, start).filter(Boolean)).toEqual(expected);
  });

  it('uses plan order for named or repeated weeks', () => {
    expect(weekMonthHeadings(Array.from({ length: 6 }, () => ({ week: 'Marketing workshop' }))))
      .toEqual(['Month 1', null, null, null, 'Month 2', null]);
  });
});

describe('placeActivity', () => {
  // The plan as the learner detail carries it: a module list, week rows, and
  // flat component rows that buildLearnerJourney groups into the journey.
  const detail = {
    modules: ['Aya Modual'],
    week: [
      { module: 'Aya Modual', week: 'Week 1' },
      { module: 'Aya Modual', week: 'Week 2' },
    ],
    components: [
      {
        module: 'Aya Modual', week: 'Week 1', component: 'Reading Material 2',
        componentId: 'COMP-READ-2', type: 'reading', contentHtml: '<p>Read</p>',
        isQuiz: false,
      },
      {
        module: 'Aya Modual', week: 'Week 1', component: 'QUIZE SOCIAL MEDIA',
        componentId: 'COMP-QUIZ', type: 'quiz', isQuiz: true,
        quizMeta: { quizId: 4324, questions: 56 },
      },
      {
        module: 'Aya Modual', week: 'Week 2', component: 'Reading Material 9',
        componentId: 'COMP-READ-9', type: 'reading', contentHtml: '<p>Read</p>',
        isQuiz: false,
      },
    ],
    quizAttempts: [],
  } as unknown as LearnerDetail;

  it('finds a quiz by its quiz id, which is all a quiz page has', () => {
    const placement = placeActivity(detail, { quizId: 4324 }, new Set());

    expect(placement?.weekTitle).toBe('Week 1');
    expect(placement?.moduleTitle).toBe('Aya Modual');
    // The whole week is listed beside it, not just the quiz.
    expect(placement!.weekComponents.length).toBeGreaterThan(1);
  });

  it('lists the module’s other weeks, marking the one being sat', () => {
    const placement = placeActivity(detail, { quizId: 4324 }, new Set());

    expect(placement?.weeks.map((w) => w.week)).toEqual(['Week 1', 'Week 2']);
    expect(placement?.weeks.find((w) => w.active)?.week).toBe('Week 1');
  });

  it('finds an ordinary activity by its component id', () => {
    const placement = placeActivity(detail, { componentId: 'COMP-READ-9' }, new Set());

    expect(placement?.weekTitle).toBe('Week 2');
  });

  it('keeps identically named weeks and their completion counts separate', () => {
    const repeated = {
      ...detail,
      week: detail.week.map((w, index) => ({ ...w, week: 'Marketing Week', weekId: `W${index + 1}` })),
      components: detail.components.map((c) => ({ ...c, week: 'Marketing Week', weekId: c.week === 'Week 1' ? 'W1' : 'W2' })),
    };
    const placement = placeActivity(repeated, { componentId: 'COMP-READ-9' }, new Set(['COMP-READ-2']));

    expect(placement?.weekLabel).toBe('Week 2 · Marketing Week');
    expect(placement?.weeks.map((w) => [w.key, w.active, w.completed])).toEqual([
      ['W1', false, 1], ['W2', true, 0],
    ]);
    expect(placement?.weekComponents.map((c) => c.componentId)).toEqual(['COMP-READ-9']);
  });

  it('has no placement for an activity that is not in the plan', () => {
    expect(placeActivity(detail, { quizId: 9999 }, new Set())).toBeNull();
    expect(placeActivity(detail, { componentId: 'COMP-GONE' }, new Set())).toBeNull();
  });

  it('has no placement without a learner or without something to match', () => {
    expect(placeActivity(null, { quizId: 4324 }, new Set())).toBeNull();
    expect(placeActivity(detail, {}, new Set())).toBeNull();
  });
});
