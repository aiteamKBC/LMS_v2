import { describe, expect, it } from 'vitest';
import { barPosition, buildPlanModules, monthMetrics, nextSession, percent, reviewToBook, sessionDay, timelineYears, uniquePlanSessions } from './model';
import type { TrainingPlanDashboard, PlanSession } from '@/api/trainingPlanDashboard';
import { subjectsFrom, type Subject } from '../my-learning/SubjectWorkspace';
import type { LearnerDetail } from '@/api/learnerDetail';

const data: TrainingPlanDashboard = { months: { '2026-09': { label: '', topics: [], planned: 18, source: 'contract' } }, actual: [
  { month: '2026-09', groupId: '1', hours: 7, count: 2 }, { month: '2026-09', groupId: null, hours: 4.5, count: 1 },
], actualAvailable: true, modules: [], moduleLinks: { 'legacy:1': { id: 'module-1', title: 'Marketing' } }, sessions: [], reviews: [], coach: { name: '', bookingUrl: null }, contractStatus: 'ready', generatedAt: '' };
const subject: Subject = { id: 'legacy:1', title: 'Marketing', source: 'legacy', activities: ['2026-09-01','2026-09-08','2026-09-15','2026-09-22'].map((date, i) => ({ id: `${i}`, title: `Activity ${i}`, completed: i < 2, category: 'reading', position: i, schedule: { date } })) };

describe('Training Plan calculations', () => {
  it('offers every year inside a multi-year module even without a contract for that year', () => {
    expect(timelineYears(['2024-09-01','2028-07-01','invalid'],2026,2026)).toEqual([2024,2025,2026,2027,2028]);
  });
  it('prioritizes the earliest outstanding progress review over future reviews', () => {
    const reviews = [
      {source:'progress-review',status:'not-scheduled',date:'2026-10-01',id:'future'},
      {source:'progress-review',status:'not-scheduled',date:'2026-09-01',id:'overdue'},
      {source:'mcr',status:'not-scheduled',date:'2026-08-01',id:'coaching'},
      {source:'progress-review',status:'completed',date:'2026-07-01',id:'done'},
    ] as TrainingPlanDashboard['reviews'];
    expect(reviewToBook(reviews)?.id).toBe('overdue');
    expect(reviewToBook([])).toBeNull();
  });
  it('counts a Teams occurrence once when two historical subjects map to the same Builder module', () => {
    const shared = {...data,sessions:[{id:'occurrence-1',moduleId:'module-1',start:'2026-09-14T10:00:00Z'} as PlanSession],
      moduleLinks:{...data.moduleLinks,'legacy:2':{id:'module-1',title:'Marketing'}}};
    const modules=buildPlanModules([subject,{...subject,id:'legacy:2'}],shared);
    expect(uniquePlanSessions(modules)).toHaveLength(1);
  });
  it('shares newly authored module content and completion with My Learning by id', () => {
    const real = { modules: ['New module'], components: [
      { moduleId: 'MOD-NEW', module: 'New module', componentId: 'C-NEW', component: 'New activity', type: 'reading' },
    ], componentProgress: [{ componentId: 'C-NEW', kind: 'component' }] } as LearnerDetail;
    const subjects = subjectsFrom(null, real, { covers: {}, current_subjects: [{ id: 'MOD-NEW', title: 'New module' }],
      activity_dates: { 'C-NEW': { date: '2026-09-15', month: '2026-09' } } });
    const modules = buildPlanModules(subjects, { ...data, modules: [{ id: 'MOD-NEW', title: 'New module', description: 'Live Builder description' }] } as TrainingPlanDashboard);
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ id: 'current:MOD-NEW', moduleId: 'MOD-NEW', done: 1, progress: 100, start: '2026-09-15', weeks: 1,
      detail: { description: 'Live Builder description' } });
    expect(modules[0].activities).toBe(subjects[0].activities);
  });
  it('uses accepted monthly actual once, including hours without a module, and real study weeks', () => {
    const modules = buildPlanModules([subject], data);
    expect(modules[0].actual).toBe(7);
    expect(monthMetrics('2026-09', modules, data)).toMatchObject({ planned: 18, actual: 11.5, remaining: 6.5, weekly: 4.5, weeks: 4 });
    expect(modules[0].progress).toBe(50);
  });
  it('does not invent four weeks or use cloned upload dates as a schedule', () => {
    const unknown = { ...subject, activities: subject.activities.map(a => ({ ...a, schedule: { ...a.schedule, date_needs_review: true } })) };
    const modules = buildPlanModules([unknown], data);
    expect(modules[0].start).toBe('');
    expect(monthMetrics('2026-09', modules, data).weekly).toBeNull();
    expect(monthMetrics('2026-10', modules, data).planned).toBeNull();
  });
  it('deduplicates the same teaching week across modules and keeps an explicit target', () => {
    const duplicate = { ...subject, id: 'legacy:2' };
    const modules = buildPlanModules([subject, duplicate], data);
    expect(monthMetrics('2026-09', modules, data).weeks).toBe(4);
    expect(monthMetrics('2026-09', modules, { ...data, months: { '2026-09': { ...data.months['2026-09'], weeklyTarget: 3 } } }).weekly).toBe(3);
  });
  it('keeps actual hours above target and never shows a negative remainder', () => {
    const over = { ...data, actual: [{ month: '2026-09', groupId: null, hours: 20, count: 1 }] };
    expect(monthMetrics('2026-09', [], over)).toMatchObject({ actual: 20, remaining: 0, progress: 100 });
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(0, 0)).toBe(0);
  });
  it('positions a module across years and honours equal month columns, including leap days', () => {
    expect(barPosition('2025-12-15','2026-02-28',2026)?.left).toBe(0);
    expect(barPosition('2025-12-15','2026-02-28',2026)?.width).toBeCloseTo(100 / 6);
    expect(barPosition('2024-02-01','2024-02-29',2024)?.left).toBeCloseTo(100 / 12);
    expect(barPosition('2024-02-01','2024-02-29',2024)?.width).toBeCloseTo(100 / 12);
    expect(barPosition('2025-01-01','2025-02-01',2026)).toBeNull();
  });
  it('takes the earliest future live occurrence and excludes cancelled sessions', () => {
    const sessions = [
      { id: 'later', start: '2026-09-20T12:00:00Z', status: 'scheduled' },
      { id: 'next', start: '2026-09-11T12:00:00Z', status: 'scheduled' },
      { id: 'cancelled', start: '2026-09-10T12:00:00Z', status: 'cancelled' },
      { id: 'past', start: '2026-09-01T12:00:00Z', status: 'scheduled' },
    ] as PlanSession[];
    expect(nextSession(sessions, Date.parse('2026-09-10T00:00:00Z'))?.id).toBe('next');
    expect(nextSession([], Date.now())).toBeNull();
  });
  it('groups late UTC sessions in their UK teaching month during daylight saving', () => {
    expect(sessionDay('2026-03-31T23:30:00Z')).toBe('2026-04-01');
    expect(sessionDay('2026-01-31T23:30:00Z')).toBe('2026-01-31');
  });
  it('distinguishes a missing audit connection from zero accepted hours', () => {
    expect(monthMetrics('2026-09', [], { ...data, actualAvailable: false, actual: [] })).toMatchObject({ actual: null, remaining: null, progress: null });
    expect(monthMetrics('2026-09', [], { ...data, actual: [] }).actual).toBe(0);
  });
});
