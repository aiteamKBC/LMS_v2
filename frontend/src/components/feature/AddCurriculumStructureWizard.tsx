import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumModules } from '@/hooks/useCurriculumModules';
import { DatePickerField } from '@/components/feature/DatePickerField';
import {
  attachCurriculumModulesToGroup,
  archiveCurriculumHoliday,
  createCurriculumCohort,
  createCurriculumGroup,
  createCurriculumHoliday,
  createCurriculumModule,
  createCurriculumProgramme,
  updateCurriculumCohort,
  updateCurriculumGroup,
  updateCurriculumHoliday,
  updateCurriculumProgramme,
  type CurriculumCohort,
  type CurriculumCohortInput,
  type CurriculumGroup,
  type CurriculumGroupInput,
  type CurriculumHoliday,
  type CurriculumHolidayInput,
  type CurriculumModule,
  type CurriculumModuleAttachmentInput,
  type CurriculumProgramme,
  type CurriculumStaffProfile,
} from '@/lib/curriculumApi';
import {
  componentTypes,
  curriculumModuleToCatalogue,
  getDefaultStructure,
  loadModuleStructure,
  loadLocalModules,
  MODULE_BUILDER_WIZARD_DRAFT_PREFIX,
  readModuleBuilderSync,
  type ModuleCatalogueItem,
  type ModuleComponent,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { closeCurriculumLoading, showCurriculumAlert, showCurriculumConfirm, showCurriculumLoading } from '@/components/feature/CurriculumSweetAlert';

type WizardStep = 'programme' | 'cohort' | 'group' | 'modules' | 'weeks' | 'review';
type ModuleMode = 'existing' | 'new';
type SaveIntent = 'draft' | 'final';

interface GeneratedSession {
  sessionNumber: number;
  date: string;
  day: string;
  startTime: string;
  shiftedFromDate?: string;
  shiftedHolidaySessions?: SkippedHolidaySession[];
}

interface SkippedHolidaySession {
  date: string;
  day: string;
  startTime: string;
  holidayId: string;
  holidayLabel: string;
}

interface WeekDraft extends GeneratedSession {
  id: string;
  title: string;
  components: ModuleComponent[];
  open: boolean;
}

interface ModuleDraft {
  localId: string;
  sourceId?: string;
  mode: ModuleMode;
  catalogueId: string;
  name: string;
  color: string;
  startDate: string;
  endDate: string;
  sessionsNumber: string;
  coach: string;
  tutor: string;
  notes: string;
  weeks: WeekDraft[];
  skippedHolidaySessions: SkippedHolidaySession[];
  originalEndDate: string;
  extensionDays: number;
}

interface GroupDraft {
  localId: string;
  sourceId?: string;
  name: string;
  deliveryDays: string[];
  startTime: string;
  endTime: string;
  color: string;
  modules: ModuleDraft[];
}

interface CohortDraft {
  localId: string;
  sourceId?: string;
  name: string;
  startDate: string;
  durationMonths: string;
  endDate: string;
  color: string;
  holidayIds: string[];
  groups: GroupDraft[];
}

interface AddCurriculumStructureWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initialProgrammeId?: string;
  initialCohortId?: string;
  initialGroupId?: string;
  startStep?: WizardStep;
}

const steps: Array<{ key: WizardStep; label: string; icon: string }> = [
  { key: 'programme', label: 'Programme', icon: 'ri-book-2-line' },
  { key: 'cohort', label: 'Cohort', icon: 'ri-calendar-event-line' },
  { key: 'group', label: 'Group', icon: 'ri-team-line' },
  { key: 'modules', label: 'Modules', icon: 'ri-stack-line' },
  { key: 'weeks', label: 'Module Content', icon: 'ri-layout-row-line' },
  { key: 'review', label: 'Review', icon: 'ri-checkbox-circle-line' },
];

const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekdayIndexes: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const moduleModeOptions: Array<{ key: ModuleMode; label: string; description: string; icon: string }> = [
  { key: 'existing', label: 'Use Existing Module', description: 'Link content from Module Builder', icon: 'ri-archive-stack-line' },
  { key: 'new', label: 'Create New Module', description: 'Create an empty module shell', icon: 'ri-add-box-line' },
];

function normalise(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugify(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function generatedCurriculumId(prefix: 'COHORT' | 'GROUP') {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${timestamp}${suffix}`;
}

function parseDateParts(dateValue: string) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromInput(dateValue: string) {
  const parts = parseDateParts(dateValue);
  return parts ? new Date(parts.year, parts.month - 1, parts.day) : null;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function calculateCohortEndDate(startDate: string, durationMonths: number | string) {
  const parts = parseDateParts(startDate);
  const months = Math.max(0, Math.round(Number(durationMonths) || 0));
  if (!parts || months <= 0) return '';

  const targetMonthIndex = parts.month - 1 + months;
  const targetYear = parts.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(parts.day, daysInMonth(targetYear, targetMonth));
  const end = new Date(targetYear, targetMonth, targetDay);
  end.setDate(end.getDate() - 1);
  return toDateInput(end);
}

function addDaysToInput(dateValue: string, days: number) {
  const date = dateFromInput(dateValue);
  if (!date) return '';
  date.setDate(date.getDate() + Math.max(0, Math.round(days) || 0));
  return toDateInput(date);
}

function addHoursToTime(timeValue: string, hours: number) {
  const [hour, minute] = String(timeValue || '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  const totalMinutes = (hour * 60 + minute + hours * 60) % 1440;
  const normalisedMinutes = totalMinutes < 0 ? totalMinutes + 1440 : totalMinutes;
  const nextHour = Math.floor(normalisedMinutes / 60);
  const nextMinute = normalisedMinutes % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

function selectedHolidayOverlapDays(rangeStartValue: string, rangeEndValue: string, holidays: CurriculumHoliday[]) {
  const rangeStart = dateFromInput(rangeStartValue);
  const rangeEnd = dateFromInput(rangeEndValue);
  if (!rangeStart || !rangeEnd) return 0;

  const countedDates = new Set<string>();
  holidays.forEach(holiday => {
    const holidayStart = dateFromInput(holiday.startDate);
    const holidayEnd = dateFromInput(holiday.endDate || holiday.startDate);
    if (!holidayStart || !holidayEnd || holidayEnd < rangeStart || holidayStart > rangeEnd) return;

    const cursor = new Date(Math.max(holidayStart.getTime(), rangeStart.getTime()));
    const end = new Date(Math.min(holidayEnd.getTime(), rangeEnd.getTime()));
    let guard = 3660;
    while (cursor <= end && guard > 0) {
      countedDates.add(toDateInput(cursor));
      cursor.setDate(cursor.getDate() + 1);
      guard -= 1;
    }
  });

  return countedDates.size;
}

function buildHolidayAdjustedCohortPlan(startDate: string, durationMonths: number | string, selectedHolidays: CurriculumHoliday[]) {
  const baseEndDate = calculateCohortEndDate(startDate, durationMonths);
  if (!baseEndDate) return { baseEndDate: '', adjustedEndDate: '', extensionDays: 0 };

  let adjustedEndDate = baseEndDate;
  let extensionDays = 0;
  let guard = 20;

  while (guard > 0) {
    const nextExtensionDays = selectedHolidayOverlapDays(startDate, adjustedEndDate, selectedHolidays);
    const nextAdjustedEndDate = addDaysToInput(baseEndDate, nextExtensionDays);
    if (nextAdjustedEndDate === adjustedEndDate && nextExtensionDays === extensionDays) break;
    adjustedEndDate = nextAdjustedEndDate;
    extensionDays = nextExtensionDays;
    guard -= 1;
  }

  return { baseEndDate, adjustedEndDate, extensionDays };
}

function getNextGroupDeliveryDate(startDate: string, groupDay: string) {
  const start = dateFromInput(startDate);
  const targetDay = weekdayIndexes[groupDay];
  if (!start || targetDay === undefined) return '';
  const offset = (targetDay - start.getDay() + 7) % 7;
  const next = new Date(start);
  next.setDate(start.getDate() + offset);
  return toDateInput(next);
}

function parseDeliveryDays(value: string | string[]) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[|,]/);
  const selected = source
    .map(day => weekDays.find(option => normalise(option) === normalise(day)))
    .filter((day): day is string => Boolean(day));
  return selected.length ? selected : ['Wednesday'];
}

function dayNameFromDate(date: Date) {
  return weekDays.find(day => weekdayIndexes[day] === date.getDay()) || weekDays[0];
}

function formatSessionDate(dateValue: string) {
  const date = dateFromInput(dateValue);
  return date ? `${dayNameFromDate(date).slice(0, 3)} ${dateValue}` : dateValue;
}

function generateModuleSessions(startDate: string, sessionCount: number | string, groupDay: string, groupTime: string): GeneratedSession[] {
  const count = Math.max(0, Math.round(Number(sessionCount) || 0));
  const start = dateFromInput(startDate);
  const deliveryDays = parseDeliveryDays(groupDay);
  const deliveryIndexes = new Set(deliveryDays.map(day => weekdayIndexes[day]));
  if (!start || count <= 0 || deliveryIndexes.size === 0) return [];

  const sessions: GeneratedSession[] = [];
  const cursor = new Date(start);
  let guard = 3660;
  while (sessions.length < count && guard > 0) {
    if (deliveryIndexes.has(cursor.getDay())) {
      sessions.push({
        sessionNumber: sessions.length + 1,
        date: toDateInput(cursor),
        day: dayNameFromDate(cursor),
        startTime: groupTime,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
    guard -= 1;
  }
  return sessions;
}

function calculateModuleEndDate(generatedSessions: GeneratedSession[]) {
  return generatedSessions.at(-1)?.date || '';
}

function daysBetween(startDate: string, endDate: string) {
  const start = dateFromInput(startDate);
  const end = dateFromInput(endDate);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function holidayId(holiday: CurriculumHoliday) {
  return String(holiday.id);
}

function dateInRange(dateValue: string, startValue: string, endValue: string) {
  const date = dateFromInput(dateValue);
  const start = dateFromInput(startValue);
  const end = dateFromInput(endValue || startValue);
  if (!date || !start || !end) return false;
  return date >= start && date <= end;
}

function holidayOverlapsRange(holiday: CurriculumHoliday, startValue: string, endValue: string) {
  const start = dateFromInput(startValue);
  const end = dateFromInput(endValue);
  const holidayStart = dateFromInput(holiday.startDate);
  const holidayEnd = dateFromInput(holiday.endDate || holiday.startDate);
  if (!start || !end || !holidayStart || !holidayEnd) return false;
  return holidayStart <= end && holidayEnd >= start;
}

function selectHolidayIdsInAdjustedCohortRange(
  startDate: string,
  durationMonths: string,
  holidays: CurriculumHoliday[],
  selectedIds: string[],
) {
  const nextIds = new Set(selectedIds);
  let previousSignature = '';
  let guard = 20;

  while (guard > 0) {
    const selectedHolidays = holidays.filter(holiday => nextIds.has(holidayId(holiday)));
    const plan = buildHolidayAdjustedCohortPlan(startDate, durationMonths, selectedHolidays);
    const rangeEnd = plan.adjustedEndDate || calculateCohortEndDate(startDate, durationMonths);

    holidays.forEach(holiday => {
      if (holidayOverlapsRange(holiday, startDate, rangeEnd)) nextIds.add(holidayId(holiday));
    });

    const signature = Array.from(nextIds).sort().join('|');
    if (signature === previousSignature) break;
    previousSignature = signature;
    guard -= 1;
  }

  return Array.from(nextIds);
}

function findHolidayForDate(dateValue: string, holidays: CurriculumHoliday[]) {
  return holidays.find(holiday => dateInRange(dateValue, holiday.startDate, holiday.endDate || holiday.startDate));
}

function buildHolidayAdjustedSessionPlan(
  startDate: string,
  sessionCount: number | string,
  groupDay: string,
  groupTime: string,
  activeHolidays: CurriculumHoliday[],
) {
  const count = Math.max(0, Math.round(Number(sessionCount) || 0));
  const originalSessions = generateModuleSessions(startDate, count, groupDay, groupTime);
  const originalEndDate = calculateModuleEndDate(originalSessions);
  const start = dateFromInput(startDate);
  const deliveryDays = parseDeliveryDays(groupDay);
  const deliveryIndexes = new Set(deliveryDays.map(day => weekdayIndexes[day]));
  if (!start || count <= 0 || deliveryIndexes.size === 0) {
    return { sessions: [], skippedHolidaySessions: [], originalEndDate: '', adjustedEndDate: '', extensionDays: 0 };
  }

  const sessions: GeneratedSession[] = [];
  const skippedHolidaySessions: SkippedHolidaySession[] = [];
  let pendingShiftHolidays: SkippedHolidaySession[] = [];
  const cursor = new Date(start);
  let guard = Math.max(3650, count * 28 * Math.max(1, deliveryIndexes.size));

  while (sessions.length < count && guard > 0) {
    if (!deliveryIndexes.has(cursor.getDay())) {
      cursor.setDate(cursor.getDate() + 1);
      guard -= 1;
      continue;
    }
    const date = toDateInput(cursor);
    const day = dayNameFromDate(cursor);
    const holiday = findHolidayForDate(date, activeHolidays);
    if (holiday) {
      const skippedSession = {
        date,
        day,
        startTime: groupTime,
        holidayId: holidayId(holiday),
        holidayLabel: holiday.label || 'Selected holiday',
      };
      skippedHolidaySessions.push(skippedSession);
      pendingShiftHolidays.push(skippedSession);
    } else {
      sessions.push({
        sessionNumber: sessions.length + 1,
        date,
        day,
        startTime: groupTime,
        shiftedFromDate: pendingShiftHolidays[0]?.date,
        shiftedHolidaySessions: pendingShiftHolidays.length ? [...pendingShiftHolidays] : undefined,
      });
      pendingShiftHolidays = [];
    }
    cursor.setDate(cursor.getDate() + 1);
    guard -= 1;
  }

  const adjustedEndDate = calculateModuleEndDate(sessions);
  return {
    sessions,
    skippedHolidaySessions,
    originalEndDate,
    adjustedEndDate,
    extensionDays: daysBetween(originalEndDate, adjustedEndDate),
  };
}

function todayIso() {
  return toDateInput(new Date());
}

function readableTextColor(hexColor: string) {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#111827' : '#ffffff';
}

function mixHexWithBlack(hexColor: string, amount = 0.45) {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#374151';
  const red = Math.round(parseInt(hex.slice(0, 2), 16) * (1 - amount));
  const green = Math.round(parseInt(hex.slice(2, 4), 16) * (1 - amount));
  const blue = Math.round(parseInt(hex.slice(4, 6), 16) * (1 - amount));
  return `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgba(hexColor: string | undefined, alpha: number) {
  const safeHex = String(hexColor || '#7c3aed').replace('#', '');
  const hex = safeHex.length === 3 ? safeHex.split('').map(char => `${char}${char}`).join('') : safeHex;
  if (hex.length !== 6) return `rgba(124, 58, 237, ${alpha})`;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) return `rgba(124, 58, 237, ${alpha})`;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function reviewTintStyle(color: string | undefined, backgroundAlpha = 0.06, borderAlpha = 0.18) {
  return {
    background: `linear-gradient(135deg, ${hexToRgba(color, backgroundAlpha)}, rgba(255, 255, 255, 0.94) 46%, ${hexToRgba(color, Math.max(backgroundAlpha - 0.025, 0.025))})`,
    borderColor: hexToRgba(color, borderAlpha),
  };
}

function holidayTypeBadgeStyle(color: string) {
  const safeColor = color || '#7c3aed';
  return {
    backgroundColor: `${safeColor}1F`,
    borderColor: `${safeColor}66`,
    color: mixHexWithBlack(safeColor, readableTextColor(safeColor) === '#111827' ? 0.5 : 0.25),
  };
}

function staffName(profile: CurriculumStaffProfile) {
  return String(profile.name || profile.Tutor_name || profile.Coach_name || profile.email || '').trim();
}

function staffAssignment(...values: unknown[]) {
  const value = values
    .map(item => String(item || '').trim())
    .find(item => item && normalise(item) !== 'unassigned');
  return value || '';
}

function uniqueStaffNames(values: unknown[]) {
  const names = new Map<string, string>();
  values.forEach(value => {
    const name = String(value || '').trim();
    const key = normalise(name);
    if (!key || key === 'unassigned' || names.has(key)) return;
    names.set(key, name);
  });
  return Array.from(names.values()).sort((left, right) => left.localeCompare(right));
}

function moduleOptionId(module: CurriculumModule) {
  return moduleBuilderStructureId(module);
}

function moduleOptionMatches(module: CurriculumModule, identifier: string) {
  const requested = String(identifier || '').trim();
  if (!requested) return false;
  return [
    moduleOptionId(module),
    module.catalogueId,
    module.sourceId,
    module.id,
  ].some(value => String(value || '') === requested);
}

function findModuleOption(moduleOptions: CurriculumModule[], identifier: string) {
  return moduleOptions.find(module => moduleOptionMatches(module, identifier));
}

function mergeCurriculumModule(existing: CurriculumModule | undefined, next: CurriculumModule): CurriculumModule {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    programme: next.programme && next.programme !== 'Unassigned' ? next.programme : existing.programme,
    cohort: next.cohort || existing.cohort,
    group: next.group || existing.group,
    startDate: next.startDate || existing.startDate,
    endDate: next.endDate || existing.endDate,
    tutor: staffAssignment(next.tutor, existing.tutor),
    coach: staffAssignment(next.coach, existing.coach),
    notes: userFacingNotes(next.notes) || userFacingNotes(existing.notes),
  };
}

function moduleBuilderDraftToCurriculumModule(module: ModuleCatalogueItem): CurriculumModule {
  return {
    id: module.id || module.catalogueId,
    sourceId: module.sourceId || module.catalogueId,
    catalogueId: module.catalogueId,
    name: module.title,
    programme: module.programmeName,
    cohort: module.sourceModule?.cohort,
    group: module.sourceModule?.group,
    weeks: module.weeks || module.weekStructure.length || 1,
    sessionsNumber: module.sessionsNumber || module.weeks || module.weekStructure.length || 1,
    startDate: module.startDate,
    endDate: module.endDate,
    ksbCount: module.ksbCount || 0,
    lessons: module.lessonCount || 0,
    quizzes: module.quizCount || 0,
    assignments: module.weekStructure.flatMap(week => week.components).filter(component => component.type === 'assignment').length,
    status: module.status || 'draft',
    authoringStatus: module.authoringStatus || module.status || 'draft',
    sourceType: module.sourceType || 'authoring',
    importedFromTrainingPlanId: module.importedFromTrainingPlanId,
    deliveryStatus: module.deliveryStatus,
    author: module.sourceModule?.author || 'Module Builder',
    tutor: staffAssignment(module.deliveryMetadata?.tutor, module.sourceModule?.tutor),
    coach: staffAssignment(module.deliveryMetadata?.coach, module.sourceModule?.coach),
    lastUpdated: module.sourceModule?.lastUpdated || '',
    color: module.sourceModule?.color || '#2563eb',
    notes: userFacingNotes(module.description),
    sessionNames: module.weekStructure.map(week => week.title || `Week ${week.weekNumber}`),
    ksbCodes: module.moduleKsbMappings.map(mapping => mapping.code),
  };
}

function moduleBuilderStructureId(module: CurriculumModule) {
  const base = curriculumModuleToCatalogue(module);
  const sourceId = base.sourceModule?.id || base.id;
  return String(sourceId).startsWith('training-module-') ? String(sourceId) : base.catalogueId;
}

function moduleSessionCount(module?: CurriculumModule) {
  return Math.max(1, Number(module?.sessionsNumber || module?.weeks || module?.sessionNames?.length || 1));
}

function userFacingNotes(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/(^|\s)__[a-zA-Z0-9_]+:[\s\S]*?(?=\s__[a-zA-Z0-9_]+:|$)/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function toTimeInput(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function scheduleTimes(value: unknown) {
  const text = String(value || '');
  const range = text.match(/(\d{1,2}:?\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:?\d{2}\s*(?:AM|PM)?)/i);
  const startTime = toTimeInput(range?.[1] || text) || '09:30';
  const endTime = toTimeInput(range?.[2]) || addHoursToTime(startTime, 2);
  return { startTime, endTime };
}

function scheduleDeliveryDays(value: unknown) {
  const text = String(value || '');
  const explicitDays = weekDays.filter(day => {
    const shortDay = day.slice(0, 3);
    return new RegExp(`\\b(${day}|${shortDay})\\b`, 'i').test(text);
  });
  return explicitDays.length ? explicitDays : parseDeliveryDays(text);
}

function inclusiveMonthSpan(startDate: string, endDate: string) {
  const start = dateFromInput(startDate);
  const end = dateFromInput(endDate);
  if (!start || !end || end < start) return '12';
  let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  if (end.getDate() >= start.getDate() - 1) months += 1;
  return String(Math.max(1, months));
}

function candidateKeys(values: unknown[]) {
  const keys = new Set<string>();
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    keys.add(normalise(text));
    keys.add(normalise(slugify(text)));
    keys.add(normalise(`program-${slugify(text)}`));
  });
  return keys;
}

function valueMatchesCandidate(value: unknown, candidates: Set<string>) {
  const text = String(value || '').trim();
  if (!text) return false;
  return candidates.has(normalise(text)) || candidates.has(normalise(slugify(text))) || candidates.has(normalise(`program-${slugify(text)}`));
}

function programmeKeys(programme: CurriculumProgramme) {
  return candidateKeys([programme.id, programme.sourceId, programme.name, programme.standard]);
}

function cohortBelongsToProgramme(cohort: CurriculumCohort, programme: CurriculumProgramme) {
  const keys = programmeKeys(programme);
  return valueMatchesCandidate(cohort.programmeId, keys) || valueMatchesCandidate(cohort.programme, keys);
}

function groupBelongsToCohort(group: CurriculumGroup, cohort: CurriculumCohort) {
  const cohortIdKeys = candidateKeys([cohort.id]);
  const groupIdKeys = candidateKeys([group.id]);
  return valueMatchesCandidate(group.cohortId, cohortIdKeys) || (cohort.groups || []).some(id => valueMatchesCandidate(id, groupIdKeys));
}

function moduleBelongsToGroup(module: CurriculumModule, group: CurriculumGroup, cohort: CurriculumCohort, programme: CurriculumProgramme) {
  const groupMatch = valueMatchesCandidate(module.groupId, candidateKeys([group.id]));
  const cohortMatch = valueMatchesCandidate(module.cohortId, candidateKeys([cohort.id]));
  const programmeMatch = valueMatchesCandidate(module.programmeId, programmeKeys(programme));
  return groupMatch && cohortMatch && programmeMatch;
}

function uniqueModulesByName(modules: CurriculumModule[]) {
  const seen = new Set<string>();
  return modules.filter(module => {
    const key = normalise(module.name || moduleOptionId(module));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function moduleStaffValues(module: CurriculumModule, group?: CurriculumGroup) {
  const deliveryMetadata = (module as CurriculumModule & { deliveryMetadata?: Record<string, string> }).deliveryMetadata;
  return {
    tutor: staffAssignment(module.tutor, deliveryMetadata?.tutor, group?.tutor),
    coach: staffAssignment(module.coach, deliveryMetadata?.coach, group?.coach),
  };
}

function existingModuleDraft(module: CurriculumModule, group: GroupDraft, activeHolidays: CurriculumHoliday[], sourceGroup?: CurriculumGroup): ModuleDraft {
  const localId = `module-existing-${module.id || moduleOptionId(module)}`;
  const startDate = module.startDate || todayIso();
  const sessionsNumber = String(moduleSessionCount(module));
  const plan = buildHolidayAdjustedSessionPlan(startDate, sessionsNumber, group.deliveryDays.join(', '), group.startTime, activeHolidays);
  const staff = moduleStaffValues(module, sourceGroup);
  const baseDraft: ModuleDraft = {
    localId,
    sourceId: module.id,
    mode: 'existing',
    catalogueId: moduleOptionId(module),
    name: module.name || '',
    color: module.color || '#2563eb',
    startDate,
    endDate: module.endDate || plan.adjustedEndDate || startDate,
    sessionsNumber,
    coach: staff.coach,
    tutor: staff.tutor,
    notes: userFacingNotes(module.notes),
    weeks: buildWeeks(localId, plan.sessions, []),
    skippedHolidaySessions: plan.skippedHolidaySessions,
    originalEndDate: plan.originalEndDate,
    extensionDays: plan.extensionDays,
  };
  const structure = getDefaultStructure(curriculumModuleToCatalogue(module));
  return applyModuleBuilderContent(baseDraft, structure, group.deliveryDays.join(', '), group.startTime, activeHolidays);
}

function buildExistingProgrammeDrafts(
  programme: CurriculumProgramme,
  cohorts: CurriculumCohort[],
  groups: CurriculumGroup[],
  modules: CurriculumModule[],
  holidays: CurriculumHoliday[],
  initialCohortId?: string,
  initialGroupId?: string,
) {
  const programmeCohorts = cohorts.filter(cohort => cohortBelongsToProgramme(cohort, programme));

  return programmeCohorts.map(cohort => {
    const holidayIds = (cohort.holidayIds || []).map(String);
    const activeHolidays = holidays.filter(holiday => holidayIds.includes(holidayId(holiday)));
    const cohortDraft: CohortDraft = {
      localId: `cohort-existing-${cohort.id}`,
      sourceId: cohort.id,
      name: cohort.name || '',
      startDate: cohort.startDate || todayIso(),
      durationMonths: inclusiveMonthSpan(cohort.startDate, cohort.endDate),
      endDate: cohort.endDate || calculateCohortEndDate(cohort.startDate || todayIso(), inclusiveMonthSpan(cohort.startDate, cohort.endDate)),
      color: cohort.color || '#0f766e',
      holidayIds,
      groups: [],
    };

    const cohortGroups = groups.filter(group => groupBelongsToCohort(group, cohort));
    cohortDraft.groups = cohortGroups.flatMap(group => {
      const times = scheduleTimes(group.schedule);
      const groupDraft: GroupDraft = {
        localId: `group-existing-${group.id}`,
        sourceId: group.id,
        name: group.name || '',
        deliveryDays: scheduleDeliveryDays(group.schedule),
        startTime: times.startTime,
        endTime: times.endTime,
        color: String((group as { color?: string }).color || '#334155'),
        modules: [],
      };
      const groupModules = uniqueModulesByName(modules.filter(module => moduleBelongsToGroup(module, group, cohort, programme)));
      if (!groupModules.length) return [];
      groupDraft.modules = groupModules.map(module => existingModuleDraft(module, groupDraft, activeHolidays, group));
      return [groupDraft];
    });

    if (initialGroupId) {
      cohortDraft.groups.sort((left, right) => Number(right.sourceId === initialGroupId) - Number(left.sourceId === initialGroupId));
    }
    return cohortDraft;
  })
    .filter(cohort => cohort.groups.length > 0)
    .sort((left, right) => Number(right.sourceId === initialCohortId) - Number(left.sourceId === initialCohortId));
}

function emptyModuleDraft(groupDay = '', groupTime = '09:30', activeHolidays: CurriculumHoliday[] = []): ModuleDraft {
  const localId = `module-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const plan = buildHolidayAdjustedSessionPlan(todayIso(), 1, groupDay, groupTime, activeHolidays);
  return {
    localId,
    mode: 'existing',
    catalogueId: '',
    name: '',
    color: '#2563eb',
    startDate: todayIso(),
    endDate: plan.adjustedEndDate || todayIso(),
    sessionsNumber: '1',
    coach: '',
    tutor: '',
    notes: '',
    weeks: buildWeeks(localId, plan.sessions, []),
    skippedHolidaySessions: plan.skippedHolidaySessions,
    originalEndDate: plan.originalEndDate,
    extensionDays: plan.extensionDays,
  };
}

function emptyGroupDraft(): GroupDraft {
  const localId = `group-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    localId,
    name: '',
    deliveryDays: ['Wednesday'],
    startTime: '09:30',
    endTime: addHoursToTime('09:30', 2),
    color: '#334155',
    modules: [],
  };
}

function emptyCohortDraft(): CohortDraft {
  const localId = `cohort-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    localId,
    name: '',
    startDate: todayIso(),
    durationMonths: '12',
    endDate: calculateCohortEndDate(todayIso(), 12),
    color: '#0f766e',
    holidayIds: [],
    groups: [],
  };
}

function isConfiguredGroup(group: GroupDraft) {
  return Boolean(group.name.trim() || group.modules.some(module => module.catalogueId || module.name.trim()));
}

function isConfiguredModule(module: ModuleDraft) {
  return Boolean(module.catalogueId || module.name.trim());
}

function configuredModuleCount(group: GroupDraft) {
  return group.modules.filter(isConfiguredModule).length;
}

function formatModuleCount(count: number) {
  return `${count} module${count === 1 ? '' : 's'}`;
}

function formatSessionCount(count: number) {
  return `${count} session${count === 1 ? '' : 's'}`;
}

function moduleDraftDisplayName(draft: ModuleDraft, index: number, moduleOptions: CurriculumModule[]) {
  const selectedModule = findModuleOption(moduleOptions, draft.catalogueId);
  return draft.name.trim() || selectedModule?.name || `Module ${index + 1}`;
}

function moduleBuilderUrlForDraft(draft: ModuleDraft, moduleOptions: CurriculumModule[], programmeName: string, programmeId = '', cohort?: CohortDraft, group?: GroupDraft) {
  const selectedModule = findModuleOption(moduleOptions, draft.catalogueId);
  const moduleIdentifier = selectedModule ? moduleBuilderStructureId(selectedModule) : draft.catalogueId;
  if (moduleIdentifier) return `/curriculum/module-builder?module=${encodeURIComponent(moduleIdentifier)}`;
  const title = draft.name.trim();
  if (!title) return '';
  const draftKey = `${MODULE_BUILDER_WIZARD_DRAFT_PREFIX}${draft.localId}`;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(draftKey, JSON.stringify({
      programmeId,
      programme: programmeName || 'Unassigned programme',
      cohortId: cohort?.sourceId || cohort?.localId || '',
      cohortName: cohort ? cohortDisplayName(cohort) : '',
      groupId: group?.sourceId || group?.localId || '',
      groupName: group?.name || '',
      title,
      description: userFacingNotes(draft.notes),
      sessionsNumber: Math.max(1, Number(draft.sessionsNumber) || draft.weeks.length || 1),
      startDate: draft.startDate || todayIso(),
      endDate: draft.endDate || '',
    }));
  }
  return `/curriculum/module-builder?wizardModule=${encodeURIComponent(draftKey)}&moduleTitle=${encodeURIComponent(title)}`;
}

function configuredGroupCount(cohort: CohortDraft) {
  return cohort.groups.filter(isConfiguredGroup).length;
}

function formatGroupCount(count: number) {
  return count > 0 ? `${count} group${count === 1 ? '' : 's'}` : 'No groups yet';
}

function cohortDisplayName(cohort: CohortDraft) {
  return cohort.name.trim() || 'New cohort';
}

function isCurriculumNotFoundError(err: unknown) {
  return err instanceof Error && /\b404\b/.test(err.message);
}

async function saveCurriculumCohort(sourceId: string | undefined, payload: CurriculumCohortInput) {
  if (!sourceId) return createCurriculumCohort(payload);
  try {
    return await updateCurriculumCohort(sourceId, payload);
  } catch (err) {
    if (isCurriculumNotFoundError(err)) return createCurriculumCohort(payload);
    throw err;
  }
}

async function saveCurriculumGroup(sourceId: string | undefined, payload: CurriculumGroupInput) {
  if (!sourceId) return createCurriculumGroup(payload);
  try {
    return await updateCurriculumGroup(sourceId, payload);
  } catch (err) {
    if (isCurriculumNotFoundError(err)) return createCurriculumGroup(payload);
    throw err;
  }
}

function showWizardSwalToast(title: string, text: string, icon: 'success' | 'error' | 'info' = 'success') {
  return showCurriculumAlert({
    title,
    text,
    icon,
    timer: icon === 'error' ? undefined : 2100,
    confirmButtonText: icon === 'error' ? 'Close' : 'Done',
  });
}

async function confirmDraftRemoval(itemType: 'cohort' | 'group' | 'module', itemName: string, onConfirm: () => void | Promise<void>) {
  return showCurriculumConfirm({
    title: `Remove ${itemType}?`,
    text: `${itemName || `This ${itemType}`} will be removed from this draft.`,
    icon: 'warning',
    confirmButtonText: 'Yes, remove it',
    cancelButtonText: 'Cancel',
    onConfirm,
  });
}

async function confirmDestructiveAction({
  title,
  text,
  confirmButtonText,
  successTitle,
  successText,
  onConfirm,
}: {
  title: string;
  text: string;
  confirmButtonText: string;
  successTitle: string;
  successText: string;
  onConfirm: () => Promise<void>;
}) {
  return showCurriculumConfirm({
    title,
    text,
    icon: 'warning',
    confirmButtonText,
    cancelButtonText: 'Cancel',
    successTitle,
    successText,
    onConfirm,
  });
}

function buildWeeks(localId: string, sessions: GeneratedSession[], previousWeeks: WeekDraft[]) {
  return sessions.map(session => {
    const previous = previousWeeks.find(week => week.sessionNumber === session.sessionNumber);
    const id = previous?.id || `${localId}-week-${session.sessionNumber}`;
    return {
      ...session,
      id,
      title: previous?.title || `Week ${session.sessionNumber}`,
      components: (previous?.components || []).map(component => ({ ...component, weekId: id })),
      open: previous?.open ?? session.sessionNumber === 1,
    };
  });
}

function reconcileModuleDraft(draft: ModuleDraft, groupDay: string, groupTime: string, activeHolidays: CurriculumHoliday[]): ModuleDraft {
  const plan = buildHolidayAdjustedSessionPlan(draft.startDate, draft.sessionsNumber, groupDay, groupTime, activeHolidays);
  return {
    ...draft,
    endDate: plan.adjustedEndDate,
    weeks: buildWeeks(draft.localId, plan.sessions, draft.weeks),
    skippedHolidaySessions: plan.skippedHolidaySessions,
    originalEndDate: plan.originalEndDate,
    extensionDays: plan.extensionDays,
  };
}

function applyModuleBuilderContent(draft: ModuleDraft, structure: ModuleCatalogueItem, groupDay: string, groupTime: string, activeHolidays: CurriculumHoliday[]) {
  const next = reconcileModuleDraft(draft, groupDay, groupTime, activeHolidays);
  return {
    ...next,
    notes: userFacingNotes(next.notes),
    weeks: next.weeks.map((week, index) => {
      const sourceWeek = structure.weekStructure[index];
      return {
        ...week,
        title: sourceWeek?.title || week.title,
        components: (sourceWeek?.components || []).map(component => ({
          ...component,
          id: `${week.id}-${component.id}`,
          weekId: week.id,
        })),
      };
    }),
  };
}

export function AddCurriculumStructureWizard({
  isOpen,
  onClose,
  onSaved,
  initialProgrammeId,
  initialCohortId,
  initialGroupId,
  startStep = 'programme',
}: AddCurriculumStructureWizardProps) {
  const { data, loading, error, reload } = useCurriculumData();
  const { modules: catalogueModules, reload: reloadCatalogueModules } = useCurriculumModules();
  const [step, setStep] = useState<WizardStep>(startStep);
  const [programmeForm, setProgrammeForm] = useState({
    name: '',
    standard: '',
    level: '',
    status: 'planned',
    color: '#2563eb',
    description: '',
  });
  const [cohortDrafts, setCohortDrafts] = useState<CohortDraft[]>([]);
  const [activeCohortId, setActiveCohortId] = useState('');
  const [expandedCohortId, setExpandedCohortId] = useState('');
  const [activeGroupId, setActiveGroupId] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState('');
  const [activeModuleId, setActiveModuleId] = useState('');
  const [expandedModuleId, setExpandedModuleId] = useState('');
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [holidayManagerOpen, setHolidayManagerOpen] = useState(false);
  const [removingDraftId, setRemovingDraftId] = useState('');
  const [localBuilderModules, setLocalBuilderModules] = useState<ModuleCatalogueItem[]>([]);
  const hydratedProgrammeRef = useRef('');

  const programmes = useMemo(() => data?.programmes ?? [], [data?.programmes]);
  const selectedProgramme = useMemo(
    () => programmes.find(programme => programme.id === initialProgrammeId || programme.sourceId === initialProgrammeId),
    [initialProgrammeId, programmes],
  );
  const modules = useMemo(() => {
    const merged = new Map<string, CurriculumModule>();
    (data?.modules ?? []).forEach(module => {
      merged.set(moduleOptionId(module), module);
    });
    catalogueModules.forEach(module => {
      const id = moduleOptionId(module);
      merged.set(id, mergeCurriculumModule(merged.get(id), module));
    });
    localBuilderModules.map(moduleBuilderDraftToCurriculumModule).forEach(module => {
      const id = moduleOptionId(module);
      merged.set(id, mergeCurriculumModule(merged.get(id), module));
    });
    return Array.from(merged.values());
  }, [catalogueModules, data?.modules, localBuilderModules]);
  const holidays = useMemo(() => data?.holidays ?? [], [data?.holidays]);
  const activeCohort = useMemo(() => cohortDrafts.find(cohort => cohort.localId === activeCohortId) || cohortDrafts[0] || emptyCohortDraft(), [activeCohortId, cohortDrafts]);
  const activeGroup = useMemo(() => activeCohort.groups.find(group => group.localId === activeGroupId) || activeCohort.groups[0] || emptyGroupDraft(), [activeCohort, activeGroupId]);
  const cohortForm = activeCohort;
  const groupForm = {
    ...activeGroup,
    endTime: activeGroup.endTime || addHoursToTime(activeGroup.startTime, 2),
    deliveryDay: activeGroup.deliveryDays.join(', '),
  };
  const moduleDrafts = activeGroup.modules;
  const activeModule = useMemo(() => activeModuleId ? moduleDrafts.find(draft => draft.localId === activeModuleId) : undefined, [activeModuleId, moduleDrafts]);
  const activeHolidays = useMemo(
    () => holidays.filter(holiday => cohortForm.holidayIds.includes(holidayId(holiday))),
    [cohortForm.holidayIds, holidays],
  );
  const syncModuleDraftsFromBuilder = useCallback(() => {
    setCohortDrafts(previous => previous.map(cohort => {
      const cohortHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
      let cohortChanged = false;
      const nextGroups = cohort.groups.map(group => {
        let groupChanged = false;
        const groupDeliveryDay = group.deliveryDays.join(', ');
        const nextModules = group.modules.map(draft => {
          const structure = readModuleBuilderSync(draft.localId) || readModuleBuilderSync(draft.catalogueId);
          if (!structure) return draft;
          groupChanged = true;
          cohortChanged = true;
          return applyModuleBuilderContent(
            {
              ...draft,
              mode: 'existing',
              catalogueId: structure.catalogueId || draft.catalogueId,
              name: structure.title || draft.name,
              color: structure.sourceModule?.color || draft.color,
              sessionsNumber: String(structure.sessionsNumber || structure.weeks || draft.sessionsNumber || 1),
              notes: userFacingNotes(structure.description || draft.notes),
            },
            structure,
            groupDeliveryDay,
            group.startTime,
            cohortHolidays,
          );
        });
        return groupChanged ? { ...group, modules: nextModules } : group;
      });
      return cohortChanged ? { ...cohort, groups: nextGroups } : cohort;
    }));
  }, [holidays]);

  useEffect(() => {
    if (!isOpen) return;

    const refreshModuleBuilderState = () => {
      setLocalBuilderModules(loadLocalModules());
      syncModuleDraftsFromBuilder();
    };
    refreshModuleBuilderState();
    reloadCatalogueModules({ silent: true });
    window.addEventListener('focus', refreshModuleBuilderState);
    window.addEventListener('storage', refreshModuleBuilderState);
    return () => {
      window.removeEventListener('focus', refreshModuleBuilderState);
      window.removeEventListener('storage', refreshModuleBuilderState);
    };
  }, [isOpen, reloadCatalogueModules, syncModuleDraftsFromBuilder]);

  useEffect(() => {
    if (!isOpen) {
      closeCurriculumLoading();
      return;
    }

    if (loading) {
      showCurriculumLoading({
        title: 'Loading curriculum options',
        text: 'Live programmes, cohorts, groups, modules and holidays are being prepared.',
      });
      return;
    }

    closeCurriculumLoading();
  }, [isOpen, loading]);

  useEffect(() => {
    if (!isOpen || !discardConfirmOpen) return;

    let active = true;
    showCurriculumConfirm({
      title: 'Discard unsaved changes?',
      text: 'Closing now will discard the programme structure in this wizard.',
      icon: 'warning',
      confirmButtonText: 'Discard changes',
      cancelButtonText: 'Keep editing',
      onConfirm: async () => {
        onClose();
      },
    }).finally(() => {
      if (active) setDiscardConfirmOpen(false);
    });

    return () => {
      active = false;
    };
  }, [discardConfirmOpen, isOpen, onClose]);

  const cohortHolidayPlan = useMemo(
    () => buildHolidayAdjustedCohortPlan(cohortForm.startDate, cohortForm.durationMonths, activeHolidays),
    [activeHolidays, cohortForm.durationMonths, cohortForm.startDate],
  );
  const moduleOptions = useMemo(() => {
    const seen = new Set<string>();
    return modules.filter(module => {
      const key = normalise(module.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [modules]);
  const tutors = uniqueStaffNames((data?.tutors ?? []).map(staffName));
  const coaches = uniqueStaffNames((data?.coaches ?? []).map(staffName));

  const setCohortForm = (updater: Partial<CohortDraft> | ((previous: CohortDraft) => CohortDraft)) => {
    setCohortDrafts(previous => previous.map(cohort => {
      if (cohort.localId !== activeCohort.localId) return cohort;
      return typeof updater === 'function' ? updater(cohort) : { ...cohort, ...updater };
    }));
  };

  const setGroupForm = (updater: Partial<GroupDraft> | ((previous: GroupDraft) => GroupDraft)) => {
    setCohortDrafts(previous => previous.map(cohort => {
      if (cohort.localId !== activeCohort.localId) return cohort;
      return {
        ...cohort,
        groups: cohort.groups.map(group => {
          if (group.localId !== activeGroup.localId) return group;
          return typeof updater === 'function' ? updater(group) : { ...group, ...updater };
        }),
      };
    }));
  };

  const setModuleDrafts = (updater: ModuleDraft[] | ((previous: ModuleDraft[]) => ModuleDraft[])) => {
    setCohortDrafts(previous => previous.map(cohort => {
      if (cohort.localId !== activeCohort.localId) return cohort;
      return {
        ...cohort,
        groups: cohort.groups.map(group => {
          if (group.localId !== activeGroup.localId) return group;
          return {
            ...group,
            modules: typeof updater === 'function' ? updater(group.modules) : updater,
          };
        }),
      };
    }));
  };

  const addCohortDraft = () => {
    const next = emptyCohortDraft();
    setCohortDrafts(previous => [...previous, next]);
    setActiveCohortId(next.localId);
    setExpandedCohortId(next.localId);
    setActiveGroupId('');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
  };

  const removeCohortDraft = async (id: string) => {
    const target = cohortDrafts.find(cohort => cohort.localId === id);
    if (!target || removingDraftId) return;
    await confirmDraftRemoval('cohort', cohortDisplayName(target), async () => {
      setRemovingDraftId(id);
      const removeIndex = cohortDrafts.findIndex(cohort => cohort.localId === id);
      const nextDrafts = cohortDrafts.filter(cohort => cohort.localId !== id);
      const fallback = nextDrafts[Math.min(Math.max(removeIndex, 0), Math.max(nextDrafts.length - 1, 0))] || nextDrafts[0];
      setCohortDrafts(nextDrafts);
      if (activeCohortId === id) setActiveCohortId(fallback?.localId || '');
      if (expandedCohortId === id) setExpandedCohortId('');
      if (!fallback || activeCohortId === id) {
        setActiveGroupId(fallback?.groups[0]?.localId || '');
        setExpandedGroupId('');
        setActiveModuleId(fallback?.groups[0]?.modules[0]?.localId || '');
        setExpandedModuleId('');
      }
      if (!nextDrafts.length && step !== 'cohort') setStep('cohort');
    });
    setRemovingDraftId('');
  };

  const addGroupDraft = (options: { focusGroupStep?: boolean } = {}) => {
    const next = emptyGroupDraft();
    setCohortDrafts(previous => previous.map(cohort => cohort.localId === activeCohort.localId ? { ...cohort, groups: [...cohort.groups, next] } : cohort));
    setActiveGroupId(next.localId);
    setExpandedGroupId(next.localId);
    setActiveModuleId('');
    setExpandedModuleId('');
    if (options.focusGroupStep) setStep('group');
  };

  const removeGroupDraft = async (id: string) => {
    const target = activeCohort.groups.find(group => group.localId === id);
    if (!target || removingDraftId) return;
    await confirmDraftRemoval('group', target.name || 'this group', async () => {
      setRemovingDraftId(id);
      const removeIndex = activeCohort.groups.findIndex(group => group.localId === id);
      const nextGroups = activeCohort.groups.filter(group => group.localId !== id);
      const fallback = nextGroups[Math.min(Math.max(removeIndex, 0), Math.max(nextGroups.length - 1, 0))] || nextGroups[0];
      setCohortDrafts(previous => previous.map(cohort => (
        cohort.localId === activeCohort.localId ? { ...cohort, groups: nextGroups } : cohort
      )));
      if (activeGroupId === id) setActiveGroupId(fallback?.localId || '');
      if (expandedGroupId === id) setExpandedGroupId('');
      if (activeGroupId === id) setActiveModuleId(fallback?.modules[0]?.localId || '');
      if (expandedGroupId === id) setExpandedModuleId('');
    });
    setRemovingDraftId('');
  };

  const addModuleDraft = (options: { focusModulesStep?: boolean } = {}) => {
    const next = emptyModuleDraft(groupForm.deliveryDay, groupForm.startTime, activeHolidays);
    setModuleDrafts(previous => [...previous, next]);
    setActiveModuleId(next.localId);
    setExpandedModuleId(next.localId);
    if (options.focusModulesStep) setStep('modules');
  };

  const removeModuleDraft = async (id: string) => {
    const target = moduleDrafts.find(draft => draft.localId === id);
    if (!target || removingDraftId) return;
    const selectedModule = findModuleOption(moduleOptions, target.catalogueId);
    await confirmDraftRemoval('module', target.name || selectedModule?.name || 'this module', async () => {
      setRemovingDraftId(id);
      const removeIndex = moduleDrafts.findIndex(draft => draft.localId === id);
      const nextDrafts = moduleDrafts.filter(draft => draft.localId !== id);
      const fallback = nextDrafts[Math.min(Math.max(removeIndex, 0), Math.max(nextDrafts.length - 1, 0))] || nextDrafts[0];
      setModuleDrafts(nextDrafts);
      if (activeModuleId === id) setActiveModuleId(fallback?.localId || '');
      if (expandedModuleId === id) setExpandedModuleId('');
    });
    setRemovingDraftId('');
  };

  const activeProgramme = selectedProgramme ? {
    ...selectedProgramme,
    name: programmeForm.name || selectedProgramme.name,
    standard: programmeForm.standard || selectedProgramme.standard,
    level: programmeForm.level || selectedProgramme.level,
    status: programmeForm.status || selectedProgramme.status,
    color: programmeForm.color || selectedProgramme.color,
    description: programmeForm.description || selectedProgramme.description,
  } : {
    name: programmeForm.name,
    standard: programmeForm.standard || programmeForm.name,
    level: programmeForm.level,
    status: programmeForm.status,
    color: programmeForm.color,
    description: programmeForm.description,
  } as CurriculumProgramme;

  const stepIndex = steps.findIndex(item => item.key === step);
  const moduleIssues = cohortDrafts.flatMap((cohort, cohortIndex) => cohort.groups.flatMap((group, groupIndex) => {
    if (!group.modules.length) return [`Cohort ${cohortIndex + 1}, Group ${groupIndex + 1}: add at least one module.`];
    return group.modules.flatMap((draft, index) => {
      const label = `Cohort ${cohortIndex + 1}, Group ${groupIndex + 1}, Module ${index + 1}`;
      const issues = [];
      if (draft.mode === 'existing' && !draft.catalogueId && !draft.name.trim()) issues.push(`${label}: choose an existing module.`);
      if (draft.mode === 'new' && !draft.name.trim()) issues.push(`${label}: enter a module name.`);
      if (!draft.startDate) issues.push(`${label}: choose a start date.`);
      if ((Number(draft.sessionsNumber) || 0) < 1) issues.push(`${label}: set at least one session.`);
      if (!draft.weeks.length) issues.push(`${label}: no sessions could be generated for the selected delivery days.`);
      return issues;
    });
  }));

  const validation = {
    programme: !programmeForm.name.trim() ? ['Programme name is required.'] : [],
    cohort: cohortDrafts.length
      ? cohortDrafts.flatMap((cohort, index) => [
          !cohort.name.trim() ? `Cohort ${index + 1}: name is required.` : '',
          !cohort.startDate ? `Cohort ${index + 1}: start date is required.` : '',
          (Number(cohort.durationMonths) || 0) < 1 ? `Cohort ${index + 1}: duration must be at least 1 month.` : '',
        ].filter(Boolean))
      : ['Add at least one cohort.'],
    group: cohortDrafts.flatMap((cohort, cohortIndex) => (
      cohort.groups.length
        ? cohort.groups.flatMap((group, groupIndex) => [
            !group.name.trim() ? `Cohort ${cohortIndex + 1}, Group ${groupIndex + 1}: group name is required.` : '',
            !group.deliveryDays.length ? `Cohort ${cohortIndex + 1}, Group ${groupIndex + 1}: choose at least one delivery day.` : '',
            !group.startTime ? `Cohort ${cohortIndex + 1}, Group ${groupIndex + 1}: start time is required.` : '',
          ].filter(Boolean))
        : [`Cohort ${cohortIndex + 1}: add at least one group.`]
    )),
    modules: moduleIssues,
    weeks: [],
  };

  const canContinue = (
    step === 'programme' ? validation.programme.length === 0 :
    step === 'cohort' ? validation.cohort.length === 0 :
    step === 'group' ? validation.group.length === 0 :
    step === 'modules' ? validation.modules.length === 0 :
    true
  );
  const canSave = validation.programme.length === 0 && validation.cohort.length === 0 && validation.group.length === 0 && validation.modules.length === 0;
  const currentStepMeta = steps[stepIndex] || steps[0];
  const nextStepMeta = steps[Math.min(stepIndex + 1, steps.length - 1)] || steps[steps.length - 1];
  const dialogWidth = {
    programme: 'max-w-[1040px]',
    cohort: 'max-w-[1120px]',
    group: 'max-w-[1120px]',
    modules: 'max-w-[1240px]',
    weeks: 'max-w-[1240px]',
    review: 'max-w-[1120px]',
  }[step];

  useEffect(() => {
    if (!isOpen) return;
    const initialStep = startStep === 'programme' && initialProgrammeId ? 'cohort' : startStep;
    setStep(initialStep);
    setMessage(null);
    setDiscardConfirmOpen(false);
    setSubmitted(false);
    setSaving(null);
    setProgrammeForm({ name: '', standard: '', level: '', status: 'planned', color: '#2563eb', description: '' });
    setCohortDrafts([]);
    setActiveCohortId('');
    setExpandedCohortId('');
    setActiveGroupId('');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
    hydratedProgrammeRef.current = '';
  }, [initialProgrammeId, isOpen, startStep]);

  useEffect(() => {
    if (!isOpen || !selectedProgramme) return;
    setProgrammeForm({
      name: selectedProgramme.name || '',
      standard: selectedProgramme.standard || selectedProgramme.name || '',
      level: selectedProgramme.level || '',
      status: String(selectedProgramme.status || 'planned'),
      color: selectedProgramme.color || '#2563eb',
      description: selectedProgramme.description || '',
    });
  }, [isOpen, selectedProgramme]);

  useEffect(() => {
    if (!isOpen || !data || !selectedProgramme || loading || cohortDrafts.length || hydratedProgrammeRef.current) return;
    const existingDrafts = buildExistingProgrammeDrafts(
      selectedProgramme,
      data.cohorts || [],
      data.groups || [],
      modules,
      holidays,
      initialCohortId,
      initialGroupId,
    );

    hydratedProgrammeRef.current = selectedProgramme.id || selectedProgramme.sourceId || selectedProgramme.name;
    if (!existingDrafts.length) return;

    const firstCohort = existingDrafts[0];
    const firstGroup = firstCohort.groups[0];
    setCohortDrafts(existingDrafts);
    setActiveCohortId(firstCohort.localId);
    setExpandedCohortId('');
    setActiveGroupId(firstGroup?.localId || '');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
  }, [cohortDrafts.length, data, holidays, initialCohortId, initialGroupId, isOpen, loading, modules, selectedProgramme]);

  useEffect(() => {
    if (!cohortDrafts.length) {
      if (activeCohortId) setActiveCohortId('');
      if (expandedCohortId) setExpandedCohortId('');
      if (activeGroupId) setActiveGroupId('');
      if (expandedGroupId) setExpandedGroupId('');
      return;
    }
    const nextCohort = cohortDrafts.find(cohort => cohort.localId === activeCohortId) || cohortDrafts[0];
    if (nextCohort.localId !== activeCohortId) setActiveCohortId(nextCohort.localId);
    if (expandedCohortId && !cohortDrafts.some(cohort => cohort.localId === expandedCohortId)) setExpandedCohortId('');
    const nextGroup = nextCohort.groups.find(group => group.localId === activeGroupId) || nextCohort.groups[0];
    if (nextGroup && nextGroup.localId !== activeGroupId) setActiveGroupId(nextGroup.localId);
    if (!nextGroup && activeGroupId) setActiveGroupId('');
    if (expandedGroupId && !nextCohort.groups.some(group => group.localId === expandedGroupId)) setExpandedGroupId('');
    const nextModule = activeModuleId ? nextGroup?.modules.find(module => module.localId === activeModuleId) : undefined;
    if (activeModuleId && !nextModule) setActiveModuleId('');
    if (expandedModuleId && !nextGroup?.modules.some(module => module.localId === expandedModuleId)) setExpandedModuleId('');
  }, [activeCohortId, activeGroupId, activeModuleId, cohortDrafts, expandedCohortId, expandedGroupId, expandedModuleId]);

  useEffect(() => {
    if (!cohortDrafts.length) return;
    setCohortDrafts(previous => previous.map(cohort => (
      cohort.localId !== activeCohort.localId || cohort.endDate === cohortHolidayPlan.adjustedEndDate
        ? cohort
        : { ...cohort, endDate: cohortHolidayPlan.adjustedEndDate }
    )));
  }, [activeCohort.localId, cohortDrafts.length, cohortHolidayPlan.adjustedEndDate]);

  useEffect(() => {
    setCohortDrafts(previous => {
      const existingIds = new Set(holidays.map(holiday => holidayId(holiday)));
      return previous.map(cohort => {
        const nextIds = cohort.holidayIds.filter(id => existingIds.has(id));
        return nextIds.length === cohort.holidayIds.length ? cohort : { ...cohort, holidayIds: nextIds };
      });
    });
  }, [holidays]);

  useEffect(() => {
    if (!cohortDrafts.length || !activeCohort.groups.length) return;
    setCohortDrafts(previous => previous.map(cohort => {
      if (cohort.localId !== activeCohort.localId) return cohort;
      return {
        ...cohort,
        groups: cohort.groups.map(group => group.localId === activeGroup.localId
          ? { ...group, modules: group.modules.map(draft => reconcileModuleDraft(draft, groupForm.deliveryDay, groupForm.startTime, activeHolidays)) }
          : group),
      };
    }));
  }, [activeCohort.groups.length, activeCohort.localId, activeGroup.localId, activeHolidays, cohortDrafts.length, groupForm.deliveryDay, groupForm.startTime]);

  const requestClose = () => {
    if (saving) return;
    const hasDraft = Boolean(
      programmeForm.name.trim() ||
      cohortDrafts.some(cohort => (
        cohort.name.trim() ||
        cohort.holidayIds.length > 0 ||
        cohort.groups.some(group => (
          group.name.trim() ||
          group.modules.some(draft => draft.catalogueId || draft.name.trim() || draft.weeks.some(week => week.components.length))
        ))
      )),
    );
    if (hasDraft && !submitted) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const updateModuleDraft = (localId: string, patch: Partial<ModuleDraft>) => {
    setModuleDrafts(prev => prev.map(draft => {
      if (draft.localId !== localId) return draft;
      if (Object.keys(patch).length === 1 && patch.endDate !== undefined) return { ...draft, endDate: patch.endDate };
      return reconcileModuleDraft({ ...draft, ...patch }, groupForm.deliveryDay, groupForm.startTime, activeHolidays);
    }));
  };

  const selectExistingModule = async (draft: ModuleDraft, catalogueId: string) => {
    const module = findModuleOption(moduleOptions, catalogueId);
    if (!catalogueId || !module) {
      updateModuleDraft(draft.localId, {
        mode: 'existing',
        catalogueId,
        name: '',
        sessionsNumber: '1',
      });
      return;
    }
    const sessionsNumber = String(moduleSessionCount(module));
    const staff = moduleStaffValues(module);
    updateModuleDraft(draft.localId, {
      mode: 'existing',
      catalogueId,
      name: module?.name || '',
      color: module?.color || draft.color,
      sessionsNumber,
      tutor: staff.tutor,
      coach: staff.coach,
      notes: '',
    });

    try {
      const savedStructure = await loadModuleStructure(moduleBuilderStructureId(module));
      const structure = getDefaultStructure(savedStructure || curriculumModuleToCatalogue(module));
      setModuleDrafts(previous => previous.map(item => (
        item.localId === draft.localId
          ? applyModuleBuilderContent(
              {
                ...item,
                mode: 'existing',
                catalogueId,
                name: structure.title || module.name,
                color: module.color || item.color,
                sessionsNumber: String(structure.sessionsNumber || structure.weeks || sessionsNumber),
                tutor: staff.tutor || item.tutor,
                coach: staff.coach || item.coach,
                notes: userFacingNotes(structure.description || item.notes),
              },
              structure,
              groupForm.deliveryDay,
              groupForm.startTime,
              activeHolidays,
            )
          : item
      )));
    } catch {
      const fallback = getDefaultStructure(curriculumModuleToCatalogue(module));
      setModuleDrafts(previous => previous.map(item => (
        item.localId === draft.localId
          ? applyModuleBuilderContent(
              {
                ...item,
                mode: 'existing',
                catalogueId,
                name: fallback.title || module.name,
                color: module.color || item.color,
                sessionsNumber: String(fallback.sessionsNumber || fallback.weeks || sessionsNumber),
                tutor: staff.tutor || item.tutor,
                coach: staff.coach || item.coach,
                notes: userFacingNotes(fallback.description || item.notes),
              },
              fallback,
              groupForm.deliveryDay,
              groupForm.startTime,
              activeHolidays,
            )
          : item
      )));
    }
  };

  const persistStructure = async (intent: SaveIntent) => {
    if (!canSave) {
      setMessage('Complete the required fields before saving.');
      return;
    }
    setSaving(intent);
    setMessage(null);
    try {
      const matchingProgramme = selectedProgramme || programmes.find(programme => (
        normalise(programme.name) === normalise(programmeForm.name)
        || normalise(programme.sourceId) === normalise(slugify(programmeForm.name))
      ));
      const programmeResult = matchingProgramme
        ? await updateCurriculumProgramme(matchingProgramme.sourceId || matchingProgramme.id, {
            ...programmeForm,
            standard: programmeForm.standard || programmeForm.name,
            status: programmeForm.status || matchingProgramme.status,
          })
        : await createCurriculumProgramme({
            ...programmeForm,
            standard: programmeForm.standard || programmeForm.name,
            status: intent === 'draft' ? 'draft' : programmeForm.status,
          });
      const savedProgramme = programmeResult.programme;
      const programmeName = savedProgramme?.name || programmeForm.name;
      const programmeSourceId = matchingProgramme?.sourceId || matchingProgramme?.id || savedProgramme?.sourceId || savedProgramme?.id || slugify(programmeName);
      const existingCohortIds = new Set((data?.cohorts ?? []).map(cohort => String(cohort.id)).filter(Boolean));
      const existingGroupIds = new Set((data?.groups ?? []).map(group => String(group.id)).filter(Boolean));

      for (const cohort of cohortDrafts) {
        const cohortActiveHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
        const cohortSourceId = cohort.sourceId && existingCohortIds.has(String(cohort.sourceId)) ? cohort.sourceId : undefined;
        const cohortId = cohortSourceId || generatedCurriculumId('COHORT');
        const cohortPayload = {
          id: cohortId,
          name: cohort.name,
          programme: programmeName,
          programmeId: programmeSourceId,
          startDate: cohort.startDate,
          endDate: cohort.endDate,
          durationMonths: Number(cohort.durationMonths),
          color: cohort.color,
          holidayIds: cohort.holidayIds,
        };
        await saveCurriculumCohort(cohortSourceId, cohortPayload);
        existingCohortIds.add(cohortId);

        for (const group of cohort.groups) {
          const deliveryDayValue = group.deliveryDays.join(', ');
          const groupSourceId = group.sourceId && existingGroupIds.has(String(group.sourceId)) ? group.sourceId : undefined;
          const groupId = groupSourceId || generatedCurriculumId('GROUP');
          const groupPayload = {
            id: groupId,
            name: group.name,
            cohortId,
            programmeId: programmeSourceId,
            weekDays: deliveryDayValue,
            startTime: group.startTime,
            endTime: group.endTime || addHoursToTime(group.startTime, 2),
            color: group.color,
            startDate: cohort.startDate,
            endDate: cohort.endDate,
          };
          await saveCurriculumGroup(groupSourceId, groupPayload);
          existingGroupIds.add(groupId);
          const attachments: CurriculumModuleAttachmentInput[] = [];

          for (const originalDraft of group.modules) {
            const draft = reconcileModuleDraft(originalDraft, deliveryDayValue, group.startTime, cohortActiveHolidays);
            let sourceModule: CurriculumModule | undefined;
            let catalogueId = draft.catalogueId;
            let moduleName = draft.name;

            if (draft.mode === 'existing') {
              sourceModule = findModuleOption(moduleOptions, draft.catalogueId) || findModuleOption(modules, draft.catalogueId);
              catalogueId = sourceModule ? moduleOptionId(sourceModule) : (draft.catalogueId || `existing-${slugify(draft.name)}`);
              moduleName = sourceModule?.name || draft.name || draft.catalogueId || 'Module';
            } else {
              const duplicate = modules.find(module => normalise(module.name) === normalise(draft.name));
              sourceModule = duplicate;
              if (!duplicate) {
                const created = await createCurriculumModule({
                  name: draft.name,
                  weeks: Number(draft.sessionsNumber) || 1,
                  color: draft.color,
                  notes: userFacingNotes(draft.notes),
                  startDate: draft.startDate,
                  endDate: draft.endDate,
                  tutor: draft.tutor,
                  coach: draft.coach,
                });
                sourceModule = created.module;
              }
              catalogueId = sourceModule ? moduleOptionId(sourceModule) : `MOD-${Date.now().toString(36).toUpperCase()}`;
              moduleName = sourceModule?.name || draft.name;
            }

            attachments.push({
              moduleName,
              catalogueId,
              programmeId: programmeSourceId,
              cohortId,
              groupId,
              color: draft.color || sourceModule?.color,
              startDate: draft.startDate,
              endDate: draft.endDate,
              sessionsNumber: Number(draft.sessionsNumber) || 1,
              weeks: Number(draft.sessionsNumber) || 1,
              coach: draft.coach,
              tutor: draft.tutor,
              weekDays: deliveryDayValue,
              startTime: group.startTime,
              endTime: group.endTime || addHoursToTime(group.startTime, 2),
              notes: userFacingNotes(draft.notes),
              holidays: cohortActiveHolidays,
            });
          }
          await attachCurriculumModulesToGroup(groupId, attachments);
        }
      }

      await reload();
      setSubmitted(true);
      showWizardSwalToast(
        matchingProgramme ? 'Programme updated' : (intent === 'draft' ? 'Draft programme saved' : 'Programme created'),
        'The programme, cohorts, groups and module links were saved through scoped curriculum endpoints. Module content remains managed in Module Builder.',
      );
      onSaved?.();
      onClose();
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unable to save programme structure.';
      setMessage(detail);
      showWizardSwalToast('Save failed', detail, 'error');
    } finally {
      setSaving(null);
    }
  };

  if (!isOpen) return null;

  return createPortal((
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-2 backdrop-blur-md sm:p-5" onClick={requestClose}>
      <NestedPopupBackdrop
        stepIndex={stepIndex}
        programme={activeProgramme}
        cohort={cohortForm}
        group={groupForm}
      />
      <div key={step} className={`relative z-10 flex max-h-[94vh] w-full ${dialogWidth} flex-col overflow-hidden rounded-2xl border border-white/20 bg-background-50 shadow-2xl`} onClick={event => event.stopPropagation()}>
        <header className="border-b border-foreground-200/70 bg-background-50 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-600">Curriculum Studio</p>
              <h2 className="mt-1 text-xl font-heading font-bold text-foreground-950">{currentStepMeta.label}</h2>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-foreground-500">
                {stepIndex === 0 ? 'Create the programme, then continue into the next popup.' : 'Complete this layer, then continue to the next popup.'}
              </p>
            </div>
            <button type="button" onClick={requestClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background-100 text-foreground-500 transition-smooth hover:bg-background-200" aria-label="Close wizard">
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
          <PopupTrail current={step} stepIndex={stepIndex} />
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto bg-background-100/70">
          <main className="min-w-0 p-3 sm:p-5">
              {error && <PanelTone icon="ri-error-warning-line" text={`Curriculum API error: ${error}`} tone="error" />}
              {message && <PanelTone icon="ri-information-line" text={message} tone={message.includes('Unable') || message.includes('returned') || message.includes('Complete') ? 'error' : 'info'} />}

              {step === 'programme' && (
                <StepPanel title="Programme" description="Name the programme first. Optional catalogue details can be added if needed.">
                  {selectedProgramme && (
                    <PanelTone icon="ri-pencil-line" text="Editing the existing programme. Cohorts, groups and modules are loaded below using their saved IDs." />
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
                    <Field label="Programme name" value={programmeForm.name} onChange={value => setProgrammeForm(prev => ({ ...prev, name: value }))} required error={validation.programme[0]} placeholder="Example: Project Controls Technician" />
                    <ColorField label="Programme colour" value={programmeForm.color} onChange={value => setProgrammeForm(prev => ({ ...prev, color: value }))} />
                    <Field label="Level" value={programmeForm.level} onChange={value => setProgrammeForm(prev => ({ ...prev, level: value }))} placeholder="Example: L4" />
                    <AdvancedSection title="Optional details" description="Status and description are useful later, but they are not needed to continue.">
                      <SelectNative label="Status" value={programmeForm.status} onChange={value => setProgrammeForm(prev => ({ ...prev, status: value }))} options={['planned', 'active', 'draft']} />
                      <TextArea label="Description" value={programmeForm.description} onChange={value => setProgrammeForm(prev => ({ ...prev, description: value }))} rows={3} />
                    </AdvancedSection>
                  </div>
                </StepPanel>
              )}

              {step === 'cohort' && (
                <StepPanel title="Cohort" description="Set the cohort dates first. Holidays are optional and only apply when selected.">
                  <CurrentParentBanner
                    icon="ri-book-2-line"
                    label={selectedProgramme ? 'Editing programme' : 'Programme created'}
                    title={activeProgramme.name || 'Programme'}
                    meta={[activeProgramme.level, activeProgramme.status].filter(Boolean).join(' - ') || 'Ready for cohort setup'}
                    color={activeProgramme.color || '#2563eb'}
                    next={selectedProgramme ? 'Existing cohorts are loaded here. You can edit them or add another.' : 'Now add the cohort that belongs inside this programme.'}
                  />
                  <DraftSwitcher
                    label="Cohorts in this programme"
                    items={cohortDrafts.map(cohort => ({ id: cohort.localId, label: cohortDisplayName(cohort), meta: formatGroupCount(configuredGroupCount(cohort)), color: cohort.color }))}
                    activeId={activeCohort.localId}
                    onSelect={id => {
                      const nextCohort = cohortDrafts.find(cohort => cohort.localId === id);
                      const nextGroup = nextCohort?.groups[0];
                      setActiveCohortId(id);
                      setActiveGroupId(nextGroup?.localId || '');
                      setExpandedGroupId('');
                      setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                      setExpandedModuleId('');
                    }}
                    onAdd={addCohortDraft}
                    addLabel="Add Cohort"
                    onRemoveItem={removeCohortDraft}
                    removingId={removingDraftId}
                    expandedId={expandedCohortId}
                    onToggleItem={id => {
                      const nextCohort = cohortDrafts.find(cohort => cohort.localId === id);
                      const nextGroup = nextCohort?.groups[0];
                      setActiveCohortId(id);
                      setActiveGroupId(nextGroup?.localId || '');
                      setExpandedGroupId('');
                      setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                      setExpandedModuleId('');
                      setExpandedCohortId(current => current === id ? '' : id);
                    }}
                  />
                  {cohortDrafts.length > 0 && expandedCohortId === activeCohort.localId && (
                    <div className="space-y-4">
                      <section className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: cohortForm.color }}>
                              <i className="ri-calendar-event-line text-lg"></i>
                            </span>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-foreground-400">Cohort details</p>
                              <h4 className="truncate text-sm font-heading font-bold text-foreground-950">{cohortForm.name || 'Name this cohort'}</h4>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedCohortId('')}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                            aria-label="Collapse cohort details"
                          >
                            <i className="ri-arrow-up-s-line text-lg"></i>
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_220px]">
                          <Field label="Cohort name" value={cohortForm.name} onChange={value => setCohortForm(prev => ({ ...prev, name: value }))} required error={validation.cohort.find(item => item.includes('Cohort'))} placeholder="Example: Jan 2026 Cohort" />
                          <Field label="Start date" type="date" value={cohortForm.startDate} onChange={value => setCohortForm(prev => ({ ...prev, startDate: value }))} required error={validation.cohort.find(item => item.includes('Start'))} />
                          <Field label="Duration in months" type="number" value={cohortForm.durationMonths} onChange={value => setCohortForm(prev => ({ ...prev, durationMonths: value }))} required error={validation.cohort.find(item => item.includes('Duration'))} />
                          <Field
                            label="Adjusted end date"
                            type="date"
                            value={cohortForm.endDate}
                            onChange={value => setCohortForm(prev => ({ ...prev, endDate: value }))}
                          />
                          <ColorField label="Cohort colour" value={cohortForm.color} onChange={value => setCohortForm(prev => ({ ...prev, color: value }))} />
                        </div>
                      </section>
                      <div>
                        <HolidaySelector
                          holidays={holidays}
                          cohortStartDate={cohortForm.startDate}
                          cohortDurationMonths={cohortForm.durationMonths}
                          selectedIds={cohortForm.holidayIds}
                          onChange={holidayIds => setCohortForm(prev => ({ ...prev, holidayIds }))}
                          onManage={() => setHolidayManagerOpen(true)}
                        />
                      </div>
                    </div>
                  )}
                </StepPanel>
              )}

              {step === 'group' && (
                <StepPanel title="Group" description="Choose a cohort, then add the delivery groups that belong inside it.">
                  <DraftSwitcher
                    label="Choose cohort"
                    items={cohortDrafts.map(cohort => ({ id: cohort.localId, label: cohortDisplayName(cohort), meta: formatGroupCount(configuredGroupCount(cohort)) }))}
                    activeId={activeCohort.localId}
                    onSelect={id => {
                      const nextCohort = cohortDrafts.find(cohort => cohort.localId === id);
                      const nextGroup = nextCohort?.groups[0];
                      setActiveCohortId(id);
                      setActiveGroupId(nextGroup?.localId || '');
                      setExpandedGroupId('');
                      setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                      setExpandedModuleId('');
                    }}
                    onAdd={addCohortDraft}
                    addLabel="Add Cohort"
                    onRemoveItem={removeCohortDraft}
                    removingId={removingDraftId}
                  />
                  <ScopeCard
                    icon="ri-calendar-event-line"
                    label="Selected cohort"
                    title={cohortForm.name || 'Unnamed cohort'}
                    meta={`${cohortForm.startDate} to ${cohortForm.endDate} - ${formatGroupCount(configuredGroupCount(activeCohort)).toLowerCase()} inside this cohort`}
                    color={cohortForm.color}
                    compact
                  >
                    <DraftSwitcher
                      label="Groups inside this cohort"
                      items={activeCohort.groups.map((group, index) => {
                        const moduleCount = configuredModuleCount(group);
                        return { id: group.localId, label: group.name || `Group ${index + 1}`, meta: `${formatModuleCount(moduleCount)} inside`, color: group.color };
                      })}
                      activeId={activeGroup.localId}
                      onSelect={id => {
                        const nextGroup = activeCohort.groups.find(group => group.localId === id);
                        setActiveGroupId(id);
                        setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                        setExpandedModuleId('');
                      }}
                      onAdd={() => addGroupDraft()}
                      addLabel={`Add Group to ${cohortDisplayName(activeCohort)}`}
                      onRemoveItem={removeGroupDraft}
                      removingId={removingDraftId}
                      expandedId={expandedGroupId}
                      onToggleItem={id => {
                        const nextGroup = activeCohort.groups.find(group => group.localId === id);
                        setActiveGroupId(id);
                        setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                        setExpandedModuleId('');
                        setExpandedGroupId(current => current === id ? '' : id);
                      }}
                      compact
                    />
                    {activeCohort.groups.length > 0 && expandedGroupId === activeGroup.localId && (
                      <NestedScopeCard
                        icon="ri-team-line"
                        label="Selected group"
                        title={groupForm.name || 'Unnamed group'}
                        meta={`${groupForm.deliveryDay || 'No delivery days'} - ${groupForm.startTime}-${groupForm.endTime}`}
                        color={groupForm.color}
                        badge={`${formatModuleCount(configuredModuleCount(activeGroup))} inside`}
                        compact
                      >
                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
                          <div className="rounded-xl border border-background-200 bg-background-50/70 p-3">
                            <p className="mb-2 text-[10px] font-bold uppercase text-foreground-400">Group details</p>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7.75rem]">
                              <Field label="Group name" value={groupForm.name} onChange={value => setGroupForm(prev => ({ ...prev, name: value }))} required error={validation.group.find(item => item.includes('Group'))} placeholder="Example: Wednesday AM" />
                              <ColorField label="Colour" value={groupForm.color} onChange={value => setGroupForm(prev => ({ ...prev, color: value }))} compact />
                            </div>
                          </div>
                          <div className="rounded-xl border border-background-200 bg-background-50/70 p-3">
                            <p className="mb-2 text-[10px] font-bold uppercase text-foreground-400">Delivery pattern</p>
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
                              <WeekdayCheckboxes label="Delivery days" value={activeGroup.deliveryDays} onChange={deliveryDays => setGroupForm(prev => ({ ...prev, deliveryDays }))} error={validation.group.find(item => item.includes('delivery day'))} compact />
                              <div className="grid grid-cols-2 gap-3">
                                <Field label="Start time" type="time" value={groupForm.startTime} onChange={value => setGroupForm(prev => ({ ...prev, startTime: value, endTime: addHoursToTime(value, 2) }))} required error={validation.group.find(item => item.includes('Start time'))} />
                                <Field label="End time" type="time" value={groupForm.endTime} onChange={() => undefined} disabled />
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end xl:col-span-2">
                            <button
                              type="button"
                              onClick={() => addModuleDraft({ focusModulesStep: true })}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                            >
                              <i className="ri-add-line text-sm"></i>
                              Add Module to {groupForm.name.trim() || 'this group'}
                            </button>
                          </div>
                        </div>
                      </NestedScopeCard>
                    )}
                  </ScopeCard>
                </StepPanel>
              )}

              {step === 'modules' && (
                <StepPanel title="Modules" description="Pick a delivery path on the left, then configure the module in the workspace.">
                  <ModulesStepWorkspace
                    cohortDrafts={cohortDrafts}
                    activeCohort={activeCohort}
                    activeGroup={activeGroup}
                    activeModule={activeModule}
                    moduleDrafts={moduleDrafts}
                    moduleOptions={moduleOptions}
                    tutors={tutors}
                    coaches={coaches}
                    groupForm={groupForm}
                    removingDraftId={removingDraftId}
                    validationModules={validation.modules}
                    onSelectCohort={id => {
                      const nextCohort = cohortDrafts.find(cohort => cohort.localId === id);
                      const nextGroup = nextCohort?.groups[0];
                      setActiveCohortId(id);
                      setActiveGroupId(nextGroup?.localId || '');
                      setExpandedGroupId('');
                      setActiveModuleId('');
                      setExpandedModuleId('');
                    }}
                    onAddCohort={addCohortDraft}
                    onRemoveCohort={removeCohortDraft}
                    onSelectGroup={id => {
                      setActiveGroupId(id);
                      setActiveModuleId('');
                      setExpandedModuleId('');
                    }}
                    onAddGroup={() => addGroupDraft({ focusGroupStep: true })}
                    onRemoveGroup={removeGroupDraft}
                    onSelectModule={id => {
                      setActiveModuleId(id);
                      setExpandedModuleId('');
                    }}
                    onAddModule={addModuleDraft}
                    onRemoveModule={removeModuleDraft}
                    onChangeModule={updateModuleDraft}
                    onSelectExistingModule={selectExistingModule}
                  />
                </StepPanel>
              )}

              {step === 'weeks' && (
                <StepPanel title="Module Content" description="Review the module-builder content attached to this group's modules. Edit weeks and components in Module Builder to keep one source of truth.">
                  <DraftSwitcher
                    label="Choose cohort"
                    items={cohortDrafts.map(cohort => ({ id: cohort.localId, label: cohortDisplayName(cohort), meta: formatGroupCount(configuredGroupCount(cohort)), color: cohort.color }))}
                    activeId={activeCohort.localId}
                    onSelect={id => {
                      const nextCohort = cohortDrafts.find(cohort => cohort.localId === id);
                      const nextGroup = nextCohort?.groups[0];
                      setActiveCohortId(id);
                      setActiveGroupId(nextGroup?.localId || '');
                      setExpandedGroupId('');
                      setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                      setExpandedModuleId('');
                    }}
                    onAdd={addCohortDraft}
                    addLabel="Add Cohort"
                    onRemoveItem={removeCohortDraft}
                    removingId={removingDraftId}
                  />
                  <ScopeCard
                    icon="ri-calendar-event-line"
                    label="Selected cohort"
                    title={cohortForm.name || 'Unnamed cohort'}
                    meta="Weekly components are edited inside the selected group's modules."
                    color={cohortForm.color}
                  >
                    <DraftSwitcher
                      label="Groups inside this cohort"
                      items={activeCohort.groups.map((group, index) => {
                        const moduleCount = configuredModuleCount(group);
                        return { id: group.localId, label: group.name || `Group ${index + 1}`, meta: `${formatModuleCount(moduleCount)} inside`, color: group.color };
                      })}
                      activeId={activeGroup.localId}
                      onSelect={id => {
                        const nextGroup = activeCohort.groups.find(group => group.localId === id);
                        setActiveGroupId(id);
                        setActiveModuleId(nextGroup?.modules[0]?.localId || '');
                        setExpandedModuleId('');
                      }}
                      onAdd={() => addGroupDraft({ focusGroupStep: true })}
                      addLabel={`Add Group to ${cohortDisplayName(activeCohort)}`}
                      onRemoveItem={removeGroupDraft}
                      removingId={removingDraftId}
                    />
                    {activeCohort.groups.length > 0 && (
                      <NestedScopeCard
                        icon="ri-team-line"
                        label="Module-builder content in selected group"
                        title={groupForm.name || 'Unnamed group'}
                        meta={`${groupForm.deliveryDay || 'No delivery days'} - ${groupForm.startTime}-${groupForm.endTime}`}
                        color={groupForm.color}
                        badge={`${formatModuleCount(configuredModuleCount(activeGroup))} inside this group`}
                      >
                        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] font-semibold text-sky-800 sm:flex-row sm:items-center sm:justify-between">
                          <span className="flex items-start gap-2">
                            <i className="ri-information-line mt-0.5 text-sm"></i>
                            <span>Weeks and components are managed in Module Builder. This wizard only consumes that content and applies cohort/group scheduling.</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => addModuleDraft({ focusModulesStep: true })}
                            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                          >
                            <i className="ri-add-line"></i>
                            Add Module to {groupForm.name.trim() || 'this group'}
                          </button>
                        </div>
                        <div className="space-y-4">
                          {moduleDrafts.map(draft => (
                            <ModuleBuilderContentPreview
                              key={draft.localId}
                              draft={draft}
                              moduleOptions={moduleOptions}
                              programmeId={selectedProgramme?.sourceId || selectedProgramme?.id || slugify(activeProgramme.name || programmeForm.name)}
                              programmeName={activeProgramme.name || programmeForm.name}
                              cohort={activeCohort}
                              group={activeGroup}
                            />
                          ))}
                        </div>
                      </NestedScopeCard>
                    )}
                  </ScopeCard>
                </StepPanel>
              )}

              {step === 'review' && (
                <StepPanel title="Review" description="Confirm the full structure before creation.">
                  <ReviewSummary
                    programme={activeProgramme}
                    cohortForm={cohortForm}
                    groupForm={groupForm}
                    moduleDrafts={moduleDrafts}
                    selectedHolidays={activeHolidays}
                    cohortHolidayExtensionDays={cohortHolidayPlan.extensionDays}
                    cohortDrafts={cohortDrafts}
                    holidays={holidays}
                  />
                  {!canSave && <ValidationList items={[...validation.programme, ...validation.cohort, ...validation.group, ...validation.modules]} />}
                </StepPanel>
              )}
          </main>
        </div>

        <footer className="border-t border-foreground-200/60 bg-background-50 px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <button type="button" onClick={stepIndex === 0 ? requestClose : () => setStep(steps[stepIndex - 1].key)} disabled={Boolean(saving)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50 transition-smooth">
            <i className={stepIndex === 0 ? 'ri-close-line' : 'ri-arrow-left-line'}></i>
            {stepIndex === 0 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button type="button" onClick={() => persistStructure('draft')} disabled={Boolean(saving) || !canSave} className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50 transition-smooth">
              <i className="ri-save-3-line"></i>
              {saving === 'draft' ? 'Saving...' : 'Save Draft'}
            </button>
            {step === 'review' ? (
              <button type="button" onClick={() => persistStructure('final')} disabled={Boolean(saving) || !canSave} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-50 transition-smooth">
                <i className="ri-checkbox-circle-line"></i>
                {saving === 'final' ? 'Saving...' : selectedProgramme ? 'Save Programme Changes' : 'Create Programme'}
              </button>
            ) : (
              <button type="button" onClick={() => setStep(nextStepMeta.key)} disabled={!canContinue || Boolean(saving)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-50 transition-smooth">
                {step === 'weeks' ? 'Open Review Popup' : `Next: ${nextStepMeta.label}`}
                <i className="ri-arrow-right-line"></i>
              </button>
            )}
          </div>
        </footer>

        {holidayManagerOpen && (
          <HolidayManagerModal
            holidays={holidays}
            onClose={() => setHolidayManagerOpen(false)}
            onChanged={() => {
              reload();
              setMessage('Global holidays updated. Select the holidays that should apply to this cohort.');
            }}
          />
        )}
      </div>
    </div>
  ), document.body);
}

function PopupTrail({ current, stepIndex }: { current: WizardStep; stepIndex: number }) {
  return (
    <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
      {steps.map((item, index) => {
        const active = item.key === current;
        const complete = index < stepIndex;
        return (
          <div key={item.key} className="flex shrink-0 items-center gap-2">
            <span className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-bold transition-smooth ${active ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-background-200 bg-background-100 text-foreground-400'}`}>
              <i className={`${complete ? 'ri-check-line' : item.icon} text-[12px]`}></i>
              {item.label}
            </span>
            {index < steps.length - 1 && <span className={`h-0.5 w-5 rounded-full ${complete ? 'bg-emerald-300' : 'bg-background-200'}`} />}
          </div>
        );
      })}
    </div>
  );
}

function NestedPopupBackdrop({
  stepIndex,
  programme,
  cohort,
  group,
}: {
  stepIndex: number;
  programme: CurriculumProgramme;
  cohort: CohortDraft;
  group: GroupDraft & { deliveryDay?: string };
}) {
  const cards = [
    {
      label: 'Programme',
      title: programme?.name || 'Programme',
      meta: programme?.level || programme?.status || 'Created',
      color: programme?.color || '#2563eb',
      icon: 'ri-book-2-line',
    },
    {
      label: 'Cohort',
      title: cohort.name || 'Cohort',
      meta: cohort.startDate && cohort.endDate ? `${cohort.startDate} to ${cohort.endDate}` : 'Dates selected',
      color: cohort.color,
      icon: 'ri-calendar-event-line',
    },
    {
      label: 'Group',
      title: group.name || 'Group',
      meta: group.deliveryDay || group.deliveryDays.join(', ') || 'Delivery selected',
      color: group.color,
      icon: 'ri-team-line',
    },
    {
      label: 'Modules',
      title: 'Modules',
      meta: `${formatModuleCount(configuredModuleCount(group))} inside selected group`,
      color: '#7c3aed',
      icon: 'ri-stack-line',
    },
  ].slice(0, Math.max(0, Math.min(stepIndex, 4)));

  if (!cards.length) return null;

  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-0 hidden -translate-y-1/2 flex-col gap-3 xl:flex">
      {cards.map((card, index) => (
        <div
          key={card.label}
          className="w-64 rounded-2xl border border-white/15 bg-background-50/80 p-3 shadow-2xl backdrop-blur-sm"
          style={{ transform: `translate(${index * 14}px, ${index * 8}px)`, opacity: 0.95 - index * 0.12 }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: card.color }}>
              <i className={card.icon}></i>
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-foreground-400">{card.label}</p>
              <p className="truncate text-[12px] font-heading font-bold text-foreground-950">{card.title}</p>
              <p className="truncate text-[10px] font-semibold text-foreground-500">{card.meta}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftSwitcher({
  label,
  items,
  activeId,
  onSelect,
  onAdd,
  addLabel,
  expandedId,
  onToggleItem,
  onRemoveItem,
  removingId,
  compact,
}: {
  label: string;
  items: Array<{ id: string; label: string; meta: string; color?: string }>;
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  addLabel: string;
  expandedId?: string;
  onToggleItem?: (id: string) => void;
  onRemoveItem?: (id: string) => void | Promise<void>;
  removingId?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`${compact ? 'mb-3' : 'mb-4'} rounded-xl border border-background-200 bg-background-50 px-3 py-2 shadow-sm`}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            title={open ? `Collapse ${label}` : `Expand ${label}`}
          >
            <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
          </button>
        </div>
        <button type="button" onClick={onAdd} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700">
          <i className="ri-add-line"></i>
          {addLabel}
        </button>
      </div>
      {open && (
        <div className={`${compact ? 'mt-1.5' : 'mt-2'} min-w-0`}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map(item => {
              const removing = removingId === item.id;
              return (
              <div
                key={item.id}
                className={`flex ${compact ? 'min-w-[150px]' : 'min-w-[172px]'} overflow-hidden rounded-lg border text-left transition-smooth ${removing ? 'pointer-events-none opacity-60' : ''} ${item.id === activeId ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-background-200 bg-background-100/60 hover:border-primary-200'}`}
                style={{ borderLeftColor: item.color || undefined, borderLeftWidth: item.color ? 4 : undefined }}
                aria-busy={removing}
              >
                <button type="button" onClick={() => onSelect(item.id)} disabled={removing} className={`min-w-0 flex-1 px-3 ${compact ? 'py-1.5' : 'py-2'} text-left disabled:cursor-wait`}>
                  <span className="flex items-center gap-2">
                    {item.color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }}></span>}
                    <span className="block min-w-0 truncate text-[12px] font-bold text-foreground-950">{item.label}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-500">{item.meta}</span>
                </button>
                {onToggleItem && (
                  <button
                    type="button"
                    onClick={() => onToggleItem(item.id)}
                    disabled={removing}
                    className={`flex w-8 shrink-0 items-center justify-center border-l transition-smooth ${expandedId === item.id ? 'border-primary-200 text-primary-700' : 'border-background-200 text-foreground-400 hover:bg-primary-50 hover:text-primary-700'}`}
                    aria-label={`${expandedId === item.id ? 'Collapse' : 'Expand'} ${item.label}`}
                  >
                    <i className={`${expandedId === item.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
                  </button>
                )}
                {onRemoveItem && (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={removing}
                    className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 disabled:cursor-wait"
                    aria-label={removing ? `Removing ${item.label}` : `Remove ${item.label}`}
                  >
                    <i className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></i>
                  </button>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeCard({
  icon,
  label,
  title,
  meta,
  color,
  compact,
  children,
}: {
  icon: string;
  label: string;
  title: string;
  meta: string;
  color: string;
  compact?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className={`rounded-2xl border border-background-200 bg-background-100/40 ${compact ? 'p-3' : 'p-4'} shadow-sm`} style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
      <div className={`${open ? (compact ? 'mb-3' : 'mb-4') : ''} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex ${compact ? 'h-9 w-9' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl text-white shadow-sm`} style={{ backgroundColor: color }}>
            <i className={`${icon} ${compact ? 'text-base' : 'text-lg'}`}></i>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
            <h4 className={`${compact ? 'text-sm' : 'text-base'} mt-0.5 truncate font-heading font-bold text-foreground-950`}>{title}</h4>
            <p className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-[12px]'} font-semibold text-foreground-500`}>{meta}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-background-50 px-3 py-1 text-[11px] font-bold text-foreground-600">Parent</span>
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            title={open ? 'Collapse section' : 'Expand section'}
          >
            <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
          </button>
        </div>
      </div>
      {open && children}
    </section>
  );
}

function NestedScopeCard({
  icon,
  label,
  title,
  meta,
  color,
  badge,
  compact,
  children,
}: {
  icon: string;
  label: string;
  title: string;
  meta: string;
  color: string;
  badge: string;
  compact?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className={`rounded-2xl border border-background-200 bg-background-50 ${compact ? 'p-3' : 'p-4'} shadow-sm`} style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
      <div className={`${open ? (compact ? 'mb-3' : 'mb-4') : ''} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex ${compact ? 'h-9 w-9' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl text-white shadow-sm`} style={{ backgroundColor: color }}>
            <i className={`${icon} ${compact ? 'text-base' : 'text-lg'}`}></i>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase" style={{ color }}>{label}</p>
            <h4 className={`${compact ? 'text-sm' : 'text-base'} mt-0.5 truncate font-heading font-bold text-foreground-950`}>{title}</h4>
            <p className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-[12px]'} font-semibold text-foreground-500`}>{meta}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ backgroundColor: `${color}14`, color }}>
            {badge}
          </span>
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            title={open ? 'Collapse section' : 'Expand section'}
          >
            <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
          </button>
        </div>
      </div>
      {open && children}
    </section>
  );
}

function WeekdayCheckboxes({ label, value, onChange, error, compact }: { label: string; value: string[]; onChange: (value: string[]) => void; error?: string; compact?: boolean }) {
  const selected = new Set(value);
  const toggle = (day: string) => {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange(weekDays.filter(option => next.has(option)));
  };

  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-foreground-400">{label} *</p>
      <div className={`mt-1 grid ${compact ? 'grid-cols-4 gap-1.5 sm:grid-cols-7 xl:grid-cols-4' : 'grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4'}`}>
        {weekDays.map(day => {
          const checked = selected.has(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              className={`flex ${compact ? 'h-9 gap-1.5 px-2' : 'h-10 gap-2 px-3'} items-center rounded-lg border text-left text-[11px] font-bold transition-smooth ${checked ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-background-200 bg-background-50 text-foreground-600 hover:border-primary-200'}`}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-primary-500 bg-primary-600 text-white' : 'border-foreground-300 bg-background-50'}`}>
                {checked && <i className="ri-check-line text-[11px]"></i>}
              </span>
              {day.slice(0, 3)}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p> : !compact && <p className="mt-1 text-[11px] text-foreground-400">Choose one or more delivery days per week.</p>}
    </div>
  );
}

function StepPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-2xl bg-background-50 p-4 sm:p-5">
      <div className={`${open ? 'mb-5' : ''} flex items-start justify-between gap-3`}>
        <div>
          <h3 className="text-base font-heading font-bold text-foreground-950">{title}</h3>
          <p className="mt-1 text-[12px] leading-5 text-foreground-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          title={open ? 'Collapse section' : 'Expand section'}
        >
          <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xl`}></i>
        </button>
      </div>
      {open && children}
    </section>
  );
}

function AdvancedSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:col-span-2 rounded-xl border border-background-200 bg-background-100/60">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span>
          <span className="block text-[12px] font-heading font-bold text-foreground-900">{title}</span>
          <span className="mt-0.5 block text-[11px] text-foreground-500">{description}</span>
        </span>
        <i className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-background-200 px-4 py-4 lg:grid-cols-[220px_1fr]">
          {children}
        </div>
      )}
    </div>
  );
}

function CurrentParentBanner({
  icon,
  label,
  title,
  meta,
  color,
  next,
}: {
  icon: string;
  label: string;
  title: string;
  meta: string;
  color: string;
  next: string;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: color }}>
            <i className={`${icon} text-lg`}></i>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-emerald-700">{label}</p>
            <p className="truncate text-sm font-heading font-bold text-foreground-950">{title}</p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground-500">{meta}</p>
          </div>
        </div>
        <span className="rounded-full bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-700 shadow-sm">{next}</span>
      </div>
    </div>
  );
}

function HolidaySelector({
  holidays,
  cohortStartDate,
  cohortDurationMonths,
  selectedIds,
  onChange,
  onManage,
}: {
  holidays: CurriculumHoliday[];
  cohortStartDate: string;
  cohortDurationMonths: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onManage: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectableIds = useMemo(
    () => selectHolidayIdsInAdjustedCohortRange(cohortStartDate, cohortDurationMonths, holidays, []),
    [cohortDurationMonths, cohortStartDate, holidays],
  );
  const selectableSet = useMemo(() => new Set(selectableIds), [selectableIds]);
  const selectedInRangeIds = selectedIds.filter(id => selectableSet.has(id));
  const selectedSet = new Set(selectedInRangeIds);

  useEffect(() => {
    if (selectedInRangeIds.length === selectedIds.length) return;
    onChange(selectedInRangeIds);
  }, [onChange, selectedIds.length, selectedInRangeIds]);

  const toggle = (id: string) => {
    if (!selectableSet.has(id)) return;
    const next = new Set(selectedInRangeIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(Array.from(next));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200/80 bg-background-50 shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <i className="ri-sun-cloudy-line text-lg"></i>
            </span>
            <div>
              <p className="text-sm font-heading font-bold text-foreground-950">Cohort holidays</p>
              <p className="mt-1 text-[12px] leading-5 text-foreground-600">Only selected holidays will affect this cohort's module/session dates.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:min-w-[360px]">
              <div className="grid grid-cols-3 gap-2 text-center">
                <HolidayCount label="Global" value={holidays.length} />
              <HolidayCount label="In range" value={selectableIds.length} />
              <HolidayCount label="Selected" value={selectedInRangeIds.length} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-background-200/70 p-4">
        <button type="button" onClick={() => onChange(selectableIds)} className="rounded-lg border border-amber-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-700 hover:bg-amber-100 transition-smooth">
          Select in range ({selectableIds.length})
        </button>
        <button type="button" onClick={() => onChange(selectableIds)} className="rounded-lg border border-amber-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-700 hover:bg-amber-100 transition-smooth">
          Select all
        </button>
        <button type="button" onClick={() => onChange([])} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-100 transition-smooth">
          Clear selected
        </button>
        <button type="button" onClick={() => setExpanded(current => !current)} className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100 transition-smooth">
          <i className={`${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} mr-1`}></i>
          {expanded ? 'Hide holiday list' : 'Browse holidays'}
        </button>
        <button type="button" onClick={onManage} className="rounded-lg bg-primary-600 px-3 py-1.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700">
          <i className="ri-settings-3-line mr-1"></i>
          Manage global holidays
        </button>
        <span className="ml-auto rounded-full bg-background-100 px-3 py-1.5 text-[11px] font-bold text-foreground-600">
          {selectedInRangeIds.length} selected in cohort range
        </span>
      </div>

      {selectedInRangeIds.length > 0 && !expanded && (
        <div className="border-b border-background-200/70 bg-background-100/40 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {holidays.filter(holiday => selectedSet.has(holidayId(holiday))).slice(0, 5).map(holiday => (
              <span key={holidayId(holiday)} className="rounded-full bg-background-50 px-3 py-1 text-[11px] font-bold text-foreground-700 shadow-sm">
                {holiday.label}
              </span>
            ))}
            {selectedInRangeIds.length > 5 && <span className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">+{selectedInRangeIds.length - 5} more</span>}
          </div>
        </div>
      )}

      {expanded && <div className="max-h-72 space-y-2 overflow-y-auto p-4">
        {holidays.length ? holidays.map(holiday => {
          const id = holidayId(holiday);
          const checked = selectedSet.has(id);
          const inRange = selectableSet.has(id);
          return (
            <label key={id} className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition-smooth ${inRange ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'} ${checked ? 'border-amber-300 bg-amber-50/60 shadow-sm' : 'border-background-200 bg-background-50 hover:border-amber-200'}`}>
              <input type="checkbox" checked={checked} disabled={!inRange} onChange={() => toggle(id)} className="mt-1 h-4 w-4 accent-amber-600 disabled:cursor-not-allowed disabled:opacity-40" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-foreground-900">{holiday.label || 'Holiday'}</span>
                <span className="mt-0.5 block text-[11px] text-foreground-500">{holiday.startDate}{holiday.endDate && holiday.endDate !== holiday.startDate ? ` to ${holiday.endDate}` : ''}</span>
              </span>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${inRange ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>
                {inRange ? 'In range' : 'Out of range'}
              </span>
            </label>
          );
        }) : (
          <EmptyState text="No global holidays found. Add global holidays from the holiday manager before selecting them for a cohort." />
        )}
      </div>}
    </div>
  );
}

function HolidayCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-amber-100 bg-background-50 px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
      <p className="mt-0.5 text-sm font-heading font-bold text-foreground-950">{value}</p>
    </div>
  );
}

type HolidayManagerDraft = {
  id?: string | number;
  label: string;
  type: string;
  color: string;
  startDate: string;
  endDate: string;
};

const emptyHolidayManagerDraft: HolidayManagerDraft = {
  label: '',
  type: '',
  color: '#0f766e',
  startDate: '',
  endDate: '',
};

type HolidayTypeDraft = {
  original: string;
  name: string;
  color: string;
};

type HolidayTypeDefinition = {
  name: string;
  color: string;
  count: number;
  custom?: boolean;
};

const HOLIDAY_TYPE_STORE_KEY = 'lms.curriculum.holiday-types.v1';
const NEW_HOLIDAY_TYPE_BUSY_KEY = '__new_holiday_type__';

function readStoredHolidayTypes(): HolidayTypeDefinition[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HOLIDAY_TYPE_STORE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return Array.isArray(values)
      ? values
          .map(item => ({
            name: String(item?.name || '').trim(),
            color: String(item?.color || '#7c3aed'),
            count: 0,
            custom: true,
          }))
          .filter(item => item.name)
      : [];
  } catch {
    return [];
  }
}

function writeStoredHolidayTypes(types: HolidayTypeDefinition[]) {
  if (typeof window === 'undefined') return;
  const customTypes = types
    .filter(type => type.custom)
    .map(type => ({ name: type.name, color: type.color }));
  window.localStorage.setItem(HOLIDAY_TYPE_STORE_KEY, JSON.stringify(customTypes));
}

function upsertStoredHolidayType(types: HolidayTypeDefinition[], name: string, color: string) {
  const nextName = name.trim();
  const existingIndex = types.findIndex(type => normalise(type.name) === normalise(nextName));
  if (existingIndex >= 0) {
    return types.map((type, index) => index === existingIndex ? { ...type, name: nextName, color, custom: true } : type);
  }
  return [...types, { name: nextName, color, count: 0, custom: true }];
}

function HolidayManagerModal({
  holidays,
  onClose,
  onChanged,
}: {
  holidays: CurriculumHoliday[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<HolidayManagerDraft>(emptyHolidayManagerDraft);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [typeBusy, setTypeBusy] = useState<string | null>(null);
  const [typeDraft, setTypeDraft] = useState<HolidayTypeDraft | null>(null);
  const [customTypes, setCustomTypes] = useState<HolidayTypeDefinition[]>(() => readStoredHolidayTypes());
  const [collapsedHolidayYears, setCollapsedHolidayYears] = useState<Record<string, boolean>>({});
  const [holidaySearch, setHolidaySearch] = useState('');
  const [holidayTypeFilter, setHolidayTypeFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editing = draft.id !== undefined && draft.id !== null;
  const typeLibrary = useMemo(() => buildHolidayTypeLibrary(holidays, customTypes), [customTypes, holidays]);
  const filteredHolidays = useMemo(
    () => filterHolidays(holidays, holidaySearch, holidayTypeFilter),
    [holidaySearch, holidayTypeFilter, holidays],
  );
  const holidayYearGroups = useMemo(() => buildHolidayYearGroups(filteredHolidays), [filteredHolidays]);
  const holidayYears = useMemo(() => buildHolidayYearGroups(holidays).map(group => group.year), [holidays]);
  const canSave = Boolean(draft.label.trim() && draft.startDate && draft.endDate);

  const updateDraft = (patch: Partial<HolidayManagerDraft>) => setDraft(current => ({ ...current, ...patch }));
  const persistCustomTypes = (nextTypes: HolidayTypeDefinition[]) => {
    setCustomTypes(nextTypes);
    writeStoredHolidayTypes(nextTypes);
  };
  const toggleHolidayYear = (year: string) => {
    setCollapsedHolidayYears(current => ({ ...current, [year]: !current[year] }));
  };
  const collapseAllHolidayYears = () => {
    setCollapsedHolidayYears(Object.fromEntries(holidayYears.map(year => [year, true])));
  };
  const expandAllHolidayYears = () => {
    setCollapsedHolidayYears({});
  };

  const editHoliday = (holiday: CurriculumHoliday) => {
    setError(null);
    setDraft({
      id: holiday.id,
      label: holiday.label || '',
      type: holiday.type || '',
      color: holiday.color || '#0f766e',
      startDate: holiday.startDate || '',
      endDate: holiday.endDate || holiday.startDate || '',
    });
  };

  const resetDraft = () => {
    setError(null);
    setDraft(emptyHolidayManagerDraft);
  };

  const saveHoliday = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    const payload: CurriculumHolidayInput = {
      label: draft.label.trim(),
      type: draft.type.trim(),
      color: draft.color,
      startDate: draft.startDate,
      endDate: draft.endDate,
    };
    try {
      if (editing && draft.id !== undefined) {
        await updateCurriculumHoliday(draft.id, payload);
      } else {
        await createCurriculumHoliday(payload);
      }
      resetDraft();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save holiday.');
    } finally {
      setSaving(false);
    }
  };

  const archiveHoliday = async (holiday: CurriculumHoliday) => {
    if (busyId) return;
    const holidayName = holiday.label || 'This holiday';
    await confirmDestructiveAction({
      title: 'Delete holiday?',
      text: `${holidayName} will be removed from the global holiday library.`,
      confirmButtonText: 'Yes, delete it',
      successTitle: 'Holiday deleted',
      successText: `${holidayName} was removed successfully.`,
      onConfirm: async () => {
        setBusyId(holiday.id);
        setError(null);
        try {
          await archiveCurriculumHoliday(holiday.id);
          if (draft.id === holiday.id) resetDraft();
          onChanged();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unable to delete holiday.';
          setError(message);
          throw new Error(message);
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const startNewType = () => {
    setError(null);
    setTypeDraft({ original: '', name: '', color: draft.color || '#7c3aed' });
  };

  const saveType = async () => {
    if (!typeDraft || !typeDraft.name.trim() || typeBusy) return;
    const originalName = typeDraft.original.trim();
    const nextName = typeDraft.name.trim();
    const affected = originalName ? holidays.filter(holiday => holiday.type === originalName) : [];
    const busyKey = originalName || NEW_HOLIDAY_TYPE_BUSY_KEY;
    setTypeBusy(busyKey);
    setError(null);
    try {
      if (affected.length) {
        await Promise.all(affected.map(holiday => updateCurriculumHoliday(holiday.id, {
          type: nextName,
          color: typeDraft.color,
        })));
      }
      const existingCustom = customTypes.some(type => normalise(type.name) === normalise(originalName || nextName));
      if (!originalName || existingCustom) {
        const renamedTypes = originalName
          ? customTypes.filter(type => normalise(type.name) !== normalise(originalName))
          : customTypes;
        persistCustomTypes(upsertStoredHolidayType(renamedTypes, nextName, typeDraft.color));
      }
      if (!originalName || draft.type === originalName) updateDraft({ type: nextName, color: typeDraft.color });
      setTypeDraft(null);
      if (affected.length) onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update holiday type.');
    } finally {
      setTypeBusy(null);
    }
  };

  const removeType = async (typeName: string) => {
    if (!typeName || typeBusy) return;
    const affected = holidays.filter(holiday => holiday.type === typeName);
    await confirmDestructiveAction({
      title: 'Delete holiday type?',
      text: affected.length
        ? `${typeName} will be removed from ${affected.length} holiday period${affected.length === 1 ? '' : 's'}.`
        : `${typeName} will be removed from the reusable holiday types list.`,
      confirmButtonText: 'Yes, delete type',
      successTitle: 'Holiday type deleted',
      successText: affected.length
        ? `${typeName} was cleared from linked holiday periods.`
        : `${typeName} was removed from the type list.`,
      onConfirm: async () => {
        setTypeBusy(typeName);
        setError(null);
        try {
          if (affected.length) {
            await Promise.all(affected.map(holiday => updateCurriculumHoliday(holiday.id, { type: '' })));
          }
          const nextCustomTypes = customTypes.filter(type => normalise(type.name) !== normalise(typeName));
          if (nextCustomTypes.length !== customTypes.length) persistCustomTypes(nextCustomTypes);
          if (draft.type === typeName) updateDraft({ type: '' });
          if (typeDraft?.original === typeName) setTypeDraft(null);
          if (affected.length) onChanged();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unable to delete holiday type.';
          setError(message);
          throw new Error(message);
        } finally {
          setTypeBusy(null);
        }
      },
    });
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4" onClick={event => event.stopPropagation()}>
      <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-2xl">
        <header className="border-b border-foreground-200/60 bg-background-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <i className="ri-sun-cloudy-line text-xl"></i>
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-700">Curriculum Studio</p>
                <h3 className="mt-1 text-base font-heading font-bold text-foreground-950">Holidays & non-teaching periods</h3>
                <p className="mt-1 text-[12px] leading-5 text-foreground-500">Manage global holidays here, then select which ones apply to this cohort.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-700 hover:bg-background-200">
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
        </header>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-[12px] font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-background-100/70 md:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-background-200/70 bg-background-50 p-4 md:border-b-0 md:border-r">
            <div className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase text-foreground-400">{editing ? 'Edit period' : 'Add new period'}</p>
                  <p className="mt-1 text-sm font-heading font-bold text-foreground-950">{editing ? draft.label || 'Selected holiday' : 'Create global holiday'}</p>
                </div>
                {editing && (
                  <button type="button" onClick={resetDraft} className="rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 hover:bg-background-100">
                    New
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <Field label="Name" value={draft.label} onChange={value => updateDraft({ label: value })} placeholder="Example: Christmas Break" required />
                <HolidayTypeLibraryPanel
                  types={typeLibrary}
                  activeType={draft.type}
                  typeDraft={typeDraft}
                  busyType={typeBusy}
                  onAdd={startNewType}
                  onSelect={type => updateDraft({ type: type.name, color: type.color })}
                  onStartEdit={type => setTypeDraft({ original: type.name, name: type.name, color: type.color })}
                  onDraftChange={patch => setTypeDraft(current => current ? { ...current, ...patch } : current)}
                  onCancelEdit={() => setTypeDraft(null)}
                  onSaveEdit={saveType}
                  onRemove={removeType}
                />
                <Field label="Start date" type="date" value={draft.startDate} onChange={value => updateDraft({ startDate: value, endDate: draft.endDate || value })} required />
                <Field label="End date" type="date" value={draft.endDate} onChange={value => updateDraft({ endDate: value })} required />
              </div>

              <button type="button" onClick={saveHoliday} disabled={!canSave || saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <i className="ri-save-3-line"></i>}
                {editing ? 'Save changes' : 'Add period'}
              </button>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4">
            <div className="mb-3 rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-heading font-bold text-foreground-950">Global holiday library</p>
                  <p className="mt-0.5 text-[12px] text-foreground-500">
                    {filteredHolidays.length} of {holidays.length} periods shown across {holidayYearGroups.length} years.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={expandAllHolidayYears} className="rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 hover:bg-background-100">
                    Expand all
                  </button>
                  <button type="button" onClick={collapseAllHolidayYears} className="rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 hover:bg-background-100">
                    Collapse all
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <label className="flex h-10 items-center gap-2 rounded-xl border border-background-200 bg-background-50 px-3 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100">
                  <i className="ri-search-line text-foreground-400"></i>
                  <input
                    value={holidaySearch}
                    onChange={event => setHolidaySearch(event.target.value)}
                    placeholder="Search holidays by name, type, or date..."
                    className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-foreground-900 outline-none placeholder:text-foreground-400"
                  />
                  {holidaySearch && (
                    <button type="button" onClick={() => setHolidaySearch('')} className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-400 hover:bg-background-100 hover:text-foreground-700" aria-label="Clear holiday search">
                      <i className="ri-close-line"></i>
                    </button>
                  )}
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setHolidayTypeFilter('')}
                    className={`rounded-lg px-3 py-2 text-[11px] font-bold transition-smooth ${holidayTypeFilter ? 'border border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100' : 'bg-primary-600 text-white shadow-sm'}`}
                  >
                    All types
                  </button>
                  {typeLibrary.slice(0, 4).map(type => {
                    const active = normalise(holidayTypeFilter) === normalise(type.name);
                    return (
                      <button
                        key={type.name}
                        type="button"
                        onClick={() => setHolidayTypeFilter(active ? '' : type.name)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold transition-smooth ${active ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'}`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: type.color }}></span>
                        {type.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {holidayYearGroups.length ? holidayYearGroups.map(group => {
                const collapsed = Boolean(collapsedHolidayYears[group.year]);
                return (
                  <section key={group.year} className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
                    <button
                      type="button"
                      onClick={() => toggleHolidayYear(group.year)}
                      aria-expanded={!collapsed}
                      className="flex w-full items-center justify-between gap-3 border-b border-background-200 bg-background-100/60 px-4 py-3 text-left transition-smooth hover:bg-background-100"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-50 text-foreground-600 shadow-sm">
                          <i className={`${collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase text-foreground-400">Year</p>
                          <h4 className="truncate text-sm font-heading font-bold text-foreground-950">{group.year}</h4>
                        </div>
                      </div>
                      <span className="rounded-full bg-background-50 px-3 py-1 text-[11px] font-bold text-foreground-600 shadow-sm">
                        {group.holidays.length} period{group.holidays.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="space-y-2 p-3">
                        {group.holidays.map(holiday => {
                          const color = holiday.color || '#0f766e';
                          const typeColor = typeLibrary.find(type => normalise(type.name) === normalise(holiday.type))?.color || color;
                          return (
                            <div key={holidayId(holiday)} className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-50 px-4 py-3 transition-smooth hover:border-primary-200 hover:shadow-md">
                              <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }}></span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-[13px] font-bold text-foreground-950">{holiday.label || 'Holiday'}</p>
                                  {holiday.type && (
                                    <span className="rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase" style={holidayTypeBadgeStyle(typeColor)}>
                                      {holiday.type}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[12px] font-semibold text-foreground-500">
                                  {holiday.startDate}{holiday.endDate && holiday.endDate !== holiday.startDate ? ` to ${holiday.endDate}` : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="hidden rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500 sm:inline-flex">
                                  {holidayDurationLabel(holiday)}
                                </span>
                                <button type="button" onClick={() => editHoliday(holiday)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${holiday.label}`}>
                                  <i className="ri-edit-line"></i>
                                </button>
                                <button type="button" onClick={() => archiveHoliday(holiday)} disabled={busyId === holiday.id} className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50" aria-label={`Archive ${holiday.label}`}>
                                  {busyId === holiday.id ? <span className="h-3 w-3 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" /> : <i className="ri-delete-bin-line"></i>}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              }) : (
                <EmptyState text={holidays.length ? 'No holidays match the current search or type filter.' : 'No global holidays yet. Add the first period on the left.'} />
              )}
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-background-200 bg-background-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] font-semibold text-foreground-500">Only selected holidays affect cohort dates. Managing this list does not apply holidays automatically.</p>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-primary-700">
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

function HolidayTypeLibraryPanel({
  types,
  activeType,
  typeDraft,
  busyType,
  onAdd,
  onSelect,
  onStartEdit,
  onDraftChange,
  onCancelEdit,
  onSaveEdit,
  onRemove,
}: {
  types: HolidayTypeDefinition[];
  activeType: string;
  typeDraft: HolidayTypeDraft | null;
  busyType: string | null;
  onAdd: () => void;
  onSelect: (type: HolidayTypeDefinition) => void;
  onStartEdit: (type: HolidayTypeDefinition) => void;
  onDraftChange: (patch: Partial<HolidayTypeDraft>) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRemove: (typeName: string) => void;
}) {
  const savingDraft = typeDraft ? busyType === (typeDraft.original || NEW_HOLIDAY_TYPE_BUSY_KEY) : false;
  const selectedType = types.find(type => normalise(type.name) === normalise(activeType));
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/50 p-3 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase text-foreground-400">Holiday types</p>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground-500">Choose an existing type for this period, or add a reusable type with its colour.</p>
        </div>
        <button type="button" onClick={onAdd} className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-primary-700">
          <i className="ri-add-line mr-1"></i>
          Add type
        </button>
      </div>

      {selectedType && !typeDraft && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ backgroundColor: `${selectedType.color}18`, borderColor: `${selectedType.color}55` }}>
          <span className="rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase" style={holidayTypeBadgeStyle(selectedType.color)}>
            {selectedType.name}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase text-foreground-500">Selected type</p>
            <p className="truncate text-[11px] font-semibold text-foreground-600">{selectedType.count} linked period{selectedType.count === 1 ? '' : 's'}</p>
          </div>
        </div>
      )}

      {typeDraft && (
        <div className="mb-3 rounded-xl border border-primary-200 bg-primary-50/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase text-primary-700">{typeDraft.original ? 'Edit type' : 'New type'}</p>
            <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-foreground-500">
              {typeDraft.original ? 'Updates linked periods' : 'Reusable'}
            </span>
          </div>
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase text-foreground-500">Type</span>
              <input
                value={typeDraft.name}
                onChange={event => onDraftChange({ name: event.target.value })}
                placeholder="Example: Bank Holidays"
                className="w-full rounded-lg border border-primary-200 bg-background-50 px-3 py-2 text-[12px] font-semibold text-foreground-900 outline-none focus:border-primary-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase text-foreground-500">Type colour</span>
              <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-background-50 p-2">
                <input
                  type="color"
                  value={typeDraft.color}
                  onChange={event => onDraftChange({ color: event.target.value })}
                  className="h-8 w-10 cursor-pointer rounded-md border border-background-200 bg-background-50 p-1"
                />
                <span className="rounded-md px-2 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: typeDraft.color }}>
                  {typeDraft.color.toUpperCase()}
                </span>
              </div>
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onSaveEdit} disabled={Boolean(busyType) || !typeDraft.name.trim()} className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-primary-700 disabled:opacity-50">
              {savingDraft ? 'Saving...' : typeDraft.original ? 'Save type' : 'Add type'}
            </button>
            <button type="button" onClick={onCancelEdit} className="rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] font-bold text-foreground-600 hover:bg-background-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
        {types.length ? types.map(type => {
          const selected = normalise(activeType) === normalise(type.name);
          const busy = busyType === type.name;
          return (
            <div key={type.name} className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${selected ? 'border-primary-200 bg-primary-50' : 'border-background-200 bg-background-50'}`}>
              <button type="button" onClick={() => onSelect(type)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: type.color }}></span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-foreground-800">{type.name}</span>
                <span className="rounded-full bg-background-100 px-1.5 py-0.5 text-[9px] font-bold text-foreground-500">{type.count}</span>
              </button>
              <button type="button" onClick={() => onStartEdit(type)} className="flex h-6 w-6 items-center justify-center rounded-md bg-background-100 text-foreground-500 hover:bg-primary-100 hover:text-primary-700" aria-label={`Edit ${type.name}`}>
                <i className="ri-edit-line text-[12px]"></i>
              </button>
              <button type="button" onClick={() => onRemove(type.name)} disabled={busy} className="flex h-6 w-6 items-center justify-center rounded-md bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50" aria-label={`Remove ${type.name}`}>
                {busy ? <span className="h-3 w-3 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" /> : <i className="ri-delete-bin-line text-[12px]"></i>}
              </button>
            </div>
          );
        }) : (
          <p className="rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-3 text-[11px] font-semibold text-foreground-400">
            No types yet. Add a reusable type, then assign it to holidays.
          </p>
        )}
      </div>
    </div>
  );
}

function getHolidayYear(holiday: CurriculumHoliday) {
  const startDate = dateFromInput(holiday.startDate || '');
  return startDate ? String(startDate.getFullYear()) : 'No date';
}

function filterHolidays(holidays: CurriculumHoliday[], search: string, typeFilter: string) {
  const query = normalise(search);
  const typeKey = normalise(typeFilter);
  return holidays.filter(holiday => {
    const matchesType = !typeKey || normalise(holiday.type) === typeKey;
    if (!matchesType) return false;
    if (!query) return true;
    return [
      holiday.label,
      holiday.type,
      holiday.startDate,
      holiday.endDate,
    ].some(value => normalise(value).includes(query));
  });
}

function holidayDurationLabel(holiday: CurriculumHoliday) {
  const startDate = dateFromInput(holiday.startDate || '');
  const endDate = dateFromInput(holiday.endDate || holiday.startDate || '');
  if (!startDate || !endDate) return 'No dates';
  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function buildHolidayYearGroups(holidays: CurriculumHoliday[]) {
  const groups = new Map<string, CurriculumHoliday[]>();
  holidays.forEach(holiday => {
    const year = getHolidayYear(holiday);
    groups.set(year, [...(groups.get(year) || []), holiday]);
  });
  return Array.from(groups.entries())
    .sort(([yearA], [yearB]) => {
      if (yearA === 'No date') return 1;
      if (yearB === 'No date') return -1;
      return Number(yearA) - Number(yearB);
    })
    .map(([year, items]) => ({
      year,
      holidays: [...items].sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))),
    }));
}

function buildHolidayTypeLibrary(holidays: CurriculumHoliday[], customTypes: HolidayTypeDefinition[] = []): HolidayTypeDefinition[] {
  const map = new Map<string, HolidayTypeDefinition>();
  customTypes.forEach(type => {
    const name = type.name.trim();
    if (!name) return;
    map.set(normalise(name), {
      name,
      color: type.color || '#7c3aed',
      count: 0,
      custom: true,
    });
  });
  holidays.forEach(holiday => {
    const name = String(holiday.type || '').trim();
    if (!name) return;
    const key = normalise(name);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.color = holiday.color || existing.color || '#7c3aed';
      return;
    }
    map.set(key, {
      name,
      color: holiday.color || '#7c3aed',
      count: 1,
    });
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ModulesStepWorkspace({
  cohortDrafts,
  activeCohort,
  activeGroup,
  activeModule,
  moduleDrafts,
  moduleOptions,
  tutors,
  coaches,
  groupForm,
  removingDraftId,
  validationModules,
  onSelectCohort,
  onAddCohort,
  onRemoveCohort,
  onSelectGroup,
  onAddGroup,
  onRemoveGroup,
  onSelectModule,
  onAddModule,
  onRemoveModule,
  onChangeModule,
  onSelectExistingModule,
}: {
  cohortDrafts: CohortDraft[];
  activeCohort: CohortDraft;
  activeGroup: GroupDraft;
  activeModule?: ModuleDraft;
  moduleDrafts: ModuleDraft[];
  moduleOptions: CurriculumModule[];
  tutors: string[];
  coaches: string[];
  groupForm: GroupDraft & { deliveryDay: string };
  removingDraftId: string;
  validationModules: string[];
  onSelectCohort: (id: string) => void;
  onAddCohort: () => void;
  onRemoveCohort: (id: string) => void | Promise<void>;
  onSelectGroup: (id: string) => void;
  onAddGroup: () => void;
  onRemoveGroup: (id: string) => void | Promise<void>;
  onSelectModule: (id: string) => void;
  onAddModule: () => void;
  onRemoveModule: (id: string) => void | Promise<void>;
  onChangeModule: (localId: string, patch: Partial<ModuleDraft>) => void;
  onSelectExistingModule: (draft: ModuleDraft, catalogueId: string) => void;
}) {
  const activeModuleIndex = activeModule ? Math.max(0, moduleDrafts.findIndex(draft => draft.localId === activeModule.localId)) : -1;
  const groupSchedule = `${groupForm.deliveryDay || 'No delivery days'} ${groupForm.startTime || ''}-${groupForm.endTime || addHoursToTime(groupForm.startTime, 2)}`.trim();
  const [workspaceOpen, setWorkspaceOpen] = useState(true);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <DeliveryPathPanel
          title="Delivery path"
          subtitle="Select where this module will be delivered."
          rows={[
            { label: 'Programme', value: 'Current programme', icon: 'ri-book-2-line', tone: 'bg-primary-50 text-primary-700' },
            { label: 'Cohort', value: cohortDisplayName(activeCohort), icon: 'ri-calendar-event-line', tone: 'bg-emerald-50 text-emerald-700' },
            { label: 'Group', value: activeGroup.name || 'No group selected', icon: 'ri-team-line', tone: 'bg-slate-100 text-slate-700' },
          ]}
        />

        <EntityPickerPanel
          label="Cohorts"
          count={cohortDrafts.length}
          addLabel="Add"
          onAdd={onAddCohort}
          items={cohortDrafts.map(cohort => ({
            id: cohort.localId,
            label: cohortDisplayName(cohort),
            meta: formatGroupCount(configuredGroupCount(cohort)),
            color: cohort.color,
          }))}
          activeId={activeCohort.localId}
          onSelect={onSelectCohort}
          onRemove={onRemoveCohort}
          removingId={removingDraftId}
        />

        <EntityPickerPanel
          label="Groups"
          count={activeCohort.groups.length}
          addLabel="Add"
          onAdd={onAddGroup}
          items={activeCohort.groups.map((group, index) => ({
            id: group.localId,
            label: group.name || `Group ${index + 1}`,
            meta: `${group.deliveryDays.join(', ')} ${group.startTime}-${group.endTime || addHoursToTime(group.startTime, 2)}`,
            color: group.color,
          }))}
          activeId={activeGroup.localId}
          onSelect={onSelectGroup}
          onRemove={onRemoveGroup}
          removingId={removingDraftId}
          emptyText="Add a group before assigning modules."
        />
      </aside>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
        <div className={`${workspaceOpen ? 'border-b' : ''} border-background-200 bg-gradient-to-r from-background-100 via-background-50 to-primary-50/50 px-4 py-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: groupForm.color || '#334155' }}>
                <i className="ri-team-line text-lg"></i>
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-foreground-400">Module workspace</p>
                <h4 className="truncate text-base font-heading font-bold text-foreground-950">{groupForm.name || 'Select a group'}</h4>
                <p className="mt-0.5 text-[12px] font-semibold text-foreground-500">{groupSchedule}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="rounded-full bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 shadow-sm">
                {formatModuleCount(configuredModuleCount(activeGroup))}
              </span>
              <button
                type="button"
                onClick={onAddModule}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
              >
                <i className="ri-add-line"></i>
                Add Module
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceOpen(value => !value)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 shadow-sm transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                aria-label={workspaceOpen ? 'Collapse module workspace' : 'Expand module workspace'}
                title={workspaceOpen ? 'Collapse section' : 'Expand section'}
              >
                <i className={`${workspaceOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
              </button>
            </div>
          </div>
        </div>

        {workspaceOpen && <div className="border-b border-background-200 bg-background-50 px-4 py-2.5">
          {moduleDrafts.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {moduleDrafts.map((draft, index) => {
                const active = activeModule?.localId === draft.localId;
                const title = moduleDraftDisplayName(draft, index, moduleOptions);
                const removing = removingDraftId === draft.localId;
                return (
                  <div
                    key={draft.localId}
                    className={`flex min-w-[174px] overflow-hidden rounded-xl border transition-smooth ${active ? 'border-primary-300 bg-primary-50 shadow-sm ring-2 ring-primary-100' : 'border-background-200 bg-background-100/60 hover:border-primary-200'} ${removing ? 'pointer-events-none opacity-60' : ''}`}
                    style={{ borderLeftColor: draft.color, borderLeftWidth: 4 }}
                  >
                    <button type="button" onClick={() => onSelectModule(draft.localId)} className="min-w-0 flex-1 px-3 py-1.5 text-left">
                      <span className="block truncate text-[12px] font-bold text-foreground-950">{title}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-500">
                        {isConfiguredModule(draft) ? `${draft.weeks.length} sessions` : 'Not configured'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveModule(draft.localId)}
                      disabled={removing}
                      className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 disabled:cursor-wait"
                      aria-label={`Remove ${title}`}
                    >
                      <i className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></i>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text="No modules in this group yet. Add the first module to start scheduling." />
          )}
        </div>}

        {workspaceOpen && <div className="bg-background-100/50 p-4">
          {activeModule ? (
            <ModulePlanningPanel
              key={activeModule.localId}
              draft={activeModule}
              index={activeModuleIndex}
              moduleOptions={moduleOptions}
              tutors={tutors}
              coaches={coaches}
              groupDay={groupForm.deliveryDay}
              groupTime={groupForm.startTime}
              canRemove={!removingDraftId}
              onRemove={() => onRemoveModule(activeModule.localId)}
              onChange={patch => onChangeModule(activeModule.localId, patch)}
              onSelectExisting={catalogueId => onSelectExistingModule(activeModule, catalogueId)}
            />
          ) : (
            <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-background-300 bg-background-50">
              <div className="max-w-sm px-6 py-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <i className="ri-stack-line text-xl"></i>
                </span>
                <p className="mt-3 text-sm font-heading font-bold text-foreground-950">Choose or add a module</p>
                <p className="mt-1 text-[12px] leading-5 text-foreground-500">The module form appears here after a module is selected.</p>
                <button type="button" onClick={onAddModule} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-[11px] font-bold text-white hover:bg-primary-700">
                  <i className="ri-add-line"></i>
                  Add Module
                </button>
              </div>
            </div>
          )}
          {validationModules.length > 0 && <div className="mt-4"><ValidationList items={validationModules} /></div>}
        </div>}
      </section>
    </div>
  );
}

function DeliveryPathPanel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: string; icon: string; tone: string }>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-heading font-bold text-foreground-950">{title}</p>
          <p className="mt-1 text-[12px] leading-5 text-foreground-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          title={open ? 'Collapse section' : 'Expand section'}
        >
          <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
        </button>
      </div>
      {open && <div className="mt-4 space-y-2">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-100/60 px-3 py-2.5">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${row.tone}`}>
              <i className={`${row.icon} text-sm`}></i>
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase text-foreground-400">{row.label}</p>
              <p className="truncate text-[12px] font-bold text-foreground-900">{row.value}</p>
            </div>
          </div>
        ))}
      </div>}
    </section>
  );
}

function EntityPickerPanel({
  label,
  count,
  items,
  activeId,
  onSelect,
  onAdd,
  addLabel,
  onRemove,
  removingId,
  emptyText = 'Nothing here yet.',
}: {
  label: string;
  count: number;
  items: Array<{ id: string; label: string; meta: string; color?: string }>;
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  addLabel: string;
  onRemove?: (id: string) => void | Promise<void>;
  removingId?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-2xl border border-background-200 bg-background-50 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          <p className="text-[11px] font-semibold text-foreground-500">{count} available</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onAdd} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-background-100 px-2.5 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-primary-50 hover:text-primary-700">
            <i className="ri-add-line"></i>
            {addLabel}
          </button>
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            title={open ? 'Collapse section' : 'Expand section'}
          >
            <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
          </button>
        </div>
      </div>
      {open && (items.length ? (
        <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
          {items.map(item => {
            const active = item.id === activeId;
            const removing = removingId === item.id;
            return (
              <div
                key={item.id}
                className={`flex overflow-hidden rounded-xl border transition-smooth ${active ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-background-200 bg-background-100/60 hover:border-primary-200'} ${removing ? 'pointer-events-none opacity-60' : ''}`}
                style={{ borderLeftColor: item.color, borderLeftWidth: item.color ? 4 : undefined }}
              >
                <button type="button" onClick={() => onSelect(item.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
                  <span className="block truncate text-[12px] font-bold text-foreground-950">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-500">{item.meta}</span>
                </button>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    disabled={removing}
                    className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 disabled:cursor-wait"
                    aria-label={`Remove ${item.label}`}
                  >
                    <i className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></i>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-background-300 bg-background-100/60 px-3 py-4 text-[11px] font-semibold text-foreground-400">{emptyText}</p>
      ))}
    </section>
  );
}

function ModulePlanningPanel({
  draft,
  index,
  moduleOptions,
  tutors,
  coaches,
  groupDay,
  groupTime,
  canRemove,
  onRemove,
  onChange,
  onSelectExisting,
}: {
  draft: ModuleDraft;
  index: number;
  moduleOptions: CurriculumModule[];
  tutors: string[];
  coaches: string[];
  groupDay: string;
  groupTime: string;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<ModuleDraft>) => void;
  onSelectExisting: (catalogueId: string) => void;
}) {
  const selectedModule = findModuleOption(moduleOptions, draft.catalogueId);
  const selectedModuleId = selectedModule ? moduleOptionId(selectedModule) : draft.catalogueId;
  const moduleTitle = draft.name || selectedModule?.name || `Module ${index + 1}`;
  const plannedSessionCount = Math.max(1, Number(draft.sessionsNumber) || draft.weeks.length || moduleSessionCount(selectedModule));
  const [open, setOpen] = useState(true);
  const [schedulingOpen, setSchedulingOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm" style={{ borderLeftColor: draft.color, borderLeftWidth: 4 }}>
      <div className={`flex flex-col gap-3 ${open ? 'border-b' : ''} border-background-200/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between`} style={{ background: `linear-gradient(90deg, ${draft.color}14 0%, #ffffff 68%)` }}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: draft.color }}>
            <i className="ri-book-open-line"></i>
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-heading font-bold text-foreground-950">{moduleTitle}</p>
              <span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold" style={{ color: draft.color }}>Module {index + 1}</span>
            </div>
            <p className="text-[11px] text-foreground-500">
              {draft.mode === 'existing'
                ? `${formatSessionCount(plannedSessionCount)} from linked content scheduled on ${groupDay} at ${groupTime}`
                : `${formatSessionCount(plannedSessionCount)} generated on ${groupDay} at ${groupTime}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          <button type="button" onClick={onRemove} disabled={!canRemove} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40 transition-smooth">
            <i className="ri-delete-bin-line mr-1"></i>
            Remove
          </button>
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            aria-label={open ? `Collapse ${moduleTitle}` : `Expand ${moduleTitle}`}
            title={open ? 'Collapse section' : 'Expand section'}
          >
            <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
          </button>
        </div>
      </div>

      {open && <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {moduleModeOptions.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange({ mode: option.key, catalogueId: option.key === 'new' ? '' : draft.catalogueId, name: option.key === 'new' ? '' : draft.name, notes: '' })}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-smooth ${draft.mode === option.key ? 'border-primary-300 bg-primary-50 text-primary-800 shadow-sm ring-2 ring-primary-100' : 'border-background-200 bg-background-50 text-foreground-600 hover:border-primary-200 hover:bg-background-100'}`}
            >
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${draft.mode === option.key ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-500'}`}>
                <i className={`${option.icon} text-base`}></i>
              </span>
              <span>
                <span className="block text-[13px] font-heading font-bold">{option.label}</span>
                <span className="mt-0.5 block text-[11px] font-semibold opacity-75">{option.description}</span>
              </span>
            </button>
          ))}
        </div>

        {draft.mode === 'existing' ? (
          <label className="block">
            <span className="text-[10px] font-bold uppercase text-foreground-400">Existing module *</span>
            <select value={selectedModuleId} onChange={event => onSelectExisting(event.target.value)} className="mt-1 w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-[13px] font-semibold text-foreground-900 outline-none focus:border-primary-300">
              <option value="">Select a reusable module...</option>
              {moduleOptions.map(module => (
                <option key={moduleOptionId(module)} value={moduleOptionId(module)}>
                  {module.name} - {formatSessionCount(moduleSessionCount(module))}
                </option>
              ))}
            </select>
            {selectedModule ? (
              <p className="mt-2 text-[11px] text-foreground-500">
                Loaded from Module Builder/catalogue: {selectedModule.name} - {formatSessionCount(plannedSessionCount)}. Weeks and components are read-only here.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-foreground-500">Choose a module managed in Module Builder. This wizard will link it to the selected group and schedule its sessions.</p>
            )}
          </label>
        ) : (
          <div className="space-y-2">
            <Field label="New module name" value={draft.name} onChange={value => onChange({ name: value })} required placeholder="Example: Contract Administration Fundamentals" />
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800">
              This creates the module shell for this programme. Add or refine weeks and components from Module Builder after saving.
            </p>
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-3">
          <div className="rounded-xl border border-background-200 bg-background-50/80 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase text-foreground-400">Scheduling</p>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">
                  {formatSessionCount(plannedSessionCount)}
                </span>
                <button
                  type="button"
                  onClick={() => setSchedulingOpen(value => !value)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                  aria-label={schedulingOpen ? 'Collapse scheduling' : 'Expand scheduling'}
                >
                  <i className={`${schedulingOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-base`}></i>
                </button>
              </div>
            </div>
            {schedulingOpen && <div className="flex flex-wrap items-end gap-3">
              <div className="w-[7.75rem] shrink-0">
                <ColorField label="Colour" value={draft.color} onChange={value => onChange({ color: value })} compact />
              </div>
              <div className="min-w-[10.75rem] flex-1">
                <Field label="Start date" type="date" value={draft.startDate} onChange={value => onChange({ startDate: value })} required />
              </div>
              {draft.mode === 'new' && (
                <div className="w-[7rem] shrink-0">
                  <Field label="Sessions" type="number" value={draft.sessionsNumber} onChange={value => onChange({ sessionsNumber: value })} required />
                </div>
              )}
              <div className="min-w-[10.75rem] flex-1">
                <Field label="End date" type="date" value={draft.endDate} onChange={value => onChange({ endDate: value })} />
              </div>
            </div>}
          </div>
          <div className="rounded-xl border border-background-200 bg-background-50/80 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase text-foreground-400">Delivery team</p>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">
                  Optional
                </span>
                <button
                  type="button"
                  onClick={() => setTeamOpen(value => !value)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                  aria-label={teamOpen ? 'Collapse delivery team' : 'Expand delivery team'}
                >
                  <i className={`${teamOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-base`}></i>
                </button>
              </div>
            </div>
            {teamOpen && <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
              <StaffSelect label="Tutor" value={draft.tutor} onChange={value => onChange({ tutor: value })} options={tutors} />
              <StaffSelect label="Coach" value={draft.coach} onChange={value => onChange({ coach: value })} options={coaches} />
            </div>}
          </div>
        </div>
        <TextArea label="Notes" value={userFacingNotes(draft.notes)} onChange={value => onChange({ notes: userFacingNotes(value) })} rows={2} />
        <SessionPreview draft={draft} />
      </div>}
    </div>
  );
}

function SessionPreview({ draft }: { draft: ModuleDraft }) {
  const [open, setOpen] = useState(true);
  const sessions = draft.weeks;
  return (
    <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50">
      <div className={`${open ? 'border-b' : ''} border-background-200/70 bg-background-100/70 p-3`}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase text-foreground-500">Session plan preview</p>
            <p className="mt-0.5 text-[11px] text-foreground-500">
              Original end: {draft.originalEndDate || 'N/A'} - Adjusted end: {draft.endDate || 'N/A'} - Extension: {draft.extensionDays} days
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{sessions.length} counted</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">{draft.skippedHolidaySessions.length} skipped</span>
            {draft.extensionDays > 0 && <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">+{draft.extensionDays} days</span>}
            <button
              type="button"
              onClick={() => setOpen(value => !value)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-background-200 bg-background-50 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
              aria-label={open ? 'Collapse session preview' : 'Expand session preview'}
            >
              <i className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-base`}></i>
            </button>
          </div>
        </div>
      </div>
      {open && <div className="p-3">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase text-foreground-500">Counted session dates</p>
          <p className="mt-0.5 text-[11px] text-foreground-500">These dates contribute to the required session count. Holiday clashes move the affected session to the next available delivery day.</p>
        </div>
      </div>
      {sessions.length ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map(session => (
            <div key={session.id} className={`rounded-lg border px-3 py-2 ${session.shiftedHolidaySessions?.length ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-100 bg-emerald-50/40'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-[10px] font-bold uppercase ${session.shiftedHolidaySessions?.length ? 'text-amber-800' : 'text-emerald-700'}`}>Session {session.sessionNumber}</p>
                  <p className="mt-0.5 text-[12px] font-bold text-foreground-900">{session.day.slice(0, 3)} {session.date}</p>
                </div>
                {session.shiftedHolidaySessions?.length ? (
                  <span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">Shifted</span>
                ) : null}
              </div>
              {session.shiftedHolidaySessions?.length ? (
                <div className="mt-2 rounded-lg bg-background-50 px-2.5 py-2">
                  <p className="text-[10px] font-bold uppercase text-amber-800">
                    Shifted from {formatSessionDate(session.shiftedFromDate || session.shiftedHolidaySessions[0].date)}
                  </p>
                  <div className="mt-1 space-y-1">
                    {session.shiftedHolidaySessions.map(skipped => (
                      <p key={`${session.id}-${skipped.date}-${skipped.holidayId}`} className="text-[11px] font-semibold text-foreground-600">
                        {formatSessionDate(skipped.date)} skipped: {skipped.holidayLabel}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-foreground-500">Set a start date, session count and group delivery day to preview sessions.</p>
      )}
      {draft.skippedHolidaySessions.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase text-amber-800">Skipped holiday sessions</p>
          <p className="mt-0.5 text-[11px] font-semibold text-amber-800">Skipped dates are not counted. The affected session continues moving to the next delivery day until a non-holiday date is found.</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {draft.skippedHolidaySessions.map(skipped => (
              <div key={`${skipped.date}-${skipped.holidayId}`} className="rounded-lg bg-background-50 px-3 py-2">
                <p className="text-[11px] font-bold text-amber-800">{skipped.day.slice(0, 3)} {skipped.date}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-foreground-600">{skipped.holidayLabel}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>}
    </div>
  );
}

function ModuleBuilderContentPreview({ draft, moduleOptions, programmeId, programmeName, cohort, group }: { draft: ModuleDraft; moduleOptions: CurriculumModule[]; programmeId: string; programmeName: string; cohort: CohortDraft; group: GroupDraft }) {
  const [moduleOpen, setModuleOpen] = useState(true);
  const [expandedWeekIds, setExpandedWeekIds] = useState<Set<string>>(() => new Set(draft.weeks.slice(0, 2).map(week => week.id)));
  const title = draft.name || 'Untitled module';
  const componentCount = draft.weeks.reduce((total, week) => total + week.components.length, 0);
  const moduleBuilderUrl = moduleBuilderUrlForDraft(draft, moduleOptions, programmeName, programmeId, cohort, group);

  useEffect(() => {
    setModuleOpen(true);
    setExpandedWeekIds(new Set(draft.weeks.slice(0, 2).map(week => week.id)));
  }, [draft.localId, draft.weeks]);

  const toggleWeek = (weekId: string) => {
    setExpandedWeekIds(previous => {
      const next = new Set(previous);
      next.has(weekId) ? next.delete(weekId) : next.add(weekId);
      return next;
    });
  };

  const openModuleBuilder = () => {
    if (!moduleBuilderUrl) return;
    window.open(moduleBuilderUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50">
      <div className="flex flex-col gap-2 border-b border-background-200/70 bg-background-100/50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-heading font-bold text-foreground-950">{title}</p>
          <p className="mt-0.5 text-[11px] text-foreground-500">{draft.weeks.length} scheduled weeks - {componentCount} module-builder components</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openModuleBuilder}
            disabled={!moduleBuilderUrl}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-background-200 disabled:text-foreground-400 disabled:shadow-none"
          >
            <i className="ri-external-link-line"></i>
            Open Module Builder
          </button>
          <span className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">Read-only</span>
          <button
            type="button"
            onClick={() => setModuleOpen(open => !open)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background-50 text-foreground-500 shadow-sm ring-1 ring-background-200 transition-smooth hover:bg-primary-50 hover:text-primary-700"
            aria-label={moduleOpen ? `Collapse ${title}` : `Expand ${title}`}
            title={moduleOpen ? 'Collapse module' : 'Expand module'}
          >
            <i className={`ri-arrow-down-s-line text-lg transition-transform ${moduleOpen ? 'rotate-180' : ''}`}></i>
          </button>
        </div>
      </div>
      {moduleOpen && (
        <div className="divide-y divide-background-200/70">
          {draft.weeks.map(week => {
            const open = expandedWeekIds.has(week.id);
            return (
              <div key={week.id}>
                <button type="button" onClick={() => toggleWeek(week.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-background-100/60 transition-smooth">
                  <span>
                    <span className="block text-[13px] font-bold text-foreground-900">{week.title}</span>
                    <span className="mt-0.5 block text-[11px] text-foreground-500">{week.day} {week.date} at {week.startTime}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">{week.components.length} components</span>
                    <i className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
                  </span>
                </button>
                {open && (
                  <div className="space-y-3 bg-background-100/40 px-4 pb-4">
                    {week.components.length ? (
                      <div className="space-y-3">
                        {week.components.map(component => (
                          <ReadOnlyComponentCard
                            key={component.id}
                            component={component}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="No module-builder components are defined for this week yet. Add them in Module Builder." />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReadOnlyComponentCard({ component }: { component: ModuleComponent }) {
  const typeMeta = componentTypes.find(item => item.type === component.type);
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <i className={typeMeta?.icon || 'ri-shapes-line'}></i>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-foreground-900">{component.title || typeMeta?.label || 'Component'}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">{typeMeta?.label || component.type}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{Number(component.expectedOtjh || 0)} OTJH</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{Number(component.points || 0)} pts</span>
            </div>
          </div>
          {component.description ? <p className="mt-2 text-[12px] leading-5 text-foreground-600">{component.description}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ReviewSummary({
  programme,
  cohortForm,
  groupForm,
  moduleDrafts,
  selectedHolidays,
  cohortHolidayExtensionDays,
  cohortDrafts,
  holidays,
}: {
  programme: CurriculumProgramme;
  cohortForm: { name: string; startDate: string; durationMonths: string; endDate: string; color: string; holidayIds: string[] };
  groupForm: { name: string; deliveryDay: string; startTime: string; endTime: string; color: string };
  moduleDrafts: ModuleDraft[];
  selectedHolidays: CurriculumHoliday[];
  cohortHolidayExtensionDays: number;
  cohortDrafts: CohortDraft[];
  holidays: CurriculumHoliday[];
}) {
  const configuredCohorts = cohortDrafts.length ? cohortDrafts : [{
    localId: 'current-cohort',
    name: cohortForm.name,
    startDate: cohortForm.startDate,
    durationMonths: cohortForm.durationMonths,
    endDate: cohortForm.endDate,
    color: cohortForm.color,
    holidayIds: cohortForm.holidayIds,
    groups: [{
      localId: 'current-group',
      name: groupForm.name,
      deliveryDays: groupForm.deliveryDay ? [groupForm.deliveryDay] : [],
      startTime: groupForm.startTime,
      endTime: groupForm.endTime,
      color: groupForm.color,
      modules: moduleDrafts,
    }],
  }];
  const configuredGroups = configuredCohorts.flatMap(cohort => cohort.groups.filter(isConfiguredGroup));
  const configuredModules = configuredGroups.flatMap(group => group.modules.filter(isConfiguredModule));
  const cohortCount = configuredCohorts.length;
  const groupCount = configuredGroups.length;
  const moduleCount = configuredModules.length;
  const componentCount = configuredModules.reduce((total, draft) => total + draft.weeks.reduce((weekTotal, week) => weekTotal + week.components.length, 0), 0);
  const skippedCount = configuredModules.reduce((total, draft) => total + draft.skippedHolidaySessions.length, 0);
  const programmeColor = programme?.color || '#5b21b6';

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border bg-background-50 shadow-sm" style={{ borderColor: hexToRgba(programmeColor, 0.22) }}>
        <div className="border-b px-4 py-4 sm:px-5" style={{ ...reviewTintStyle(programmeColor, 0.09, 0.2), borderBottomColor: hexToRgba(programmeColor, 0.18) }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm" style={{ backgroundColor: programmeColor }}>
                <i className="ri-book-2-line text-xl"></i>
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-700">Programme</p>
                  <ReviewBadge tone="success">Ready to create</ReviewBadge>
                  <ReviewBadge tone="info">{programme?.status || 'planned'}</ReviewBadge>
                </div>
                <h3 className="mt-1 truncate text-xl font-heading font-bold text-foreground-950">{programme?.name || 'Untitled programme'}</h3>
                <p className="mt-1 text-[12px] font-semibold text-foreground-600">{programme?.level || 'Level not set'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[30rem]">
              <ReviewStat label="Cohorts" value={String(cohortCount)} />
              <ReviewStat label="Groups" value={String(groupCount)} />
              <ReviewStat label="Modules" value={String(moduleCount)} />
              <ReviewStat label="Components" value={String(componentCount)} />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-heading font-bold text-foreground-950">Structure preview</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-foreground-500">
                <span>Programme</span>
                <i className="ri-arrow-right-s-line text-foreground-400"></i>
                <span>Cohorts</span>
                <i className="ri-arrow-right-s-line text-foreground-400"></i>
                <span>Groups</span>
                <i className="ri-arrow-right-s-line text-foreground-400"></i>
                <span>Modules</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ReviewBadge>{formatGroupCount(groupCount)}</ReviewBadge>
              <ReviewBadge tone="info">{formatModuleCount(moduleCount)}</ReviewBadge>
              <ReviewBadge tone={skippedCount ? 'warning' : 'success'}>{skippedCount} skipped sessions</ReviewBadge>
            </div>
          </div>

          <div className="space-y-4">
            {configuredCohorts.map((cohort, cohortIndex) => {
              const cohortColor = cohort.color || '#0f766e';
              const selectedForCohort = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
              const groups = cohort.groups.filter(isConfiguredGroup);
              const hasExtension = cohort.localId === 'current-cohort' && cohortHolidayExtensionDays > 0;
              return (
                <div key={cohort.localId} className="relative pl-8">
                  <span className="absolute left-3 top-12 bottom-0 w-px" style={{ backgroundColor: hexToRgba(cohortColor, 0.22) }} aria-hidden="true"></span>
                  <span className="absolute left-0 top-2 flex h-7 w-7 items-center justify-center rounded-full border-4 border-background-50 text-white shadow-sm" style={{ backgroundColor: cohortColor }}>
                    <i className="ri-calendar-event-line text-sm"></i>
                  </span>
                  <div className="rounded-2xl border p-3 shadow-sm" style={reviewTintStyle(cohortColor, 0.065, 0.2)}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-500">Cohort {cohortIndex + 1}</p>
                          <ReviewBadge>{formatGroupCount(groups.length)}</ReviewBadge>
                          <ReviewBadge tone={selectedForCohort.length ? 'warning' : 'muted'}>{selectedForCohort.length} holidays</ReviewBadge>
                          {hasExtension ? <ReviewBadge tone="warning">extended {cohortHolidayExtensionDays}d</ReviewBadge> : null}
                        </div>
                        <p className="mt-1 truncate text-base font-heading font-bold text-foreground-950">{cohort.name || `Cohort ${cohortIndex + 1}`}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-foreground-500">
                          {cohort.startDate || 'No start'} to {cohort.endDate || 'No end'} - {cohort.durationMonths || 0} months
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-3">
                      {groups.length ? groups.map((group, groupIndex) => {
                        const groupColor = group.color || '#334155';
                        const modules = group.modules.filter(isConfiguredModule);
                        return (
                          <div key={group.localId} className="relative rounded-xl border p-3 pl-4 shadow-[0_1px_0_rgba(15,23,42,0.03)]" style={reviewTintStyle(groupColor, 0.052, 0.18)}>
                            <span className="absolute -left-[1.05rem] top-5 h-px w-4" style={{ backgroundColor: hexToRgba(cohortColor, 0.24) }} aria-hidden="true"></span>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex min-w-0 gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: groupColor }}>
                                  <i className="ri-team-line"></i>
                                </span>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-[10px] font-bold uppercase text-foreground-400">Group {groupIndex + 1}</p>
                                    <ReviewBadge tone="info">{formatModuleCount(modules.length)}</ReviewBadge>
                                  </div>
                                  <p className="mt-0.5 truncate text-sm font-bold text-foreground-950">{group.name || `Group ${groupIndex + 1}`}</p>
                                  <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">
                                    {group.deliveryDays.join(', ') || 'No delivery day'} - {group.startTime || '--:--'} to {group.endTime || '--:--'}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                              {modules.length ? modules.map((draft, moduleIndex) => {
                                const draftComponentCount = draft.weeks.reduce((total, week) => total + week.components.length, 0);
                                const moduleColor = draft.color || '#7c3aed';
                                return (
                                  <div
                                    key={draft.localId}
                                    className="rounded-xl border p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
                                    style={{ ...reviewTintStyle(moduleColor, 0.045, 0.2), borderTopColor: moduleColor, borderTopWidth: 3 }}
                                  >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <p className="truncate text-[13px] font-bold text-foreground-950">{draft.name || `Module ${moduleIndex + 1}`}</p>
                                          <ReviewBadge tone={draft.mode === 'existing' ? 'info' : 'success'}>{draft.mode === 'existing' ? 'Module Builder' : 'New module'}</ReviewBadge>
                                          {draft.extensionDays > 0 ? <ReviewBadge tone="warning">extended {draft.extensionDays}d</ReviewBadge> : null}
                                        </div>
                                        <p className="mt-1 text-[11px] text-foreground-500">
                                          {draft.startDate || 'No start'} to {draft.endDate || 'No end'} - {draft.sessionsNumber || draft.weeks.length || 0} sessions
                                        </p>
                                      </div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      <ReviewMiniMetric label="Skipped" value={String(draft.skippedHolidaySessions.length)} tone={draft.skippedHolidaySessions.length ? 'warning' : 'success'} />
                                      <ReviewMiniMetric label="Content" value={String(draftComponentCount)} tone="info" />
                                      <ReviewMiniMetric label="Tutor" value={draft.tutor || 'Unassigned'} />
                                      <ReviewMiniMetric label="Coach" value={draft.coach || 'Unassigned'} />
                                    </div>
                                  </div>
                                );
                              }) : (
                                <div className="rounded-xl border border-dashed border-background-200 bg-background-100 px-3 py-4 text-[12px] font-semibold text-foreground-500">No modules configured for this group.</div>
                              )}
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="rounded-xl border border-dashed border-background-200 bg-background-50 px-3 py-4 text-[12px] font-semibold text-foreground-500">No groups configured for this cohort.</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <i className="ri-calendar-close-line text-lg"></i>
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-heading font-bold text-foreground-950">Holidays applied at the end</p>
                <ReviewBadge tone={selectedHolidays.length ? 'warning' : 'muted'}>{selectedHolidays.length}</ReviewBadge>
              </div>
              <p className="mt-1 text-[12px] text-foreground-600">These dates can extend the cohort and shift module sessions.</p>
            </div>
          </div>
          <div className="grid w-full gap-2 lg:max-w-2xl">
            {selectedHolidays.length ? configuredCohorts.map((cohort, index) => {
              const cohortHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
              if (!cohortHolidays.length) return null;
              return (
                <div key={`${cohort.localId}-holidays`} className="rounded-xl border border-amber-200/80 bg-white/80 px-3 py-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[12px] font-bold text-foreground-900">{cohort.name || `Cohort ${index + 1}`}</p>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {cohortHolidays.map(holiday => <ReviewBadge key={holidayId(holiday)} tone="warning">{holiday.label}</ReviewBadge>)}
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-xl border border-background-200 bg-white/70 px-3 py-3 text-[12px] font-semibold text-foreground-500">No holidays selected.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2 shadow-sm">
      <p className="text-[9px] font-bold uppercase text-foreground-400">{label}</p>
      <p className="mt-0.5 text-lg font-heading font-bold text-foreground-950">{value}</p>
    </div>
  );
}

function ReviewBadge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'success' | 'warning' | 'info' | 'muted' }) {
  const classes = {
    default: 'border-background-200 bg-background-50 text-foreground-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-primary-200 bg-primary-50 text-primary-700',
    muted: 'border-background-200 bg-background-100 text-foreground-500',
  }[tone];

  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${classes}`}>{children}</span>;
}

function ReviewMiniMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'info' }) {
  const toneClass = {
    default: 'bg-background-50 text-foreground-900',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    info: 'bg-primary-50 text-primary-700',
  }[tone];

  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ${toneClass}`}>
      <p className="text-[9px] font-bold uppercase opacity-70">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-bold">{value}</p>
    </div>
  );
}

function SummaryBlock({ icon, label, title, meta, color, compact = false }: { icon: string; label: string; title: string; meta: string; color?: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-background-200 bg-background-50 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: color || '#2563eb' }}>
          <i className={icon}></i>
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          <p className="mt-0.5 truncate text-[13px] font-bold text-foreground-950">{title || 'Not set'}</p>
          <p className="mt-0.5 truncate text-[11px] text-foreground-500">{meta || 'No details yet'}</p>
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ icon, label, title, meta, color, badges = [] }: { icon: string; label: string; title: string; meta: string; color: string; badges?: string[] }) {
  return (
    <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: color || '#2563eb' }}>
          <i className={`${icon} text-base`}></i>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          <p className="mt-0.5 truncate text-sm font-bold text-foreground-950">{title || 'Not set'}</p>
          <p className="mt-0.5 truncate text-[11px] text-foreground-500">{meta || 'No details'}</p>
          {badges.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {badges.filter(Boolean).map(badge => <ReviewBadge key={badge}>{badge}</ReviewBadge>)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
  disabled,
  error,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  helper?: string;
}) {
  if (type === 'date') {
    return (
      <DatePickerField
        label={label}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        error={error}
        helper={helper}
      />
    );
  }

  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}{required ? ' *' : ''}</span>
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        min={type === 'number' ? 1 : undefined}
        className={`mt-1 w-full rounded-lg border bg-background-50 px-3 py-2.5 text-[13px] font-medium text-foreground-900 outline-none transition-smooth disabled:bg-background-100 disabled:text-foreground-500 ${error ? 'border-red-300 focus:border-red-400' : 'border-background-200 focus:border-primary-300'}`}
      />
      {error ? <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p> : helper ? <p className="mt-1 text-[11px] text-foreground-400">{helper}</p> : null}
    </label>
  );
}

function ColorField({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const safeValue = value || '#000000';

  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}</span>
      <div className={`mt-1 flex h-[42px] items-center rounded-lg border border-background-200 bg-background-50 px-2 ${compact ? 'max-w-[7.75rem] gap-2' : 'gap-3'}`}>
        <input
          type="color"
          value={safeValue}
          onChange={event => onChange(event.target.value)}
          className={`${compact ? 'h-8 w-8' : 'h-8 w-10'} cursor-pointer rounded-md border border-background-200 bg-background-50 p-1`}
          aria-label={label}
        />
        <span
          className={`${compact ? 'min-w-0 truncate px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]'} rounded-md font-bold uppercase`}
          style={{ backgroundColor: compact ? 'transparent' : safeValue, color: compact ? safeValue : readableTextColor(safeValue) }}
          title={safeValue.toUpperCase()}
        >
          {safeValue.toUpperCase()}
        </span>
      </div>
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}</span>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="mt-1 w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300" />
    </label>
  );
}

function SelectNative({
  label,
  value,
  onChange,
  options,
  labels,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}{required ? ' *' : ''}</span>
      <select value={value} onChange={event => onChange(event.target.value)} required={required} className="mt-1 w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-[13px] font-semibold text-foreground-900 outline-none focus:border-primary-300">
        {options.map(option => <option key={option} value={option}>{labels?.[option] || option}</option>)}
      </select>
    </label>
  );
}

function StaffSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const filtered = options.filter(option => normalise(option).includes(normalise(query)));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}</span>
      <button type="button" onClick={() => setOpen(current => !current)} className="mt-1 flex w-full items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-left text-[13px] font-semibold text-foreground-900 hover:bg-background-100/60">
        <i className="ri-user-line text-foreground-400"></i>
        <span className="min-w-0 flex-1 truncate">{value || 'Unassigned'}</span>
        <i className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && (
        <div className="absolute z-[10030] mt-2 w-full overflow-hidden rounded-xl border border-background-200 bg-background-50 p-2 shadow-2xl">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}...`} className="mb-2 w-full rounded-lg border border-background-200 px-3 py-2 text-[12px] outline-none focus:border-primary-300" />
          <div className="max-h-56 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Unassigned</button>
            {filtered.map(option => (
              <button key={option} type="button" onClick={() => { onChange(option); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-foreground-700 hover:bg-primary-50">{option}</button>
            ))}
            {!filtered.length && <p className="px-3 py-3 text-[12px] text-foreground-400">No matching staff found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoStrip({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="lg:col-span-full flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-[12px] font-semibold text-primary-700">
      <i className={`${icon} text-sm`}></i>
      {text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-background-300 bg-background-100/40 px-4 py-6 text-center text-[12px] font-semibold text-foreground-400">
      {text}
    </div>
  );
}

function ValidationList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">
      {items.map(item => <p key={item}>{item}</p>)}
    </div>
  );
}

function PanelTone({ icon, text, tone = 'info' }: { icon: string; text: string; tone?: 'info' | 'error' }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-semibold ${tone === 'error' ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-primary-200 bg-primary-50 text-primary-700'}`}>
      <i className={`${icon} text-sm`}></i>
      {text}
    </div>
  );
}
