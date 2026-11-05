import { describe, expect, it } from 'vitest';
import type { StudentActivityItem } from '@/api/studentActivity';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { Subject, SubjectEntry } from './learningSummary';
import { currentLearningWeek, resolveSubjectWeek, subjectMapWeeks, subjectWeeks } from './subjectLearning';
import { combinedActivities } from './combinedActivities';

function activity(id: string, section: string, title: string, order: number, position: number, date = '2026-09-05'): SubjectEntry {
  const legacy = { activity_id: id, group_id: 50, catalogue_kind: 'material', can_open_material: true,
    source_section: { id: section, title, order, component_order: position } } as StudentActivityItem;
  return { id, title: id, category: 'reading', completed: false, position: 999 - position, legacy,
    schedule: { date, month: date.slice(0, 7), date_source: 'original_created_at', date_needs_review: true } };
}
const subject = (activities: SubjectEntry[]): Subject => ({ id: 'legacy:50', title: 'Course', source: 'legacy', activities });

describe('original source weeks', () => {
  it('keeps all seventeen sections and their contents instead of merging them by upload week', () => {
    const entries = Array.from({ length: 17 }, (_, i) => [
      activity(`late-${i}`, `S${i}`, `Source section ${i}`, i, 2, '2026-09-26'),
      activity(`first-${i}`, `S${i}`, `Source section ${i}`, i, 1),
    ]).flat().reverse();
    const before = JSON.stringify(entries);
    const weeks = subjectWeeks(subject(entries));
    expect(weeks).toHaveLength(17);
    expect(weeks.map(week => week.sourceOrder)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(weeks[0].activities.map(item => item.id)).toEqual(['first-0', 'late-0']);
    expect(new Set(weeks.flatMap(week => week.activities.map(item => item.id))).size).toBe(34);
    expect(weeks.every(week => week.start === null && week.month === '2026-09')).toBe(true);
    expect(currentLearningWeek(subject(entries), '2026-09-05')).toBeUndefined();
    expect(JSON.stringify(entries)).toBe(before);
  });

  it('uses original ordinals and exact names within each month without renumbering EPA or Week 00', () => {
    const weeks = subjectWeeks(subject([
      activity('two', 'S4', 'Week 02: Principles', 4, 1),
      activity('zero', 'S1', 'Week 00: Welcome', 1, 1),
      activity('epa', 'S3', 'EPA Distinction', 3, 1),
      activity('one', 'S2', 'Week 01: Introduction', 2, 1),
      activity('oct', 'S5', 'Week 03: Governance', 5, 1, '2026-10-06'),
    ]));
    expect(weeks.map(week => week.title)).toEqual(['Week 00: Welcome', 'Week 01: Introduction', 'EPA Distinction', 'Week 02: Principles', 'Week 03: Governance']);
    expect(weeks.every(week => week.label === week.title)).toBe(true);
  });

  it('anchors the full section on the session day, including materials uploaded in other months', () => {
    const live = activity('live', 'S1', 'Week 01', 1, 2, '2026-09-29');
    live.schedule = { date: '2026-09-29', month: '2026-09', date_source: 'section_title', week_start: '2026-09-28' };
    const course = subject([activity('reading', 'S1', 'Week 01', 1, 1, '2026-10-01'), live]);
    const weeks = subjectWeeks(course);
    expect(weeks).toHaveLength(1);
    expect(currentLearningWeek(course, '2026-10-05')).toMatchObject({ start: '2026-09-29', end: '2026-10-05', month: '2026-09' });
    expect(resolveSubjectWeek(weeks, '2026-09-28')).toBe(weeks[0]);
    expect(resolveSubjectWeek(weeks, '2026-09-29')).toBe(weeks[0]);
  });

  it('keeps unplaced stored material visible and preserves one linked Reading + Quiz row', () => {
    const parent = activity('parent', 'S1', 'Week 01', 1, 1);
    parent.category = 'Reading + Quiz';
    const quiz = activity('quiz', 'S1', 'Week 01', 1, 1);
    quiz.legacy = { ...quiz.legacy!, catalogue_kind: 'quiz', source_material_activity_id: 'parent' };
    const extra = activity('extra', 'unknown', '', 0, 1);
    extra.legacy = { ...extra.legacy!, source_section: undefined };
    const course = subject([quiz, extra, parent]);
    expect(subjectWeeks(course).flatMap(week => week.activities)).toHaveLength(3);
    expect(subjectWeeks(course).find(week => week.id === 'unplaced')?.activities.map(item => item.id)).toEqual(['extra']);
    const combined = combinedActivities(course.activities);
    expect(combined.activities.map(item => item.id)).toEqual(['extra', 'parent']);
    expect(combined.aliases.get('quiz')).toBe('parent');
  });

  it('does not guess a teaching date or split a section when upload months disagree', () => {
    const weeks = subjectWeeks(subject([activity('a', 'S1', 'Resources', 1, 1), activity('b', 'S1', 'Resources', 1, 2, '2026-10-01')]));
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ start: null, end: null, month: undefined });
    expect(weeks[0].activities).toHaveLength(2);
  });

  it('does not merge new Builder weeks into the source course before transfer', () => {
    const course = subject([activity('old', 'S1', 'Original section', 1, 1)]);
    const detail = { week: [{ moduleId: 'M1', module: 'New course', weekId: 'NEW', week: 'New Builder week' }] } as LearnerDetail;
    const weeks = subjectMapWeeks(course, detail, { covers: {}, builder_subjects: { 'legacy:50': { id: 'M1', title: 'New course' } } });
    expect(weeks).toHaveLength(1);
    expect(weeks[0].title).toBe('Original section');
  });
});
