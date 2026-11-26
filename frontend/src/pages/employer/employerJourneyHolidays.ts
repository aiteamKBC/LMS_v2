import type { EmployerLearnerCard } from '@/api/employerPortal';
import { learnerKey } from './employerDashboardData';
import { moduleDate } from './employerModuleTimelineData';
import type { JourneyModule } from './employerJourneyTimelineData';
import type { JourneySchedules } from './useEmployerJourneyHolidays';

export type JourneyHoliday = { key: string; label: string; start: string; end: string; position: number; learners: string[] };
const day = (value: string) => Date.parse(`${value}T12:00:00Z`);

export function journeyHolidays(module: JourneyModule, learners: EmployerLearnerCard[], records: JourneySchedules): JourneyHoliday[] {
  const holidays = new Map<string, JourneyHoliday>();
  const normalize = (id: string) => id.replace(/^current:/, '');
  for (const learner of learners) {
    const schedule = records[learnerKey(learner)]?.data;
    if (!schedule) continue;
    const linkedId = schedule.moduleLinks?.[module.id]?.id;
    const assigned = schedule.modules.find(row => row.id === linkedId || normalize(row.id) === normalize(module.id));
    if (!assigned) continue;
    const start = moduleDate(assigned.start_date || '') || module.start;
    const end = moduleDate(assigned.effectiveEndDate || assigned.end_date || '') || module.end;
    if (!start || !end || start > end) continue;
    for (const slot of assigned.curriculumSlots || []) {
      // Only the scheduler can establish a holiday closure; never infer one from a gap.
      if (slot.type !== 'reading-week') continue;
      for (const holiday of slot.holidays || []) {
        const from = moduleDate(holiday.startDate);
        const to = holiday.endDate ? moduleDate(holiday.endDate) : from;
        if (!from || !to || from > to || to < start || from > end) continue;
        const label = holiday.label || 'Holiday';
        const key = JSON.stringify([holiday.id || label, label, from, to, start, end]);
        const found = holidays.get(key);
        if (found) {
          if (!found.learners.includes(learner.name)) found.learners.push(learner.name);
          continue;
        }
        const midpoint = (day(from < start ? start : from) + day(to > end ? end : to)) / 2;
        const position = end === start ? 50 : 100 * (midpoint - day(start)) / (day(end) - day(start));
        holidays.set(key, { key, label, start: from, end: to, position, learners: [learner.name] });
      }
    }
  }
  return [...holidays.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}
