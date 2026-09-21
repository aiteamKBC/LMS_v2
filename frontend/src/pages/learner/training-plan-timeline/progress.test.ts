import { describe, expect, it } from 'vitest';
import type { TrainingPlanDashboard, PlanReview } from '@/api/trainingPlanDashboard';
import { barPosition, buildPlanModules, timelineMonthKeys, timelinePeriodYear } from './model';
import { moduleProgress } from './progress';
import { dashboardPlanSubjects } from '@/pages/workspace/learner/dashboardPlan';

const data: TrainingPlanDashboard = { months: {}, actual: [], actualAvailable: false, modules: [{ id: 'M1', title: 'Marketing', description: '',
  start_date: '2026-09-01', end_date: '2026-10-31', tutor_name: '', coach_name: '', total_otjh: 10 }], moduleLinks: {},
  sessions: [true, false, null].map((attended, index) => ({ id: String(index), moduleId: 'M1', title: 'Session', start: '2026-09-10T10:00:00Z', end: null,
    minutes: 60, joinUrl: null, status: 'scheduled', attended })),
  reviews: [{ eventKey: 'done', source: 'mcr', status: 'completed', date: '2026-09-10' },
    { eventKey: 'pending', source: 'progress-review', status: 'not-scheduled', date: '2026-10-10' },
    { eventKey: 'outside', source: 'mcr', status: 'not-scheduled', date: '2027-01-10' },
    { eventKey: 'support', source: 'student-support', status: 'not-scheduled', date: '2026-10-10' },
    { eventKey: 'cancelled', source: 'mcr', status: 'cancelled', date: '2026-10-10' }] as PlanReview[],
  coach: { name: '', bookingUrl: null }, contractStatus: 'ready', generatedAt: '' };
const subject = { id: 'current:M1', title: 'Marketing', source: 'current' as const, total: 10, completed: 4, dates: [], moduleIds: ['M1'], sessionTitles: [],
  directHours: 2, ksbProgress: { completed: 3, total: 4 } };

describe('dashboard module progress', () => {
  it('averages the five measures equally and counts only reviews within module dates', () => {
    const result = moduleProgress(buildPlanModules([subject], data)[0], data, Date.parse('2026-09-20T12:00:00Z'));
    expect(result.measures.map(measure => measure.value)).toEqual([33.33, 40, 20, 75, 50]);
    expect(result.measures[0].detail).toBe('1 / 3 ended sessions attended · 1 pending');
    expect(result.value).toBe(43.67);
    expect(result.available).toBe(5);
  });
  it('uses rescheduled review dates', () => {
    const changed = { ...data, reviews: data.reviews.map(review => review.eventKey === 'pending' ? { ...review, scheduledDate: '2026-11-01' } : review) };
    const result = moduleProgress(buildPlanModules([subject], changed)[0], changed, Date.parse('2026-09-20T12:00:00Z'));
    expect(result.measures[0].value).toBe(33.33);
    expect(result.measures[4].value).toBe(100);
  });
  it('excludes future sessions and counts ended sessions without attendance as pending', () => {
    const sessions = [
      { ...data.sessions[0], id: 'attended', start: '2026-09-10T10:00:00Z', attended: true },
      { ...data.sessions[0], id: 'absent', start: '2026-09-11T10:00:00Z', attended: false },
      { ...data.sessions[0], id: 'pending', start: '2026-09-12T10:00:00Z', attended: null },
      { ...data.sessions[0], id: 'future', start: '2026-09-21T10:00:00Z', attended: null },
    ];
    const current = { ...data, sessions };
    const result = moduleProgress(buildPlanModules([subject], current)[0], current, Date.parse('2026-09-20T12:00:00Z'));
    expect(result.measures[0]).toEqual({ label: 'Attendance', value: 33.33,
      detail: '1 / 3 ended sessions attended · 1 pending' });
  });
  it('distinguishes missing measures from zero and caps over-target hours', () => {
    const module = buildPlanModules([{ ...subject, directHours: 20, ksbProgress: null }], { ...data, sessions: [], reviews: [] })[0];
    const result = moduleProgress(module, { ...data, reviews: [] });
    expect(result.measures.map(measure => measure.value)).toEqual([null, 40, 100, null, null]);
    expect(result.value).toBe(70);
    expect(result.available).toBe(2);
    expect(result.measures[2].detail).toBe('20 / 10 hours');
    expect(moduleProgress({ ...module, done: 0, activityCount: 0, actual: null }, { ...data, reviews: [] }).value).toBeNull();
  });
  it('combines verified old and new summaries without losing KSB points or recorded hours', () => {
    const combined = { ...data, actualAvailable: true, actual: [{ month: '2026-09', groupId: '10', hours: 5, count: 1 }], moduleLinks: { 'legacy:10': { id: 'M1', title: 'Marketing' } } };
    const subjects = dashboardPlanSubjects([{ ...subject, id: 'legacy:10', source: 'legacy', directHours: 1, ksbCodes: ['K1'], activityCounts: { reading: 10 } },
      { ...subject, ksbCodes: ['S1'], activityCounts: { video: 10 } }], combined);
    const module = buildPlanModules(subjects, combined)[0];
    expect(module.actual).toBe(8);
    expect(module.ksbProgress).toEqual({ completed: 6, total: 8 });
    expect(module.activityCounts).toEqual({ reading: 10, video: 10 });
    expect(module.ksbCodes).toEqual(['K1', 'S1']);
  });
});

describe('learner start month timeline', () => {
  it('shows exactly twelve months from the learner start month across calendar years', () => {
    const months = timelineMonthKeys(2026, 7);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-08');
    expect(months[11]).toBe('2027-07');
    expect(timelinePeriodYear('2027-02', 7)).toBe(2026);
    expect(timelinePeriodYear('2027-08', 7)).toBe(2027);
    expect(barPosition('2026-08-01', '2027-07-31', 2026, 7)).toEqual({ left: 0, width: 100 });
    expect(barPosition('2027-02-01', '2027-02-28', 2026, 7)?.left).toBe(50);
    expect(barPosition('2027-02-01', '2027-02-28', 2026, 7)?.width).toBeCloseTo(100 / 12);
    expect(barPosition('2027-08-01', '2027-08-31', 2026, 7)).toBeNull();
  });
});
