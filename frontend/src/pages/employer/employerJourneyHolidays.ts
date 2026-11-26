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
    // Module marks describe the teaching schedule. The full annual calendar
    // also includes selected holidays with no teaching slot or module dates.
    for (const holiday of (assigned.curriculumSlots || []).flatMap(slot => slot.holidays || [])) {
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
  return [...holidays.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

/** Complete cohort calendar: teaching slots and module dates do not limit it. */
export function annualJourneyHolidays(learners: EmployerLearnerCard[], records: JourneySchedules, start: string, end: string): JourneyHoliday[] {
  const holidays = new Map<string, JourneyHoliday>();
  for (const learner of learners) {
    const schedule = records[learnerKey(learner)]?.data;
    if (!schedule) continue;
    const selected = schedule.holidayCalendar?.available ? schedule.holidayCalendar.holidays
      : schedule.modules.flatMap(module => (module.curriculumSlots || []).flatMap(slot => slot.holidays || []));
    for (const holiday of selected) {
      const from = moduleDate(holiday.startDate);
      const to = moduleDate(holiday.endDate || holiday.startDate);
      if (!from || !to || from > to || to < start || from > end) continue;
      const label = holiday.label || 'Holiday';
      const key = JSON.stringify([holiday.id || label, label, from, to]);
      const found = holidays.get(key);
      if (found) {
        if (!found.learners.includes(learner.name)) found.learners.push(learner.name);
        continue;
      }
      const midpoint = (day(from < start ? start : from) + day(to > end ? end : to)) / 2;
      const position = 100 * (midpoint - day(start)) / (day(end) - day(start));
      holidays.set(key, { key, label, start: from, end: to, position, learners: [learner.name] });
    }
  }
  return [...holidays.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

/** Put the selected year's dates on the existing road, inside each colour.
 * Nearby holidays share a mark so every date remains reachable in its popup.
 */
export function journeyHolidayMarks(holidays: JourneyHoliday[], geometry: { width: number; offset: number; canvasWidth: number; canvasInset: number }) {
  const marks: { left: number; holidays: JourneyHoliday[] }[] = [];
  for (const holiday of holidays) {
    const x = geometry.canvasInset + 28 + holiday.position / 100 * (geometry.canvasWidth - 56) - geometry.offset;
    // Adjacent columns have a 4px gap. Each owns half of that gap, so a date
    // on a boundary is included once, without placing its hit target outside.
    if (x < -2 || x >= geometry.width + 2) continue;
    const left = Math.max(14, Math.min(geometry.width - 14, x));
    const previous = marks.at(-1);
    if (previous && left - previous.left < 28) {
      previous.left = (previous.left * previous.holidays.length + left) / (previous.holidays.length + 1);
      previous.holidays.push(holiday);
    } else marks.push({ left, holidays: [holiday] });
  }
  return marks;
}
