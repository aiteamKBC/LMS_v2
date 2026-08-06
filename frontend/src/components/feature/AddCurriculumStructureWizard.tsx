import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumStaffProfiles } from '@/hooks/useCurriculumStaffProfiles';
import { DatePickerField } from '@/components/feature/DatePickerField';
import {
  attachCurriculumModulesToGroup,
  archiveCurriculumCohort,
  archiveCurriculumGroup,
  archiveCurriculumHoliday,
  createCohortGroup,
  createCurriculumCohort,
  createCurriculumGroup,
  createCurriculumHoliday,
  createCurriculumModule,
  createCurriculumProgramme,
  fetchCurriculumModules,
  fetchCurriculumKsbSets,
  fetchCurriculumProgrammeDetail,
  fetchCurriculumStandards,
  fetchFreeProgrammeModules,
  saveFreeProgrammeModules,
  saveCurriculumProgrammeTree,
  updateCurriculumCohort,
  updateCurriculumGroup,
  updateCurriculumHoliday,
  updateCurriculumKsbFramework,
  updateCurriculumModule,
  updateCurriculumProgramme,
  type CurriculumCohort,
  type CurriculumComponent,
  type CurriculumCohortInput,
  type CurriculumGroup,
  type CurriculumGroupInput,
  type CurriculumHoliday,
  type CurriculumHolidayInput,
  type CurriculumKsbSet,
  type CurriculumModule,
  type CurriculumModuleAttachmentInput,
  type CurriculumModuleInput,
  type CurriculumProgramme,
  type CurriculumProgrammeDetail,
  type CurriculumSession,
  type CurriculumStaffProfile,
  type CurriculumStandard,
  type FreeProgrammeModule,
  type FreeProgrammeModuleInput,
} from '@/lib/curriculumApi';
import {
  componentTypes,
  createTeamsMeeting,
  createEmptyComponent,
  curriculumModuleToCatalogue,
  getDefaultStructure,
  loadModuleStructure,
  loadModuleStructuresBatch,
  loadTeamsMeetingConfiguration,
  loadTeamsMeetingArtifacts,
  MODULE_BUILDER_WIZARD_DRAFT_PREFIX,
  recalculateModule,
  saveModuleStructure,
  syncTeamsMeetingArtifacts,
  updateTeamsMeetingSchedule,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleComponentType,
  type TeamsMeetingInput,
  type TeamsMeetingOccurrence,
  type TeamsMeetingResult,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { closeCurriculumLoading, showCurriculumAlert, showCurriculumConfirm, showCurriculumLoading } from '@/components/feature/CurriculumSweetAlert';

type WizardStep = 'programme' | 'cohort' | 'group' | 'modules' | 'weeks' | 'review';
type ModuleMode = 'existing' | 'new';
type SaveIntent = 'draft' | 'final';
type ProgrammeStructureType = 'scheduled' | 'free';
type StaffOption = { value: string; label: string; email?: string; aliases?: string[] };

const MODULE_BUILDER_SYNC_CHANNEL = 'kbc-module-builder-sync';

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
  ksbMappings?: ModuleComponent['ksbMappings'];
  open: boolean;
}

interface ModuleDraft {
  localId: string;
  sourceId?: string;
  mode: ModuleMode;
  catalogueId: string;
  name: string;
  existingCatalogueId?: string;
  existingName?: string;
  existingSessionsNumber?: string;
  newName?: string;
  newSessionsNumber?: string;
  color: string;
  startDate: string;
  endDate: string;
  sessionsNumber: string;
  coach: string;
  tutor: string;
  notes: string;
  weeks: WeekDraft[];
  moduleKsbMappings?: ModuleComponent['ksbMappings'];
  skippedHolidaySessions: SkippedHolidaySession[];
  originalEndDate: string;
  extensionDays: number;
  teamsMeeting?: TeamsMeetingDraft;
}

interface TeamsMeetingDraft {
  liveSessionId: string;
  eventId: string;
  onlineMeetingId?: string;
  joinUrl: string;
  webLink: string;
  meetingOptionsUrl: string;
  organizerEmail: string;
  attendees: string[];
  presenters: string[];
  startDateTimeUtc: string;
  durationMinutes: number;
  repeat: string;
  repeatOccurrences: number;
  trackedOccurrences?: number;
  lobbyBypass: string;
  recording: string;
  spokenLanguage: string;
  meetingType: string;
  requestResponses: boolean;
  allowNewTimeProposals: boolean;
  hideAttendees: boolean;
}

interface TutorSessionSummary {
  id: string;
  tutor: string;
  tutorKey?: string;
  date: string;
  startTime: string;
  endTime: string;
  programme: string;
  cohort: string;
  group: string;
  module: string;
  sessionNumber: number;
  title: string;
  moduleLocalId?: string;
  groupLocalId?: string;
  cohortLocalId?: string;
  programmeSourceId?: string;
  cohortSourceId?: string;
  groupSourceId?: string;
  moduleSourceId?: string;
  external?: boolean;
}

interface TutorScheduleConflict {
  id: string;
  tutor: string;
  proposed: TutorSessionSummary;
  conflicting: TutorSessionSummary;
  message: string;
}

interface GroupDraft {
  localId: string;
  sourceId?: string;
  isFreeCourse?: boolean;
  name: string;
  coach: string;
  deliveryDays: string[];
  startTime: string;
  endTime: string;
  color: string;
  modules: ModuleDraft[];
}

interface CohortDraft {
  localId: string;
  sourceId?: string;
  isFreeCourse?: boolean;
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
  onSaved?: () => void | Promise<void>;
  initialProgrammeId?: string;
  initialProgramme?: CurriculumProgramme;
  initialCohortId?: string;
  initialGroupId?: string;
  startStep?: WizardStep;
  modulePlacementMode?: boolean;
}

function wizardDraftSnapshot(
  programmeForm: {
    name: string;
    standard: string;
    level: string;
    color: string;
    description: string;
    structureType: ProgrammeStructureType;
  },
  ksbSourceKind: 'profile' | 'standard',
  ksbSourceValue: string,
  cohortDrafts: CohortDraft[],
) {
  return JSON.stringify({
    programmeForm,
    ksbSourceKind,
    ksbSourceValue,
    cohortDrafts: cohortDrafts.map(cohort => ({
      ...cohort,
      groups: cohort.groups.map(group => ({
        ...group,
        modules: group.modules.map(module => ({
          ...module,
          weeks: module.weeks.map(({ open: _open, ...week }) => week),
        })),
      })),
    })),
  });
}

const steps: Array<{ key: WizardStep; label: string; icon: string }> = [
  { key: 'programme', label: 'Programme', icon: 'ri-book-2-line' },
  { key: 'cohort', label: 'Cohort', icon: 'ri-calendar-event-line' },
  { key: 'group', label: 'Group', icon: 'ri-team-line' },
  { key: 'modules', label: 'Modules', icon: 'ri-stack-line' },
  { key: 'weeks', label: 'Components', icon: 'ri-layout-row-line' },
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
  { key: 'existing', label: 'Link Existing Module', description: 'Use content already managed in Module Builder', icon: 'ri-archive-stack-line' },
  { key: 'new', label: 'Create New Module', description: 'Create an empty module shell', icon: 'ri-add-box-line' },
];
const freeProgrammeComponentTypes = componentTypes.filter(item => ![
  'live-session',
  'reflection',
  'checkpoint',
  'monthly-ksb-quiz',
  'coaching-preparation',
].includes(item.type));

function normalise(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugify(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function uniqueTextValues(values: Array<unknown>) {
  const seen = new Set<string>();
  return values
    .map(value => String(value || '').trim())
    .filter(value => {
      if (!value) return false;
      const key = normalise(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function wizardKsbSourceId(profile: CurriculumKsbSet) {
  return String(profile.frameworkId || profile.ksbProfileId || profile.profileId || profile.programmeId || profile.standard || profile.programmeName || '');
}

function wizardKsbSetCountsLabel(profile: CurriculumKsbSet) {
  const counts = profile.ksbs.reduce((total, item) => {
    const type = String(item.type || '').toLowerCase();
    if (type.startsWith('knowledge')) total.knowledge += 1;
    else if (type.startsWith('skill')) total.skill += 1;
    else if (type.startsWith('behaviour')) total.behaviour += 1;
    return total;
  }, { knowledge: 0, skill: 0, behaviour: 0 });
  return `${counts.knowledge} K / ${counts.skill} S / ${counts.behaviour} B`;
}

function wizardStandardCountsLabel(standard: CurriculumStandard) {
  const knowledge = Number(standard.knowledge) || standard.ksbs?.filter(item => String(item.type).toLowerCase().startsWith('knowledge')).length || 0;
  const skills = Number(standard.skills) || standard.ksbs?.filter(item => String(item.type).toLowerCase().startsWith('skill')).length || 0;
  const behaviours = Number(standard.behaviours) || standard.ksbs?.filter(item => String(item.type).toLowerCase().startsWith('behaviour')).length || 0;
  return `${knowledge} K / ${skills} S / ${behaviours} B`;
}

function generatedCurriculumId(prefix: 'COHORT' | 'GROUP') {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${timestamp}${suffix}`;
}

function generatedModuleBuilderId() {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MOD-${timestamp}${suffix}`;
}

// A draft represents an existing entity when it carries a stored canonical id
// (PROG-/COHORT-/GROUP-/MOD-...). This is decided from the id itself, never by
// comparing a name-derived value against a list, so an existing entity is
// always PATCHed and a rename can never fork into a POST/duplicate.
function isCanonicalCurriculumId(value: unknown, prefix: 'COHORT' | 'GROUP') {
  return typeof value === 'string' && new RegExp(`^${prefix}-[A-Z0-9]`, 'i').test(value.trim());
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

function compareDateInputs(left: string, right: string) {
  const leftDate = dateFromInput(left);
  const rightDate = dateFromInput(right);
  if (!leftDate || !rightDate) return 0;
  return leftDate.getTime() - rightDate.getTime();
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

function staffEmail(profile: CurriculumStaffProfile) {
  return String(profile.email || '').trim();
}

function staffSelectionValue(profile: CurriculumStaffProfile) {
  return staffEmail(profile) || staffName(profile);
}

function staffSelectionLabel(profile: CurriculumStaffProfile) {
  const name = staffName(profile);
  const email = staffEmail(profile);
  return email && name && normalise(name) !== normalise(email)
    ? `${name} - ${email}`
    : name || email;
}

function staffOptionMatchesValue(option: StaffOption, value: string) {
  const requested = normalise(value);
  if (!requested || requested === 'unassigned') return false;
  return [option.value, option.label, option.email, ...(option.aliases || [])].some(candidate => normalise(candidate) === requested);
}

function findStaffOption(options: StaffOption[], value: string) {
  const current = String(value || '').trim();
  if (!current) return undefined;
  const direct = options.find(option => option.value === current);
  if (direct) return direct;
  const matches = options.filter(option => staffOptionMatchesValue(option, current));
  return matches.length === 1 ? matches[0] : undefined;
}

function staffAssignment(...values: unknown[]) {
  const value = values
    .map(item => String(item || '').trim())
    .find(item => item && normalise(item) !== 'unassigned');
  return value || '';
}

function staffDisplayValue(value: unknown, options: StaffOption[] = []) {
  const current = staffAssignment(value);
  if (!current) return '';
  return findStaffOption(options, current)?.label || current;
}

function staffIdentityKey(value: unknown, options: StaffOption[] = []) {
  const current = staffAssignment(value);
  if (!current) return '';
  return normalise(findStaffOption(options, current)?.value || current);
}

function countUniqueStaffAssignments(values: unknown[], options: StaffOption[] = []) {
  const seen = new Set<string>();
  values.forEach(value => {
    const key = staffIdentityKey(value, options);
    if (!key || key === 'unassigned') return;
    seen.add(key);
  });
  return seen.size;
}

function buildStaffOptions(profiles: CurriculumStaffProfile[] = []) {
  const options = new Map<string, StaffOption>();
  profiles.forEach(profile => {
    const value = staffSelectionValue(profile);
    const key = normalise(value);
    if (!key || key === 'unassigned' || options.has(key)) return;
    const label = staffSelectionLabel(profile);
    const email = staffEmail(profile);
    options.set(key, {
      value,
      label,
      email: email || undefined,
      aliases: [staffName(profile), email, label].filter(Boolean),
    });
  });
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function moduleOptionId(module: CurriculumModule) {
  return moduleBuilderStructureId(module);
}

function isCanonicalModuleBuilderId(value: unknown) {
  return /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(String(value || '').trim());
}

function moduleOptionMatches(module: CurriculumModule, identifier: string) {
  const requested = String(identifier || '').trim();
  if (!requested) return false;
  return [
    moduleOptionId(module),
    module.moduleCatalogueId,
    module.moduleId,
    module.structureId,
    module.catalogueId,
    module.sourceId,
    module.id,
    ...(module.relatedCatalogueIds || []),
  ].some(value => String(value || '') === requested);
}

function moduleAssignmentKeyVariants(values: unknown[]) {
  const keys = new Set<string>();
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    keys.add(normalise(text));
    const canonical = text.match(/(MOD-[A-Z0-9][A-Z0-9_-]*)/i)?.[1];
    if (canonical) keys.add(normalise(canonical));
  });
  return keys;
}

function moduleDraftMatchesStaffAssignment(draft: ModuleDraft, assignment: Partial<CurriculumModule> | string | number) {
  const draftKeys = moduleAssignmentKeyVariants([
    draft.sourceId,
    draft.catalogueId,
    draft.existingCatalogueId,
  ]);
  const assignmentKeys = typeof assignment === 'object'
    ? moduleAssignmentKeyVariants([
        assignment.id,
        assignment.moduleId,
        assignment.moduleCatalogueId,
        assignment.deliveryRowId,
        assignment.deliveryModuleId,
        assignment.catalogueId,
        assignment.sourceId,
      ])
    : moduleAssignmentKeyVariants([assignment]);
  return Array.from(draftKeys).some(key => assignmentKeys.has(key));
}

function assignedTutorForDraft(draft: ModuleDraft, tutorProfiles: CurriculumStaffProfile[]) {
  for (const profile of tutorProfiles) {
    const value = staffSelectionValue(profile);
    if (!value) continue;
    const assignedModules = Array.isArray(profile.assignedModules) ? profile.assignedModules : [];
    if (assignedModules.some(module => moduleDraftMatchesStaffAssignment(draft, module))) return value;
    const assignedModuleIds = Array.isArray(profile.assignedModuleIds) ? profile.assignedModuleIds : [];
    if (assignedModuleIds.some(id => moduleDraftMatchesStaffAssignment(draft, id))) return value;
  }
  return '';
}

function findModuleOption(moduleOptions: CurriculumModule[], identifier: string) {
  return moduleOptions.find(module => moduleOptionMatches(module, identifier));
}

function contextValuesOverlap(leftValues: unknown[], rightValues: unknown[]) {
  const left = leftValues.map(normalise).filter(Boolean);
  const right = rightValues.map(normalise).filter(Boolean);
  if (right.length && !left.length) return false;
  if (!left.length || !right.length) return true;
  return left.some(value => right.includes(value));
}

function moduleMatchesDeliveryContext(module: CurriculumModule, context: {
  programmeId?: string;
  programmeName?: string;
  cohortId?: string;
  cohortName?: string;
  groupId?: string;
  groupName?: string;
}) {
  return (
    contextValuesOverlap([module.programmeId, module.programme], [context.programmeId, context.programmeName]) &&
    contextValuesOverlap([module.cohortId, module.cohort], [context.cohortId, context.cohortName]) &&
    contextValuesOverlap([module.groupId, module.group], [context.groupId, context.groupName])
  );
}

function mergeCurriculumModule(existing: CurriculumModule | undefined, next: CurriculumModule): CurriculumModule {
  if (!existing) return next;
  const existingComponentCount = curriculumModuleComponentCount(existing);
  const nextComponentCount = curriculumModuleComponentCount(next);
  const richer = nextComponentCount >= existingComponentCount ? next : existing;
  const other = richer === next ? existing : next;
  return {
    ...other,
    ...richer,
    programme: richer.programme && richer.programme !== 'Unassigned' ? richer.programme : other.programme,
    cohort: richer.cohort || other.cohort,
    group: richer.group || other.group,
    startDate: richer.startDate || other.startDate,
    endDate: richer.endDate || other.endDate,
    tutor: staffAssignment(richer.tutor, other.tutor),
    coach: staffAssignment(richer.coach, other.coach),
    notes: userFacingNotes(richer.notes) || userFacingNotes(other.notes),
    weekStructure: richer.weekStructure?.length ? richer.weekStructure : other.weekStructure,
    lessons: Math.max(Number(existing.lessons) || 0, Number(next.lessons) || 0),
    quizzes: Math.max(Number(existing.quizzes) || 0, Number(next.quizzes) || 0),
    assignments: Math.max(Number(existing.assignments) || 0, Number(next.assignments) || 0),
  };
}

function moduleBuilderDraftToCurriculumModule(module: ModuleCatalogueItem): CurriculumModule {
  return {
    id: module.id || module.catalogueId,
    moduleId: module.catalogueId,
    moduleCatalogueId: module.catalogueId,
    structureId: module.catalogueId,
    sourceId: module.catalogueId || module.sourceId,
    catalogueId: module.catalogueId,
    name: module.title,
    programmeId: module.programmeId,
    programme: module.programmeName,
    cohortId: module.cohortId || module.deliveryMetadata?.cohortId || module.sourceModule?.cohortId || '',
    cohort: module.cohort || module.deliveryMetadata?.cohort || module.sourceModule?.cohort || '',
    groupId: module.groupId || module.deliveryMetadata?.groupId || module.sourceModule?.groupId || '',
    group: module.group || module.deliveryMetadata?.group || module.sourceModule?.group || '',
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
    deliveryStatus: module.deliveryStatus,
    author: module.sourceModule?.author || 'Module Builder',
    tutor: staffAssignment(module.tutor, module.deliveryMetadata?.tutor, module.sourceModule?.tutor),
    coach: staffAssignment(module.coach, module.deliveryMetadata?.coach, module.sourceModule?.coach),
    lastUpdated: module.sourceModule?.lastUpdated || '',
    color: module.sourceModule?.color || '#2563eb',
    notes: userFacingNotes(module.description),
    sessionNames: module.weekStructure.map(week => week.title || `Week ${week.weekNumber}`),
    ksbCodes: module.moduleKsbMappings.map(mapping => mapping.code),
    moduleKsbMappings: module.moduleKsbMappings,
    weekStructure: module.weekStructure.map(week => ({
      id: week.id,
      weekNumber: week.weekNumber,
      title: week.title || `Week ${week.weekNumber}`,
      displayOrder: week.weekNumber - 1,
      ksbMappings: week.ksbMappings,
      components: week.components.map((component, componentIndex) => ({
        id: component.id,
        moduleCatalogueId: module.catalogueId,
        moduleId: module.catalogueId,
        weekId: component.weekId || week.id,
        title: component.title,
        type: component.type,
        displayOrder: componentIndex,
        module: module.title,
        programme: module.programmeName,
        week: week.title || `Week ${week.weekNumber}`,
        weekTitle: week.title || `Week ${week.weekNumber}`,
        duration: Number(component.expectedOtjh || 0),
        expectedOtjh: Number(component.expectedOtjh || 0),
        reflectionRequired: component.reflectionRequired,
        workplaceEvidenceRequired: component.workplaceEvidenceRequired,
        tutorValidationRequired: component.tutorValidationRequired,
        ksbRefs: component.ksbMappings.map(mapping => mapping.code || mapping.ksbId),
        ksbMappings: component.ksbMappings,
        status: ['published', 'review'].includes(module.status) ? module.status as 'published' | 'review' : 'draft',
        lastEdited: module.sourceModule?.lastUpdated || '',
        contentSections: 0,
        hasResources: false,
        description: component.description,
        points: component.points,
        settings: component.settings,
      })),
    })),
  };
}

function moduleBuilderStructureId(module: CurriculumModule) {
  const canonical = [
    module.moduleCatalogueId,
    module.catalogueId,
    module.structureId,
    module.moduleId,
    ...(module.relatedCatalogueIds || []),
  ].map(value => String(value || '').trim()).find(isCanonicalModuleBuilderId);
  return canonical || String(module.moduleCatalogueId || module.catalogueId || module.structureId || module.moduleId || curriculumModuleToCatalogue(module).catalogueId || '');
}

function wizardProgrammeModulesForKsbCascade(programmeId: string, programmeName: string, modules: CurriculumModule[]) {
  const programmeKeys = [programmeId, programmeName].map(normalise).filter(Boolean);
  const uniqueModules = new Map<string, CurriculumModule>();
  modules.forEach(module => {
    const moduleProgrammeKeys = [module.programmeId, module.programme].map(normalise).filter(Boolean);
    if (!programmeKeys.some(key => moduleProgrammeKeys.includes(key))) return;
    const id = moduleBuilderStructureId(module);
    if (!id || id.startsWith('training-module-')) return;
    uniqueModules.set(id, module);
  });
  return Array.from(uniqueModules.entries()).map(([id, module]) => ({ id, module }));
}

async function cascadeWizardKsbSourceToProgrammeModules(programmeId: string, programmeName: string, modules: CurriculumModule[], ksbProfileSourceId: string) {
  const programmeModules = wizardProgrammeModulesForKsbCascade(programmeId, programmeName, modules);
  if (!programmeModules.length) return 0;
  await Promise.all(programmeModules.map(({ id, module }) => updateCurriculumModule(id, {
    name: module.name,
    programmeId,
    programmeName,
    programme: programmeName,
    color: module.color,
    notes: module.notes,
    ksbProfileSourceId,
  })));
  return programmeModules.length;
}

function moduleSessionCount(module?: CurriculumModule) {
  return Math.max(1, Number(module?.sessionsNumber || module?.weeks || module?.sessionNames?.length || 1));
}

function moduleDraftSessionCount(draft: Pick<ModuleDraft, 'mode' | 'sessionsNumber' | 'weeks'>, selectedModule?: CurriculumModule) {
  if (draft.mode === 'existing' && selectedModule) return moduleSessionCount(selectedModule);
  const parsed = Number(draft.sessionsNumber);
  if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  return Math.max(0, draft.weeks.length);
}

function moduleBuilderStructureSessionCount(structure: ModuleCatalogueItem, fallback = 1) {
  if (Array.isArray(structure.weekStructure) && structure.weekStructure.length) return structure.weekStructure.length;
  return Math.max(0, Math.round(Number(structure.sessionsNumber) || Number(structure.weeks) || fallback));
}

function moduleBuilderStructureComponentCount(structure: ModuleCatalogueItem) {
  return structure.weekStructure.reduce((total, week) => total + (week.components || []).length, 0);
}

function moduleDraftComponentCount(draft: Pick<ModuleDraft, 'weeks'>) {
  return draft.weeks.reduce((total, week) => total + week.components.length, 0);
}

function curriculumModuleComponentCount(module: CurriculumModule) {
  return Math.max(
    Number(module.lessons) || 0,
    module.weekStructure?.reduce((total, week) => total + (week.components || []).length, 0) || 0,
  );
}

function userFacingNotes(value: unknown) {
  return stripInternalMetadata(value)
    .split(/\r?\n/)
    .filter(line => !/^\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours)$/i.test(line))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function stripInternalMetadata(value: unknown) {
  return String(value || '')
    .replace(/(^|\s)__[a-zA-Z0-9_]+(?::|=)?[\s\S]*?(?=\s__[a-zA-Z0-9_]+(?::|=)?|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function userFacingComponentDescription(component: ModuleComponent) {
  return userFacingNotes(component.description);
}

function isDisplayableModuleBuilderComponent(component: ModuleComponent, _weekTitle = '') {
  const description = userFacingComponentDescription(component);
  if (/placeholder lesson derived from the existing (module catalogue|delivery module)/i.test(description)) return false;
  return true;
}

function moduleDraftDisplayableComponents(draft: Pick<ModuleDraft, 'weeks'>, freeMode = false) {
  return draft.weeks.flatMap(week => (
    freeMode ? week.components : week.components.filter(component => isDisplayableModuleBuilderComponent(component, week.title))
  ));
}

function moduleDraftDisplayComponentCount(draft: Pick<ModuleDraft, 'weeks'>, freeMode = false) {
  return moduleDraftDisplayableComponents(draft, freeMode).length;
}

function uniqueKsbMappings(mappings: ModuleComponent['ksbMappings']) {
  const seen = new Set<string>();
  const unique: ModuleComponent['ksbMappings'] = [];
  mappings.forEach(mapping => {
    const key = String(mapping.code || mapping.ksbId || mapping.id || '').trim().toUpperCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(mapping);
  });
  return unique;
}

function moduleDraftKsbMappings(draft: Pick<ModuleDraft, 'weeks'>, freeMode = false) {
  const moduleMappings = 'moduleKsbMappings' in draft && Array.isArray(draft.moduleKsbMappings) ? draft.moduleKsbMappings : [];
  const weekMappings = draft.weeks.flatMap(week => week.ksbMappings || []);
  const componentMappings = moduleDraftDisplayableComponents(draft, freeMode).flatMap(component => {
    const refs = (component as ModuleComponent & { ksbRefs?: string[] }).ksbRefs || [];
    return (component.ksbMappings || []).length ? component.ksbMappings : ksbCodesToMappings(refs);
  });
  return uniqueKsbMappings([...moduleMappings, ...weekMappings, ...componentMappings]);
}

function groupKsbMappings(group: GroupDraft, freeMode = false) {
  return uniqueKsbMappings(group.modules.filter(isConfiguredModule).flatMap(draft => moduleDraftKsbMappings(draft, freeMode)));
}

function cohortKsbMappings(cohort: CohortDraft, freeMode = false) {
  return uniqueKsbMappings(cohort.groups.filter(isConfiguredGroup).flatMap(group => groupKsbMappings(group, freeMode)));
}

function programmeKsbMappings(cohorts: CohortDraft[], freeMode = false) {
  return uniqueKsbMappings(cohorts.flatMap(cohort => cohortKsbMappings(cohort, freeMode)));
}

function ksbMappingTypeInitial(mapping: ModuleComponent['ksbMappings'][number]) {
  const type = String(mapping.classification || mapping.type || '').toLowerCase();
  if (type.startsWith('knowledge')) return 'K';
  if (type.startsWith('skill')) return 'S';
  if (type.startsWith('behaviour') || type.startsWith('behavior')) return 'B';
  return '';
}

function ksbMappingTypeSummary(mappings: ModuleComponent['ksbMappings']) {
  const counts = mappings.reduce((totals, mapping) => {
    const type = ksbMappingTypeInitial(mapping);
    if (type === 'K') totals.knowledge += 1;
    if (type === 'S') totals.skills += 1;
    if (type === 'B') totals.behaviours += 1;
    return totals;
  }, { knowledge: 0, skills: 0, behaviours: 0 });
  if (!counts.knowledge && !counts.skills && !counts.behaviours) {
    return `${mappings.length} mapped`;
  }
  return `K${counts.knowledge} / S${counts.skills} / B${counts.behaviours}`;
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
  const deliveryMetadata = (module as CurriculumModule & { deliveryMetadata?: Record<string, unknown> }).deliveryMetadata || {};
  const moduleGroupValues = [module.groupId, module.group, deliveryMetadata.groupId, deliveryMetadata.group];
  const groupMatch = moduleGroupValues.some(value => valueMatchesCandidate(value, candidateKeys([group.id, group.name])));
  const cohortMatch = [module.cohortId, module.cohort, deliveryMetadata.cohortId, deliveryMetadata.cohort]
    .some(value => valueMatchesCandidate(value, candidateKeys([cohort.id, cohort.name])));
  const programmeMatch = [module.programmeId, module.programme]
    .some(value => valueMatchesCandidate(value, programmeKeys(programme)));
  if (!cohortMatch || !programmeMatch) return false;
  if (groupMatch) return true;

  const hasGroupContext = moduleGroupValues.some(value => String(value || '').trim());
  if (hasGroupContext) return false;

  const groupModuleKeys = candidateKeys(group.modules || []);
  return valueMatchesCandidate(module.name, groupModuleKeys) || (cohort.groups || []).length <= 1;
}

function uniqueModulesByName(modules: CurriculumModule[]) {
  const preferred = [...modules].sort((left, right) => curriculumModuleComponentCount(right) - curriculumModuleComponentCount(left));
  const seen = new Set<string>();
  return preferred.filter(module => {
    const key = normalise(module.name || moduleOptionId(module));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nestedGroupsForCohort(cohort: CurriculumCohort) {
  const nestedGroups = (cohort as unknown as { groups?: unknown[] }).groups;
  if (!Array.isArray(nestedGroups)) return [];
  return nestedGroups.filter((group): group is CurriculumGroup & { modules?: CurriculumModule[] } => Boolean(group && typeof group === 'object'));
}

function nestedModulesForGroup(group: CurriculumGroup) {
  const nestedModules = (group as unknown as { modules?: unknown[] }).modules;
  if (!Array.isArray(nestedModules)) return [];
  return nestedModules.filter((module): module is CurriculumModule => Boolean(module && typeof module === 'object'));
}

function curriculumComponentBelongsToModule(component: CurriculumComponent, module: CurriculumModule) {
  const moduleKeys = moduleAssignmentKeyVariants([
    moduleBuilderStructureId(module),
    module.moduleCatalogueId,
    module.moduleId,
    module.structureId,
    module.catalogueId,
    module.deliveryModuleId,
    module.legacyModuleId,
    module.id,
    module.sourceId,
  ]);
  const componentKeys = moduleAssignmentKeyVariants([
    component.moduleCatalogueId,
    component.moduleId,
    component.module,
  ]);
  return Array.from(componentKeys).some(key => moduleKeys.has(key))
    || normalise(component.module) === normalise(module.name);
}

function isPlaceholderCurriculumComponent(component: CurriculumComponent) {
  return /placeholder lesson derived from the existing (module catalogue|delivery module)/i.test(String(component.description || ''));
}

function actualWeekStructureForModule(module: CurriculumModule) {
  return (module.weekStructure || []).map(week => ({
    moduleId: moduleBuilderStructureId(module),
    summary: '',
    learningOutcomes: [],
    ...week,
    components: (week.components || []).filter(component => !isPlaceholderCurriculumComponent(component)),
  }));
}

function ksbCodesToMappings(codes: unknown[] = [], sourceId = ''): ModuleComponent['ksbMappings'] {
  return uniqueTextValues(codes).map((code, index) => ({
    id: `module-code-${slugify(code)}-${index}`,
    ksbId: String(code),
    code: String(code),
    description: '',
    sourceType: sourceId.startsWith('standard:') ? 'standard' : sourceId ? 'framework' : '',
    sourceId,
    type: 'secondary',
    classification: 'secondary',
    weight: 20,
  }));
}

function moduleKsbMappingsFromCurriculumModule(module: CurriculumModule): ModuleComponent['ksbMappings'] {
  const explicitMappings = (module.moduleKsbMappings || []) as ModuleComponent['ksbMappings'];
  if (explicitMappings.length) return explicitMappings;
  return ksbCodesToMappings(module.ksbCodes || [], module.ksbProfileSourceId || '');
}

function actualModuleCatalogueStructure(module: CurriculumModule): ModuleCatalogueItem {
  const catalogue = curriculumModuleToCatalogue(module);
  const moduleKsbMappings = moduleKsbMappingsFromCurriculumModule(module);
  return {
    ...catalogue,
    sessionsNumber: moduleSessionCount(module),
    moduleKsbMappings: moduleKsbMappings.length ? moduleKsbMappings : catalogue.moduleKsbMappings,
    ksbCount: Math.max(catalogue.ksbCount || 0, moduleKsbMappings.length),
    weekStructure: actualWeekStructureForModule(module) as unknown as ModuleCatalogueItem['weekStructure'],
  };
}

function enrichModulesWithDetailComponents(modules: CurriculumModule[], components: CurriculumComponent[] = []) {
  if (!components.length) return modules;

  return modules.map(module => {
    const relatedComponents = components.filter(component => curriculumComponentBelongsToModule(component, module));
    if (!relatedComponents.length) return module;

    const existingWeeks = module.weekStructure || [];
    const hasActualWeekComponents = existingWeeks.some(week => (
      (week.components || []).some(component => !isPlaceholderCurriculumComponent(component))
    ));
    if (hasActualWeekComponents) return module;

    const weekCount = Math.max(1, Number(module.sessionsNumber || module.weeks || existingWeeks.length || module.sessionNames?.length || 1) || 1);
    const weeks = Array.from({ length: weekCount }, (_, index) => {
      const existing = existingWeeks[index];
      return {
        id: existing?.id || `${moduleBuilderStructureId(module) || module.id}-week-${index + 1}`,
        weekNumber: existing?.weekNumber || index + 1,
        title: existing?.title || module.sessionNames?.[index] || `Week ${index + 1}`,
        displayOrder: existing?.displayOrder ?? index,
        components: [] as CurriculumComponent[],
      };
    });

    relatedComponents.forEach(component => {
      const componentWeekKey = normalise(component.weekId || component.weekTitle || component.week);
      const weekByIdentity = weeks.find(week => (
        normalise(week.id) === componentWeekKey
        || normalise(week.title) === componentWeekKey
        || normalise(`Week ${week.weekNumber}`) === componentWeekKey
      ));
      if (!weekByIdentity) return;
      weekByIdentity.components = [...(weekByIdentity.components || []), component];
    });

    return {
      ...module,
      weekStructure: weeks,
      lessons: relatedComponents.length,
    };
  });
}

function moduleStaffValues(module: CurriculumModule, group?: CurriculumGroup) {
  const deliveryMetadata = (module as CurriculumModule & { deliveryMetadata?: Record<string, string> }).deliveryMetadata;
  return {
    tutor: staffAssignment(module.tutor, deliveryMetadata?.tutor, group?.tutor),
    coach: staffAssignment(module.coach, deliveryMetadata?.coach, group?.coach),
  };
}

function metadataBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function normaliseTeamsEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed !== value) return normaliseTeamsEmailList(parsed);
  } catch {
    // Legacy records may store a plain delimited string instead of JSON.
  }
  return value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean);
}

function teamsMeetingFromModule(module: CurriculumModule): TeamsMeetingDraft | undefined {
  const metadata = (module as CurriculumModule & { deliveryMetadata?: Record<string, unknown> }).deliveryMetadata || {};
  const liveComponent = (module.weekStructure || [])
    .flatMap(week => week.components || [])
    .find(component => ['live-session', 'live_session'].includes(String(component.type || '').toLowerCase()));
  const componentSettings = (liveComponent?.settings || {}) as Record<string, unknown>;
  const setting = (metadataKey: string, componentKey = metadataKey) => metadata[metadataKey] ?? componentSettings[componentKey];
  const joinUrl = String(setting('teamsMeetingUrl', 'liveSessionUrl') || '').trim();
  const eventId = String(setting('teamsEventId') || '').trim();
  if (!joinUrl && !eventId) return undefined;
  const attendees = normaliseTeamsEmailList(setting('teamsAttendees'));
  const presenters = normaliseTeamsEmailList(setting('teamsPresenters'));
  return {
    liveSessionId: String(setting('teamsLiveSessionId') || ''),
    eventId,
    onlineMeetingId: String(setting('teamsOnlineMeetingId') || ''),
    joinUrl,
    webLink: String(setting('teamsWebLink') || ''),
    meetingOptionsUrl: String(setting('teamsMeetingOptionsUrl') || ''),
    organizerEmail: String(setting('teamsOrganizerEmail') || ''),
    attendees,
    presenters,
    startDateTimeUtc: String(setting('teamsStartDateTimeUtc', 'sessionDateTimeUtc') || ''),
    durationMinutes: Number(setting('teamsDurationMinutes', 'durationMinutes') || 60),
    repeat: String(setting('teamsRepeat') || 'none'),
    repeatOccurrences: Number(setting('teamsRepeatOccurrences') || 1),
    lobbyBypass: String(setting('teamsLobbyBypass') || 'invited'),
    recording: String(setting('teamsRecording') || 'record-transcribe'),
    spokenLanguage: String(setting('teamsSpokenLanguage') || 'en-GB'),
    meetingType: String(setting('teamsMeetingType') || 'live-session'),
    requestResponses: metadataBoolean(setting('teamsRequestResponses'), true),
    allowNewTimeProposals: metadataBoolean(setting('teamsAllowTimeProposals'), true),
    hideAttendees: metadataBoolean(setting('teamsHideAttendees'), false),
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
    existingCatalogueId: moduleOptionId(module),
    existingName: module.name || '',
    existingSessionsNumber: sessionsNumber,
    newName: '',
    newSessionsNumber: '0',
    color: module.color || '#2563eb',
    startDate,
    endDate: module.endDate || plan.adjustedEndDate || startDate,
    sessionsNumber,
    coach: staff.coach,
    tutor: staff.tutor,
    notes: userFacingNotes(module.notes),
    weeks: buildWeeks(localId, plan.sessions, []),
    moduleKsbMappings: moduleKsbMappingsFromCurriculumModule(module),
    skippedHolidaySessions: plan.skippedHolidaySessions,
    originalEndDate: plan.originalEndDate,
    extensionDays: plan.extensionDays,
    teamsMeeting: teamsMeetingFromModule(module),
  };
  const structure = actualModuleCatalogueStructure(module);
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
  components: CurriculumComponent[] = [],
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
      durationMonths: String(Number(cohort.durationMonths) || Number(inclusiveMonthSpan(cohort.startDate, cohort.endDate)) || 12),
      endDate: cohort.endDate || calculateCohortEndDate(
        cohort.startDate || todayIso(),
        Number(cohort.durationMonths) || Number(inclusiveMonthSpan(cohort.startDate, cohort.endDate)) || 12,
      ),
      color: cohort.color || '#0f766e',
      holidayIds,
      groups: [],
    };

    const cohortGroups = nestedGroupsForCohort(cohort);
    const resolvedCohortGroups = cohortGroups.length ? cohortGroups : groups.filter(group => groupBelongsToCohort(group, cohort));
    cohortDraft.groups = resolvedCohortGroups.flatMap(group => {
      const times = scheduleTimes(group.schedule);
      const groupDraft: GroupDraft = {
        localId: `group-existing-${group.id}`,
        sourceId: group.id,
        name: group.name || '',
        coach: staffAssignment(group.coach),
        deliveryDays: scheduleDeliveryDays(group.schedule),
        startTime: times.startTime,
        endTime: times.endTime,
        color: String((group as { color?: string }).color || '#334155'),
        modules: [],
      };
      const nestedModules = nestedModulesForGroup(group);
      const groupModules = uniqueModulesByName(enrichModulesWithDetailComponents(
        nestedModules.length ? nestedModules : modules.filter(module => moduleBelongsToGroup(module, group, cohort, programme)),
        components,
      ));
      groupDraft.modules = groupModules.map(module => existingModuleDraft(module, groupDraft, activeHolidays, group));
      return [groupDraft];
    });

    if (initialGroupId) {
      cohortDraft.groups.sort((left, right) => Number(right.sourceId === initialGroupId) - Number(left.sourceId === initialGroupId));
    }
    return cohortDraft;
  })
    .sort((left, right) => Number(right.sourceId === initialCohortId) - Number(left.sourceId === initialCohortId));
}

function emptyModuleDraft(groupDay = '', groupTime = '09:30', activeHolidays: CurriculumHoliday[] = []): ModuleDraft {
  const localId = `module-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const plan = buildHolidayAdjustedSessionPlan(todayIso(), 0, groupDay, groupTime, activeHolidays);
  return {
    localId,
    mode: 'new',
    catalogueId: '',
    name: '',
    color: '#2563eb',
    startDate: todayIso(),
    endDate: plan.adjustedEndDate,
    sessionsNumber: '0',
    coach: '',
    tutor: '',
    notes: '',
    weeks: buildWeeks(localId, plan.sessions, []),
    skippedHolidaySessions: plan.skippedHolidaySessions,
    originalEndDate: plan.originalEndDate,
    extensionDays: plan.extensionDays,
  };
}

function wizardCloneId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneModuleDraft(draft: ModuleDraft): ModuleDraft {
  const localId = wizardCloneId('module');
  const baseName = draft.name || draft.existingName || 'Module';
  return {
    ...draft,
    localId,
    sourceId: undefined,
    mode: 'new',
    catalogueId: '',
    name: `${baseName} copy`,
    existingCatalogueId: undefined,
    existingName: undefined,
    existingSessionsNumber: undefined,
    newName: `${baseName} copy`,
    newSessionsNumber: draft.sessionsNumber,
    teamsMeeting: undefined,
    weeks: draft.weeks.map((week, index) => ({
      ...week,
      id: `${localId}-week-${week.sessionNumber || index + 1}-${Math.random().toString(36).slice(2)}`,
      open: false,
      components: week.components.map(component => ({
        ...component,
        id: wizardCloneId('component'),
        sourceId: undefined,
        moduleId: localId,
      })),
    })),
  };
}

function cloneGroupDraftForEditing(group: GroupDraft): GroupDraft {
  return {
    ...group,
    localId: wizardCloneId('group'),
    sourceId: undefined,
    name: group.name ? `${group.name} copy` : 'New group copy',
    modules: group.modules.map(cloneModuleDraft),
  };
}

function cloneCohortDraftForEditing(cohort: CohortDraft): CohortDraft {
  return {
    ...cohort,
    localId: wizardCloneId('cohort'),
    sourceId: undefined,
    name: cohort.name ? `${cohort.name} copy` : 'New cohort copy',
    groups: cohort.groups.map(cloneGroupDraftForEditing),
  };
}

function emptyGroupDraft(): GroupDraft {
  const localId = `group-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    localId,
    name: '',
    coach: '',
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

function freeProgrammeBaseName(programmeName: string) {
  return programmeName.trim() || 'Module course';
}

function freeCohortName(programmeName: string) {
  return `${freeProgrammeBaseName(programmeName)} - Free Course`;
}

function freeGroupName(programmeName: string) {
  return `${freeProgrammeBaseName(programmeName)} - Custom Modules`;
}

function isFreeCourseContainer(cohort: CohortDraft) {
  const group = cohort.groups[0];
  return Boolean(
    cohort.isFreeCourse ||
    group?.isFreeCourse ||
    normalise(cohort.name).includes('freecourse') ||
    normalise(group?.name).includes('custommodules'),
  );
}

function normaliseFreeProgrammeDrafts(drafts: CohortDraft[], programmeName: string, color: string): CohortDraft[] {
  const existingFree = drafts.find(isFreeCourseContainer) || drafts[0];
  const existingGroup = existingFree?.groups.find(group => group.isFreeCourse) || existingFree?.groups[0];
  const modules = ((existingFree && isFreeCourseContainer(existingFree))
    ? (existingGroup?.modules || [])
    : drafts.flatMap(cohort => cohort.groups.flatMap(group => group.modules)))
    .map(module => ({
      ...module,
      mode: 'new' as ModuleMode,
      catalogueId: '',
      tutor: '',
      coach: '',
      sessionsNumber: '1',
    }));
  const startDate = existingFree?.startDate || modules.find(module => module.startDate)?.startDate || todayIso();
  const durationMonths = existingFree?.durationMonths || '1';
  const endDate = existingFree?.endDate || calculateCohortEndDate(startDate, durationMonths) || startDate;

  const nextGroup: GroupDraft = {
    ...(existingGroup || emptyGroupDraft()),
    isFreeCourse: true,
    name: freeGroupName(programmeName),
    coach: '',
    deliveryDays: existingGroup?.deliveryDays?.length ? existingGroup.deliveryDays : ['Monday'],
    startTime: existingGroup?.startTime || '09:30',
    endTime: existingGroup?.endTime || addHoursToTime(existingGroup?.startTime || '09:30', 2),
    color: existingGroup?.color || '#334155',
    modules,
  };

  const nextCohort: CohortDraft = {
    ...(existingFree || emptyCohortDraft()),
    isFreeCourse: true,
    name: freeCohortName(programmeName),
    startDate,
    durationMonths,
    endDate,
    color: color || existingFree?.color || '#0f766e',
    holidayIds: existingFree?.holidayIds || [],
    groups: [nextGroup],
  };

  const previousSignature = JSON.stringify(drafts);
  const nextDrafts = [nextCohort];
  return previousSignature === JSON.stringify(nextDrafts) ? drafts : nextDrafts;
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

function formatHoursValue(hours: number) {
  const totalMinutes = Math.round(Math.max(0, Number(hours) || 0) * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours && !minutes) return '0h';
  if (!wholeHours) return `${minutes}m`;
  if (!minutes) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes}m`;
}

function componentTotalHours(components: ModuleComponent[]) {
  return components.reduce((total, component) => total + Math.max(0, Number(component.expectedOtjh) || 0), 0);
}

function moduleDraftActualComponentHours(draft: Pick<ModuleDraft, 'weeks'>, freeMode = false) {
  return componentTotalHours(moduleDraftDisplayableComponents(draft, freeMode));
}

function groupActualComponentHours(group: GroupDraft, freeMode = false) {
  return group.modules.filter(isConfiguredModule).reduce((total, draft) => total + moduleDraftActualComponentHours(draft, freeMode), 0);
}

function cohortActualComponentHours(cohort: CohortDraft, freeMode = false) {
  return cohort.groups.filter(isConfiguredGroup).reduce((total, group) => total + groupActualComponentHours(group, freeMode), 0);
}

function programmeActualComponentHours(cohorts: CohortDraft[], freeMode = false) {
  return cohorts.reduce((total, cohort) => total + cohortActualComponentHours(cohort, freeMode), 0);
}

function moduleDraftAuthoredHours(draft: ModuleDraft, moduleOptions: CurriculumModule[]) {
  const authoredTotal = componentTotalHours(moduleDraftDisplayableComponents(draft));
  if (authoredTotal > 0) return authoredTotal;
  const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  const moduleTotals = selectedModule as (CurriculumModule & { declaredTotalOtjh?: number; totalOtjh?: number }) | undefined;
  return Math.max(0, Number(moduleTotals?.declaredTotalOtjh || moduleTotals?.totalOtjh || 0) || 0);
}

function groupSessionDurationHours(group: Pick<GroupDraft, 'startTime' | 'endTime'>) {
  const [startHour, startMinute] = String(group.startTime || '').split(':').map(Number);
  const [endHour, endMinute] = String(group.endTime || addHoursToTime(group.startTime, 2)).split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const durationMinutes = endTotal >= startTotal ? endTotal - startTotal : endTotal + 1440 - startTotal;
  return Math.max(0, durationMinutes / 60);
}

function moduleDraftScheduledHours(draft: ModuleDraft, group: Pick<GroupDraft, 'startTime' | 'endTime'>, moduleOptions: CurriculumModule[]) {
  const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  return moduleDraftSessionCount(draft, selectedModule) * groupSessionDurationHours(group);
}

function moduleDraftTotalHours(draft: ModuleDraft, group: Pick<GroupDraft, 'startTime' | 'endTime'>, moduleOptions: CurriculumModule[]) {
  const authoredHours = moduleDraftAuthoredHours(draft, moduleOptions);
  return authoredHours > 0 ? authoredHours : moduleDraftScheduledHours(draft, group, moduleOptions);
}

function groupTotalHours(group: GroupDraft, moduleOptions: CurriculumModule[]) {
  return group.modules.filter(isConfiguredModule).reduce((total, draft) => total + moduleDraftTotalHours(draft, group, moduleOptions), 0);
}

function cohortTotalHours(cohort: CohortDraft, moduleOptions: CurriculumModule[]) {
  return cohort.groups.filter(isConfiguredGroup).reduce((total, group) => total + groupTotalHours(group, moduleOptions), 0);
}

function programmeTotalHours(cohorts: CohortDraft[], moduleOptions: CurriculumModule[]) {
  return cohorts.reduce((total, cohort) => total + cohortTotalHours(cohort, moduleOptions), 0);
}

function moduleDraftDisplayName(draft: ModuleDraft, index: number, moduleOptions: CurriculumModule[]) {
  const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  return draft.name.trim() || selectedModule?.name || `Module ${index + 1}`;
}

function moduleDraftChipSessionCount(draft: ModuleDraft, moduleOptions: CurriculumModule[]) {
  const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  return moduleDraftSessionCount(draft, selectedModule);
}

function timeToMinutes(value: string) {
  const normalised = toTimeInput(value);
  const [hour, minute] = normalised.split(':').map(Number);
  if (!normalised || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function normalisedTimeRange(startValue: string, endValue: string) {
  const start = timeToMinutes(startValue);
  const fallbackEnd = startValue ? addHoursToTime(startValue, 2) : '';
  const end = timeToMinutes(endValue || fallbackEnd);
  if (start === null || end === null) return null;
  return { start, end: end > start ? end : end + 1440 };
}

function timeRangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  const left = normalisedTimeRange(leftStart, leftEnd);
  const right = normalisedTimeRange(rightStart, rightEnd);
  if (!left || !right) return false;
  return left.start < right.end && right.start < left.end;
}

function dateRangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  const leftStartDate = dateFromInput(leftStart);
  const leftEndDate = dateFromInput(leftEnd || leftStart);
  const rightStartDate = dateFromInput(rightStart);
  const rightEndDate = dateFromInput(rightEnd || rightStart);
  if (!leftStartDate || !leftEndDate || !rightStartDate || !rightEndDate) return true;
  return leftStartDate <= rightEndDate && rightStartDate <= leftEndDate;
}

function formatTimeRange(startTime: string, endTime: string) {
  return `${startTime || '--:--'}-${endTime || addHoursToTime(startTime, 2) || '--:--'}`;
}

function groupCoachScheduleConflict(cohortDrafts: CohortDraft[], activeGroupId: string, savedGroups: CurriculumGroup[] = [], coachOptions: StaffOption[] = []) {
  const groups = cohortDrafts.flatMap(cohort => cohort.groups.map(group => ({ cohort, group })));
  const target = groups.find(item => item.group.localId === activeGroupId);
  if (!target) return null;
  const coach = staffAssignment(target.group.coach);
  const coachKey = staffIdentityKey(coach, coachOptions);
  if (!coachKey || coachKey === 'unassigned') return null;
  const coachLabel = staffDisplayValue(coach, coachOptions) || coach;
  const targetDays = new Set(target.group.deliveryDays);
  if (!targetDays.size || !target.group.startTime) return null;

  for (const item of groups) {
    if (item.group.localId === target.group.localId) continue;
    if (staffIdentityKey(item.group.coach, coachOptions) !== coachKey) continue;
    const overlappingDays = item.group.deliveryDays.filter(day => targetDays.has(day));
    if (!overlappingDays.length) continue;
    if (!timeRangesOverlap(target.group.startTime, target.group.endTime, item.group.startTime, item.group.endTime)) continue;
    if (!dateRangesOverlap(target.cohort.startDate, target.cohort.endDate, item.cohort.startDate, item.cohort.endDate)) continue;
    return {
      coach: coachLabel,
      groupName: item.group.name || 'another group',
      cohortName: cohortDisplayName(item.cohort),
      programmeName: '',
      days: overlappingDays,
      time: formatTimeRange(item.group.startTime, item.group.endTime || addHoursToTime(item.group.startTime, 2)),
    };
  }

  for (const group of savedGroups) {
    if (target.group.sourceId && normalise(group.id) === normalise(target.group.sourceId)) continue;
    if (staffIdentityKey(group.coach, coachOptions) !== coachKey) continue;
    const schedule = String(group.schedule || '');
    const savedDays = scheduleDeliveryDays(schedule);
    const overlappingDays = savedDays.filter(day => targetDays.has(day));
    if (!overlappingDays.length) continue;
    const savedTimes = scheduleTimes(schedule);
    if (!timeRangesOverlap(target.group.startTime, target.group.endTime, savedTimes.startTime, savedTimes.endTime)) continue;
    if (!dateRangesOverlap(target.cohort.startDate, target.cohort.endDate, group.startDate, group.endDate)) continue;
    return {
      coach: coachLabel,
      groupName: group.name || 'another group',
      cohortName: group.cohort || 'another cohort',
      programmeName: group.programme || '',
      days: overlappingDays,
      time: formatTimeRange(savedTimes.startTime, savedTimes.endTime),
    };
  }
  return null;
}

function tutorSessionsOverlap(left: TutorSessionSummary, right: TutorSessionSummary) {
  const leftTutor = left.tutorKey || normalise(left.tutor);
  const rightTutor = right.tutorKey || normalise(right.tutor);
  if (!leftTutor || leftTutor !== rightTutor) return false;
  if (!left.date || left.date !== right.date) return false;
  return timeRangesOverlap(left.startTime, left.endTime, right.startTime, right.endTime);
}

function sameSavedSessionContext(left: TutorSessionSummary, right: TutorSessionSummary) {
  if (!left.external && !right.external) return false;
  const sameCohort = Boolean(left.cohortSourceId && right.cohortSourceId && normalise(left.cohortSourceId) === normalise(right.cohortSourceId));
  const sameGroup = Boolean(left.groupSourceId && right.groupSourceId && normalise(left.groupSourceId) === normalise(right.groupSourceId));
  const sameModule = Boolean(left.moduleSourceId && right.moduleSourceId && normalise(left.moduleSourceId) === normalise(right.moduleSourceId));
  return sameCohort && sameGroup && sameModule && left.date === right.date && left.startTime === right.startTime;
}

function conflictSessionLabel(session: TutorSessionSummary) {
  const path = [session.programme, session.cohort, session.group].filter(Boolean).join(' / ');
  const title = session.title || `${session.module || 'Session'} ${session.sessionNumber}`;
  return `${title}${path ? ` (${path})` : ''}`;
}

function buildTutorConflict(proposed: TutorSessionSummary, conflicting: TutorSessionSummary): TutorScheduleConflict {
  const proposedRange = formatTimeRange(proposed.startTime, proposed.endTime);
  const conflictingRange = formatTimeRange(conflicting.startTime, conflicting.endTime);
  return {
    id: `${proposed.id}__${conflicting.id}`,
    tutor: proposed.tutor,
    proposed,
    conflicting,
    message: `${proposed.tutor} is already assigned to ${conflictSessionLabel(conflicting)} on ${formatSessionDate(proposed.date)} from ${conflictingRange}. The selected session is ${conflictSessionLabel(proposed)} from ${proposedRange}.`,
  };
}

function draftTutorSessions(cohortDrafts: CohortDraft[], moduleOptions: CurriculumModule[], tutorOptions: StaffOption[] = [], programmeName: string, programmeSourceId = '') {
  return cohortDrafts.flatMap(cohort => cohort.groups.flatMap(group => group.modules.flatMap((draft, moduleIndex) => {
    const tutorValue = staffAssignment(draft.tutor);
    const tutorKey = staffIdentityKey(tutorValue, tutorOptions);
    if (!tutorKey || !isConfiguredModule(draft)) return [];
    const tutor = staffDisplayValue(tutorValue, tutorOptions) || tutorValue;
    const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
    const moduleName = moduleDraftDisplayName(draft, moduleIndex, moduleOptions);
    const endTime = group.endTime || addHoursToTime(group.startTime, 2);
    return draft.weeks.map(session => ({
      id: `draft-${cohort.localId}-${group.localId}-${draft.localId}-${session.sessionNumber}`,
      tutor,
      tutorKey,
      date: session.date,
      startTime: session.startTime || group.startTime,
      endTime,
      programme: programmeName,
      cohort: cohortDisplayName(cohort),
      group: group.name || 'Unnamed group',
      module: moduleName,
      sessionNumber: session.sessionNumber,
      title: session.title || `${moduleName} session ${session.sessionNumber}`,
      moduleLocalId: draft.localId,
      groupLocalId: group.localId,
      cohortLocalId: cohort.localId,
      programmeSourceId,
      cohortSourceId: cohort.sourceId,
      groupSourceId: group.sourceId,
      moduleSourceId: draft.sourceId || draft.catalogueId || selectedModule?.moduleCatalogueId || selectedModule?.moduleId || selectedModule?.id,
    }));
  })));
}

function savedTutorSessions(sessions: CurriculumSession[], tutorOptions: StaffOption[] = []) {
  return sessions
    .filter(session => staffAssignment(session.tutor))
    .filter(session => !['cancelled', 'archived'].includes(normalise(session.status)))
    .map((session): TutorSessionSummary | null => {
      const tutorValue = staffAssignment(session.tutor);
      const tutorKey = staffIdentityKey(tutorValue, tutorOptions);
      if (!tutorKey) return null;
      return {
        id: `saved-${session.id}`,
        tutor: staffDisplayValue(tutorValue, tutorOptions) || tutorValue,
        tutorKey,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime || addHoursToTime(session.startTime, 2),
        programme: session.programme,
        cohort: session.cohort,
        group: session.group,
        module: session.module,
        sessionNumber: Number(session.week) || 1,
        title: session.title || session.module || 'Saved session',
        programmeSourceId: session.programmeSourceId || session.programmeId,
        cohortSourceId: session.cohortId,
        groupSourceId: session.groupId,
        moduleSourceId: session.moduleCatalogueId || session.moduleId || session.deliveryModuleId || session.legacyModuleId,
        external: true,
      };
    })
    .filter((session): session is TutorSessionSummary => Boolean(session));
}

function findTutorScheduleConflicts(
  cohortDrafts: CohortDraft[],
  moduleOptions: CurriculumModule[],
  tutorOptions: StaffOption[] = [],
  programmeName: string,
  programmeSourceId = '',
  externalSessions: CurriculumSession[] = [],
) {
  const proposedSessions = draftTutorSessions(cohortDrafts, moduleOptions, tutorOptions, programmeName, programmeSourceId);
  const savedSessions = savedTutorSessions(externalSessions, tutorOptions);
  const conflicts: TutorScheduleConflict[] = [];
  const seen = new Set<string>();

  proposedSessions.forEach((proposed, index) => {
    proposedSessions.slice(index + 1).forEach(other => {
      if (proposed.moduleLocalId === other.moduleLocalId) return;
      if (!tutorSessionsOverlap(proposed, other)) return;
      const key = [proposed.id, other.id].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      conflicts.push(buildTutorConflict(proposed, other));
    });
    savedSessions.forEach(other => {
      if (sameSavedSessionContext(proposed, other)) return;
      if (!tutorSessionsOverlap(proposed, other)) return;
      const key = [proposed.id, other.id].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      conflicts.push(buildTutorConflict(proposed, other));
    });
  });

  return conflicts;
}

function firstTutorConflictForModule(conflicts: TutorScheduleConflict[], moduleLocalId?: string) {
  if (!moduleLocalId) return undefined;
  return conflicts.find(conflict => conflict.proposed.moduleLocalId === moduleLocalId || conflict.conflicting.moduleLocalId === moduleLocalId);
}

function moduleModeSwitchPatch(draft: ModuleDraft, nextMode: ModuleMode): Partial<ModuleDraft> {
  if (nextMode === draft.mode) return {};

  if (nextMode === 'new') {
    return {
      mode: 'new',
      existingCatalogueId: draft.catalogueId || draft.existingCatalogueId,
      existingName: draft.name || draft.existingName,
      existingSessionsNumber: draft.sessionsNumber || draft.existingSessionsNumber,
      catalogueId: '',
      name: draft.newName || '',
      sessionsNumber: draft.newSessionsNumber || '0',
      weeks: [],
      skippedHolidaySessions: [],
      originalEndDate: '',
      endDate: '',
      extensionDays: 0,
    };
  }

  return {
    mode: 'existing',
    newName: draft.mode === 'new' ? draft.name : draft.newName,
    newSessionsNumber: draft.mode === 'new' ? draft.sessionsNumber : draft.newSessionsNumber,
    catalogueId: draft.existingCatalogueId || '',
    name: draft.existingName || '',
    sessionsNumber: draft.existingSessionsNumber || '0',
  };
}

function moduleBuilderUrlForDraft(
  draft: ModuleDraft,
  moduleOptions: CurriculumModule[],
  programmeName: string,
  programmeId = '',
  cohort?: CohortDraft,
  group?: GroupDraft,
  ksbSourceId = '',
  ksbSourceLabel = '',
) {
  const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  const moduleIdentifier = draft.mode === 'existing' ? (selectedModule ? moduleBuilderStructureId(selectedModule) : draft.catalogueId) : '';
  const title = draft.name.trim();
  if (!title && !moduleIdentifier) return '';
  const params = new URLSearchParams();
  params.set('wizardModule', draft.localId);
  if (moduleIdentifier) params.set('module', moduleIdentifier);
  if (title) params.set('moduleTitle', title);
  params.set('programmeId', programmeId);
  params.set('programme', programmeName || 'Unassigned programme');
  if (ksbSourceId) {
    params.set('ksbSourceId', ksbSourceId);
    params.set('ksbProfileSourceId', ksbSourceId);
  }
  if (ksbSourceLabel) params.set('ksbSourceLabel', ksbSourceLabel);
  params.set('cohortId', cohort?.sourceId || cohort?.localId || '');
  params.set('cohortName', cohort ? cohortDisplayName(cohort) : '');
  params.set('groupId', group?.sourceId || group?.localId || '');
  params.set('groupName', group?.name || '');
  params.set('title', title || selectedModule?.name || draft.catalogueId || 'Untitled module');
  params.set('description', userFacingNotes(draft.notes));
  params.set('sessionsNumber', String(moduleDraftSessionCount(draft, selectedModule)));
  params.set('startDate', draft.startDate || todayIso());
  params.set('endDate', draft.endDate || '');
  return `/curriculum/module-builder?${params.toString()}`;
}

function moduleBuilderStructureIdentifierForDraft(draft: ModuleDraft, moduleOptions: CurriculumModule[]) {
  if (isCanonicalModuleBuilderId(draft.catalogueId)) return draft.catalogueId;
  if (isCanonicalModuleBuilderId(draft.existingCatalogueId)) return draft.existingCatalogueId;
  const selectedModule = draft.catalogueId ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  if (selectedModule) return moduleBuilderStructureId(selectedModule);
  return draft.catalogueId || draft.sourceId || '';
}

function moduleBuilderStructureIdentifiersForDraft(draft: ModuleDraft, moduleOptions: CurriculumModule[]) {
  const selectedModule = draft.catalogueId ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  const selectedIdentifiers = selectedModule
    ? [
      moduleBuilderStructureId(selectedModule),
      selectedModule.moduleCatalogueId,
      selectedModule.catalogueId,
      selectedModule.structureId,
      selectedModule.moduleId,
      selectedModule.sourceId,
      selectedModule.name,
      ...(selectedModule.relatedCatalogueIds || []),
    ]
    : [];
  return uniqueTextValues([
    moduleBuilderStructureIdentifierForDraft(draft, moduleOptions),
    draft.catalogueId,
    draft.existingCatalogueId,
    draft.sourceId,
    draft.name,
    draft.existingName,
    ...selectedIdentifiers,
  ].map(value => String(value || '').trim()).filter(Boolean));
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

function validationCohortLabel(cohort: CohortDraft, index: number) {
  const name = cohortDisplayName(cohort);
  return name && name !== 'New cohort' ? `Cohort ${index + 1} (${name})` : `Cohort ${index + 1}`;
}

function validationGroupLabel(group: GroupDraft, index: number) {
  const name = group.name.trim();
  return name ? `Group ${index + 1} (${name})` : `Group ${index + 1}`;
}

function isCurriculumNotFoundError(err: unknown) {
  return err instanceof Error && /\b404\b/.test(err.message);
}

// Existing vs new is decided solely by the presence of a stored canonical
// sourceId (PROG-/COHORT-/GROUP-/MOD-...). An existing entity is PATCHed and
// never silently recreated as a POST: if the canonical id cannot be found the
// save fails loudly so a rename can never fork into a duplicate row.
async function saveCurriculumCohort(sourceId: string | undefined, payload: CurriculumCohortInput) {
  if (!sourceId) return createCurriculumCohort(payload);
  try {
    return await updateCurriculumCohort(sourceId, payload);
  } catch (err) {
    if (isCurriculumNotFoundError(err)) {
      throw new Error(
        `Cohort "${payload.name || sourceId}" could not be found (${sourceId}). ` +
        'It may have been deleted in another session. Reload the curriculum and try again — ' +
        'the rename was not saved and no duplicate was created.',
      );
    }
    throw err;
  }
}

async function saveCurriculumGroup(sourceId: string | undefined, payload: CurriculumGroupInput) {
  if (!sourceId && payload.cohortId) {
    const { cohortId, ...groupInput } = payload;
    return createCohortGroup(cohortId, groupInput);
  }
  if (!sourceId) return createCurriculumGroup(payload);
  try {
    return await updateCurriculumGroup(sourceId, payload);
  } catch (err) {
    if (isCurriculumNotFoundError(err)) {
      throw new Error(
        `Group "${payload.name || sourceId}" could not be found (${sourceId}). ` +
        'It may have been deleted in another session. Reload the curriculum and try again — ' +
        'the rename was not saved and no duplicate was created.',
      );
    }
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
      ksbMappings: previous?.ksbMappings || [],
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
  const structureTutor = staffAssignment(structure.tutor, structure.deliveryMetadata?.tutor, structure.sourceModule?.tutor);
  const structureCoach = staffAssignment(structure.coach, structure.deliveryMetadata?.coach, structure.sourceModule?.coach);
  const sessionsNumber = String(moduleBuilderStructureSessionCount(structure, moduleDraftSessionCount(draft)));
  const next = reconcileModuleDraft({ ...draft, sessionsNumber }, groupDay, groupTime, activeHolidays);
  return {
    ...next,
    sessionsNumber,
    moduleKsbMappings: structure.moduleKsbMappings || next.moduleKsbMappings || [],
    tutor: staffAssignment(next.tutor, structureTutor),
    coach: staffAssignment(next.coach, structureCoach),
    notes: userFacingNotes(next.notes),
    weeks: next.weeks.map((week, index) => {
      const sourceWeek = structure.weekStructure[index];
      return {
        ...week,
        title: sourceWeek?.title || week.title,
        ksbMappings: sourceWeek?.ksbMappings || [],
        components: (sourceWeek?.components || []).map(component => ({
          ...component,
          id: `${week.id}-${component.id}`,
          weekId: week.id,
        })),
      };
    }),
  };
}

function freeComponentContainerWeek(draft: ModuleDraft): WeekDraft {
  return draft.weeks[0] || {
    id: `${draft.localId}-components`,
    sessionNumber: 1,
    date: draft.startDate || todayIso(),
    day: 'Self-paced',
    startTime: '09:00',
    title: 'Components',
    components: [],
    open: true,
  };
}

function addFreeComponentToDraft(draft: ModuleDraft, type: ModuleComponentType) {
  const week = freeComponentContainerWeek(draft);
  const component = createEmptyComponent(week.id, type, week.components.length + 1);
  return {
    ...draft,
    sessionsNumber: '1',
    weeks: [{ ...week, components: [...week.components, component] }],
  };
}

function updateFreeComponentInDraft(draft: ModuleDraft, componentId: string, patch: Partial<ModuleComponent>) {
  const week = freeComponentContainerWeek(draft);
  return {
    ...draft,
    weeks: [{
      ...week,
      components: week.components.map(component => (
        component.id === componentId ? { ...component, ...patch, weekId: week.id } : component
      )),
    }],
  };
}

function removeFreeComponentFromDraft(draft: ModuleDraft, componentId: string) {
  const week = freeComponentContainerWeek(draft);
  return {
    ...draft,
    weeks: [{ ...week, components: week.components.filter(component => component.id !== componentId) }],
  };
}

function reorderFreeComponentInDraft(draft: ModuleDraft, sourceComponentId: string, targetComponentId: string) {
  if (sourceComponentId === targetComponentId) return draft;
  const week = freeComponentContainerWeek(draft);
  const sourceIndex = week.components.findIndex(component => component.id === sourceComponentId);
  const targetIndex = week.components.findIndex(component => component.id === targetComponentId);
  if (sourceIndex < 0 || targetIndex < 0) return draft;
  const components = [...week.components];
  const [moved] = components.splice(sourceIndex, 1);
  components.splice(targetIndex, 0, moved);
  return {
    ...draft,
    weeks: [{ ...week, components }],
  };
}

function freeProgrammeModuleInput(draft: ModuleDraft, moduleId: string, moduleName: string): FreeProgrammeModuleInput {
  return {
    id: moduleId,
    title: moduleName,
    description: userFacingNotes(draft.notes),
    status: 'draft',
    color: draft.color,
    components: draft.weeks.flatMap(week => week.components).map((component, componentIndex) => ({
      id: component.sourceId || component.id,
      displayOrder: componentIndex,
      type: component.type,
      title: component.title,
      description: component.description,
      expectedOtjh: component.expectedOtjh,
      points: component.points,
      reflectionRequired: component.reflectionRequired,
      workplaceEvidenceRequired: false,
      tutorValidationRequired: component.tutorValidationRequired,
      settings: component.settings,
    })),
  };
}

function teamsComponentSettings(meeting: TeamsMeetingDraft) {
  return {
    teamsLiveSessionId: meeting.liveSessionId,
    teamsOnlineMeetingId: meeting.onlineMeetingId,
    liveSessionUrl: meeting.joinUrl || meeting.webLink,
    teamsEventId: meeting.eventId,
    teamsMeetingOptionsUrl: meeting.meetingOptionsUrl,
    teamsOrganizerEmail: meeting.organizerEmail,
    teamsAttendees: meeting.attendees,
    teamsPresenters: meeting.presenters,
    sessionDateTimeUtc: meeting.startDateTimeUtc,
    durationMinutes: meeting.durationMinutes,
    teamsProvider: 'Microsoft Teams',
    teamsRepeat: meeting.repeat,
    teamsRepeatOccurrences: meeting.repeatOccurrences,
    teamsLobbyBypass: meeting.lobbyBypass,
    teamsRecording: meeting.recording,
    teamsSpokenLanguage: meeting.spokenLanguage,
    teamsMeetingType: meeting.meetingType,
    teamsRequestResponses: meeting.requestResponses,
    teamsAllowTimeProposals: meeting.allowNewTimeProposals,
    teamsHideAttendees: meeting.hideAttendees,
  };
}

function moduleDraftAuthoringPayload(
  draft: ModuleDraft,
  catalogueId: string,
  moduleName: string,
  context: {
    programmeId: string;
    programmeName: string;
    cohortId: string;
    cohortName: string;
    groupId: string;
    groupName: string;
    tutor: string;
    coach: string;
    weekDays?: string;
    startTime?: string;
    endTime?: string;
  },
  current?: ModuleCatalogueItem | null,
): ModuleCatalogueItem {
  const moduleId = current?.id || catalogueId;
  const weekStructure = draft.weeks.map((week, weekIndex) => ({
    id: week.id,
    moduleId,
    weekNumber: week.sessionNumber || weekIndex + 1,
    title: week.title || `Week ${weekIndex + 1}`,
    summary: current?.weekStructure?.[weekIndex]?.summary || '',
    learningOutcomes: current?.weekStructure?.[weekIndex]?.learningOutcomes || [],
    ksbMappings: week.ksbMappings || current?.weekStructure?.[weekIndex]?.ksbMappings || [],
    components: week.components.map((component, componentIndex) => ({
      ...component,
      id: component.sourceId || component.id,
      moduleId,
      weekId: week.id,
      title: component.title || `${component.type} ${componentIndex + 1}`,
      expectedOtjh: Number(component.expectedOtjh) || 0,
      points: Number(component.points) || 0,
      ksbMappings: component.ksbMappings || [],
      settings: component.type === 'live-session' && draft.teamsMeeting
        ? { ...(component.settings || {}), ...teamsComponentSettings(draft.teamsMeeting) }
        : component.settings || {},
    })),
  }));

  return recalculateModule({
    ...(current || getDefaultStructure({
      id: moduleId,
      catalogueId,
      programmeId: context.programmeId,
      programmeName: context.programmeName,
      title: moduleName,
      description: userFacingNotes(draft.notes),
      status: 'draft',
      sessionsNumber: Number(draft.sessionsNumber) || draft.weeks.length || 1,
      weekStructure: [],
    } as Partial<ModuleCatalogueItem> as ModuleCatalogueItem)),
    id: moduleId,
    catalogueId,
    programmeId: context.programmeId,
    programmeName: context.programmeName,
    cohortId: context.cohortId,
    cohort: context.cohortName,
    groupId: context.groupId,
    group: context.groupName,
    tutor: context.tutor,
    coach: context.coach,
    color: draft.color,
    title: moduleName,
    description: userFacingNotes(draft.notes),
    status: current?.status || 'draft',
    sessionsNumber: Math.max(1, Number(draft.sessionsNumber) || draft.weeks.length || 1),
    startDate: draft.startDate,
    endDate: draft.endDate,
    weekStructure,
    moduleKsbMappings: draft.moduleKsbMappings || current?.moduleKsbMappings || [],
    deliveryMetadata: {
      ...(current?.deliveryMetadata || {}),
      programmeId: context.programmeId,
      programme: context.programmeName,
      cohortId: context.cohortId,
      cohort: context.cohortName,
      groupId: context.groupId,
      group: context.groupName,
      tutor: context.tutor,
      coach: context.coach,
      weekDays: context.weekDays || '',
      startTime: context.startTime || '',
      endTime: context.endTime || '',
      color: draft.color,
      ...(draft.teamsMeeting ? {
        teamsMeetingUrl: draft.teamsMeeting.joinUrl || draft.teamsMeeting.webLink,
        teamsLiveSessionId: draft.teamsMeeting.liveSessionId,
        teamsOnlineMeetingId: draft.teamsMeeting.onlineMeetingId || '',
        teamsEventId: draft.teamsMeeting.eventId,
        teamsWebLink: draft.teamsMeeting.webLink,
        teamsMeetingOptionsUrl: draft.teamsMeeting.meetingOptionsUrl,
        teamsOrganizerEmail: draft.teamsMeeting.organizerEmail,
        teamsAttendees: JSON.stringify(draft.teamsMeeting.attendees),
        teamsStartDateTimeUtc: draft.teamsMeeting.startDateTimeUtc,
        teamsDurationMinutes: String(draft.teamsMeeting.durationMinutes),
        teamsRepeat: draft.teamsMeeting.repeat,
        teamsRepeatOccurrences: String(draft.teamsMeeting.repeatOccurrences),
        teamsLobbyBypass: draft.teamsMeeting.lobbyBypass,
        teamsRecording: draft.teamsMeeting.recording,
        teamsSpokenLanguage: draft.teamsMeeting.spokenLanguage,
        teamsMeetingType: draft.teamsMeeting.meetingType,
        teamsRequestResponses: String(draft.teamsMeeting.requestResponses),
        teamsAllowTimeProposals: String(draft.teamsMeeting.allowNewTimeProposals),
        teamsHideAttendees: String(draft.teamsMeeting.hideAttendees),
      } : {}),
    },
  });
}

function freeProgrammeModulesToDrafts(modules: FreeProgrammeModule[], programmeName: string, color: string): CohortDraft[] {
  const [cohort] = normaliseFreeProgrammeDrafts([], programmeName, color);
  const group = cohort.groups[0] || emptyGroupDraft();
  const moduleDrafts = modules.map((module, moduleIndex): ModuleDraft => {
    const localId = module.id ? `${module.id}-${moduleIndex + 1}` : `free-module-${moduleIndex + 1}`;
    const weekId = `${localId}-components`;
    return {
      ...emptyModuleDraft(),
      localId,
      sourceId: module.id,
      mode: 'new',
      catalogueId: '',
      name: module.title || `Free module ${moduleIndex + 1}`,
      color: module.color || '#7c3aed',
      startDate: todayIso(),
      endDate: todayIso(),
      sessionsNumber: '1',
      coach: '',
      tutor: '',
      notes: module.description || '',
      weeks: [{
        id: weekId,
        sessionNumber: 1,
        date: todayIso(),
        day: 'Self-paced',
        startTime: '09:00',
        title: 'Components',
        components: [...(module.components || [])]
          .sort((left, right) => Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0))
          .map((component, componentIndex): ModuleComponent => ({
            id: component.id ? `${component.id}-${componentIndex + 1}` : `${weekId}-component-${componentIndex + 1}`,
            sourceId: component.id,
            moduleId: localId,
            weekId,
            type: component.type as ModuleComponentType,
            title: component.title || '',
            description: component.description || '',
            expectedOtjh: Number(component.expectedOtjh) || 0,
            points: Number(component.points) || 0,
            reflectionRequired: Boolean(component.reflectionRequired),
            workplaceEvidenceRequired: false,
            tutorValidationRequired: Boolean(component.tutorValidationRequired),
            ksbMappings: [],
            settings: (component.settings || {}) as ModuleComponent['settings'],
          })),
        open: true,
      }],
      skippedHolidaySessions: [],
      originalEndDate: todayIso(),
      extensionDays: 0,
    };
  });

  return [{
    ...cohort,
    groups: [{
      ...group,
      modules: moduleDrafts,
    }],
  }];
}

export function AddCurriculumStructureWizard({
  isOpen,
  onClose,
  onSaved,
  initialProgrammeId,
  initialProgramme,
  initialCohortId,
  initialGroupId,
  startStep = 'programme',
  modulePlacementMode = false,
}: AddCurriculumStructureWizardProps) {
  // useCurriculumData already fetches the full /curriculum/modules/ list when
  // refreshModules is set, so the wizard does not mount a second modules loader:
  // both hooks requested the identical URL and each carried its own abort signal,
  // which made them un-shareable and doubled the payload on every open.
  const { data, loading, error, reload } = useCurriculumData({ autoLoad: isOpen, compact: true, includeHolidays: true, refreshModules: true });
  const catalogueModules = useMemo(() => data?.modules ?? [], [data?.modules]);
  const { tutors: staffTutors, coaches: staffCoaches, loading: staffLoading, reload: reloadStaffProfiles } = useCurriculumStaffProfiles({ autoLoad: false });
  const [step, setStep] = useState<WizardStep>(startStep);
  const [programmeForm, setProgrammeForm] = useState({
    name: '',
    standard: '',
    level: '',
    color: '#2563eb',
    description: '',
    structureType: 'scheduled' as ProgrammeStructureType,
  });
  const [ksbSourceKind, setKsbSourceKind] = useState<'profile' | 'standard'>('profile');
  const [ksbSourceValue, setKsbSourceValue] = useState('');
  const [ksbSets, setKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [ksbSourcesLoading, setKsbSourcesLoading] = useState(false);
  const [programmeDetail, setProgrammeDetail] = useState<CurriculumProgrammeDetail | null>(null);
  const [programmeDetailLoading, setProgrammeDetailLoading] = useState(false);
  const [programmeDetailFailed, setProgrammeDetailFailed] = useState(false);
  const [chosenProgrammeId, setChosenProgrammeId] = useState('');
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
  const [embeddedModuleBuilderUrl, setEmbeddedModuleBuilderUrl] = useState('');
  const [builderStructureSyncTick, setBuilderStructureSyncTick] = useState(0);
  const [builderStructureLoadingKeys, setBuilderStructureLoadingKeys] = useState<Set<string>>(new Set());
  const [builderStructureMissingKeys, setBuilderStructureMissingKeys] = useState<Set<string>>(new Set());
  const [builderStructureFailedKeys, setBuilderStructureFailedKeys] = useState<Set<string>>(new Set());
  const [builderStructureEmptyKeys, setBuilderStructureEmptyKeys] = useState<Set<string>>(new Set());
  // Keyed on draft.localId (stable across applyModuleBuilderContent, unlike the
  // catalogue identifier) so a resolved module can never keep spinning.
  const [builderStructureResolvedDraftIds, setBuilderStructureResolvedDraftIds] = useState<Set<string>>(new Set());
  const [builderStructureMissingDraftIds, setBuilderStructureMissingDraftIds] = useState<Set<string>>(new Set());
  const [builderStructureEmptyDraftIds, setBuilderStructureEmptyDraftIds] = useState<Set<string>>(new Set());
  const [builderStructureFailedDraftIds, setBuilderStructureFailedDraftIds] = useState<Set<string>>(new Set());
  const hydratedProgrammeRef = useRef('');
  const hydratedCohortIdsRef = useRef<Set<string>>(new Set());
  const hydratedGroupIdsRef = useRef<Set<string>>(new Set());
  const loadedBuilderStructureKeysRef = useRef<Set<string>>(new Set());
  const loadingBuilderStructureKeysRef = useRef<Set<string>>(new Set());
  const loadedFreeProgrammeRef = useRef('');
  const openedDraftSnapshotRef = useRef('');
  const userEditedWizardRef = useRef(false);
  const requestedStaffProfilesRef = useRef(false);

  const programmes = useMemo(() => data?.programmes ?? [], [data?.programmes]);
  const selectedProgramme = useMemo(
    () => initialProgramme || programmes.find(programme => (
      programme.id === (chosenProgrammeId || initialProgrammeId)
      || programme.sourceId === (chosenProgrammeId || initialProgrammeId)
    )),
    [chosenProgrammeId, initialProgramme, initialProgrammeId, programmes],
  );
  const ksbProfileOptions = useMemo(() => (
    ksbSets
      .map(profile => ({ profile, id: wizardKsbSourceId(profile) }))
      .filter(item => item.id)
      .sort((left, right) => String(left.profile.standard || left.profile.programmeName).localeCompare(String(right.profile.standard || right.profile.programmeName)))
  ), [ksbSets]);
  const standardOptions = useMemo(() => (
    standards
      .filter(standard => standard.id || standard.standardRef || standard.name)
      .sort((left, right) => String(left.name || left.standardRef).localeCompare(String(right.name || right.standardRef)))
  ), [standards]);
  const selectedKsbProfile = useMemo(() => {
    if (!ksbSourceValue.startsWith('profile:')) return undefined;
    const sourceId = ksbSourceValue.slice('profile:'.length);
    return ksbProfileOptions.find(item => item.id === sourceId)?.profile;
  }, [ksbProfileOptions, ksbSourceValue]);
  const selectedKsbStandard = useMemo(() => {
    if (!ksbSourceValue.startsWith('standard:')) return undefined;
    const sourceId = ksbSourceValue.slice('standard:'.length);
    return standardOptions.find(standard => String(standard.id) === sourceId);
  }, [ksbSourceValue, standardOptions]);
  const selectedKsbSourceLabel = useMemo(() => {
    if (selectedKsbProfile) return selectedKsbProfile.standard || selectedKsbProfile.programmeName || 'KSB profile';
    if (selectedKsbStandard) return selectedKsbStandard.name || selectedKsbStandard.standardRef || selectedKsbStandard.code || 'KSB source';
    return '';
  }, [selectedKsbProfile, selectedKsbStandard]);
  const modules = useMemo(() => {
    const merged = new Map<string, CurriculumModule>();
    catalogueModules.forEach(module => {
      merged.set(moduleOptionId(module), module);
    });
    localBuilderModules.map(moduleBuilderDraftToCurriculumModule).forEach(module => {
      const id = moduleOptionId(module);
      merged.set(id, mergeCurriculumModule(merged.get(id), module));
    });
    return Array.from(merged.values());
  }, [catalogueModules, localBuilderModules]);
  const moduleOptions = useMemo(() => {
    return modules.filter(module => {
      return Boolean(moduleOptionId(module) || String(module.name || '').trim());
    });
  }, [modules]);
  const holidays = useMemo(() => data?.holidays ?? [], [data?.holidays]);
  const isFreeProgramme = programmeForm.structureType === 'free' || selectedProgramme?.structureType === 'free';
  const visibleSteps = isFreeProgramme ? steps.filter(item => item.key !== 'cohort' && item.key !== 'group') : steps;
  const shouldLoadCatalogueModules = isOpen && (step === 'modules' || step === 'weeks' || step === 'review');
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
  const moduleActualComponentsLoading = useCallback((draft: ModuleDraft) => {
    if (isFreeProgramme || !['weeks', 'review'].includes(step)) return false;
    if (moduleDraftDisplayComponentCount(draft, false) > 0) return false;
    const identifier = moduleBuilderStructureIdentifierForDraft(draft, moduleOptions);
    if (!identifier) return false;
    const loadKey = `${draft.localId}:${identifier}`;
    if (builderStructureMissingKeys.has(loadKey)) return false;
    if (builderStructureFailedKeys.has(loadKey)) return false;
    if (builderStructureEmptyKeys.has(loadKey)) return false;
    // A resolved draft is never "loading" again, even if applyModuleBuilderContent
    // rewrote its catalogueId into an identifier the request never registered.
    if (builderStructureResolvedDraftIds.has(draft.localId)) return false;
    return builderStructureLoadingKeys.has(loadKey) || !loadedBuilderStructureKeysRef.current.has(loadKey);
  }, [builderStructureEmptyKeys, builderStructureFailedKeys, builderStructureLoadingKeys, builderStructureMissingKeys, builderStructureResolvedDraftIds, isFreeProgramme, moduleOptions, step]);
  const moduleBuilderStructureMissing = useCallback((draft: ModuleDraft) => {
    if (isFreeProgramme) return false;
    if (builderStructureMissingDraftIds.has(draft.localId)) return true;
    const identifier = moduleBuilderStructureIdentifierForDraft(draft, moduleOptions);
    if (!identifier) return false;
    return builderStructureMissingKeys.has(`${draft.localId}:${identifier}`);
  }, [builderStructureMissingDraftIds, builderStructureMissingKeys, isFreeProgramme, moduleOptions]);
  const moduleBuilderStructureFailed = useCallback((draft: ModuleDraft) => {
    if (isFreeProgramme) return false;
    if (builderStructureFailedDraftIds.has(draft.localId)) return true;
    const identifier = moduleBuilderStructureIdentifierForDraft(draft, moduleOptions);
    if (!identifier) return false;
    return builderStructureFailedKeys.has(`${draft.localId}:${identifier}`);
  }, [builderStructureFailedDraftIds, builderStructureFailedKeys, isFreeProgramme, moduleOptions]);
  const moduleBuilderStructureEmpty = useCallback((draft: ModuleDraft) => {
    if (isFreeProgramme) return false;
    if (builderStructureEmptyDraftIds.has(draft.localId)) return true;
    const identifier = moduleBuilderStructureIdentifierForDraft(draft, moduleOptions);
    if (!identifier) return false;
    return builderStructureEmptyKeys.has(`${draft.localId}:${identifier}`);
  }, [builderStructureEmptyDraftIds, builderStructureEmptyKeys, isFreeProgramme, moduleOptions]);

  const syncWizardDraftsFromModuleBuilder = useCallback(() => {
    if (isFreeProgramme) return;
    setCohortDrafts(previous => {
      let changed = false;
      const cohorts = previous.map(cohort => {
        const cohortHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
        let cohortChanged = false;
        const groups = cohort.groups.map(group => {
          let groupChanged = false;
          const modules = group.modules.map(draft => {
            const storageKey = `${MODULE_BUILDER_WIZARD_DRAFT_PREFIX}${draft.localId}`;
            let stored = '';
            try {
              stored = window.localStorage.getItem(storageKey) || '';
            } catch {
              stored = '';
            }
            if (!stored) return draft;

            try {
              const payload = JSON.parse(stored) as { module?: ModuleCatalogueItem } | ModuleCatalogueItem;
              const structure = recalculateModule(('module' in payload && payload.module ? payload.module : payload) as ModuleCatalogueItem);
              if (!structure.catalogueId) return draft;
              const sessionsNumber = String(moduleBuilderStructureSessionCount(structure, moduleDraftSessionCount(draft)));
              groupChanged = true;
              cohortChanged = true;
              changed = true;
              try {
                window.localStorage.removeItem(storageKey);
              } catch {
                // The structure has still been applied; a stale localStorage cleanup failure is non-blocking.
              }
              return applyModuleBuilderContent(
                {
                  ...draft,
                  mode: 'existing',
                  catalogueId: structure.catalogueId,
                  name: structure.title || draft.name,
                  existingCatalogueId: structure.catalogueId,
                  existingName: structure.title || draft.name,
                  existingSessionsNumber: sessionsNumber,
                  sessionsNumber,
                  color: structure.sourceModule?.color || draft.color,
                  notes: userFacingNotes(structure.description || draft.notes),
                },
                structure,
                group.deliveryDays.join(', '),
                group.startTime,
                cohortHolidays,
              );
            } catch (err) {
              console.warn('Unable to apply Module Builder changes to wizard draft.', err);
              return draft;
            }
          });
          return groupChanged ? { ...group, modules } : group;
        });
        return cohortChanged ? { ...cohort, groups } : cohort;
      });
      return changed ? cohorts : previous;
    });
  }, [holidays, isFreeProgramme]);

  const refreshRemoteBuilderStructures = useCallback(() => {
    loadedBuilderStructureKeysRef.current.clear();
    setBuilderStructureLoadingKeys(new Set());
    setBuilderStructureMissingKeys(new Set());
    setBuilderStructureFailedKeys(new Set());
    setBuilderStructureEmptyKeys(new Set());
    setBuilderStructureResolvedDraftIds(new Set());
    setBuilderStructureMissingDraftIds(new Set());
    setBuilderStructureEmptyDraftIds(new Set());
    setBuilderStructureFailedDraftIds(new Set());
    setBuilderStructureSyncTick(tick => tick + 1);
  }, []);

  const closeEmbeddedModuleBuilder = useCallback(async (syncMessage?: unknown) => {
    const builderUrl = embeddedModuleBuilderUrl;
    setEmbeddedModuleBuilderUrl('');
    syncWizardDraftsFromModuleBuilder();
    let draftId = '';
    let structureId = '';
    let savedStructure: ModuleCatalogueItem | null = null;
    if (syncMessage && typeof syncMessage === 'object') {
      const message = syncMessage as { draftId?: unknown; structureId?: unknown; payload?: { module?: ModuleCatalogueItem } };
      draftId = String(message.draftId || '');
      structureId = String(message.structureId || message.payload?.module?.catalogueId || '');
      savedStructure = message.payload?.module ? recalculateModule(message.payload.module) : null;
    }
    try {
      const params = new URL(builderUrl, window.location.origin).searchParams;
      draftId = draftId || params.get('wizardModule') || '';
      structureId = structureId || params.get('module') || '';
    } catch {
      draftId = draftId || '';
      structureId = structureId || '';
    }
    if (draftId && structureId) {
      try {
        const structure = (await loadModuleStructure(structureId)) || savedStructure;
        if (structure) {
          setCohortDrafts(previous => previous.map(cohort => {
            const cohortHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
            let cohortChanged = false;
            const groups = cohort.groups.map(group => {
              let groupChanged = false;
              const modules = group.modules.map(draft => {
                if (draft.localId !== draftId) return draft;
                const sessionsNumber = String(moduleBuilderStructureSessionCount(structure, moduleDraftSessionCount(draft)));
                groupChanged = true;
                cohortChanged = true;
                loadedBuilderStructureKeysRef.current.add(`${draft.localId}:${structure.catalogueId || structureId}`);
                return applyModuleBuilderContent(
                  {
                    ...draft,
                    mode: 'existing',
                    catalogueId: structure.catalogueId || draft.catalogueId,
                    name: structure.title || draft.name,
                    existingCatalogueId: structure.catalogueId || draft.catalogueId,
                    existingName: structure.title || draft.name,
                    existingSessionsNumber: sessionsNumber,
                    sessionsNumber,
                    color: structure.sourceModule?.color || draft.color,
                    notes: userFacingNotes(structure.description || draft.notes),
                  },
                  structure,
                  group.deliveryDays.join(', '),
                  group.startTime,
                  cohortHolidays,
                );
              });
              return groupChanged ? { ...group, modules } : group;
            });
            return cohortChanged ? { ...cohort, groups } : cohort;
          }));
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to refresh module content from Module Builder.');
      }
    }
    refreshRemoteBuilderStructures();
  }, [embeddedModuleBuilderUrl, holidays, refreshRemoteBuilderStructures, syncWizardDraftsFromModuleBuilder]);

  // Pick up modules authored elsewhere while the wizard is open, but only once per
  // arrival at a step that shows them - not on every render of those steps.
  const refreshedModulesForStepRef = useRef(false);
  useEffect(() => {
    if (!shouldLoadCatalogueModules) {
      refreshedModulesForStepRef.current = false;
      return;
    }
    if (refreshedModulesForStepRef.current) return;
    refreshedModulesForStepRef.current = true;
    void reload();
  }, [reload, shouldLoadCatalogueModules]);

  useEffect(() => {
    if (!isOpen || isFreeProgramme || requestedStaffProfilesRef.current) return;
    if (!['group', 'modules', 'weeks', 'review'].includes(step)) return;
    requestedStaffProfilesRef.current = true;
    void reloadStaffProfiles({ silent: true });
    return undefined;
  }, [isFreeProgramme, isOpen, reloadStaffProfiles, step]);

  useEffect(() => {
    if (!isOpen || isFreeProgramme || !['weeks', 'review'].includes(step)) return;
    syncWizardDraftsFromModuleBuilder();
    setBuilderStructureSyncTick(tick => tick + 1);
  }, [isFreeProgramme, isOpen, step, syncWizardDraftsFromModuleBuilder]);

  useEffect(() => {
    if (!isOpen || isFreeProgramme) return;
    const shouldCloseEmbeddedBuilder = (message: unknown) => {
      if (!embeddedModuleBuilderUrl || !message || typeof message !== 'object') return false;
      const syncMessage = message as { action?: unknown; closeEmbedded?: unknown };
      return syncMessage.action === 'module-builder:saved' && syncMessage.closeEmbedded === true;
    };
    const applyBuilderSyncMessage = (message?: unknown) => {
      if (shouldCloseEmbeddedBuilder(message)) {
        void closeEmbeddedModuleBuilder(message);
        return;
      }
      syncWizardDraftsFromModuleBuilder();
      refreshRemoteBuilderStructures();
    };
    const refreshBuilderStructures = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (!['modules', 'weeks', 'review'].includes(step)) return;
      syncWizardDraftsFromModuleBuilder();
    };
    const applyBuilderStorageUpdate = (event: StorageEvent) => {
      if (!event.key?.startsWith(MODULE_BUILDER_WIZARD_DRAFT_PREFIX)) return;
      applyBuilderSyncMessage();
    };
    const applyBuilderCustomUpdate = (event: Event) => {
      applyBuilderSyncMessage(event instanceof CustomEvent ? event.detail : undefined);
    };
    const applyBuilderWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      applyBuilderSyncMessage(event.data);
    };
    let syncChannel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      syncChannel = new BroadcastChannel(MODULE_BUILDER_SYNC_CHANNEL);
      syncChannel.onmessage = event => applyBuilderSyncMessage(event.data);
    }
    window.addEventListener('focus', refreshBuilderStructures);
    window.addEventListener('message', applyBuilderWindowMessage);
    window.addEventListener('storage', applyBuilderStorageUpdate);
    window.addEventListener(MODULE_BUILDER_SYNC_CHANNEL, applyBuilderCustomUpdate);
    document.addEventListener('visibilitychange', refreshBuilderStructures);
    return () => {
      window.removeEventListener('focus', refreshBuilderStructures);
      window.removeEventListener('message', applyBuilderWindowMessage);
      window.removeEventListener('storage', applyBuilderStorageUpdate);
      window.removeEventListener(MODULE_BUILDER_SYNC_CHANNEL, applyBuilderCustomUpdate);
      document.removeEventListener('visibilitychange', refreshBuilderStructures);
      syncChannel?.close();
    };
  }, [closeEmbeddedModuleBuilder, embeddedModuleBuilderUrl, isFreeProgramme, isOpen, refreshRemoteBuilderStructures, step, syncWizardDraftsFromModuleBuilder]);

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
  const activeProgrammeSourceId = selectedProgramme?.sourceId || selectedProgramme?.id || slugify(programmeForm.name);
  const tutorOptions = useMemo(() => buildStaffOptions(staffTutors), [staffTutors]);
  const coachOptions = useMemo(() => buildStaffOptions(staffCoaches), [staffCoaches]);
  const activeGroupCoachConflict = useMemo(
    () => groupCoachScheduleConflict(cohortDrafts, activeGroup.localId, data?.groups || [], coachOptions),
    [activeGroup.localId, coachOptions, cohortDrafts, data?.groups],
  );
  useEffect(() => {
    if (!isOpen || !cohortDrafts.length || !staffTutors.length) return;
    setCohortDrafts(previous => {
      let changed = false;
      const next = previous.map(cohort => ({
        ...cohort,
        groups: cohort.groups.map(group => ({
          ...group,
          modules: group.modules.map(draft => {
            if (staffAssignment(draft.tutor)) return draft;
            const assignedTutor = assignedTutorForDraft(draft, staffTutors);
            if (!assignedTutor) return draft;
            changed = true;
            return { ...draft, tutor: assignedTutor };
          }),
        })),
      }));
      return changed ? next : previous;
    });
  }, [cohortDrafts.length, isOpen, staffTutors]);
  const tutorScheduleConflicts = useMemo(
    () => isFreeProgramme ? [] : findTutorScheduleConflicts(
      cohortDrafts,
      moduleOptions,
      tutorOptions,
      selectedProgramme?.name || programmeForm.name,
      activeProgrammeSourceId,
      data?.sessions || [],
    ),
    [activeProgrammeSourceId, cohortDrafts, data?.sessions, isFreeProgramme, moduleOptions, programmeForm.name, selectedProgramme?.name, tutorOptions],
  );
  const tutorScheduleIssues = useMemo(() => {
    if (isFreeProgramme) return [];
    return tutorScheduleConflicts.map(conflict => conflict.message);
  }, [isFreeProgramme, tutorScheduleConflicts]);

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
    userEditedWizardRef.current = true;
    const next = emptyCohortDraft();
    setCohortDrafts(previous => [...previous, next]);
    setActiveCohortId(next.localId);
    setExpandedCohortId(next.localId);
    setActiveGroupId('');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
  };

  const cloneCohortDraft = (sourceId = activeCohort.localId, options: { focusCohortStep?: boolean } = {}) => {
    const source = cohortDrafts.find(cohort => cohort.localId === sourceId);
    if (!source) return;
    userEditedWizardRef.current = true;
    const next = cloneCohortDraftForEditing(source);
    const firstGroup = next.groups[0];
    setCohortDrafts(previous => [...previous, next]);
    setActiveCohortId(next.localId);
    setExpandedCohortId(next.localId);
    setActiveGroupId(firstGroup?.localId || '');
    setExpandedGroupId(firstGroup?.localId || '');
    setActiveModuleId(firstGroup?.modules[0]?.localId || '');
    setExpandedModuleId('');
    if (options.focusCohortStep) setStep('cohort');
  };

  const removeCohortDraft = async (id: string) => {
    const target = cohortDrafts.find(cohort => cohort.localId === id);
    if (!target || removingDraftId) return;
    userEditedWizardRef.current = true;
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
    userEditedWizardRef.current = true;
    const next = emptyGroupDraft();
    setCohortDrafts(previous => previous.map(cohort => cohort.localId === activeCohort.localId ? { ...cohort, groups: [...cohort.groups, next] } : cohort));
    setActiveGroupId(next.localId);
    setExpandedGroupId(next.localId);
    setActiveModuleId('');
    setExpandedModuleId('');
    if (options.focusGroupStep) setStep('group');
  };

  const cloneGroupDraft = (sourceId = activeGroup.localId, options: { focusGroupStep?: boolean } = {}) => {
    const source = activeCohort.groups.find(group => group.localId === sourceId);
    if (!source) return;
    userEditedWizardRef.current = true;
    const next = cloneGroupDraftForEditing(source);
    setCohortDrafts(previous => previous.map(cohort => cohort.localId === activeCohort.localId ? { ...cohort, groups: [...cohort.groups, next] } : cohort));
    setActiveGroupId(next.localId);
    setExpandedGroupId(next.localId);
    setActiveModuleId(next.modules[0]?.localId || '');
    setExpandedModuleId('');
    if (options.focusGroupStep) setStep('group');
  };

  const removeGroupDraft = async (id: string) => {
    const target = activeCohort.groups.find(group => group.localId === id);
    if (!target || removingDraftId) return;
    userEditedWizardRef.current = true;
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
    userEditedWizardRef.current = true;
    const baseDraft = emptyModuleDraft(groupForm.deliveryDay, groupForm.startTime, activeHolidays);
    const next = isFreeProgramme
      ? {
          ...baseDraft,
          mode: 'new' as ModuleMode,
          catalogueId: '',
          tutor: '',
          coach: '',
          sessionsNumber: '1',
        }
      : baseDraft;
    setModuleDrafts(previous => [...previous, next]);
    setActiveModuleId(next.localId);
    setExpandedModuleId(next.localId);
    if (options.focusModulesStep) setStep('modules');
  };

  const cloneModuleDraftForActiveGroup = (sourceId = activeModule?.localId, options: { focusModulesStep?: boolean } = {}) => {
    const source = moduleDrafts.find(draft => draft.localId === sourceId);
    if (!source) return;
    userEditedWizardRef.current = true;
    const next = cloneModuleDraft(source);
    setModuleDrafts(previous => [...previous, next]);
    setActiveModuleId(next.localId);
    setExpandedModuleId(next.localId);
    if (options.focusModulesStep) setStep('modules');
  };

  const removeModuleDraft = async (id: string) => {
    const target = moduleDrafts.find(draft => draft.localId === id);
    if (!target || removingDraftId) return;
    userEditedWizardRef.current = true;
    const selectedModule = target.mode === 'existing' ? findModuleOption(moduleOptions, target.catalogueId) : undefined;
    await confirmDraftRemoval('module', target.name.trim() || selectedModule?.name || 'this module', async () => {
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

  const addFreeComponent = (moduleId: string, type: ModuleComponentType) => {
    setModuleDrafts(previous => previous.map(draft => (
      draft.localId === moduleId ? addFreeComponentToDraft(draft, type) : draft
    )));
  };

  const updateFreeComponent = (moduleId: string, componentId: string, patch: Partial<ModuleComponent>) => {
    setModuleDrafts(previous => previous.map(draft => (
      draft.localId === moduleId ? updateFreeComponentInDraft(draft, componentId, patch) : draft
    )));
  };

  const removeFreeComponent = (moduleId: string, componentId: string) => {
    setModuleDrafts(previous => previous.map(draft => (
      draft.localId === moduleId ? removeFreeComponentFromDraft(draft, componentId) : draft
    )));
  };

  const reorderFreeComponent = (moduleId: string, sourceComponentId: string, targetComponentId: string) => {
    setModuleDrafts(previous => previous.map(draft => (
      draft.localId === moduleId ? reorderFreeComponentInDraft(draft, sourceComponentId, targetComponentId) : draft
    )));
  };

  const activeProgramme = selectedProgramme ? {
    ...selectedProgramme,
    name: programmeForm.name || selectedProgramme.name,
    standard: programmeForm.standard || selectedProgramme.standard,
    level: programmeForm.level || selectedProgramme.level,
    color: programmeForm.color || selectedProgramme.color,
    description: programmeForm.description || selectedProgramme.description,
  } : {
    name: programmeForm.name,
    standard: programmeForm.standard || programmeForm.name,
    level: programmeForm.level,
    color: programmeForm.color,
    description: programmeForm.description,
  } as CurriculumProgramme;

  const stepIndex = Math.max(0, visibleSteps.findIndex(item => item.key === step));
  const hasAnyModuleDraft = cohortDrafts.some(cohort => cohort.groups.some(group => group.modules.length > 0));
  const moduleIssues = [
    ...(isFreeProgramme && !hasAnyModuleDraft ? ['Add at least one module.'] : cohortDrafts.flatMap((cohort, cohortIndex) => cohort.groups.flatMap((group, groupIndex) => {
    const cohortLabel = validationCohortLabel(cohort, cohortIndex);
    const groupLabel = validationGroupLabel(group, groupIndex);
    if (!group.modules.length) return [isFreeProgramme ? 'Add at least one module.' : `${cohortLabel}, ${groupLabel}: add at least one module.`];
    return group.modules.flatMap((draft, index) => {
      const label = isFreeProgramme ? `Module ${index + 1}` : `${cohortLabel}, ${groupLabel}, Module ${index + 1}`;
      const selectedModule = findModuleOption(moduleOptions, draft.catalogueId);
      const issues = [];
      if (draft.mode === 'existing' && !draft.catalogueId && !draft.name.trim()) issues.push(`${label}: choose an existing module.`);
      if (draft.mode === 'new' && !draft.name.trim()) issues.push(`${label}: enter a module name.`);
      if (!isFreeProgramme) {
        if (!draft.startDate) issues.push(`${label}: choose a start date.`);
        if (draft.startDate && cohort.startDate && compareDateInputs(draft.startDate, cohort.startDate) < 0) {
          issues.push(`${label}: start date cannot be before the cohort start date (${cohort.startDate}).`);
        }
        if (draft.startDate && cohort.endDate && compareDateInputs(draft.startDate, cohort.endDate) > 0) {
          issues.push(`${label}: start date cannot be after the cohort end date (${cohort.endDate}).`);
        }
        if (moduleDraftSessionCount(draft, selectedModule) < 1) issues.push(`${label}: set at least one session.`);
        if (!draft.weeks.length) issues.push(`${label}: no sessions could be generated for the selected delivery days.`);
      }
      return issues;
    });
    }))),
    ...tutorScheduleIssues,
  ];

  const validation = {
    programme: modulePlacementMode && !selectedProgramme
      ? ['Choose the programme this module will be added to.']
      : !programmeForm.name.trim() ? ['Programme name is required.'] : [],
    cohort: isFreeProgramme ? [] : cohortDrafts.length
      ? cohortDrafts.flatMap((cohort, index) => [
          !cohort.name.trim() ? `Cohort ${index + 1}: name is required.` : '',
          !cohort.startDate ? `Cohort ${index + 1}: start date is required.` : '',
          (Number(cohort.durationMonths) || 0) < 1 ? `Cohort ${index + 1}: duration must be at least 1 month.` : '',
        ].filter(Boolean))
      : ['Add at least one cohort.'],
    group: isFreeProgramme ? [] : cohortDrafts.flatMap((cohort, cohortIndex) => (
      cohort.groups.length
        ? cohort.groups.flatMap((group, groupIndex) => {
            const cohortLabel = validationCohortLabel(cohort, cohortIndex);
            const groupLabel = validationGroupLabel(group, groupIndex);
            return [
              !group.name.trim() ? `${cohortLabel}, ${groupLabel}: group name is required.` : '',
              !group.deliveryDays.length ? `${cohortLabel}, ${groupLabel}: choose at least one delivery day.` : '',
              !group.startTime ? `${cohortLabel}, ${groupLabel}: start time is required.` : '',
            ].filter(Boolean);
          })
        : [`${validationCohortLabel(cohort, cohortIndex)}: add at least one group.`]
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
  const canSaveProgrammeDetails = Boolean(selectedProgramme && step === 'programme' && validation.programme.length === 0);
  const canSaveDraft = canSave || canSaveProgrammeDetails;
  const reviewGroupsForSave = cohortDrafts.flatMap(cohort => cohort.groups.filter(isConfiguredGroup));
  const reviewModulesForSave = reviewGroupsForSave.flatMap(group => group.modules.filter(isConfiguredModule));
  const reviewComponentsForSave = reviewModulesForSave.reduce((total, draft) => total + moduleDraftDisplayComponentCount(draft, isFreeProgramme), 0);
  const reviewSaveSummary = `${reviewModulesForSave.length} modules - ${reviewComponentsForSave} components`;
  const currentStepMeta = visibleSteps[stepIndex] || visibleSteps[0];
  const nextStepMeta = visibleSteps[Math.min(stepIndex + 1, visibleSteps.length - 1)] || visibleSteps[visibleSteps.length - 1];
  const currentValidationItems = (
    step === 'programme' ? validation.programme :
    step === 'cohort' ? validation.cohort :
    step === 'group' ? validation.group :
    step === 'modules' ? validation.modules :
    []
  );
  const footerBlocker = !canContinue && currentValidationItems.length ? currentValidationItems[0] : '';
  const stepInstruction = isFreeProgramme && step === 'programme'
    ? 'Choose the course type, then continue to custom modules.'
    : step === 'review'
    ? 'Review the structure and save when everything looks right.'
    : 'Complete this step, then continue.';
  const dialogWidth = {
    programme: 'max-w-[1040px]',
    cohort: 'max-w-[1320px]',
    group: 'max-w-[1320px]',
    modules: 'max-w-[1520px]',
    weeks: 'max-w-[1520px]',
    review: 'max-w-[1280px]',
  }[step];

  useEffect(() => {
    if (!isOpen) return;
    setStep(startStep);
    setMessage(null);
    setDiscardConfirmOpen(false);
    setSubmitted(false);
    setSaving(null);
    setProgrammeForm({ name: '', standard: '', level: '', color: '#2563eb', description: '', structureType: 'scheduled' });
    setKsbSourceKind('profile');
    setKsbSourceValue('');
    setProgrammeDetail(null);
    setProgrammeDetailLoading(false);
    setProgrammeDetailFailed(false);
    setChosenProgrammeId('');
    setCohortDrafts([]);
    setActiveCohortId('');
    setExpandedCohortId('');
    setActiveGroupId('');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
    hydratedProgrammeRef.current = '';
    hydratedCohortIdsRef.current.clear();
    hydratedGroupIdsRef.current.clear();
    loadedBuilderStructureKeysRef.current.clear();
    loadingBuilderStructureKeysRef.current.clear();
    setBuilderStructureEmptyKeys(new Set());
    setBuilderStructureResolvedDraftIds(new Set());
    setBuilderStructureMissingDraftIds(new Set());
    setBuilderStructureEmptyDraftIds(new Set());
    setBuilderStructureFailedDraftIds(new Set());
    loadedFreeProgrammeRef.current = '';
    openedDraftSnapshotRef.current = '';
    userEditedWizardRef.current = false;
    requestedStaffProfilesRef.current = false;
  }, [initialProgrammeId, isOpen, startStep]);

  const chooseExistingProgramme = (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setChosenProgrammeId(programmeId);
    setProgrammeForm({
      name: programme.name || '',
      standard: programme.standard || programme.name || '',
      level: programme.level || '',
      color: programme.color || '#2563eb',
      description: programme.description || '',
      structureType: programme.structureType === 'free' ? 'free' : 'scheduled',
    });
    setMessage(null);
    setCohortDrafts([]);
    setActiveCohortId('');
    setExpandedCohortId('');
    setActiveGroupId('');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
    hydratedProgrammeRef.current = '';
    hydratedCohortIdsRef.current.clear();
    hydratedGroupIdsRef.current.clear();
    loadedBuilderStructureKeysRef.current.clear();
    loadingBuilderStructureKeysRef.current.clear();
    setBuilderStructureEmptyKeys(new Set());
    setBuilderStructureResolvedDraftIds(new Set());
    setBuilderStructureMissingDraftIds(new Set());
    setBuilderStructureEmptyDraftIds(new Set());
    setBuilderStructureFailedDraftIds(new Set());
    loadedFreeProgrammeRef.current = '';
    openedDraftSnapshotRef.current = '';
    userEditedWizardRef.current = true;
  };

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setKsbSourcesLoading(true);
    Promise.all([
      fetchCurriculumKsbSets(controller.signal),
      fetchCurriculumStandards(controller.signal),
    ])
      .then(([nextKsbSets, nextStandards]) => {
        setKsbSets(nextKsbSets);
        setStandards(nextStandards);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('Unable to load KSB sources.', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setKsbSourcesLoading(false);
      });
    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedProgramme) return;
    setProgrammeForm({
      name: selectedProgramme.name || '',
      standard: selectedProgramme.standard || selectedProgramme.name || '',
      level: selectedProgramme.level || '',
      color: selectedProgramme.color || '#2563eb',
      description: selectedProgramme.description || '',
      structureType: selectedProgramme.structureType === 'free' ? 'free' : 'scheduled',
    });
  }, [isOpen, selectedProgramme]);

  useEffect(() => {
    if (!isOpen || !selectedProgramme) return;
    const programmeIds = uniqueTextValues([selectedProgramme.sourceId, selectedProgramme.id, selectedProgramme.name]);
    const linkedProfile = ksbProfileOptions.find(({ profile }) => {
      const profileProgrammeIds = uniqueTextValues([
        profile.programmeId,
        ...(profile.programmeIds || []),
      ]);
      return programmeIds.some(id => profileProgrammeIds.some(profileId => normalise(profileId) === normalise(id)));
    });
    if (linkedProfile) {
      setKsbSourceKind('profile');
      setKsbSourceValue(`profile:${linkedProfile.id}`);
      return;
    }
    const linkedStandard = standardOptions.find(standard => (
      normalise(standard.id) === normalise(selectedProgramme.standard)
      || normalise(standard.name) === normalise(selectedProgramme.standard)
      || normalise(standard.standardRef) === normalise(selectedProgramme.standard)
    ));
    if (linkedStandard) {
      setKsbSourceKind('standard');
      setKsbSourceValue(`standard:${linkedStandard.id}`);
    }
  }, [isOpen, ksbProfileOptions, selectedProgramme, standardOptions]);

  useEffect(() => {
    if (!isOpen || !isFreeProgramme) return;
    setCohortDrafts(previous => normaliseFreeProgrammeDrafts(previous, programmeForm.name, programmeForm.color));
    if (step === 'cohort' || step === 'group') setStep('modules');
  }, [isFreeProgramme, isOpen, programmeForm.color, programmeForm.name, step]);

  useEffect(() => {
    if (!isOpen || !isFreeProgramme || !selectedProgramme) return;
    const programmeId = selectedProgramme.sourceId || selectedProgramme.id || '';
    if (!programmeId || loadedFreeProgrammeRef.current === programmeId) return;
    loadedFreeProgrammeRef.current = programmeId;
    const controller = new AbortController();
    fetchFreeProgrammeModules(programmeId, controller.signal)
      .then(freeModules => {
        if (!freeModules.length) return;
        const drafts = freeProgrammeModulesToDrafts(freeModules, programmeForm.name || selectedProgramme.name, programmeForm.color || selectedProgramme.color);
        const firstCohort = drafts[0];
        const firstGroup = firstCohort.groups[0];
        setCohortDrafts(drafts);
        setActiveCohortId(firstCohort.localId);
        setExpandedCohortId('');
        setActiveGroupId(firstGroup?.localId || '');
        setExpandedGroupId('');
        setActiveModuleId(firstGroup?.modules[0]?.localId || '');
        setExpandedModuleId('');
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('Unable to load free modules.', error);
      });
    return () => controller.abort();
  }, [isFreeProgramme, isOpen, programmeForm.color, programmeForm.name, selectedProgramme]);

  useEffect(() => {
    const availableSteps = visibleSteps;
    if (!availableSteps.some(item => item.key === step)) setStep(availableSteps[0].key);
  }, [step, visibleSteps]);

  useEffect(() => {
    if (!isOpen || !selectedProgramme || isFreeProgramme) {
      setProgrammeDetail(null);
      setProgrammeDetailLoading(false);
      setProgrammeDetailFailed(false);
      return;
    }
    const programmeId = selectedProgramme.sourceId || selectedProgramme.id || '';
    if (!programmeId) return;

    let active = true;
    const controller = new AbortController();
    setProgrammeDetail(null);
    setProgrammeDetailFailed(false);
    setProgrammeDetailLoading(true);
    fetchCurriculumProgrammeDetail(programmeId, controller.signal)
      .then(detail => {
        if (!active) return;
        setProgrammeDetail(detail);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('Unable to load programme detail for editing.', error);
        if (active) setProgrammeDetailFailed(true);
      })
      .finally(() => {
        if (active) setProgrammeDetailLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isFreeProgramme, isOpen, selectedProgramme]);

  useEffect(() => {
    if (!isOpen || !data || !selectedProgramme || loading || cohortDrafts.length || hydratedProgrammeRef.current) return;
    if (!isFreeProgramme && programmeDetailLoading) return;
    if (!isFreeProgramme && !programmeDetail && !programmeDetailFailed) return;
    const detailCohorts = programmeDetail?.cohorts || [];
    const detailFlat = programmeDetail?.flat;
    const sourceCohorts = detailCohorts.length ? detailCohorts : (detailFlat?.cohorts || data.cohorts || []);
    const sourceGroups: CurriculumGroup[] = detailCohorts.length
      ? detailCohorts.flatMap(cohort => nestedGroupsForCohort(cohort))
      : ((detailFlat?.groups || data.groups || []).filter((group): group is CurriculumGroup => Boolean(group && typeof group === 'object')));
    const sourceModules: CurriculumModule[] = detailCohorts.length
      ? detailCohorts.flatMap(cohort => nestedGroupsForCohort(cohort).flatMap(group => nestedModulesForGroup(group)))
      : ((detailFlat?.modules || modules).filter((module): module is CurriculumModule => Boolean(module && typeof module === 'object')));
    const detailComponents = detailFlat?.components || [];
    const existingDrafts = buildExistingProgrammeDrafts(
      programmeDetail?.programme || selectedProgramme,
      sourceCohorts,
      sourceGroups,
      enrichModulesWithDetailComponents(sourceModules, detailComponents),
      holidays,
      initialCohortId,
      initialGroupId,
      detailComponents,
    );

    hydratedProgrammeRef.current = selectedProgramme.id || selectedProgramme.sourceId || selectedProgramme.name;
    hydratedCohortIdsRef.current = new Set(existingDrafts
      .map(cohort => cohort.sourceId)
      .filter((id): id is string => isCanonicalCurriculumId(id, 'COHORT')));
    hydratedGroupIdsRef.current = new Set(existingDrafts
      .flatMap(cohort => cohort.groups.map(group => group.sourceId))
      .filter((id): id is string => isCanonicalCurriculumId(id, 'GROUP')));
    existingDrafts.forEach(cohort => {
      cohort.groups.forEach(group => {
        group.modules.forEach(draft => {
          const identifier = moduleBuilderStructureIdentifierForDraft(draft, moduleOptions);
          if (identifier && moduleDraftDisplayComponentCount(draft, false) > 0) {
            loadedBuilderStructureKeysRef.current.add(`${draft.localId}:${identifier}`);
          }
        });
      });
    });
    if (!existingDrafts.length) return;

    if (existingDrafts.length === 1 && isFreeCourseContainer(existingDrafts[0])) {
      setProgrammeForm(previous => ({ ...previous, structureType: 'free' }));
    }

    const firstCohort = existingDrafts[0];
    const firstGroup = firstCohort.groups[0];
    setCohortDrafts(existingDrafts);
    setActiveCohortId(firstCohort.localId);
    setExpandedCohortId('');
    setActiveGroupId(firstGroup?.localId || '');
    setExpandedGroupId('');
    setActiveModuleId('');
    setExpandedModuleId('');
  }, [cohortDrafts.length, data, holidays, initialCohortId, initialGroupId, isFreeProgramme, isOpen, loading, moduleOptions, modules, programmeDetail, programmeDetailFailed, programmeDetailLoading, selectedProgramme]);

  useEffect(() => {
    if (!isOpen || openedDraftSnapshotRef.current) return;
    if (selectedProgramme) {
      if (loading || ksbSourcesLoading || !programmeForm.name.trim()) return;
      if (!isFreeProgramme && !hydratedProgrammeRef.current) return;
    }
    openedDraftSnapshotRef.current = wizardDraftSnapshot(programmeForm, ksbSourceKind, ksbSourceValue, cohortDrafts);
  }, [
    cohortDrafts,
    isFreeProgramme,
    isOpen,
    ksbSourceKind,
    ksbSourceValue,
    ksbSourcesLoading,
    loading,
    programmeForm,
    selectedProgramme,
  ]);

  useEffect(() => {
    if (!isOpen || !cohortDrafts.length || isFreeProgramme || !['modules', 'weeks', 'review'].includes(step)) return;

    let active = true;
    const cohortsToHydrate = step === 'review'
      ? cohortDrafts
      : cohortDrafts
        .map(cohort => ({
          ...cohort,
          groups: cohort.groups.filter(group => group.localId === activeGroupId),
        }))
        .filter(cohort => cohort.groups.length);
    const targets = cohortsToHydrate.flatMap(cohort => cohort.groups.flatMap(group => group.modules.map(draft => {
      const identifier = moduleBuilderStructureIdentifierForDraft(draft, moduleOptions);
      if (!identifier) return null;
      const loadKey = `${draft.localId}:${identifier}`;
      if (
        loadedBuilderStructureKeysRef.current.has(loadKey)
        || loadingBuilderStructureKeysRef.current.has(loadKey)
      ) return null;
      const identifiers = moduleBuilderStructureIdentifiersForDraft(draft, moduleOptions);
      const keyVariants = uniqueTextValues([identifier, ...identifiers].map(value => `${draft.localId}:${value}`));
      if (keyVariants.some(key => loadedBuilderStructureKeysRef.current.has(key) || loadingBuilderStructureKeysRef.current.has(key))) return null;
      const expectsComponents = draft.mode === 'existing' && moduleDraftDisplayComponentCount(draft, false) === 0;
      return { draftId: draft.localId, identifier, identifiers, loadKey, keyVariants, expectsComponents };
    }).filter((target): target is { draftId: string; identifier: string; identifiers: string[]; loadKey: string; keyVariants: string[]; expectsComponents: boolean } => Boolean(target))));

    if (!targets.length) return;

    let retryExpectedComponents = false;
    targets.forEach(target => target.keyVariants.forEach(key => loadingBuilderStructureKeysRef.current.add(key)));
    setBuilderStructureLoadingKeys(previous => {
      const next = new Set(previous);
      targets.forEach(target => target.keyVariants.forEach(key => next.add(key)));
      return next;
    });

    loadModuleStructuresBatch(targets.map(target => ({
      requestId: target.draftId,
      identifier: target.identifier,
      identifiers: target.identifiers,
    }))).then(results => {
      const targetByDraftId = new Map(targets.map(target => [target.draftId, target]));
      const waitingForComponentsDraftIds = new Set(results
        .filter(result => {
          const target = targetByDraftId.get(result.requestId);
          return Boolean(target?.expectsComponents && (!result.found || !result.hasComponents));
        })
        .map(result => result.requestId));
      retryExpectedComponents = waitingForComponentsDraftIds.size > 0;
      results.forEach(result => {
        const target = targetByDraftId.get(result.requestId);
        if (!target) return;
        if (waitingForComponentsDraftIds.has(result.requestId)) return;
        target.keyVariants.forEach(key => loadedBuilderStructureKeysRef.current.add(key));
      });
      const missingKeys = results
        .filter(result => !result.found && !waitingForComponentsDraftIds.has(result.requestId))
        .flatMap(result => targetByDraftId.get(result.requestId)?.keyVariants || []);
      const emptyKeys = results
        .filter(result => result.found && !result.hasComponents && !waitingForComponentsDraftIds.has(result.requestId))
        .flatMap(result => targetByDraftId.get(result.requestId)?.keyVariants || []);
      const loaded = new Map(results
        .filter(result => {
          if (!result.found || !result.module) return false;
          if (waitingForComponentsDraftIds.has(result.requestId)) return false;
          return true;
        })
        .map(result => [result.requestId, {
          draftId: result.requestId,
          identifier: result.identifier,
          structure: result.module as ModuleCatalogueItem,
          hasComponents: Boolean(result.hasComponents),
        }]));
      setBuilderStructureMissingKeys(previous => {
        const next = new Set(previous);
        targets.forEach(target => target.keyVariants.forEach(key => {
          next.delete(key);
        }));
        missingKeys.forEach(key => next.add(key));
        return next;
      });
      setBuilderStructureEmptyKeys(previous => {
        const next = new Set(previous);
        targets.forEach(target => target.keyVariants.forEach(key => {
          next.delete(key);
        }));
        emptyKeys.forEach(key => next.add(key));
        return next;
      });
      setBuilderStructureFailedKeys(previous => {
        const next = new Set(previous);
        targets.forEach(target => target.keyVariants.forEach(key => {
          next.delete(key);
        }));
        return next;
      });
      // Resolve by stable draft id so the spinner always clears, and record the
      // missing/empty verdicts the same way — the draft's catalogue identifier is
      // about to be rewritten by applyModuleBuilderContent below.
      const respondedDraftIds = results
        .map(result => result.requestId)
        .filter(requestId => targetByDraftId.has(requestId) && !waitingForComponentsDraftIds.has(requestId));
      setBuilderStructureResolvedDraftIds(previous => {
        const next = new Set(previous);
        // Resolve every dispatched target, not just the ones echoed back: a draft
        // the backend omits from `results` must not keep spinning either.
        targets
          .filter(target => !waitingForComponentsDraftIds.has(target.draftId))
          .forEach(target => next.add(target.draftId));
        return next;
      });
      setBuilderStructureMissingDraftIds(previous => {
        const next = new Set(previous);
        respondedDraftIds.forEach(draftId => next.delete(draftId));
        results
          .filter(result => !result.found && targetByDraftId.has(result.requestId) && !waitingForComponentsDraftIds.has(result.requestId))
          .forEach(result => next.add(result.requestId));
        // A dispatched draft the backend never echoed back is treated as missing
        // rather than silently rendering as an empty module.
        targets
          .filter(target => !respondedDraftIds.includes(target.draftId) && !target.expectsComponents)
          .forEach(target => next.add(target.draftId));
        return next;
      });
      setBuilderStructureEmptyDraftIds(previous => {
        const next = new Set(previous);
        respondedDraftIds.forEach(draftId => next.delete(draftId));
        results
          .filter(result => result.found && !result.hasComponents && targetByDraftId.has(result.requestId) && !waitingForComponentsDraftIds.has(result.requestId))
          .forEach(result => next.add(result.requestId));
        return next;
      });
      setBuilderStructureFailedDraftIds(previous => {
        const next = new Set(previous);
        respondedDraftIds.forEach(draftId => next.delete(draftId));
        return next;
      });
      if (!active || !loaded.size) return;

      setCohortDrafts(previous => previous.map(cohort => {
        const cohortHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
        let cohortChanged = false;
        const groups = cohort.groups.map(group => {
          let groupChanged = false;
          const modules = group.modules.map(draft => {
            const match = loaded.get(draft.localId);
            if (!match) return draft;
            const selectedModule = findModuleOption(moduleOptions, draft.catalogueId);
            const sessionsNumber = String(moduleBuilderStructureSessionCount(match.structure, moduleDraftSessionCount(draft, selectedModule)));
            groupChanged = true;
            cohortChanged = true;
            const nextDraft = applyModuleBuilderContent(
              {
                ...draft,
                mode: isFreeProgramme ? 'new' : 'existing',
                catalogueId: isFreeProgramme ? '' : match.structure.catalogueId || draft.catalogueId,
                name: match.structure.title || draft.name,
                existingCatalogueId: isFreeProgramme ? '' : match.structure.catalogueId || draft.catalogueId,
                existingName: isFreeProgramme ? '' : match.structure.title || draft.name,
                existingSessionsNumber: isFreeProgramme ? '0' : sessionsNumber,
                color: match.structure.sourceModule?.color || draft.color,
                sessionsNumber: isFreeProgramme ? '1' : sessionsNumber,
                tutor: isFreeProgramme ? '' : draft.tutor,
                notes: userFacingNotes(match.structure.description || draft.notes),
              },
              match.structure,
              group.deliveryDays.join(', '),
              group.startTime,
              cohortHolidays,
            );
            if (moduleDraftDisplayComponentCount(nextDraft, false) > 0 || !match.hasComponents) {
              moduleBuilderStructureIdentifiersForDraft(nextDraft, moduleOptions)
                .forEach(value => loadedBuilderStructureKeysRef.current.add(`${nextDraft.localId}:${value}`));
              loadedBuilderStructureKeysRef.current.add(`${nextDraft.localId}:${match.identifier}`);
            }
            return nextDraft;
          });
          return groupChanged ? { ...group, modules } : group;
        });
        return cohortChanged ? { ...cohort, groups } : cohort;
      }));
    }).catch(() => {
      targets.forEach(target => target.keyVariants.forEach(key => loadedBuilderStructureKeysRef.current.add(key)));
      setBuilderStructureFailedKeys(previous => {
        const next = new Set(previous);
        targets.forEach(target => target.keyVariants.forEach(key => next.add(key)));
        return next;
      });
      setBuilderStructureResolvedDraftIds(previous => {
        const next = new Set(previous);
        targets.forEach(target => next.add(target.draftId));
        return next;
      });
      setBuilderStructureFailedDraftIds(previous => {
        const next = new Set(previous);
        targets.forEach(target => next.add(target.draftId));
        return next;
      });
    }).finally(() => {
      targets.forEach(target => target.keyVariants.forEach(key => {
        loadingBuilderStructureKeysRef.current.delete(key);
      }));
      setBuilderStructureLoadingKeys(previous => {
        const next = new Set(previous);
        targets.forEach(target => target.keyVariants.forEach(key => {
          next.delete(key);
        }));
        return next;
      });
      if (active && retryExpectedComponents) {
        window.setTimeout(() => {
          if (active) setBuilderStructureSyncTick(tick => tick + 1);
        }, 1000);
      }
    });

    return () => {
      active = false;
    };
  }, [activeGroupId, builderStructureSyncTick, cohortDrafts, holidays, isFreeProgramme, isOpen, moduleOptions, step]);

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
      let changed = false;
      const next = previous.map(cohort => {
        const nextIds = cohort.holidayIds.filter(id => existingIds.has(id));
        if (nextIds.length === cohort.holidayIds.length) return cohort;
        changed = true;
        return { ...cohort, holidayIds: nextIds };
      });
      return changed ? next : previous;
    });
  }, [holidays]);

  useEffect(() => {
    if (!cohortDrafts.length || !activeCohort.groups.length) return;
    setCohortDrafts(previous => {
      let changed = false;
      const nextCohorts = previous.map(cohort => {
        if (cohort.localId !== activeCohort.localId) return cohort;
        const nextGroups = cohort.groups.map(group => {
          if (group.localId !== activeGroup.localId) return group;
          const nextModules = group.modules.map(draft => reconcileModuleDraft(draft, groupForm.deliveryDay, groupForm.startTime, activeHolidays));
          const groupChanged = JSON.stringify(nextModules) !== JSON.stringify(group.modules);
          if (!groupChanged) return group;
          changed = true;
          return { ...group, modules: nextModules };
        });
        return nextGroups.some((group, index) => group !== cohort.groups[index]) ? { ...cohort, groups: nextGroups } : cohort;
      });
      return changed ? nextCohorts : previous;
    });
  }, [activeCohort.groups.length, activeCohort.localId, activeGroup.localId, activeHolidays, cohortDrafts.length, groupForm.deliveryDay, groupForm.startTime]);

  const requestClose = () => {
    if (saving) return;
    const currentSnapshot = wizardDraftSnapshot(programmeForm, ksbSourceKind, ksbSourceValue, cohortDrafts);
    const hasUnsavedChanges = Boolean(userEditedWizardRef.current && openedDraftSnapshotRef.current && openedDraftSnapshotRef.current !== currentSnapshot);
    if (hasUnsavedChanges && !submitted) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const resolveTutorConflict = (conflict: TutorScheduleConflict) => {
    const target = conflict.proposed.moduleLocalId ? conflict.proposed : conflict.conflicting;
    setStep('modules');
    if (target.cohortLocalId) setActiveCohortId(target.cohortLocalId);
    if (target.groupLocalId) setActiveGroupId(target.groupLocalId);
    if (target.moduleLocalId) setActiveModuleId(target.moduleLocalId);
    setExpandedCohortId('');
    setExpandedGroupId('');
    setExpandedModuleId('');
  };

  const updateModuleDraft = (localId: string, patch: Partial<ModuleDraft>) => {
    userEditedWizardRef.current = true;
    setModuleDrafts(prev => prev.map(draft => {
      if (draft.localId !== localId) return draft;
      if (isFreeProgramme) return { ...draft, ...patch, mode: 'new', catalogueId: '', tutor: '', coach: '', sessionsNumber: '1' };
      if (Object.keys(patch).length === 1 && patch.endDate !== undefined) return { ...draft, endDate: patch.endDate };
      return reconcileModuleDraft({ ...draft, ...patch }, groupForm.deliveryDay, groupForm.startTime, activeHolidays);
    }));
  };

  const persistTeamsMeetingForModuleDraft = async (draft: ModuleDraft, meeting: TeamsMeetingDraft, details: string): Promise<Partial<ModuleDraft> | void> => {
    if (isFreeProgramme) return;
    const nextDraft = reconcileModuleDraft({
      ...draft,
      teamsMeeting: meeting,
      weeks: attachTeamsMeetingToWeeks(draft, meeting, details),
    }, groupForm.deliveryDay, groupForm.startTime, activeHolidays);
    const sourceModule = findModuleOption(moduleOptions, draft.catalogueId) || findModuleOption(modules, draft.catalogueId);
    const moduleId = isCanonicalModuleBuilderId(draft.catalogueId)
      ? draft.catalogueId
      : sourceModule
      ? moduleOptionId(sourceModule)
      : generatedModuleBuilderId();
    const currentStructure = sourceModule ? getDefaultStructure(curriculumModuleToCatalogue(sourceModule)) : null;
    const programmeId = selectedProgramme?.sourceId || selectedProgramme?.id || activeProgrammeSourceId;
    const moduleName = sourceModule?.name || draft.name || draft.catalogueId || 'Module';
    const authored = moduleDraftAuthoringPayload(nextDraft, moduleId, moduleName, {
      programmeId,
      programmeName: selectedProgramme?.name || programmeForm.name,
      cohortId: String(activeCohort.sourceId || ''),
      cohortName: activeCohort.name,
      groupId: String(activeGroup.sourceId || ''),
      groupName: activeGroup.name,
      tutor: nextDraft.tutor,
      coach: activeGroup.coach,
      weekDays: groupForm.deliveryDay,
      startTime: groupForm.startTime,
      endTime: groupForm.endTime || addHoursToTime(groupForm.startTime, 2),
    }, currentStructure);
    const result = sourceModule || isCanonicalModuleBuilderId(draft.catalogueId)
      ? await updateCurriculumModule(moduleId, authored as unknown as CurriculumModuleInput)
      : await createCurriculumModule({
        ...(authored as unknown as CurriculumModuleInput),
        moduleType: 'authoring',
        catalogueId: moduleId,
        moduleCatalogueId: moduleId,
      } as CurriculumModuleInput & { moduleType: string; catalogueId: string; moduleCatalogueId: string });
    await reload();
    const savedId = String(result.module?.moduleCatalogueId || result.module?.catalogueId || result.module?.structureId || moduleId);
    return {
      mode: 'existing',
      catalogueId: savedId,
      existingCatalogueId: savedId,
      existingName: moduleName,
      name: moduleName,
      teamsMeeting: meeting,
      weeks: nextDraft.weeks,
    };
  };

  const selectExistingModule = async (draft: ModuleDraft, catalogueId: string) => {
    if (isFreeProgramme) return;
    userEditedWizardRef.current = true;
    const module = findModuleOption(moduleOptions, catalogueId);
    if (!catalogueId || !module) {
      updateModuleDraft(draft.localId, {
        mode: 'existing',
        catalogueId,
        name: '',
        existingCatalogueId: '',
        existingName: '',
        existingSessionsNumber: '0',
        sessionsNumber: '0',
      });
      return;
    }
    const structureId = moduleBuilderStructureId(module);
    const sessionsNumber = String(moduleSessionCount(module));
    const staff = moduleStaffValues(module);
    updateModuleDraft(draft.localId, {
      mode: 'existing',
      catalogueId: structureId,
      name: module?.name || '',
      existingCatalogueId: structureId,
      existingName: module?.name || '',
      existingSessionsNumber: sessionsNumber,
      color: module?.color || draft.color,
      sessionsNumber: isFreeProgramme ? '1' : sessionsNumber,
      tutor: isFreeProgramme ? '' : staff.tutor,
      notes: '',
    });

    try {
      const savedStructure = await loadModuleStructure(structureId);
      const structure = savedStructure
        ? {
          ...savedStructure,
          sessionsNumber: moduleSessionCount(module),
          weekStructure: (savedStructure.weekStructure || []).map(week => ({
            ...week,
            components: (week.components || []).filter(component => isDisplayableModuleBuilderComponent(component, week.title)),
          })),
        }
        : actualModuleCatalogueStructure(module);
      const selectedSessionsNumber = String(moduleSessionCount(module));
      setModuleDrafts(previous => previous.map(item => (
        item.localId === draft.localId
          ? item.mode === 'existing' && item.catalogueId === structureId
            ? applyModuleBuilderContent(
              {
                ...item,
                mode: 'existing',
                catalogueId: structureId,
                name: structure.title || module.name,
                existingCatalogueId: structureId,
                existingName: structure.title || module.name,
                existingSessionsNumber: selectedSessionsNumber,
                color: module.color || item.color,
                sessionsNumber: isFreeProgramme ? '1' : selectedSessionsNumber,
                tutor: isFreeProgramme ? '' : (staff.tutor || item.tutor),
                notes: userFacingNotes(structure.description || item.notes),
              },
              structure,
              groupForm.deliveryDay,
              groupForm.startTime,
              activeHolidays,
            )
            : item
          : item
      )));
    } catch {
      const structure = actualModuleCatalogueStructure(module);
      const selectedSessionsNumber = String(moduleSessionCount(module));
      setModuleDrafts(previous => previous.map(item => (
        item.localId === draft.localId
          ? item.mode === 'existing' && item.catalogueId === structureId
            ? applyModuleBuilderContent(
              {
                ...item,
                mode: 'existing',
                catalogueId: structureId,
                name: structure.title || module.name,
                existingCatalogueId: structureId,
                existingName: structure.title || module.name,
                existingSessionsNumber: selectedSessionsNumber,
                color: module.color || item.color,
                sessionsNumber: isFreeProgramme ? '1' : selectedSessionsNumber,
                tutor: isFreeProgramme ? '' : (staff.tutor || item.tutor),
                notes: userFacingNotes(structure.description || item.notes),
              },
              structure,
              groupForm.deliveryDay,
              groupForm.startTime,
              activeHolidays,
            )
            : item
          : item
      )));
    }
  };

  const applySelectedKsbSource = useCallback(async (programme: CurriculumProgramme | undefined, programmeSourceId: string, programmeName: string) => {
    if (!ksbSourceValue || !programmeSourceId) return;
    const [kind, ...idParts] = ksbSourceValue.split(':');
    const sourceId = idParts.join(':');

    if (kind === 'profile') {
      const selectedProfile = ksbSets.find(profile => wizardKsbSourceId(profile) === sourceId);
      if (!selectedProfile) return;
      const selectedProfileId = wizardKsbSourceId(selectedProfile);
      const programmeCandidates = uniqueTextValues([programmeSourceId, programme?.id, programme?.sourceId, programmeName]);
      const previouslyLinkedProfiles = ksbSets.filter(profile => {
        if (wizardKsbSourceId(profile) === selectedProfileId) return false;
        const linkedProgrammeIds = uniqueTextValues([profile.programmeId, ...(profile.programmeIds || [])]);
        return programmeCandidates.some(candidate => linkedProgrammeIds.some(linked => normalise(linked) === normalise(candidate)));
      });
      await Promise.all(previouslyLinkedProfiles.map(profile => {
        const nextProgrammeIds = uniqueTextValues([...(profile.programmeIds || []), profile.programmeId])
          .filter(value => !programmeCandidates.some(candidate => normalise(candidate) === normalise(value)));
        return updateCurriculumKsbFramework(wizardKsbSourceId(profile), {
          name: profile.standard || profile.programmeName || 'KSB profile',
          programmeId: nextProgrammeIds[0] || '',
          programmeIds: nextProgrammeIds,
          notes: profile.notes,
        });
      }));
      const programmeIds = uniqueTextValues([
        ...(selectedProfile.programmeIds || []),
        selectedProfile.programmeId,
        programmeSourceId,
        programme?.id,
        programme?.sourceId,
        programmeName,
      ]);
      await updateCurriculumKsbFramework(selectedProfileId, {
        name: selectedProfile.standard || selectedProfile.programmeName || programme?.standard || programmeName,
        ksbProfileId: selectedProfile.ksbProfileId || String(selectedProfile.profileId || ''),
        programmeId: programmeSourceId,
        programmeIds,
        notes: selectedProfile.notes,
      });
      await updateCurriculumProgramme(programmeSourceId, {
        name: programme?.name || programmeName,
        standard: programme?.standard || selectedProfile.standard || selectedProfile.programmeName || programmeName,
        level: programme?.level || programmeForm.level,
        color: programme?.color || programmeForm.color,
        description: programme?.description || programmeForm.description,
        structureType: programme?.structureType || programmeForm.structureType,
        ksbProfileSourceId: `profile:${selectedProfileId}`,
      });
      // Compact is safe here: the cascade reads only programme/name/colour/notes and
      // identity fields, and this array is local to the callback (never stored).
      const modulesForCascade = modules.length ? modules : await fetchCurriculumModules(undefined, { compact: true });
      await cascadeWizardKsbSourceToProgrammeModules(programmeSourceId, programmeName, modulesForCascade, `profile:${selectedProfileId}`);
      return;
    }

    if (kind === 'standard') {
      const selectedStandard = standards.find(standard => String(standard.id) === sourceId);
      if (!selectedStandard) return;
      await updateCurriculumProgramme(programmeSourceId, {
        name: programme?.name || programmeName,
        standard: selectedStandard.name || selectedStandard.standardRef || programme?.standard || programmeName,
        level: selectedStandard.levelValue || selectedStandard.level || programme?.level || programmeForm.level,
        color: programme?.color || programmeForm.color,
        description: programme?.description || programmeForm.description,
        structureType: programme?.structureType || programmeForm.structureType,
        ksbProfileSourceId: `standard:${selectedStandard.id}`,
      });
      // Compact is safe here for the same reason as the profile branch above.
      const modulesForCascade = modules.length ? modules : await fetchCurriculumModules(undefined, { compact: true });
      await cascadeWizardKsbSourceToProgrammeModules(programmeSourceId, programmeName, modulesForCascade, `standard:${selectedStandard.id}`);
    }
  }, [ksbSets, ksbSourceValue, modules, programmeForm.color, programmeForm.description, programmeForm.level, programmeForm.structureType, standards]);

  const persistStructure = async (intent: SaveIntent) => {
    if (!canSaveDraft) {
      setMessage('Complete the required fields before saving.');
      return;
    }
    setSaving(intent);
    setMessage(null);
    try {
      // Only update a programme that the user explicitly opened or selected.
      // Name matching can point at stale catalogue data and incorrectly turn a
      // "create" action into a PATCH against a programme that no longer exists.
      const matchingProgramme = selectedProgramme;
      const programmeResult = matchingProgramme
        ? await updateCurriculumProgramme(matchingProgramme.sourceId || matchingProgramme.id, {
            ...programmeForm,
            standard: programmeForm.standard || programmeForm.name,
            ksbProfileSourceId: ksbSourceValue || matchingProgramme.ksbProfileSourceId || '',
          })
        : await createCurriculumProgramme({
            ...programmeForm,
            standard: programmeForm.standard || programmeForm.name,
            ksbProfileSourceId: ksbSourceValue,
          });
      const savedProgramme = programmeResult.programme;
      const programmeName = savedProgramme?.name || programmeForm.name;
      const programmeSourceId = matchingProgramme?.sourceId || matchingProgramme?.id || savedProgramme?.sourceId || savedProgramme?.id || slugify(programmeName);

      if (selectedProgramme && step === 'programme') {
        await applySelectedKsbSource(savedProgramme || matchingProgramme, programmeSourceId, programmeName);
        await reload();
        setSubmitted(true);
        showWizardSwalToast('Programme updated', 'The programme details were saved.');
        await onSaved?.();
        onClose();
        return;
      }

      if (isFreeProgramme) {
        const freeModules = cohortDrafts.flatMap(cohort => cohort.groups.flatMap(group => group.modules)).map((draft, index) => {
          const moduleName = draft.name || `Free module ${index + 1}`;
          const moduleId = draft.sourceId || draft.catalogueId || `${programmeSourceId}-${slugify(moduleName)}-${index + 1}`;
          return freeProgrammeModuleInput(draft, moduleId, moduleName);
        });
        await saveFreeProgrammeModules(programmeSourceId, {
          programmeName,
          modules: freeModules,
        });
        await applySelectedKsbSource(savedProgramme || matchingProgramme, programmeSourceId, programmeName);
        await reload();
        setSubmitted(true);
        showWizardSwalToast(
          matchingProgramme ? 'Free modules updated' : (intent === 'draft' ? 'Draft free modules saved' : 'Free modules created'),
          'The free modules and components were saved.',
        );
        await onSaved?.();
        onClose();
        return;
      }

      const hydrationComplete = !selectedProgramme || Boolean(hydratedProgrammeRef.current && !loading && data);
      const treeCohorts = [];
      for (const cohort of cohortDrafts) {
        const cohortActiveHolidays = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
        const cohortSourceId = isCanonicalCurriculumId(cohort.sourceId, 'COHORT') ? String(cohort.sourceId) : undefined;
        const cohortId = cohortSourceId || generatedCurriculumId('COHORT');
        const groupsForSave = [];

        for (const group of cohort.groups) {
          const deliveryDayValue = group.deliveryDays.join(', ');
          const groupSourceId = isCanonicalCurriculumId(group.sourceId, 'GROUP') ? String(group.sourceId) : undefined;
          const groupId = groupSourceId || generatedCurriculumId('GROUP');
          const modulesForSave: CurriculumModuleAttachmentInput[] = [];

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
              const duplicate = [...modules]
                .filter(module => (
                  normalise(module.name) === normalise(draft.name) &&
                  moduleMatchesDeliveryContext(module, {
                    programmeId: programmeSourceId,
                    programmeName,
                    cohortId,
                    cohortName: cohort.name,
                    groupId,
                    groupName: group.name,
                  })
                ))
                .sort((left, right) => curriculumModuleComponentCount(right) - curriculumModuleComponentCount(left))[0];
              sourceModule = duplicate;
              catalogueId = sourceModule ? moduleOptionId(sourceModule) : draft.catalogueId;
              moduleName = sourceModule?.name || draft.name;
            }
            const deliverySessionCount = draft.mode === 'existing' && sourceModule
              ? moduleSessionCount(sourceModule)
              : Math.max(1, Number(draft.sessionsNumber) || draft.weeks.length || 1);
            const canonicalCatalogueId = isCanonicalModuleBuilderId(catalogueId) ? catalogueId : '';
            const authored = moduleDraftAuthoringPayload(draft, canonicalCatalogueId, moduleName, {
              programmeId: programmeSourceId,
              programmeName,
              cohortId,
              cohortName: cohort.name,
              groupId,
              groupName: group.name,
              tutor: draft.tutor,
              coach: group.coach,
              weekDays: deliveryDayValue,
              startTime: group.startTime,
              endTime: group.endTime || addHoursToTime(group.startTime, 2),
            });
            if (draft.teamsMeeting) {
              const teamsScheduleInput = teamsScheduleInputFromDraft(
                draft,
                moduleName,
                group.startTime,
                group.endTime || addHoursToTime(group.startTime, 2),
              );
              if (teamsScheduleInput) {
                await updateTeamsMeetingSchedule(draft.teamsMeeting.liveSessionId, teamsScheduleInput);
              }
            }

            modulesForSave.push({
              moduleName,
              catalogueId: canonicalCatalogueId,
              programmeId: programmeSourceId,
              cohortId,
              groupId,
              color: draft.color || sourceModule?.color,
              startDate: draft.startDate,
              endDate: draft.endDate,
              coach: group.coach,
              tutor: draft.tutor,
              weekDays: deliveryDayValue,
              startTime: group.startTime,
              endTime: group.endTime || addHoursToTime(group.startTime, 2),
              notes: userFacingNotes(draft.notes),
              holidays: cohortActiveHolidays,
              ...authored,
              // `authored` is a catalogue item, so its `weeks` is a session count,
              // not a structure. Pin the count to sessionsNumber/weeks and the
              // authored content to weekStructure so neither can shadow the other.
              sessionsNumber: deliverySessionCount,
              weeks: deliverySessionCount,
              weekStructure: authored.weekStructure || [],
            } as CurriculumModuleAttachmentInput);
          }
          groupsForSave.push({
            id: groupId,
            name: group.name,
            cohortId,
            programmeId: programmeSourceId,
            weekDays: deliveryDayValue,
            startTime: group.startTime,
            endTime: group.endTime || addHoursToTime(group.startTime, 2),
            coach: group.coach,
            color: group.color,
            startDate: cohort.startDate,
            endDate: cohort.endDate,
            modules: modulesForSave,
          });
        }
        treeCohorts.push({
          id: cohortId,
          name: cohort.name,
          programme: programmeName,
          programmeId: programmeSourceId,
          startDate: cohort.startDate,
          endDate: cohort.endDate,
          durationMonths: Number(cohort.durationMonths),
          color: cohort.color,
          holidayIds: cohort.holidayIds,
          groups: groupsForSave,
        });
      }

      await saveCurriculumProgrammeTree({
        programme: {
          id: programmeSourceId,
          sourceId: programmeSourceId,
          ...programmeForm,
          standard: programmeForm.standard || programmeForm.name,
          ksbProfileSourceId: ksbSourceValue,
        },
        cohorts: treeCohorts,
        removeMissing: Boolean(selectedProgramme),
        hydrationComplete,
      });
      await applySelectedKsbSource(savedProgramme || matchingProgramme, programmeSourceId, programmeName);

      await reload();
      setSubmitted(true);
      showWizardSwalToast(
        matchingProgramme ? 'Programme updated' : (intent === 'draft' ? 'Draft programme saved' : 'Programme created'),
        isFreeProgramme
          ? 'The free modules and custom module links were saved. Module content remains managed in Module Builder.'
          : 'The programme, cohorts, groups and module links were saved through scoped curriculum endpoints. Module content remains managed in Module Builder.',
      );
      await onSaved?.();
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

  const showCohortDatabaseLoading = step === 'cohort' && Boolean(selectedProgramme) && !isFreeProgramme && programmeDetailLoading && !cohortDrafts.length;
  const showCohortDatabaseError = step === 'cohort' && Boolean(selectedProgramme) && !isFreeProgramme && programmeDetailFailed && !cohortDrafts.length;
  const showNoDatabaseCohorts = step === 'cohort' && Boolean(selectedProgramme) && !isFreeProgramme && !programmeDetailLoading && !programmeDetailFailed && Boolean(hydratedProgrammeRef.current) && !cohortDrafts.length;

  return createPortal((
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/35 p-2 backdrop-blur-sm sm:p-5">
      <div key={step} className={`relative z-10 flex max-h-[94vh] w-full ${dialogWidth} flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-xl`} onClick={event => event.stopPropagation()}>
        <header className="border-b border-foreground-200/70 bg-background-50 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-600">Curriculum Studio</p>
              <h2 className="mt-1 text-xl font-heading font-bold text-foreground-950">{currentStepMeta.label}</h2>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-foreground-500">
                {stepInstruction}
              </p>
            </div>
            <button type="button" onClick={requestClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background-100 text-foreground-500 transition-smooth hover:bg-background-200" aria-label="Close wizard">
              <AppIcon className="ri-close-line text-lg"></AppIcon>
            </button>
          </div>
          <PopupTrail current={step} stepIndex={stepIndex} steps={visibleSteps} onNavigate={setStep} />
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto bg-background-100/70">
          <main className="min-w-0 p-3 sm:p-5" onChangeCapture={() => { userEditedWizardRef.current = true; }}>
              {error && <PanelTone icon="ri-error-warning-line" text={`Curriculum API error: ${error}`} tone="error" />}
              {message && <PanelTone icon="ri-information-line" text={message} tone={message.includes('Unable') || message.includes('returned') || message.includes('Complete') ? 'error' : 'info'} />}

              {step === 'programme' && (
                <StepPanel
                  title={modulePlacementMode ? 'Choose a programme' : 'Programme details'}
                  description={modulePlacementMode ? 'Select the existing programme where this module should be added.' : 'Enter the programme details users need to recognise this curriculum path.'}
                >
                  {modulePlacementMode ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-primary-100 bg-primary-50/70 px-4 py-3 text-[12px] font-semibold text-primary-800">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
                            <AppIcon className="ri-folder-add-line"></AppIcon>
                          </span>
                          <div>
                            <p className="font-heading text-[13px] font-bold">Add module to an existing programme</p>
                            <p className="mt-0.5 text-[11px] leading-5 text-primary-700">Choose a programme first, then select its cohort and group before adding the module.</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {programmes.map(programme => {
                          const id = programme.sourceId || programme.id;
                          const selected = Boolean(selectedProgramme && (
                            normalise(selectedProgramme.sourceId || selectedProgramme.id) === normalise(id)
                            || normalise(selectedProgramme.name) === normalise(programme.name)
                          ));
                          return (
                            <button
                              key={id || programme.name}
                              type="button"
                              onClick={() => chooseExistingProgramme(programme)}
                              className={`rounded-xl border px-4 py-3 text-left transition-smooth ${selected ? 'border-primary-300 bg-primary-50 text-primary-950 ring-2 ring-primary-100' : 'border-background-200 bg-background-50 text-foreground-800 hover:border-primary-200 hover:bg-primary-50/40'}`}
                            >
                              <div className="flex items-start gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm" style={{ backgroundColor: programme.color || '#6d28d9' }}>
                                  <AppIcon className="ri-book-2-line"></AppIcon>
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-heading font-bold">{programme.name || 'Untitled programme'}</p>
                                  <p className="mt-1 truncate text-[11px] font-semibold text-foreground-500">{programme.level || 'Level not set'}</p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-600">{programme.cohorts || 0} cohorts</span>
                                    <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-600">{programme.groups || 0} groups</span>
                                    <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-600">{programme.modules || 0} modules</span>
                                  </div>
                                </div>
                                {selected && <AppIcon className="ri-check-line shrink-0 text-lg text-primary-600"></AppIcon>}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {loading && !programmes.length && (
                        <LoadingState
                          title="Loading programmes"
                          text="Reading actual programmes, cohorts, groups, modules and holidays from the database."
                        />
                      )}

                      {!loading && !programmes.length && (
                        <p className="rounded-xl border border-dashed border-background-300 bg-background-50 px-4 py-8 text-center text-[12px] font-semibold text-foreground-500">
                          No programmes found yet. Create a programme from Curriculum Studio first, then come back to add modules.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                  {selectedProgramme && (
                    <PanelTone icon="ri-pencil-line" text="Editing the existing programme. Cohorts, groups and modules are loaded below using their saved IDs." />
                  )}
                  <div className="rounded-2xl border border-primary-100 bg-primary-50/70 px-4 py-3 text-[12px] font-semibold text-primary-800">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
                        <AppIcon className="ri-organization-chart"></AppIcon>
                      </span>
                      <div>
                        <p className="font-heading text-[13px] font-bold">Programme delivery flow</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-primary-700">Every programme follows cohort, group, modules/courses, then module content.</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <Field label="Programme name" value={programmeForm.name} onChange={value => setProgrammeForm(prev => ({ ...prev, name: value }))} required error={validation.programme[0]} placeholder="Example: Project Controls Technician" />
                    <ColorField label="Programme colour" value={programmeForm.color} onChange={value => setProgrammeForm(prev => ({ ...prev, color: value }))} />
                    <div>
                      <Field label="Level" value={programmeForm.level} onChange={value => setProgrammeForm(prev => ({ ...prev, level: value }))} placeholder="Example: L4" />
                    </div>
                    <div className="lg:col-span-2 rounded-xl border border-primary-100 bg-background-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-primary-700">Apply KSB source</p>
                          <p className="mt-1 text-[12px] font-medium text-foreground-500">
                            {selectedKsbProfile
                              ? `${selectedKsbProfile.standard || selectedKsbProfile.programmeName} - ${wizardKsbSetCountsLabel(selectedKsbProfile)}`
                            : selectedKsbStandard
                            ? `${selectedKsbStandard.name} - ${wizardStandardCountsLabel(selectedKsbStandard)}`
                            : ksbSourcesLoading
                            ? 'Loading KSB sources...'
                            : 'Choose the KSB source this programme must satisfy.'}
                          </p>
                        </div>
                        <div className="flex rounded-lg bg-background-100 p-1">
                          {(['profile', 'standard'] as const).map(kind => (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => {
                                userEditedWizardRef.current = true;
                                setKsbSourceKind(kind);
                                setKsbSourceValue('');
                              }}
                              className={`rounded-md px-3 py-2 text-[11px] font-bold ${ksbSourceKind === kind ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-50'}`}
                            >
                              {kind === 'profile' ? 'KSB profile' : 'KSB source'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 grid max-h-52 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                        {ksbSourceKind === 'profile' && ksbProfileOptions.map(({ profile, id }) => {
                          const value = `profile:${id}`;
                          const selected = ksbSourceValue === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                userEditedWizardRef.current = true;
                                setKsbSourceValue(value);
                              }}
                              className={`rounded-lg border px-3 py-2 text-left transition-smooth ${selected ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-background-200 bg-background-50 text-foreground-800 hover:border-primary-200'}`}
                            >
                              <span className="block truncate text-[12px] font-bold">{profile.standard || profile.programmeName || 'KSB profile'}</span>
                              <span className="mt-1 block text-[10px] font-semibold text-foreground-500">{wizardKsbSetCountsLabel(profile)}</span>
                            </button>
                          );
                        })}
                        {ksbSourceKind === 'standard' && standardOptions.map(standard => {
                          const value = `standard:${standard.id}`;
                          const selected = ksbSourceValue === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                userEditedWizardRef.current = true;
                                setKsbSourceValue(value);
                                setProgrammeForm(prev => ({
                                  ...prev,
                                  standard: standard.name || standard.standardRef || prev.standard,
                                  level: standard.levelValue || standard.level || prev.level,
                                }));
                              }}
                              className={`rounded-lg border px-3 py-2 text-left transition-smooth ${selected ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-background-200 bg-background-50 text-foreground-800 hover:border-primary-200'}`}
                            >
                              <span className="block truncate text-[12px] font-bold">{standard.name || standard.standardRef}</span>
                              <span className="mt-1 block text-[10px] font-semibold text-foreground-500">{wizardStandardCountsLabel(standard)}</span>
                            </button>
                          );
                        })}
                        {!ksbSourcesLoading && ksbSourceKind === 'profile' && !ksbProfileOptions.length && (
                          <p className="rounded-lg border border-dashed border-background-200 px-3 py-4 text-[12px] font-medium text-foreground-500">No KSB profiles found.</p>
                        )}
                        {!ksbSourcesLoading && ksbSourceKind === 'standard' && !standardOptions.length && (
                          <p className="rounded-lg border border-dashed border-background-200 px-3 py-4 text-[12px] font-medium text-foreground-500">No KSB sources found.</p>
                        )}
                      </div>
                    </div>
                    <div className="lg:col-span-2">
                      <TextArea label="Description" value={programmeForm.description} onChange={value => setProgrammeForm(prev => ({ ...prev, description: value }))} rows={3} />
                    </div>
                  </div>
                    </>
                  )}
                </StepPanel>
              )}

              {step === 'cohort' && (
                <StepPanel title="Choose or edit cohort" description="Select a cohort in this programme, then confirm its dates and holiday rules.">
                  <CurrentParentBanner
                    icon="ri-book-2-line"
                    label={selectedProgramme ? 'Editing programme' : 'Programme created'}
                    title={activeProgramme.name || 'Programme'}
                    meta={activeProgramme.level || 'Ready for cohort setup'}
                    color={activeProgramme.color || '#2563eb'}
                    next={
                      showCohortDatabaseLoading
                        ? 'Cohorts are being loaded from the database.'
                        : selectedProgramme
                        ? 'Actual cohorts from the database are shown here when returned.'
                        : 'Now add the cohort that belongs inside this programme.'
                    }
                  />
                  {showCohortDatabaseLoading ? (
                    <LoadingState title="Cohorts are being loaded" text="Reading the actual cohorts assigned to this programme from the database." />
                  ) : showCohortDatabaseError ? (
                    <EmptyState text="Could not load cohorts from the database for this programme." />
                  ) : showNoDatabaseCohorts ? (
                    <div className="space-y-3">
                      <EmptyState text="No cohorts are found in the database for this programme." />
                      <button type="button" onClick={addCohortDraft} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700">
                        <AppIcon className="ri-add-line"></AppIcon>
                        Add cohort
                      </button>
                    </div>
                  ) : (
                    <DraftSwitcher
                      label={selectedProgramme ? 'Actual cohorts from database' : 'Cohorts in this programme'}
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
                      addLabel="Add cohort"
                      onCloneItem={cloneCohortDraft}
                      onRemoveItem={removeCohortDraft}
                      removingId={removingDraftId}
                    />
                  )}
                  {cohortDrafts.length > 0 && (
                    <div className="space-y-4">
                      <section className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: cohortForm.color }}>
                              <AppIcon className="ri-calendar-event-line text-lg"></AppIcon>
                            </span>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-foreground-400">Cohort details</p>
                              <h4 className="truncate text-sm font-heading font-bold text-foreground-950">{cohortForm.name || 'Name this cohort'}</h4>
                            </div>
                          </div>
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
                <StepPanel title="Choose or edit group" description="Select the cohort, then configure the delivery group that belongs inside it.">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <aside className="space-y-3 xl:sticky xl:top-3 xl:self-start">
                      <DraftSwitcher
                        label="Cohorts"
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
                        removingId={removingDraftId}
                        compact
                      />
                    </aside>

                    <section className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
                      <div className="border-b border-background-200 bg-gradient-to-r from-background-100 via-background-50 to-primary-50/50 px-4 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex min-w-0 gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: cohortForm.color || '#10b981' }}>
                              <AppIcon className="ri-calendar-event-line text-lg"></AppIcon>
                            </span>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-foreground-400">Groups in selected cohort</p>
                              <h4 className="truncate text-base font-heading font-bold text-foreground-950">{cohortForm.name || 'Unnamed cohort'}</h4>
                              <p className="mt-0.5 text-[12px] font-semibold text-foreground-500">
                                {formatGroupCount(configuredGroupCount(activeCohort))} - {formatModuleCount(configuredModuleCount(activeGroup))} in selected group
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <span className="rounded-full bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 shadow-sm">
                              {groupForm.name || 'No group selected'}
                            </span>
                            <button
                              type="button"
                              onClick={() => addGroupDraft()}
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                            >
                              <AppIcon className="ri-add-line"></AppIcon>
                              Add group
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="border-b border-background-200 bg-background-50 px-4 py-3">
                        {activeCohort.groups.length ? (
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {activeCohort.groups.map((group, index) => {
                              const active = group.localId === activeGroup.localId;
                              const removing = removingDraftId === group.localId;
                              const schedule = `${group.deliveryDays.join(', ') || 'No days'} ${group.startTime || ''}-${group.endTime || addHoursToTime(group.startTime, 2)}`.trim();
                              return (
                                <div
                                  key={group.localId}
                                  className={`group flex min-w-[190px] overflow-hidden rounded-xl border transition-smooth ${active ? 'border-primary-300 bg-primary-50 shadow-sm ring-2 ring-primary-100' : 'border-background-200 bg-background-100/60 hover:border-primary-200'} ${removing ? 'pointer-events-none opacity-60' : ''}`}
                                  style={{ borderLeftColor: group.color, borderLeftWidth: 4 }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveGroupId(group.localId);
                                      setActiveModuleId(group.modules[0]?.localId || '');
                                      setExpandedModuleId('');
                                    }}
                                    className="min-w-0 flex-1 px-3 py-2 text-left"
                                  >
                                    <span className="block truncate text-[12px] font-bold text-foreground-950">{group.name || `Group ${index + 1}`}</span>
                                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-500">
                                      {formatModuleCount(configuredModuleCount(group))} - {schedule}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeGroupDraft(group.localId)}
                                    disabled={removing}
                                    className="flex w-9 shrink-0 items-center justify-center border-l border-background-200 text-foreground-300 opacity-0 transition-smooth hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:cursor-wait"
                                    aria-label={`Remove ${group.name || `Group ${index + 1}`}`}
                                  >
                                    <AppIcon className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></AppIcon>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => cloneGroupDraft(group.localId)}
                                    className="flex w-9 shrink-0 items-center justify-center border-l border-background-200 text-foreground-300 opacity-0 transition-smooth hover:bg-primary-50 hover:text-primary-700 group-hover:opacity-100"
                                    aria-label={`Clone ${group.name || `Group ${index + 1}`}`}
                                  >
                                    <AppIcon className="ri-file-copy-line text-sm"></AppIcon>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      {activeCohort.groups.length > 0 ? (
                        <div className="p-4">
                          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_280px]">
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_8rem]">
                                <Field label="Group name" value={groupForm.name} onChange={value => setGroupForm(prev => ({ ...prev, name: value }))} required error={validation.group.find(item => item.includes('Group'))} placeholder="Example: Wednesday AM" />
                                <ColorField label="Colour" value={groupForm.color} onChange={value => setGroupForm(prev => ({ ...prev, color: value }))} compact />
                              </div>
                              <div className="rounded-xl border border-background-200 bg-background-100/50 p-3">
                                <WeekdayCheckboxes label="Delivery days" value={activeGroup.deliveryDays} onChange={deliveryDays => setGroupForm(prev => ({ ...prev, deliveryDays }))} error={validation.group.find(item => item.includes('delivery day'))} compact />
                              </div>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field label="Start time" type="time" value={groupForm.startTime} onChange={value => setGroupForm(prev => ({ ...prev, startTime: value, endTime: addHoursToTime(value, 2) }))} required error={validation.group.find(item => item.includes('Start time'))} />
                                <Field label="End time" type="time" value={groupForm.endTime} onChange={value => setGroupForm(prev => ({ ...prev, endTime: value }))} />
                              </div>
                            </div>

                            <div className="rounded-xl border border-background-200 bg-background-100/50 p-3">
                              <div className="mb-3 flex items-center gap-2">
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                                  <AppIcon className="ri-user-star-line text-sm"></AppIcon>
                                </span>
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-foreground-400">Group coach</p>
                                  <p className="text-[11px] font-semibold text-foreground-500">Assigned at group level</p>
                                </div>
                              </div>
                              <StaffSelect label="Coach" value={groupForm.coach} onChange={value => setGroupForm(prev => ({ ...prev, coach: value }))} options={coachOptions} onOpen={() => reloadStaffProfiles({ silent: true })} />
                              {activeGroupCoachConflict && (
                                <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold leading-5 text-sky-800">
                                  <div className="flex items-start gap-2">
                                    <AppIcon className="ri-information-line mt-0.5 shrink-0 text-sm"></AppIcon>
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Coach availability hint</p>
                                      <p>
                                        {activeGroupCoachConflict.coach} also has {activeGroupCoachConflict.groupName}
                                        {' '}in {[activeGroupCoachConflict.programmeName, activeGroupCoachConflict.cohortName].filter(Boolean).join(' / ')}
                                        {' '}on {activeGroupCoachConflict.days.join(', ')}
                                        {' '}at {activeGroupCoachConflict.time}. You can continue if this overlap is expected.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4">
                          <EmptyState text="No groups in this cohort yet. Add a group to configure delivery." />
                        </div>
                      )}
                    </section>
                  </div>
                </StepPanel>
              )}

              {step === 'modules' && (
                <StepPanel title="Add modules to this group" description="Choose the cohort and group on the left, then link an existing module or create a new one.">
                  <ModulesStepWorkspace
                    freeMode={isFreeProgramme}
                    programmeName={activeProgramme.name || programmeForm.name}
                    cohortDrafts={cohortDrafts}
                    activeCohort={activeCohort}
                    activeGroup={activeGroup}
                    activeModule={activeModule}
                    moduleDrafts={moduleDrafts}
                    moduleOptions={moduleOptions}
                    tutors={tutorOptions}
                    coachOptions={coachOptions}
                    groupForm={groupForm}
                    removingDraftId={removingDraftId}
                    validationModules={validation.modules}
                    tutorConflicts={tutorScheduleConflicts}
                    onRefreshStaffProfiles={() => reloadStaffProfiles({ silent: true })}
                    onSelectCohort={id => {
                      const nextCohort = cohortDrafts.find(cohort => cohort.localId === id);
                      const nextGroup = nextCohort?.groups[0];
                      setActiveCohortId(id);
                      setActiveGroupId(nextGroup?.localId || '');
                      setExpandedGroupId('');
                      setActiveModuleId('');
                      setExpandedModuleId('');
                    }}
                    onSelectGroup={id => {
                      setActiveGroupId(id);
                      setActiveModuleId('');
                      setExpandedModuleId('');
                    }}
                    onSelectModule={id => {
                      setActiveModuleId(id);
                      setExpandedModuleId('');
                    }}
                    onAddModule={addModuleDraft}
                    onCloneModule={id => cloneModuleDraftForActiveGroup(id, { focusModulesStep: true })}
                    onRemoveModule={removeModuleDraft}
                    onChangeModule={updateModuleDraft}
                    onSelectExistingModule={selectExistingModule}
                    onPersistTeamsMeeting={persistTeamsMeetingForModuleDraft}
                    onResolveTutorConflict={resolveTutorConflict}
                  />
                </StepPanel>
              )}

              {step === 'weeks' && (
                <StepPanel title="Review components" description={isFreeProgramme ? 'Add the components that learners complete inside each free module.' : 'Check the components attached to this group before review.'}>
                  {isFreeProgramme ? (
                    <section className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
                      <div className="border-b border-background-200 bg-gradient-to-r from-background-100 via-background-50 to-primary-50/50 px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
                              <AppIcon className="ri-stack-line text-lg"></AppIcon>
                            </span>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-foreground-400">Free module content</p>
                              <h4 className="truncate text-base font-heading font-bold text-foreground-950">{activeProgramme.name || programmeForm.name || 'Custom modules'}</h4>
                              <p className="mt-0.5 text-[12px] font-semibold text-foreground-500">{formatModuleCount(configuredModuleCount(activeGroup))}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => addModuleDraft({ focusModulesStep: true })}
                            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                          >
                            <AppIcon className="ri-add-line"></AppIcon>
                            Add Module
                          </button>
                        </div>
                      </div>
                      <div className="space-y-4 p-4">
                        {moduleDrafts.length ? moduleDrafts.map(draft => (
                          <ModuleBuilderContentPreview
                            key={draft.localId}
                            freeMode={isFreeProgramme}
                            draft={draft}
                            actualComponentsLoading={moduleActualComponentsLoading(draft)}
                            moduleBuilderMissing={moduleBuilderStructureMissing(draft)}
                            moduleBuilderLoadFailed={moduleBuilderStructureFailed(draft)}
                            moduleBuilderEmpty={moduleBuilderStructureEmpty(draft)}
                            moduleOptions={moduleOptions}
                            programmeId={selectedProgramme?.sourceId || selectedProgramme?.id || slugify(activeProgramme.name || programmeForm.name)}
                            programmeName={activeProgramme.name || programmeForm.name}
                            ksbSourceId={ksbSourceValue}
                            ksbSourceLabel={selectedKsbSourceLabel}
                            cohort={activeCohort}
                            group={activeGroup}
                            onAddFreeComponent={addFreeComponent}
                            onUpdateFreeComponent={updateFreeComponent}
                            onRemoveFreeComponent={removeFreeComponent}
                            onReorderFreeComponent={reorderFreeComponent}
                            onOpenModuleBuilder={setEmbeddedModuleBuilderUrl}
                          />
                        )) : (
                          <EmptyState text="No custom modules yet. Add a module first, then add its components manually." />
                        )}
                      </div>
                    </section>
                  ) : (
                  <>
                    <DraftSwitcher
                    label="Select cohort for content"
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
                    onCloneItem={id => cloneCohortDraft(id, { focusCohortStep: true })}
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
                      onCloneItem={id => cloneGroupDraft(id, { focusGroupStep: true })}
                      onRemoveItem={removeGroupDraft}
                      removingId={removingDraftId}
                      defaultOpen={false}
                    />
                    {activeCohort.groups.length > 0 && (
                      <NestedScopeCard
                        icon="ri-team-line"
                        label="Components in selected group"
                        title={groupForm.name || 'Unnamed group'}
                        meta={`${groupForm.deliveryDay || 'No delivery days'} - ${groupForm.startTime}-${groupForm.endTime}`}
                        color={groupForm.color}
                        badge={`${formatModuleCount(configuredModuleCount(activeGroup))} inside this group`}
                        defaultOpen
                      >
                        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] font-semibold text-sky-800">
                          <span className="flex items-start gap-2">
                            <AppIcon className="ri-information-line mt-0.5 text-sm"></AppIcon>
                            <span>Components are managed in Module Builder. This wizard applies cohort and group scheduling before review.</span>
                          </span>
                        </div>
                        <div className="space-y-4">
                          {moduleDrafts.map(draft => (
                            <ModuleBuilderContentPreview
                              key={draft.localId}
                              freeMode={isFreeProgramme}
                              draft={draft}
                              actualComponentsLoading={moduleActualComponentsLoading(draft)}
                              moduleBuilderMissing={moduleBuilderStructureMissing(draft)}
                              moduleBuilderLoadFailed={moduleBuilderStructureFailed(draft)}
                              moduleBuilderEmpty={moduleBuilderStructureEmpty(draft)}
                              moduleOptions={moduleOptions}
                              programmeId={selectedProgramme?.sourceId || selectedProgramme?.id || slugify(activeProgramme.name || programmeForm.name)}
                              programmeName={activeProgramme.name || programmeForm.name}
                              ksbSourceId={ksbSourceValue}
                              ksbSourceLabel={selectedKsbSourceLabel}
                              cohort={activeCohort}
                              group={activeGroup}
                              onOpenModuleBuilder={setEmbeddedModuleBuilderUrl}
                            />
                          ))}
                        </div>
                      </NestedScopeCard>
                    )}
                  </ScopeCard>
                  </>
                  )}
                </StepPanel>
              )}

              {step === 'review' && (
                <StepPanel title="Review and save" description="Check the programme, cohorts, groups and modules before saving.">
                  <TutorConflictWarning conflicts={tutorScheduleConflicts} onResolve={resolveTutorConflict} />
                  <ReviewSummary
                    isEditing={Boolean(selectedProgramme)}
                    freeMode={isFreeProgramme}
                    programme={activeProgramme}
                    cohortForm={cohortForm}
                    groupForm={groupForm}
                    moduleDrafts={moduleDrafts}
                    moduleOptions={moduleOptions}
                    tutorOptions={tutorOptions}
                    coachOptions={coachOptions}
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

        <footer className="border-t border-foreground-200/60 bg-background-50 px-5 sm:px-6 py-4">
          {footerBlocker && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
              <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm"></AppIcon>
              <span>{footerBlocker}</span>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <button type="button" onClick={stepIndex === 0 ? requestClose : () => setStep(visibleSteps[stepIndex - 1].key)} disabled={Boolean(saving)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50 transition-smooth">
            <AppIcon className={stepIndex === 0 ? 'ri-close-line' : 'ri-arrow-left-line'}></AppIcon>
            {stepIndex === 0 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {step === 'review' && (
              <div className="rounded-lg border border-background-200 bg-background-100 px-3 py-2 text-[11px] font-bold text-foreground-600 sm:text-right">
                {selectedProgramme ? 'Ready to update' : 'Ready to save'}: <span className="text-foreground-950">{reviewSaveSummary}</span>
              </div>
            )}
            {(canSaveDraft || saving === 'draft') && (
              <button type="button" onClick={() => persistStructure('draft')} disabled={Boolean(saving) || !canSaveDraft} className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50 transition-smooth">
                <AppIcon className="ri-save-3-line"></AppIcon>
                {saving === 'draft' ? selectedProgramme ? 'Updating...' : 'Saving...' : selectedProgramme ? 'Update' : 'Save Draft'}
              </button>
            )}
            {step === 'review' ? (
              <button type="button" onClick={() => persistStructure('final')} disabled={Boolean(saving) || !canSave} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-50 transition-smooth">
                <AppIcon className="ri-checkbox-circle-line"></AppIcon>
                {saving === 'final' ? 'Saving...' : selectedProgramme ? 'Update Programme' : 'Create Programme'}
              </button>
            ) : (
              <button type="button" onClick={() => setStep(nextStepMeta.key)} disabled={!canContinue || Boolean(saving)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-50 transition-smooth">
                {`Next: ${nextStepMeta.label}`}
                <AppIcon className="ri-arrow-right-line"></AppIcon>
              </button>
            )}
          </div>
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

        {embeddedModuleBuilderUrl && (
          <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-5">
            <div className="flex h-[min(88vh,920px)] w-[min(96vw,1500px)] flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl">
              <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-background-200 bg-background-50 px-4 shadow-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { void closeEmbeddedModuleBuilder(); }}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white shadow-sm shadow-primary-500/20 transition-smooth hover:bg-primary-700"
                    aria-label="Back to Wizard"
                    title="Back to Wizard"
                  >
                    <AppIcon className="ri-arrow-left-line"></AppIcon>
                    Back to Wizard
                  </button>
                  <div className="min-w-0 border-l border-background-200 pl-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Module Builder</p>
                    <p className="truncate text-sm font-heading font-bold text-foreground-950">Editing module content from the wizard</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { void closeEmbeddedModuleBuilder(); }}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-600 transition-smooth hover:bg-background-100"
                  aria-label="Close Module Builder and return to Wizard"
                  title="Back to Wizard"
                >
                  <AppIcon className="ri-close-line text-lg"></AppIcon>
                </button>
              </div>
              <iframe
                title="Module Builder"
                src={embeddedModuleBuilderUrl}
                className="min-h-0 flex-1 border-0 bg-background-50"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

function PopupTrail({
  current,
  stepIndex,
  steps: trailSteps,
  onNavigate,
}: {
  current: WizardStep;
  stepIndex: number;
  steps: Array<{ key: WizardStep; label: string; icon: string }>;
  onNavigate: (step: WizardStep) => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
      {trailSteps.map((item, index) => {
        const active = item.key === current;
        const complete = index < stepIndex;
        const canNavigate = index <= stepIndex && !active;
        return (
          <div key={item.key} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => canNavigate && onNavigate(item.key)}
              disabled={!canNavigate}
              aria-current={active ? 'step' : undefined}
              title={canNavigate ? `Go to ${item.label}` : item.label}
              className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-bold transition-smooth disabled:cursor-default ${active ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100' : 'border-background-200 bg-background-100 text-foreground-400'}`}
            >
              <AppIcon className={`${complete ? 'ri-check-line' : item.icon} text-[12px]`}></AppIcon>
              {item.label}
            </button>
            {index < trailSteps.length - 1 && <span className={`h-0.5 w-5 rounded-full ${complete ? 'bg-emerald-300' : 'bg-background-200'}`} />}
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
  freeMode = false,
}: {
  stepIndex: number;
  programme: CurriculumProgramme;
  cohort: CohortDraft;
  group: GroupDraft & { deliveryDay?: string };
  freeMode?: boolean;
}) {
  const cards = (freeMode ? [
    {
      label: 'Programme',
      title: programme?.name || 'Programme',
      meta: programme?.level || 'Free course',
      color: programme?.color || '#2563eb',
      icon: 'ri-book-2-line',
    },
    {
      label: 'Modules',
      title: 'Custom modules',
      meta: formatModuleCount(configuredModuleCount(group)),
      color: '#7c3aed',
      icon: 'ri-stack-line',
    },
  ] : [
    {
      label: 'Programme',
      title: programme?.name || 'Programme',
      meta: programme?.level || 'Created',
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
  ]).slice(0, Math.max(0, Math.min(stepIndex, freeMode ? 2 : 4)));

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
              <AppIcon className={card.icon}></AppIcon>
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
  onCloneItem,
  onRemoveItem,
  removingId,
  compact,
}: {
  label: string;
  items: Array<{ id: string; label: string; meta: string; color?: string }>;
  activeId: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  onCloneItem?: (id: string) => void;
  onRemoveItem?: (id: string) => void | Promise<void>;
  removingId?: string;
  compact?: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <div className={`${compact ? 'mb-3' : 'mb-4'} rounded-xl border border-background-200 bg-background-50 px-3 py-2 shadow-sm`}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
          <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{items.length}</span>
        </div>
        {onAdd && (
          <button type="button" onClick={onAdd} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700">
            <AppIcon className="ri-add-line"></AppIcon>
            {addLabel || 'Add'}
          </button>
        )}
      </div>
      <div className={`${compact ? 'mt-1.5' : 'mt-2'} min-w-0`}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map(item => {
            const removing = removingId === item.id;
            return (
            <div
              key={item.id}
              className={`group flex ${compact ? 'min-w-[150px]' : 'min-w-[172px]'} overflow-hidden rounded-lg border text-left transition-smooth ${removing ? 'pointer-events-none opacity-60' : ''} ${item.id === activeId ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-background-200 bg-background-100/60 hover:border-primary-200'}`}
              style={{ borderLeftColor: item.color || undefined, borderLeftWidth: item.color ? 4 : undefined }}
              aria-busy={removing}
            >
              <button type="button" onClick={() => onSelect(item.id)} disabled={removing} className={`min-w-0 flex-1 px-3 ${compact ? 'py-1.5' : 'py-2'} text-left disabled:cursor-wait`}>
                <span className="flex items-center gap-2">
                  {item.color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }}></span>}
                  <span
                    className="block min-w-0 truncate rounded-md px-2 py-0.5 text-[12px] font-black text-foreground-950 ring-1"
                    style={{
                      backgroundColor: item.color ? `${item.color}14` : undefined,
                      color: item.color || undefined,
                      ['--tw-ring-color' as string]: item.color ? `${item.color}33` : undefined,
                    }}
                  >
                    {item.label}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-500">{item.meta}</span>
              </button>
              {onCloneItem && (
                <button
                  type="button"
                  onClick={() => onCloneItem(item.id)}
                  disabled={removing}
                  className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-300 opacity-0 transition-smooth hover:bg-primary-50 hover:text-primary-700 group-hover:opacity-100 disabled:cursor-wait"
                  aria-label={`Clone ${item.label}`}
                  title={`Clone ${item.label}`}
                >
                  <AppIcon className="ri-file-copy-line text-sm"></AppIcon>
                </button>
              )}
              {onRemoveItem && (
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  disabled={removing}
                  className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-300 opacity-0 transition-smooth hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:cursor-wait"
                  aria-label={removing ? `Removing ${item.label}` : `Remove ${item.label}`}
                  title={removing ? `Removing ${item.label}` : `Remove ${item.label}`}
                >
                  <AppIcon className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></AppIcon>
                </button>
              )}
            </div>
            );
          })}
        </div>
      </div>
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
            <AppIcon className={`${icon} ${compact ? 'text-base' : 'text-lg'}`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-foreground-400">{label}</p>
            <h4
              className={`${compact ? 'text-sm' : 'text-base'} mt-1 inline-flex max-w-full rounded-lg px-2.5 py-1 font-heading font-black ring-1`}
              style={{
                backgroundColor: `${color}14`,
                color,
                ['--tw-ring-color' as string]: `${color}33`,
              }}
            >
              <span className="truncate">{title}</span>
            </h4>
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
            <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></AppIcon>
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
  defaultOpen = true,
}: {
  icon: string;
  label: string;
  title: string;
  meta: string;
  color: string;
  badge: string;
  compact?: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`rounded-2xl border border-background-200 bg-background-50 ${compact ? 'p-3' : 'p-4'} shadow-sm`} style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
      <div className={`${open ? (compact ? 'mb-3' : 'mb-4') : ''} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex ${compact ? 'h-9 w-9' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl text-white shadow-sm`} style={{ backgroundColor: color }}>
            <AppIcon className={`${icon} ${compact ? 'text-base' : 'text-lg'}`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase" style={{ color }}>{label}</p>
            <h4
              className={`${compact ? 'text-sm' : 'text-base'} mt-1 inline-flex max-w-full rounded-lg px-2.5 py-1 font-heading font-black ring-1`}
              style={{
                backgroundColor: `${color}14`,
                color,
                ['--tw-ring-color' as string]: `${color}33`,
              }}
            >
              <span className="truncate">{title}</span>
            </h4>
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
            <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></AppIcon>
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
                {checked && <AppIcon className="ri-check-line text-[11px]"></AppIcon>}
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
  return (
    <section className="rounded-2xl bg-background-50 p-4 sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-heading font-bold text-foreground-950">{title}</h3>
          <p className="mt-1 text-[12px] leading-5 text-foreground-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
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
            <AppIcon className={`${icon} text-lg`}></AppIcon>
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
  const [showAllSelected, setShowAllSelected] = useState(false);
  const selectableIds = useMemo(
    () => selectHolidayIdsInAdjustedCohortRange(cohortStartDate, cohortDurationMonths, holidays, []),
    [cohortDurationMonths, cohortStartDate, holidays],
  );
  const selectableSet = useMemo(() => new Set(selectableIds), [selectableIds]);
  const selectedInRangeIds = useMemo(() => selectedIds.filter(id => selectableSet.has(id)), [selectableSet, selectedIds]);
  const selectedSet = new Set(selectedInRangeIds);
  const selectedHolidays = holidays.filter(holiday => selectedSet.has(holidayId(holiday)));
  const visibleSelectedHolidays = showAllSelected ? selectedHolidays : selectedHolidays.slice(0, 5);

  useEffect(() => {
    if (selectedInRangeIds.length === selectedIds.length) return;
    onChange(selectedInRangeIds);
  }, [onChange, selectedIds.length, selectedInRangeIds]);

  useEffect(() => {
    if (selectedInRangeIds.length <= 5) setShowAllSelected(false);
  }, [selectedInRangeIds.length]);

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
              <AppIcon className="ri-sun-cloudy-line text-lg"></AppIcon>
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
        <button type="button" onClick={() => onChange(selectableIds)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white transition-smooth hover:bg-amber-600">
          Select in range ({selectableIds.length})
        </button>
        <button type="button" onClick={() => setExpanded(current => !current)} className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100 transition-smooth">
          <AppIcon className={`${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} mr-1`}></AppIcon>
          {expanded ? 'Hide holiday list' : 'Browse holidays'}
        </button>
        {selectedInRangeIds.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 hover:bg-background-100 transition-smooth">
            Clear selected
          </button>
        )}
        <button type="button" onClick={onManage} className="rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] font-bold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
          <AppIcon className="ri-settings-3-line mr-1"></AppIcon>
          Manage holidays
        </button>
        <span className="ml-auto rounded-full bg-background-100 px-3 py-1.5 text-[11px] font-bold text-foreground-600">
          {selectedInRangeIds.length} selected in cohort range
        </span>
      </div>

      {selectedInRangeIds.length > 0 && !expanded && (
        <div className="border-b border-background-200/70 bg-background-100/40 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {visibleSelectedHolidays.map(holiday => (
              <span key={holidayId(holiday)} className="rounded-full bg-background-50 px-3 py-1 text-[11px] font-bold text-foreground-700 shadow-sm">
                {holiday.label}
              </span>
            ))}
            {selectedInRangeIds.length > 5 && !showAllSelected && (
              <button type="button" onClick={() => setShowAllSelected(true)} className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100">
                +{selectedInRangeIds.length - 5} more
              </button>
            )}
            {selectedInRangeIds.length > 5 && showAllSelected && (
              <button type="button" onClick={() => setShowAllSelected(false)} className="rounded-full bg-background-50 px-3 py-1 text-[11px] font-bold text-foreground-600 shadow-sm transition-smooth hover:bg-background-200">
                Show less
              </button>
            )}
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

const NEW_HOLIDAY_TYPE_BUSY_KEY = '__new_holiday_type__';

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
  const [collapsedHolidayYears, setCollapsedHolidayYears] = useState<Record<string, boolean>>({});
  const [holidaySearch, setHolidaySearch] = useState('');
  const [holidayTypeFilter, setHolidayTypeFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editing = draft.id !== undefined && draft.id !== null;
  const typeLibrary = useMemo(() => buildHolidayTypeLibrary(holidays), [holidays]);
  const filteredHolidays = useMemo(
    () => filterHolidays(holidays, holidaySearch, holidayTypeFilter),
    [holidaySearch, holidayTypeFilter, holidays],
  );
  const holidayYearGroups = useMemo(() => buildHolidayYearGroups(filteredHolidays), [filteredHolidays]);
  const holidayYears = useMemo(() => buildHolidayYearGroups(holidays).map(group => group.year), [holidays]);
  const canSave = Boolean(draft.label.trim() && draft.startDate && draft.endDate);
  const draftDuration = holidayDraftDurationLabel(draft);
  const draftDateSummary = draft.startDate
    ? `${formatSessionDate(draft.startDate)}${draft.endDate && draft.endDate !== draft.startDate ? ` to ${formatSessionDate(draft.endDate)}` : ''}`
    : 'Choose start and end dates';
  const filteredType = typeLibrary.find(type => normalise(type.name) === normalise(holidayTypeFilter));

  const updateDraft = (patch: Partial<HolidayManagerDraft>) => setDraft(current => ({ ...current, ...patch }));
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
    <div className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/35 p-3 sm:p-6" onClick={event => event.stopPropagation()}>
      <section className="flex max-h-[92vh] w-full max-w-[1760px] flex-col overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-2xl">
        <header className="border-b border-foreground-200/60 bg-background-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <AppIcon className="ri-sun-cloudy-line text-xl"></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-700">Curriculum Studio</p>
                <h3 className="mt-1 text-base font-heading font-bold text-foreground-950">Holidays & non-teaching periods</h3>
                <p className="mt-1 text-[12px] leading-5 text-foreground-500">Manage global holidays here, then select which ones apply to this cohort.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-700 hover:bg-background-200">
              <AppIcon className="ri-close-line text-lg"></AppIcon>
            </button>
          </div>
        </header>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-[12px] font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-background-100/70 md:grid-cols-[440px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-background-200/70 bg-background-50 p-4 md:border-b-0 md:border-r">
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

              <div className="mt-4 overflow-hidden rounded-xl border border-background-200 bg-background-100/70">
                <div className="border-b border-background-200 bg-background-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase text-foreground-400">Period preview</p>
                </div>
                <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 p-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: draft.color || '#7c3aed' }}>
                    <AppIcon className="ri-calendar-event-line text-lg"></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-heading font-bold text-foreground-950">{draft.label || 'Unnamed holiday period'}</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">{draftDateSummary}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {draft.type ? <span className="rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase" style={holidayTypeBadgeStyle(draft.color)}>{draft.type}</span> : null}
                      <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-600 shadow-sm">{draftDuration}</span>
                    </div>
                  </div>
                </div>
              </div>

              <button type="button" onClick={saveHoliday} disabled={!canSave || saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <AppIcon className="ri-save-3-line"></AppIcon>}
                {editing ? 'Save changes' : 'Add period'}
              </button>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4">
            <div className="sticky top-0 z-10 mb-3 rounded-2xl border border-background-200 bg-background-50/95 p-4 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-heading font-bold text-foreground-950">Global holiday library</p>
                  <p className="mt-0.5 text-[12px] text-foreground-500">
                    {filteredHolidays.length} of {holidays.length} periods shown across {holidayYearGroups.length} years{filteredType ? ` - ${filteredType.name}` : ''}.
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
                  <AppIcon className="ri-search-line text-foreground-400"></AppIcon>
                  <input
                    value={holidaySearch}
                    onChange={event => setHolidaySearch(event.target.value)}
                    placeholder="Search holidays by name, type, or date..."
                    className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-foreground-900 outline-none placeholder:text-foreground-400"
                  />
                  {holidaySearch && (
                    <button type="button" onClick={() => setHolidaySearch('')} className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-400 hover:bg-background-100 hover:text-foreground-700" aria-label="Clear holiday search">
                      <AppIcon className="ri-close-line"></AppIcon>
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
                          <AppIcon className={`${collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} text-lg`}></AppIcon>
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
                      <div className="grid grid-cols-1 gap-3 p-3 2xl:grid-cols-2">
                        {group.holidays.map(holiday => {
                          const color = holiday.color || '#0f766e';
                          const typeColor = typeLibrary.find(type => normalise(type.name) === normalise(holiday.type))?.color || color;
                          return (
                            <div key={holidayId(holiday)} className="group overflow-hidden rounded-xl border border-background-200 bg-background-50 transition-smooth hover:border-primary-200 hover:shadow-md">
                              <div className="flex items-start gap-3 p-3">
                                <span className="mt-1 h-12 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }}></span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-[13px] font-heading font-bold text-foreground-950">{holiday.label || 'Holiday'}</p>
                                    {holiday.type && (
                                      <span className="rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase" style={holidayTypeBadgeStyle(typeColor)}>
                                        {holiday.type}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    <HolidayDateChip label="Starts" value={holiday.startDate} />
                                    <HolidayDateChip label="Ends" value={holiday.endDate || holiday.startDate} />
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <button type="button" onClick={() => editHoliday(holiday)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${holiday.label}`}>
                                    <AppIcon className="ri-edit-line"></AppIcon>
                                  </button>
                                  <button type="button" onClick={() => archiveHoliday(holiday)} disabled={busyId === holiday.id} className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50" aria-label={`Archive ${holiday.label}`}>
                                    {busyId === holiday.id ? <span className="h-3 w-3 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" /> : <AppIcon className="ri-delete-bin-line"></AppIcon>}
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center justify-between border-t border-background-200 bg-background-100/50 px-3 py-2">
                                <span className="text-[10px] font-bold uppercase text-foreground-400">Teaching blackout period</span>
                                <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-600 shadow-sm">
                                  {holidayDurationLabel(holiday)}
                                </span>
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
          <AppIcon className="ri-add-line mr-1"></AppIcon>
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
                <AppIcon className="ri-edit-line text-[12px]"></AppIcon>
              </button>
              <button type="button" onClick={() => onRemove(type.name)} disabled={busy} className="flex h-6 w-6 items-center justify-center rounded-md bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50" aria-label={`Remove ${type.name}`}>
                {busy ? <span className="h-3 w-3 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" /> : <AppIcon className="ri-delete-bin-line text-[12px]"></AppIcon>}
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

function HolidayDateChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-100/70 px-2.5 py-2">
      <p className="text-[9px] font-bold uppercase text-foreground-400">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-bold text-foreground-800">{formatSessionDate(value) || 'No date'}</p>
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

function holidayDraftDurationLabel(draft: Pick<HolidayManagerDraft, 'startDate' | 'endDate'>) {
  const startDate = dateFromInput(draft.startDate || '');
  const endDate = dateFromInput(draft.endDate || draft.startDate || '');
  if (!startDate || !endDate) return 'No dates yet';
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

function buildHolidayTypeLibrary(holidays: CurriculumHoliday[]): HolidayTypeDefinition[] {
  const map = new Map<string, HolidayTypeDefinition>();
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
  freeMode = false,
  programmeName,
  cohortDrafts,
  activeCohort,
  activeGroup,
  activeModule,
  moduleDrafts,
  moduleOptions,
  tutors,
  coachOptions,
  groupForm,
  removingDraftId,
  validationModules,
  tutorConflicts,
  onRefreshStaffProfiles,
  onSelectCohort,
  onSelectGroup,
  onSelectModule,
  onAddModule,
  onCloneModule,
  onRemoveModule,
  onChangeModule,
  onSelectExistingModule,
  onPersistTeamsMeeting,
  onResolveTutorConflict,
}: {
  freeMode?: boolean;
  programmeName: string;
  cohortDrafts: CohortDraft[];
  activeCohort: CohortDraft;
  activeGroup: GroupDraft;
  activeModule?: ModuleDraft;
  moduleDrafts: ModuleDraft[];
  moduleOptions: CurriculumModule[];
  tutors: StaffOption[];
  coachOptions: StaffOption[];
  groupForm: GroupDraft & { deliveryDay: string };
  removingDraftId: string;
  validationModules: string[];
  tutorConflicts: TutorScheduleConflict[];
  onRefreshStaffProfiles: () => void;
  onSelectCohort: (id: string) => void;
  onSelectGroup: (id: string) => void;
  onSelectModule: (id: string) => void;
  onAddModule: () => void;
  onCloneModule: (id: string) => void;
  onRemoveModule: (id: string) => void | Promise<void>;
  onChangeModule: (localId: string, patch: Partial<ModuleDraft>) => void;
  onSelectExistingModule: (draft: ModuleDraft, catalogueId: string) => void;
  onPersistTeamsMeeting?: (draft: ModuleDraft, meeting: TeamsMeetingDraft, details: string) => Promise<Partial<ModuleDraft> | void>;
  onResolveTutorConflict: (conflict: TutorScheduleConflict) => void;
}) {
  const activeModuleIndex = activeModule ? Math.max(0, moduleDrafts.findIndex(draft => draft.localId === activeModule.localId)) : -1;
  const groupSchedule = `${groupForm.deliveryDay || 'No delivery days'} ${groupForm.startTime || ''}-${groupForm.endTime || addHoursToTime(groupForm.startTime, 2)}`.trim();
  const workspaceTitle = freeMode ? 'Custom modules' : (groupForm.name || 'Select a group');
  const workspaceMeta = freeMode ? (programmeName || 'Module course') : groupSchedule;

  return (
    <div className={`grid grid-cols-1 gap-4 ${freeMode ? '' : 'xl:grid-cols-[300px_minmax(0,1fr)]'}`}>
      {!freeMode && <aside className="space-y-3 xl:sticky xl:top-3 xl:self-start">
        <DeliveryPathPanel
          title="Current path"
          subtitle="Modules will be added to this selected group."
          rows={[
            { label: 'Programme', value: programmeName || 'Current programme', icon: 'ri-book-2-line', tone: 'bg-primary-50 text-primary-700' },
            { label: 'Cohort', value: cohortDisplayName(activeCohort), icon: 'ri-calendar-event-line', tone: 'bg-emerald-50 text-emerald-700' },
            { label: 'Group', value: activeGroup.name || 'No group selected', icon: 'ri-team-line', tone: 'bg-slate-100 text-slate-700' },
            { label: 'Coach', value: staffDisplayValue(activeGroup.coach, coachOptions) || 'Unassigned', icon: 'ri-user-star-line', tone: 'bg-amber-50 text-amber-700' },
          ]}
        />

        <EntityPickerPanel
          label="Cohorts"
          context={programmeName ? `Inside ${programmeName}` : 'Inside programme'}
          count={cohortDrafts.length}
          items={cohortDrafts.map(cohort => ({
            id: cohort.localId,
            label: cohortDisplayName(cohort),
            meta: formatGroupCount(configuredGroupCount(cohort)),
            color: cohort.color,
          }))}
          activeId={activeCohort.localId}
          onSelect={onSelectCohort}
          removingId={removingDraftId}
        />

        <EntityPickerPanel
          label="Groups"
          context={`Inside ${cohortDisplayName(activeCohort)}`}
          count={activeCohort.groups.length}
          items={activeCohort.groups.map((group, index) => ({
            id: group.localId,
            label: group.name || `Group ${index + 1}`,
            meta: `${group.deliveryDays.join(', ')} ${group.startTime}-${group.endTime || addHoursToTime(group.startTime, 2)}${staffIdentityKey(group.coach, coachOptions) ? ` - Coach: ${staffDisplayValue(group.coach, coachOptions)}` : ''}`,
            color: group.color,
          }))}
          activeId={activeGroup.localId}
          onSelect={onSelectGroup}
          removingId={removingDraftId}
          emptyText="Add a group before assigning modules."
        />
      </aside>}

      <section className="min-w-0 overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
        <div className="border-b border-background-200 bg-gradient-to-r from-background-100 via-background-50 to-primary-50/50 px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: groupForm.color || '#334155' }}>
                <AppIcon className={`${freeMode ? 'ri-stack-line' : 'ri-team-line'} text-lg`}></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-foreground-400">Selected group modules</p>
                <h4 className="truncate text-base font-heading font-bold text-foreground-950">{workspaceTitle}</h4>
                <p className="mt-0.5 text-[12px] font-semibold text-foreground-500">{workspaceMeta}</p>
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
                <AppIcon className="ri-add-line"></AppIcon>
                Add Module
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-background-200 bg-background-50 px-4 py-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-foreground-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1">
              <AppIcon className="ri-user-star-line text-amber-600"></AppIcon>
              Group coach: {staffDisplayValue(activeGroup.coach, coachOptions) || 'Unassigned'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1">
              <AppIcon className="ri-user-line text-primary-600"></AppIcon>
              Select a tutor inside each module
            </span>
          </div>
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
                        {isConfiguredModule(draft) ? (freeMode ? `${draft.weeks.reduce((total, week) => total + week.components.length, 0)} components` : formatSessionCount(moduleDraftChipSessionCount(draft, moduleOptions))) : 'Not configured'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onCloneModule(draft.localId)}
                      disabled={removing}
                      className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-primary-50 hover:text-primary-700 disabled:cursor-wait"
                      aria-label={`Clone ${title}`}
                      title={`Clone ${title}`}
                    >
                      <AppIcon className="ri-file-copy-line text-sm"></AppIcon>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveModule(draft.localId)}
                      disabled={removing}
                    className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 disabled:cursor-wait"
                    aria-label={`Remove ${title}`}
                    title={`Remove ${title}`}
                  >
                      <AppIcon className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></AppIcon>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text={freeMode ? 'No free modules yet. Add the first custom module.' : 'No modules in this group yet. Add the first module to start scheduling.'} />
          )}
        </div>

        <div className="bg-background-100/50 p-4">
          <TutorConflictWarning conflicts={tutorConflicts} onResolve={onResolveTutorConflict} />
          {activeModule ? (
            <ModulePlanningPanel
              key={activeModule.localId}
              freeMode={freeMode}
              draft={activeModule}
              index={activeModuleIndex}
              moduleOptions={moduleOptions}
              tutors={tutors}
              groupDay={groupForm.deliveryDay}
              groupTime={groupForm.startTime}
              groupEndTime={groupForm.endTime}
              cohortStartDate={activeCohort.startDate}
              cohortEndDate={activeCohort.endDate}
              tutorConflict={firstTutorConflictForModule(tutorConflicts, activeModule.localId)}
              onRefreshStaffProfiles={onRefreshStaffProfiles}
              canRemove={!removingDraftId}
              onRemove={() => onRemoveModule(activeModule.localId)}
              onChange={patch => onChangeModule(activeModule.localId, patch)}
              onSelectExisting={catalogueId => onSelectExistingModule(activeModule, catalogueId)}
              onPersistTeamsMeeting={onPersistTeamsMeeting}
            />
          ) : (
            <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-background-300 bg-background-50">
              <div className="max-w-sm px-6 py-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <AppIcon className="ri-stack-line text-xl"></AppIcon>
                </span>
                <p className="mt-3 text-sm font-heading font-bold text-foreground-950">Choose or add a module</p>
                <p className="mt-1 text-[12px] leading-5 text-foreground-500">The module form appears here after a module is selected.</p>
                <button type="button" onClick={onAddModule} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-[11px] font-bold text-white hover:bg-primary-700">
                  <AppIcon className="ri-add-line"></AppIcon>
                  Add Module
                </button>
              </div>
            </div>
          )}
        </div>
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
    <section className="rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50/70 via-background-50 to-background-50 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-heading font-bold text-foreground-950">{title}</p>
          <p className="mt-1 text-[11px] leading-5 text-foreground-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-background-50 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          title={open ? 'Collapse section' : 'Expand section'}
        >
          <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></AppIcon>
        </button>
      </div>
      {open && <div className="mt-3 space-y-2">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2.5 rounded-xl border border-white/80 bg-white/80 px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${row.tone}`}>
              <AppIcon className={`${row.icon} text-sm`}></AppIcon>
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
  context,
  count,
  items,
  activeId,
  onSelect,
  onAdd,
  addLabel,
  onClone,
  onRemove,
  removingId,
  emptyText = 'Nothing here yet.',
}: {
  label: string;
  context?: string;
  count: number;
  items: Array<{ id: string; label: string; meta: string; color?: string }>;
  activeId: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  onClone?: (id: string) => void;
  onRemove?: (id: string) => void | Promise<void>;
  removingId?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-2xl border border-background-200 bg-background-50 p-3 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[10px] font-bold uppercase text-foreground-400">{label}</p>
            <span className="shrink-0 rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-600">
              {count}
            </span>
          </div>
          {context && <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground-500">{context}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onAdd && (
            <button type="button" onClick={onAdd} className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-background-100 px-2.5 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-primary-50 hover:text-primary-700">
              <AppIcon className="ri-add-line"></AppIcon>
              {addLabel || 'Add'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            title={open ? 'Collapse section' : 'Expand section'}
          >
            <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></AppIcon>
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
                  <span
                    className="inline-flex max-w-full rounded-md px-2 py-0.5 text-[12px] font-black ring-1"
                    style={{
                      backgroundColor: item.color ? `${item.color}14` : undefined,
                      color: item.color || undefined,
                      ['--tw-ring-color' as string]: item.color ? `${item.color}33` : undefined,
                    }}
                  >
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-500">{item.meta}</span>
                </button>
                {onClone && (
                  <button
                    type="button"
                    onClick={() => onClone(item.id)}
                    disabled={removing}
                    className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-primary-50 hover:text-primary-700 disabled:cursor-wait"
                    aria-label={`Clone ${item.label}`}
                    title={`Clone ${item.label}`}
                  >
                    <AppIcon className="ri-file-copy-line text-sm"></AppIcon>
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    disabled={removing}
                    className="flex w-8 shrink-0 items-center justify-center border-l border-background-200 text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 disabled:cursor-wait"
                    aria-label={`Remove ${item.label}`}
                    title={`Remove ${item.label}`}
                  >
                    <AppIcon className={`${removing ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} text-sm`}></AppIcon>
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

function attachTeamsMeetingToWeeks(draft: ModuleDraft, meeting: TeamsMeetingDraft, details: string) {
  const settings = teamsComponentSettings(meeting);
  return draft.weeks.map((week, weekIndex) => {
    const existingLiveSessions = week.components.filter(component => component.type === 'live-session');
    if (existingLiveSessions.length) {
      return {
        ...week,
        components: week.components.map(component => component.type === 'live-session'
          ? { ...component, settings: { ...(component.settings || {}), ...settings } }
          : component),
      };
    }
    const component = createEmptyComponent(week.id, 'live-session', week.components.length + 1);
    return {
      ...week,
      components: [...week.components, {
        ...component,
        title: `${draft.name || 'Live session'} - Session ${week.sessionNumber || weekIndex + 1}`,
        description: details || draft.notes || 'Microsoft Teams live session',
        expectedOtjh: Math.max(0.25, meeting.durationMinutes / 60),
        settings: { ...(component.settings || {}), ...settings },
      }],
    };
  });
}

function teamsScheduleInputFromDraft(draft: ModuleDraft, moduleTitle: string, groupTime: string, groupEndTime: string) {
  const meeting = draft.teamsMeeting;
  if (!meeting) return null;
  const durationMinutes = Math.max(30, Math.round(groupSessionDurationHours({ startTime: groupTime, endTime: groupEndTime }) * 60) || meeting.durationMinutes || 60);
  const scheduledOccurrences = draft.weeks.map((week, index) => {
    const localDateTime = `${week.date || draft.startDate || todayIso()}T${week.startTime || groupTime || '09:30'}`;
    return {
      sessionNumber: week.sessionNumber || index + 1,
      startDateTimeUtc: new Date(localDateTime).toISOString(),
      durationMinutes,
    };
  });
  const first = scheduledOccurrences[0];
  if (!first) return null;
  return {
    title: moduleTitle || draft.name || 'Live session',
    organizerEmail: meeting.organizerEmail,
    eventId: meeting.eventId,
    localStartDateTime: `${draft.weeks[0]?.date || draft.startDate || todayIso()}T${draft.weeks[0]?.startTime || groupTime || '09:30'}`,
    startDateTimeUtc: first.startDateTimeUtc,
    durationMinutes,
    repeat: scheduledOccurrences.length > 1 ? 'weekly' as const : 'none' as const,
    repeatOccurrences: scheduledOccurrences.length,
    scheduledOccurrences,
  };
}

function ModulePlanningPanel({
  freeMode = false,
  draft,
  index,
  moduleOptions,
  tutors,
  groupDay,
  groupTime,
  groupEndTime,
  cohortStartDate,
  cohortEndDate,
  tutorConflict,
  onRefreshStaffProfiles,
  canRemove,
  onRemove,
  onChange,
  onSelectExisting,
  onPersistTeamsMeeting,
}: {
  freeMode?: boolean;
  draft: ModuleDraft;
  index: number;
  moduleOptions: CurriculumModule[];
  tutors: StaffOption[];
  groupDay: string;
  groupTime: string;
  groupEndTime: string;
  cohortStartDate?: string;
  cohortEndDate?: string;
  tutorConflict?: TutorScheduleConflict;
  onRefreshStaffProfiles: () => void;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<ModuleDraft>) => void;
  onSelectExisting: (catalogueId: string) => void;
  onPersistTeamsMeeting?: (draft: ModuleDraft, meeting: TeamsMeetingDraft, details: string) => Promise<Partial<ModuleDraft> | void>;
}) {
  const [startDateTouched, setStartDateTouched] = useState(false);
  const [teamsMeetingOpen, setTeamsMeetingOpen] = useState(false);
  const [teamsSyncing, setTeamsSyncing] = useState(false);
  const [teamsSyncMessage, setTeamsSyncMessage] = useState('');
  const [teamsPersisting, setTeamsPersisting] = useState(false);
  const [teamsPersistMessage, setTeamsPersistMessage] = useState('');
  const [teamsScheduleSyncing, setTeamsScheduleSyncing] = useState(false);
  const [teamsSessionsLoading, setTeamsSessionsLoading] = useState(false);
  const [teamsSessionsOpen, setTeamsSessionsOpen] = useState(false);
  const [teamsSessionsError, setTeamsSessionsError] = useState('');
  const [teamsSessions, setTeamsSessions] = useState<TeamsMeetingOccurrence[]>([]);
  const selectedModule = draft.mode === 'existing' ? findModuleOption(moduleOptions, draft.catalogueId) : undefined;
  const selectedModuleId = selectedModule ? moduleOptionId(selectedModule) : draft.catalogueId;
  const moduleTitle = draft.name || selectedModule?.name || `Module ${index + 1}`;
  const plannedSessionCount = moduleDraftSessionCount(draft, selectedModule);
  const componentCount = moduleDraftDisplayComponentCount(draft, freeMode);
  const startDateError = draft.startDate && cohortStartDate && compareDateInputs(draft.startDate, cohortStartDate) < 0
    ? `Module cannot start before cohort start (${cohortStartDate}).`
    : draft.startDate && cohortEndDate && compareDateInputs(draft.startDate, cohortEndDate) > 0
    ? `Module cannot start after cohort end (${cohortEndDate}).`
    : '';
  const visibleModeOptions = freeMode ? moduleModeOptions.filter(option => option.key === 'new') : moduleModeOptions;

  return (
    <div className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm" style={{ borderLeftColor: draft.color, borderLeftWidth: 4 }}>
      <div className="flex flex-col gap-3 border-b border-background-200/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: `linear-gradient(90deg, ${draft.color}14 0%, #ffffff 68%)` }}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: draft.color }}>
            <AppIcon className="ri-book-open-line"></AppIcon>
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-heading font-bold text-foreground-950">{moduleTitle}</p>
              <span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold" style={{ color: draft.color }}>Module {index + 1}</span>
            </div>
            <p className="text-[11px] text-foreground-500">
              {freeMode
                ? `${componentCount} components - certificate after completion`
                : draft.mode === 'existing'
                ? selectedModule
                  ? `${formatSessionCount(plannedSessionCount)} from linked content scheduled on ${groupDay} at ${groupTime}`
                  : 'Choose an existing module to link content'
                : `${formatSessionCount(plannedSessionCount)} generated on ${groupDay} at ${groupTime}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          <button type="button" onClick={onRemove} disabled={!canRemove} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40 transition-smooth">
            <AppIcon className="ri-delete-bin-line mr-1"></AppIcon>
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {!freeMode && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleModeOptions.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                const patch = moduleModeSwitchPatch(draft, option.key);
                if (Object.keys(patch).length) onChange(patch);
                if (option.key === 'existing' && draft.mode !== 'existing' && draft.existingCatalogueId) {
                  onSelectExisting(draft.existingCatalogueId);
                }
              }}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-smooth ${draft.mode === option.key ? 'border-primary-300 bg-primary-50 text-primary-800 shadow-sm ring-2 ring-primary-100' : 'border-background-200 bg-background-50 text-foreground-600 hover:border-primary-200 hover:bg-background-100'}`}
            >
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${draft.mode === option.key ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-500'}`}>
                <AppIcon className={`${option.icon} text-base`}></AppIcon>
              </span>
              <span>
                <span className="block text-[13px] font-heading font-bold">{option.label}</span>
                <span className="mt-0.5 block text-[11px] font-semibold opacity-75">{option.description}</span>
              </span>
            </button>
          ))}
        </div>}

        {!freeMode && draft.mode === 'existing' ? (
          <label className="block">
            <span className="text-[10px] font-bold uppercase text-foreground-400">Existing module *</span>
            <select value={selectedModuleId} onChange={event => onSelectExisting(event.target.value)} className="mt-1 w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-[13px] font-semibold text-foreground-900 outline-none focus:border-primary-300">
              <option value="">Select a reusable module...</option>
              {moduleOptions.map(module => (
                <option key={moduleOptionId(module)} value={moduleOptionId(module)}>
                  {freeMode ? module.name : `${module.name} - ${formatSessionCount(moduleSessionCount(module))}`}
                </option>
              ))}
            </select>
            {selectedModule ? (
              <p className="mt-2 text-[11px] text-foreground-500">
                {freeMode
                  ? `Loaded from Module Builder/catalogue: ${selectedModule.name}. Components are read-only here.`
                  : `Loaded from Module Builder/catalogue: ${selectedModule.name} - ${formatSessionCount(plannedSessionCount)}. Weeks and components are read-only here.`}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-foreground-500">
                {freeMode ? 'Choose a module managed in Module Builder.' : 'Choose a module managed in Module Builder. This wizard will link it to the selected group and schedule its sessions.'}
              </p>
            )}
          </label>
        ) : (
          <div className="space-y-2">
            <Field label="New module name" value={draft.name} onChange={value => onChange({ name: value, newName: value })} required placeholder="Example: Contract Administration Fundamentals" />
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800">
              {freeMode ? 'This creates a custom free module shell. Add or refine components from Module Builder after saving.' : 'This creates the module shell for this programme. Add or refine weeks and components from Module Builder after saving.'}
            </p>
          </div>
        )}

        {freeMode ? (
          <div className="rounded-xl border border-background-200 bg-background-50/80 p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[7.75rem] shrink-0">
                <ColorField label="Colour" value={draft.color} onChange={value => onChange({ color: value })} compact />
              </div>
              <div className="min-w-[12rem] flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                Learners complete the module components at their own pace and receive the certificate after all components are complete.
              </div>
            </div>
          </div>
        ) : (
        <div>
          <div className="rounded-xl border border-background-200 bg-background-50/80 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase text-foreground-400">Scheduling</p>
              <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">
                {formatSessionCount(plannedSessionCount)}
              </span>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[7.75rem_minmax(10.75rem,1fr)_minmax(10.75rem,1fr)] 2xl:grid-cols-[7.75rem_minmax(10.75rem,1fr)_7rem_minmax(10.75rem,1fr)_minmax(11rem,1fr)] lg:items-end">
              <div className="min-w-0">
                <ColorField label="Colour" value={draft.color} onChange={value => onChange({ color: value })} compact />
              </div>
              <Field
                label="Start date"
                type="date"
                value={draft.startDate}
                onChange={value => {
                  setStartDateTouched(true);
                  onChange({ startDate: value });
                }}
                required
                min={cohortStartDate}
                max={cohortEndDate}
                error={startDateTouched ? startDateError : ''}
              />
              {draft.mode === 'new' ? (
                <Field label="Sessions" type="number" value={draft.sessionsNumber} onChange={value => onChange({ sessionsNumber: value, newSessionsNumber: value })} required />
              ) : (
                <div className="hidden 2xl:block" />
              )}
              <Field label="End date" type="date" value={draft.endDate} onChange={value => onChange({ endDate: value })} />
              <StaffSelect label="Tutor" value={draft.tutor} onChange={value => onChange({ tutor: value })} options={tutors} onOpen={onRefreshStaffProfiles} />
            </div>
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
                  <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-foreground-900">Microsoft Teams live sessions</p>
                  {draft.teamsMeeting ? (
                    <>
                      <a href={draft.teamsMeeting.joinUrl || draft.teamsMeeting.webLink} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[11px] font-bold text-primary-700 hover:text-primary-800">
                        Meeting created - open join link
                      </a>
                      <p className="mt-0.5 truncate text-[10px] font-semibold text-foreground-500">
                        {draft.teamsMeeting.organizerEmail} · {draft.teamsMeeting.repeat === 'none' ? 'One meeting' : `${draft.teamsMeeting.repeatOccurrences} recurring sessions`}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold text-emerald-700">
                        {draft.teamsMeeting.trackedOccurrences || draft.teamsMeeting.repeatOccurrences} lecture records ready for attendance, transcript and recording sync
                      </p>
                    </>
                  ) : (
                    <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">Create the Teams link and invitations for this module’s generated sessions.</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {draft.teamsMeeting ? (
                  <button
                    type="button"
                    disabled={teamsSyncing}
                    onClick={async () => {
                      setTeamsSyncing(true);
                      setTeamsSyncMessage('');
                      try {
                        const result = await syncTeamsMeetingArtifacts(draft.teamsMeeting!.liveSessionId);
                        setTeamsSyncMessage(
                          `Synced ${result.synced.attendanceRecords} attendance rows, ${result.synced.transcripts} transcripts and ${result.synced.recordings} recordings.`
                        );
                      } catch (err) {
                        setTeamsSyncMessage(err instanceof Error ? err.message : 'Unable to sync Teams results.');
                      } finally {
                        setTeamsSyncing(false);
                      }
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-50 disabled:opacity-50"
                  >
                    <AppIcon className={`${teamsSyncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}`}></AppIcon>
                    {teamsSyncing ? 'Syncing...' : 'Sync results'}
                  </button>
                ) : null}
                {draft.teamsMeeting ? (
                  <button
                    type="button"
                    disabled={teamsScheduleSyncing}
                    onClick={async () => {
                      const input = teamsScheduleInputFromDraft(draft, moduleTitle, groupTime, groupEndTime);
                      if (!input) {
                        setTeamsSyncMessage('No Teams meeting schedule is available for this module.');
                        return;
                      }
                      setTeamsScheduleSyncing(true);
                      setTeamsSyncMessage('');
                      try {
                        const result = await updateTeamsMeetingSchedule(draft.teamsMeeting!.liveSessionId, input);
                        const updatedMeeting: TeamsMeetingDraft = {
                          ...draft.teamsMeeting!,
                          ...result.meeting,
                          liveSessionId: draft.teamsMeeting!.liveSessionId,
                          joinUrl: result.meeting.joinUrl || draft.teamsMeeting!.joinUrl,
                        };
                        onChange({
                          teamsMeeting: updatedMeeting,
                          weeks: attachTeamsMeetingToWeeks(draft, updatedMeeting, draft.notes),
                        });
                        if (teamsSessionsOpen) {
                          const refreshed = await loadTeamsMeetingArtifacts(draft.teamsMeeting!.liveSessionId);
                          setTeamsSessions(refreshed.occurrences);
                          setTeamsSessionsError('');
                        }
                        setTeamsSyncMessage(`Teams schedule updated for ${result.meeting.trackedOccurrences || input.repeatOccurrences} actual sessions.`);
                      } catch (err) {
                        setTeamsSyncMessage(err instanceof Error ? err.message : 'Unable to update Teams schedule.');
                      } finally {
                        setTeamsScheduleSyncing(false);
                      }
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-50 disabled:opacity-50"
                  >
                    <AppIcon className={`${teamsScheduleSyncing ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'}`}></AppIcon>
                    {teamsScheduleSyncing ? 'Updating...' : 'Sync schedule'}
                  </button>
                ) : null}
                {draft.teamsMeeting ? (
                  <button
                    type="button"
                    disabled={teamsSessionsLoading}
                    onClick={async () => {
                      setTeamsSessionsLoading(true);
                      setTeamsSessionsError('');
                      try {
                        const result = await loadTeamsMeetingArtifacts(draft.teamsMeeting!.liveSessionId);
                        setTeamsSessions(result.occurrences);
                        setTeamsSessionsOpen(true);
                      } catch (err) {
                        setTeamsSessionsError(err instanceof Error ? err.message : 'The Teams sessions could not be loaded.');
                        setTeamsSessionsOpen(true);
                      } finally {
                        setTeamsSessionsLoading(false);
                      }
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-50 disabled:opacity-50"
                  >
                    <AppIcon className={`${teamsSessionsLoading ? 'ri-loader-4-line animate-spin' : 'ri-list-check-2'}`}></AppIcon>
                    Actual sessions
                  </button>
                ) : null}
                <button
                  type="button"
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    setTeamsMeetingOpen(true);
                  }}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-calendar-event-line"></AppIcon>
                  {draft.teamsMeeting ? 'Edit / create another' : 'Teams meeting options'}
                </button>
              </div>
            </div>
            {teamsSyncMessage ? <p className="mt-2 text-[10px] font-semibold text-foreground-600">{teamsSyncMessage}</p> : null}
            {teamsPersistMessage ? <p className={`mt-2 text-[10px] font-semibold ${teamsPersistMessage.startsWith('Saved') ? 'text-emerald-700' : 'text-amber-700'}`}>{teamsPersistMessage}</p> : null}
            {teamsSessionsOpen ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-primary-100 bg-background-50 shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-background-200 bg-primary-50/60 px-3 py-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Actual Teams sessions</p>
                    <p className="text-[10px] font-semibold text-foreground-500">{teamsSessions.length ? `${teamsSessions.length} tracked sessions` : 'No tracked sessions loaded'}</p>
                  </div>
                  <button type="button" onClick={() => setTeamsSessionsOpen(false)} className="grid h-7 w-7 place-items-center rounded-lg text-foreground-500 hover:bg-background-100" aria-label="Close actual sessions">
                    <AppIcon className="ri-close-line"></AppIcon>
                  </button>
                </div>
                {teamsSessionsError ? (
                  <p className="px-3 py-3 text-[11px] font-semibold text-red-700">{teamsSessionsError}</p>
                ) : teamsSessions.length ? (
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-background-100 text-[9px] uppercase text-foreground-400">
                        <tr>
                          <th className="px-3 py-2 font-bold">Session</th>
                          <th className="px-3 py-2 font-bold">Scheduled</th>
                          <th className="px-3 py-2 font-bold">Actual</th>
                          <th className="px-3 py-2 font-bold">Attendance</th>
                          <th className="px-3 py-2 font-bold">Artifacts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-background-200">
                        {teamsSessions.map(occurrence => (
                          <tr key={occurrence.id}>
                            <td className="px-3 py-2 font-bold text-foreground-900">Session {occurrence.session_number}</td>
                            <td className="px-3 py-2 font-semibold text-foreground-600">{occurrence.scheduled_start ? new Date(occurrence.scheduled_start).toLocaleString('en-GB') : '-'}</td>
                            <td className="px-3 py-2 font-semibold text-foreground-600">{occurrence.actual_start ? new Date(occurrence.actual_start).toLocaleString('en-GB') : 'Not attended yet'}</td>
                            <td className="px-3 py-2 font-semibold text-foreground-600">{occurrence.participant_count || occurrence.attendance?.length || 0}</td>
                            <td className="px-3 py-2 font-semibold text-foreground-600">{occurrence.artifacts?.length || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-3 py-3 text-[11px] font-semibold text-foreground-500">No Teams sessions are tracked yet.</p>
                )}
              </div>
            ) : null}
            {tutorConflict ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
                <div className="flex items-start gap-2">
                  <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm"></AppIcon>
                  <div>
                    <p className="font-bold">Tutor scheduling conflict</p>
                    <p className="mt-0.5 leading-5">{tutorConflict.message}</p>
                    <p className="mt-1 text-[11px] font-bold">Choose a different tutor before continuing.</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        )}
        <TextArea label="Notes" value={userFacingNotes(draft.notes)} onChange={value => onChange({ notes: userFacingNotes(value) })} rows={2} />
        {!freeMode && <SessionPreview draft={draft} />}
        {teamsMeetingOpen && (
          <WizardTeamsMeetingModal
            draft={draft}
            moduleTitle={moduleTitle}
            groupTime={groupTime}
            groupEndTime={groupEndTime}
            tutorEmail={String(findStaffOption(tutors, draft.tutor)?.email || '')}
            onClose={() => setTeamsMeetingOpen(false)}
            persistLabel={teamsPersisting ? 'Saving Teams link to module...' : ''}
            onCreated={async (meeting, details) => {
              setTeamsPersistMessage('');
              onChange({
                teamsMeeting: meeting,
                weeks: attachTeamsMeetingToWeeks(draft, meeting, details),
              });
              if (!onPersistTeamsMeeting) {
                setTeamsPersistMessage('Teams link is attached to this draft. Press Update to save it.');
                await showCurriculumAlert({
                  title: 'Teams link attached',
                  text: 'Press Update to save the Teams link and live-session components to this module.',
                  icon: 'info',
                  confirmButtonText: 'OK',
                });
                return;
              }
              setTeamsPersisting(true);
              showCurriculumLoading({
                title: 'Saving Teams live sessions',
                text: 'The Teams link and live-session components are being saved to this module.',
              });
              try {
                const persistedPatch = await onPersistTeamsMeeting(draft, meeting, details);
                if (persistedPatch) {
                  onChange(persistedPatch);
                }
                setTeamsPersistMessage('Saved Teams link and live-session components to this module.');
                closeCurriculumLoading();
                await showCurriculumAlert({
                  title: 'Teams sessions saved',
                  text: 'The Teams link and live-session components are now saved to the module.',
                  icon: 'success',
                  timer: 1800,
                  confirmButtonText: 'Done',
                });
              } catch (err) {
                const detail = err instanceof Error ? err.message : 'Teams link created, but module save failed. Press Update to retry.';
                closeCurriculumLoading();
                setTeamsPersistMessage(`Teams link created, but module save failed: ${detail}`);
                await showCurriculumAlert({
                  title: 'Module save failed',
                  text: detail,
                  icon: 'error',
                  confirmButtonText: 'Close',
                });
              } finally {
                setTeamsPersisting(false);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function WizardTeamsMeetingModal({
  draft,
  moduleTitle,
  groupTime,
  groupEndTime,
  tutorEmail,
  persistLabel,
  onClose,
  onCreated,
}: {
  draft: ModuleDraft;
  moduleTitle: string;
  groupTime: string;
  groupEndTime: string;
  tutorEmail: string;
  persistLabel?: string;
  onClose: () => void;
  onCreated: (meeting: TeamsMeetingDraft, details: string) => void | Promise<void>;
}) {
  const existing = draft.teamsMeeting;
  const plannedWeeks = draft.weeks;
  const sessionCount = Math.max(1, plannedWeeks.length || Number(draft.sessionsNumber) || 1);
  const firstSessionDate = plannedWeeks[0]?.date || draft.startDate || todayIso();
  const defaultDuration = Math.max(30, Math.round(groupSessionDurationHours({ startTime: groupTime, endTime: groupEndTime }) * 60) || 60);
  const [title, setTitle] = useState(moduleTitle || 'Live session');
  const [organizerEmail, setOrganizerEmail] = useState(existing?.organizerEmail || tutorEmail);
  const [presenters, setPresenters] = useState(normaliseTeamsEmailList(existing?.presenters).join('\n'));
  const [attendees, setAttendees] = useState(normaliseTeamsEmailList(existing?.attendees).join('\n'));
  const startDateTime = `${firstSessionDate}T${groupTime || '09:30'}`;
  const durationMinutes = defaultDuration;
  const repeat: TeamsMeetingInput['repeat'] = sessionCount > 1 ? 'weekly' : 'none';
  const repeatOccurrences = sessionCount;
  const [lobbyBypass, setLobbyBypass] = useState(existing?.lobbyBypass || 'invited');
  const [recording, setRecording] = useState(existing?.recording || 'record-transcribe');
  const [spokenLanguage, setSpokenLanguage] = useState(existing?.spokenLanguage || 'en-GB');
  const [meetingType, setMeetingType] = useState(existing?.meetingType || 'live-session');
  const [details, setDetails] = useState(draft.notes || '');
  const [requestResponses, setRequestResponses] = useState(existing?.requestResponses ?? true);
  const [allowNewTimeProposals, setAllowNewTimeProposals] = useState(existing?.allowNewTimeProposals ?? true);
  const [hideAttendees, setHideAttendees] = useState(existing?.hideAttendees ?? false);
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [graphConfigured, setGraphConfigured] = useState(true);
  const [timeZone, setTimeZone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<TeamsMeetingResult | null>(null);

  useEffect(() => {
    let active = true;
    loadTeamsMeetingConfiguration()
      .then(configuration => {
        if (!active) return;
        setGraphConfigured(configuration.configured);
        setTimeZone(configuration.timeZone);
        setOrganizerEmail(current => current || configuration.defaultOrganizer || '');
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to check Microsoft Teams configuration.');
      })
      .finally(() => {
        if (active) setConfigurationLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    setError('');
    if (!title.trim()) return setError('Meeting title is required.');
    if (!organizerEmail.trim()) return setError('Enter the Microsoft 365 organizer email.');
    const start = new Date(startDateTime);
    if (Number.isNaN(start.getTime())) return setError('Choose a valid meeting start date and time.');
    const scheduledWeeks = plannedWeeks.length ? plannedWeeks : [{ sessionNumber: 1, date: firstSessionDate, startTime: groupTime || '09:30' }];
    const scheduledOccurrences = scheduledWeeks.map((week, index) => {
      const scheduledStart = new Date(`${week.date || firstSessionDate}T${week.startTime || groupTime || '09:30'}`);
      return {
        sessionNumber: week.sessionNumber || index + 1,
        startDateTimeUtc: scheduledStart.toISOString(),
        durationMinutes: defaultDuration,
      };
    });
    const authoritativeStart = scheduledOccurrences[0]?.startDateTimeUtc || start.toISOString();
    const input: TeamsMeetingInput = {
      title: title.trim(),
      organizerEmail: organizerEmail.trim(),
      attendees: attendees.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean),
      presenters: presenters.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean),
      localStartDateTime: `${scheduledWeeks[0]?.date || firstSessionDate}T${scheduledWeeks[0]?.startTime || groupTime || '09:30'}`,
      startDateTimeUtc: authoritativeStart,
      durationMinutes: defaultDuration,
      repeat: scheduledOccurrences.length > 1 ? 'weekly' : 'none',
      repeatOccurrences: scheduledOccurrences.length,
      lobbyBypass,
      recording,
      spokenLanguage,
      meetingType,
      details,
      requestResponses,
      allowNewTimeProposals,
      hideAttendees,
      transactionId: `TEAMS-${draft.localId}-${Date.now()}`,
      moduleDraftId: draft.localId,
      moduleCatalogueId: draft.catalogueId,
      moduleTitle,
      scheduledOccurrences,
    };
    setSubmitting(true);
    try {
      const result = await createTeamsMeeting(input);
      const meeting: TeamsMeetingDraft = {
        ...result.meeting,
        liveSessionId: result.meeting.liveSessionId,
        joinUrl: result.meeting.joinUrl,
        lobbyBypass,
        recording,
        spokenLanguage,
        meetingType,
        requestResponses,
        allowNewTimeProposals,
        hideAttendees,
      };
      setCreated(result);
      await onCreated(meeting, details);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microsoft Teams could not create the meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10150] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-5">
      <div role="dialog" aria-modal="true" aria-labelledby="wizard-teams-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-4 bg-primary-950 px-5 py-4 text-white">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-cyan-300"><AppIcon className="ri-microsoft-teams-line text-xl"></AppIcon></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Module scheduling</p>
              <h3 id="wizard-teams-title" className="mt-0.5 text-base font-heading font-bold text-white">Microsoft Teams meeting options</h3>
              <p className="mt-1 text-[11px] font-medium text-white/65">{moduleTitle} · {sessionCount} planned session{sessionCount === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50" aria-label="Close"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background-100/45 p-4 sm:p-5">
          {created ? (
            <div className="mx-auto max-w-2xl space-y-4 py-5 text-center">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600"><AppIcon className="ri-check-line text-3xl"></AppIcon></span>
                <h4 className="mt-3 text-base font-heading font-bold text-emerald-900">Teams meeting created for this module</h4>
                <p className="mt-1 text-[12px] font-semibold text-emerald-700">The link and live-session components are now included in the module draft.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {(created.meeting.joinUrl || created.meeting.webLink) && <a href={created.meeting.joinUrl || created.meeting.webLink} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[11px] font-bold text-white hover:bg-primary-700"><AppIcon className="ri-external-link-line"></AppIcon>Open meeting</a>}
                  {created.meeting.meetingOptionsUrl && <a href={created.meeting.meetingOptionsUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-4 text-[11px] font-bold text-emerald-800"><AppIcon className="ri-settings-3-line"></AppIcon>Meeting options</a>}
                </div>
              </div>
              {!!created.warnings?.length && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">{created.warnings.map(warning => <p key={warning} className="text-[11px] font-semibold text-amber-800"><AppIcon className="ri-information-line mr-1"></AppIcon>{warning}</p>)}</div>}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
              <section className="space-y-4 rounded-2xl border border-background-200 bg-background-50 p-4">
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Meeting details</p><p className="mt-1 text-[11px] font-semibold text-foreground-500">Create the link and calendar invitations for this module.</p></div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Linked to module scheduling</p>
                  <p className="mt-1 text-[11px] font-semibold text-emerald-900">
                    Module range {draft.startDate || 'N/A'} to {draft.endDate || 'N/A'} · meeting starts {firstSessionDate} at {groupTime} · {sessionCount} session{sessionCount === 1 ? '' : 's'}
                  </p>
                </div>
                <Field label="Title" value={title} onChange={setTitle} required />
                <Field label="Organizer Microsoft 365 email" value={organizerEmail} onChange={setOrganizerEmail} required placeholder="tutor@organisation.com" />
                <div>
                  <TextArea label="Presenters" value={presenters} onChange={setPresenters} rows={2} />
                  <p className="mt-1 text-[10px] font-semibold text-foreground-400">Microsoft 365 email or UPN, one per line. Presenters are also invited automatically.</p>
                </div>
                <div>
                  <TextArea label="Attendees" value={attendees} onChange={setAttendees} rows={4} />
                  <p className="mt-1 text-[10px] font-semibold text-foreground-400">One email per line, comma, or semicolon.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Start · scheduling *</span><input type="datetime-local" value={startDateTime} readOnly className="mt-1 h-10 w-full cursor-not-allowed rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-semibold text-foreground-900" /></label>
                  <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Duration · group schedule</span><select value={durationMinutes} disabled className="mt-1 h-10 w-full cursor-not-allowed rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-semibold text-foreground-900">{[30, 45, 60, 90, 120, 180].map(value => <option key={value} value={value}>{value < 60 ? `${value} minutes` : `${value / 60} hour${value === 60 ? '' : 's'}`}</option>)}</select></label>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Repeat · module plan</span><select value={repeat} disabled className="mt-1 h-10 w-full cursor-not-allowed rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-semibold text-foreground-900"><option value="none">Does not repeat</option><option value="weekly">Weekly</option></select></label>
                  <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Number of sessions · scheduling</span><input value={String(repeatOccurrences)} readOnly className="mt-1 h-10 w-full cursor-not-allowed rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-semibold text-foreground-900" /></label>
                </div>
                <TextArea label="Details" value={details} onChange={setDetails} rows={4} />
              </section>

              <section className="space-y-4 rounded-2xl border border-primary-100 bg-primary-50/40 p-4">
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Advanced options</p><p className="mt-1 text-[11px] font-semibold text-foreground-500">Microsoft 365 policy can override some options.</p></div>
                <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Who can bypass the lobby?</span><select value={lobbyBypass} onChange={event => setLobbyBypass(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-900"><option value="invited">People invited to this meeting</option><option value="organization">People in my organization</option><option value="organization-excluding-guests">Organization, excluding guests</option><option value="everyone">Everyone</option><option value="organizer">Only organizers</option></select></label>
                <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Recording</span><select value={recording} onChange={event => setRecording(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-900"><option value="none">Do not start automatically</option><option value="record">Record automatically</option><option value="record-transcribe">Record and transcribe</option></select></label>
                <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Spoken language</span><select value={spokenLanguage} onChange={event => setSpokenLanguage(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-900"><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option><option value="ar-EG">Arabic (Egypt)</option><option value="fr-FR">French</option></select></label>
                <label className="block"><span className="text-[10px] font-bold uppercase text-foreground-400">Type</span><select value={meetingType} onChange={event => setMeetingType(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-900"><option value="live-session">Teams meeting / live session</option><option value="teams-meeting">Teams meeting</option></select></label>
                <div className="space-y-2 rounded-xl border border-dashed border-primary-200 bg-background-50/80 p-3">
                  <FreeCheckbox label="Request responses" checked={requestResponses} onChange={setRequestResponses} />
                  <FreeCheckbox label="Allow time proposals" checked={allowNewTimeProposals} onChange={setAllowNewTimeProposals} />
                  <FreeCheckbox label="Hide attendee list" checked={hideAttendees} onChange={setHideAttendees} />
                </div>
                {timeZone && <p className="text-[10px] font-semibold text-foreground-400"><AppIcon className="ri-time-line mr-1"></AppIcon>Calendar time zone: {timeZone}</p>}
              </section>
            </div>
          )}

          {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] font-semibold text-red-700"><AppIcon className="ri-error-warning-line mr-1"></AppIcon>{error}</p>}
          {!configurationLoading && !graphConfigured && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold text-amber-800">Microsoft Graph credentials are missing from the backend environment.</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-background-200 bg-background-50 px-5 py-4">
          <p className="text-[10px] font-semibold text-foreground-400">{persistLabel || 'The meeting is attached to this module draft after creation.'}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="h-9 rounded-lg border border-background-200 bg-background-50 px-4 text-[11px] font-bold text-foreground-700 hover:bg-background-100 disabled:opacity-50">{created ? 'Done' : 'Cancel'}</button>
            {!created && <button type="button" onClick={submit} disabled={submitting || configurationLoading || !graphConfigured} className="inline-flex h-9 min-w-[180px] items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[11px] font-bold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"><AppIcon className={submitting ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'}></AppIcon>{submitting ? 'Creating meeting...' : 'Create with these options'}</button>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
              <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-base`}></AppIcon>
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

function ModuleBuilderContentPreview({
  freeMode = false,
  draft,
  actualComponentsLoading = false,
  moduleBuilderMissing = false,
  moduleBuilderLoadFailed = false,
  moduleBuilderEmpty = false,
  moduleOptions,
  programmeId,
  programmeName,
  ksbSourceId,
  ksbSourceLabel,
  cohort,
  group,
  onAddFreeComponent,
  onUpdateFreeComponent,
  onRemoveFreeComponent,
  onReorderFreeComponent,
  onOpenModuleBuilder,
}: {
  freeMode?: boolean;
  draft: ModuleDraft;
  actualComponentsLoading?: boolean;
  moduleBuilderMissing?: boolean;
  moduleBuilderLoadFailed?: boolean;
  moduleBuilderEmpty?: boolean;
  moduleOptions: CurriculumModule[];
  programmeId: string;
  programmeName: string;
  ksbSourceId?: string;
  ksbSourceLabel?: string;
  cohort: CohortDraft;
  group: GroupDraft;
  onAddFreeComponent?: (moduleId: string, type: ModuleComponentType) => void;
  onUpdateFreeComponent?: (moduleId: string, componentId: string, patch: Partial<ModuleComponent>) => void;
  onRemoveFreeComponent?: (moduleId: string, componentId: string) => void;
  onReorderFreeComponent?: (moduleId: string, sourceComponentId: string, targetComponentId: string) => void;
  onOpenModuleBuilder?: (url: string) => void;
}) {
  const [moduleOpen, setModuleOpen] = useState(false);
  const [expandedWeekIds, setExpandedWeekIds] = useState<Set<string>>(() => new Set());
  const [expandedComponentIds, setExpandedComponentIds] = useState<Set<string>>(() => new Set());
  const [draggingComponentId, setDraggingComponentId] = useState('');
  const [orderUpdated, setOrderUpdated] = useState(false);
  const [newComponentType, setNewComponentType] = useState<ModuleComponentType>('video');
  const knownComponentIdsRef = useRef<Set<string>>(new Set());
  const title = draft.name || 'Untitled module';
  const displayWeeks = useMemo(() => draft.weeks.map(week => ({
    ...week,
    components: freeMode ? week.components : week.components.filter(component => isDisplayableModuleBuilderComponent(component, week.title)),
  })), [draft.weeks, freeMode]);
  const displayComponentCount = displayWeeks.reduce((total, week) => total + week.components.length, 0);
  const waitingForActualComponents = !freeMode && actualComponentsLoading && !moduleBuilderEmpty;
  const componentCount = waitingForActualComponents ? 0 : displayComponentCount;
  // Tracks how long the current load has been running so a slow request reads as
  // "still working" rather than an indefinite spinner with no feedback.
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  useEffect(() => {
    if (!waitingForActualComponents) {
      setWaitingSeconds(0);
      return;
    }
    setWaitingSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setWaitingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waitingForActualComponents]);
  const components = useMemo(() => draft.weeks.flatMap(week => week.components), [draft.weeks]);
  const componentIdSignature = components.map(component => component.id).join('|');
  const moduleBuilderUrl = moduleBuilderUrlForDraft(draft, moduleOptions, programmeName, programmeId, cohort, group, ksbSourceId, ksbSourceLabel);

  useEffect(() => {
    setModuleOpen(false);
    setExpandedWeekIds(new Set());
    setOrderUpdated(false);
    knownComponentIdsRef.current = new Set();
  }, [draft.localId]);

  useEffect(() => {
    if (waitingForActualComponents || freeMode || !componentCount) return;
    const weeksWithComponents = displayWeeks.filter(week => week.components.length).map(week => week.id);
    if (!weeksWithComponents.length) return;
    setModuleOpen(true);
    setExpandedWeekIds(previous => {
      const next = new Set(previous);
      weeksWithComponents.forEach(id => next.add(id));
      if (next.size === previous.size && Array.from(next).every(id => previous.has(id))) return previous;
      return next;
    });
  }, [componentCount, componentIdSignature, displayWeeks, freeMode, waitingForActualComponents]);

  useEffect(() => {
    if (!freeMode) return;
    const previousKnown = knownComponentIdsRef.current;
    const currentIds = new Set(components.map(component => component.id));
    setExpandedComponentIds(previous => {
      const next = new Set(previous);
      components.forEach(component => {
        if (!previousKnown.has(component.id)) next.add(component.id);
      });
      Array.from(next).forEach(id => {
        if (!currentIds.has(id)) next.delete(id);
      });
      if (next.size === previous.size && Array.from(next).every(id => previous.has(id))) return previous;
      return next;
    });
    knownComponentIdsRef.current = currentIds;
  }, [componentIdSignature, components, freeMode]);

  useEffect(() => {
    if (!freeMode || freeProgrammeComponentTypes.some(type => type.type === newComponentType)) return;
    setNewComponentType(freeProgrammeComponentTypes[0]?.type || 'video');
  }, [freeMode, newComponentType]);

  const toggleWeek = (weekId: string) => {
    setExpandedWeekIds(previous => {
      const next = new Set(previous);
      next.has(weekId) ? next.delete(weekId) : next.add(weekId);
      return next;
    });
  };

  const openModuleBuilder = () => {
    if (!moduleBuilderUrl) return;
    onOpenModuleBuilder?.(moduleBuilderUrl);
  };

  const toggleComponent = (componentId: string) => {
    setExpandedComponentIds(previous => {
      const next = new Set(previous);
      next.has(componentId) ? next.delete(componentId) : next.add(componentId);
      return next;
    });
  };

  const confirmRemoveFreeComponent = async (component: ModuleComponent) => {
    await showCurriculumConfirm({
      title: 'Delete component?',
      text: `${component.title || 'This component'} will be removed from this free module.`,
      icon: 'warning',
      confirmButtonText: 'Delete component',
      cancelButtonText: 'Keep component',
      onConfirm: async () => {
        onRemoveFreeComponent?.(draft.localId, component.id);
      },
    });
  };

  const handleComponentDragStart = (event: DragEvent<HTMLDivElement>, componentId: string) => {
    event.stopPropagation();
    setDraggingComponentId(componentId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', componentId);
  };

  const handleComponentDrop = (event: DragEvent<HTMLDivElement>, targetComponentId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceComponentId = event.dataTransfer.getData('text/plain') || draggingComponentId;
    setDraggingComponentId('');
    if (!sourceComponentId || sourceComponentId === targetComponentId) return;
    onReorderFreeComponent?.(draft.localId, sourceComponentId, targetComponentId);
    setOrderUpdated(true);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50">
      <div className={`${moduleOpen ? 'border-b' : ''} flex flex-col gap-2 border-background-200/70 bg-background-100/50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between`}>
        <button
          type="button"
          onClick={() => setModuleOpen(open => !open)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={moduleOpen}
        >
          <p className="text-sm font-heading font-bold text-foreground-950">{title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-foreground-500">
            <span className={waitingForActualComponents ? 'font-semibold text-sky-800' : ''}>
              {waitingForActualComponents
                ? 'Loading actual module-builder components...'
                : freeMode
                ? `${componentCount} components - certificate after completion`
                : moduleBuilderMissing
                ? `${draft.weeks.length} scheduled weeks - module not found in Module Builder`
                : moduleBuilderLoadFailed
                ? `${draft.weeks.length} scheduled weeks - could not load Module Builder components`
                : displayComponentCount === 0
                ? `${draft.weeks.length} scheduled weeks - no components added yet`
                : `${draft.weeks.length} scheduled weeks - ${componentCount} module-builder components`}
            </span>
            {waitingForActualComponents ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-200">
                <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
                Loading
              </span>
            ) : moduleBuilderMissing ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                Not in Module Builder
              </span>
            ) : moduleBuilderLoadFailed ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                Load failed
              </span>
            ) : null}
            {freeMode && orderUpdated ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                Order updated
              </span>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {freeMode ? (
            <>
              <select
                value={newComponentType}
                onChange={event => setNewComponentType(event.target.value as ModuleComponentType)}
                className="h-8 rounded-lg border border-background-200 bg-background-50 px-2 text-[11px] font-bold text-foreground-700 outline-none focus:border-primary-300"
                aria-label="Component type"
              >
                {freeProgrammeComponentTypes.map(type => <option key={type.type} value={type.type}>{type.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => onAddFreeComponent?.(draft.localId, newComponentType)}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700"
              >
                <AppIcon className="ri-add-line"></AppIcon>
                Add Component
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={openModuleBuilder}
                disabled={!moduleBuilderUrl}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-background-200 disabled:text-foreground-400 disabled:shadow-none"
              >
                <AppIcon className="ri-external-link-line"></AppIcon>
                Open Module Builder
              </button>
              <span className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">Read-only</span>
            </>
          )}
          <button
            type="button"
            onClick={() => setModuleOpen(open => !open)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background-50 text-foreground-500 shadow-sm ring-1 ring-background-200 transition-smooth hover:bg-primary-50 hover:text-primary-700"
            aria-label={moduleOpen ? `Collapse ${title}` : `Expand ${title}`}
            title={moduleOpen ? 'Collapse module' : 'Expand module'}
          >
            <AppIcon className={`ri-arrow-down-s-line text-lg transition-transform ${moduleOpen ? 'rotate-180' : ''}`}></AppIcon>
          </button>
        </div>
      </div>
      {!freeMode && !waitingForActualComponents && !moduleOpen && (moduleBuilderMissing || moduleBuilderLoadFailed) ? (
        <div className="flex items-start gap-3 border-t border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
          <AppIcon className="ri-error-warning-line mt-0.5 text-base"></AppIcon>
          <span>
            {moduleBuilderMissing
              ? 'This module does not exist in Module Builder yet. Create or configure it in Module Builder before its components can be shown here.'
              : 'Unable to load the actual Module Builder components. Try refreshing this step before editing components.'}
          </span>
        </div>
      ) : null}
      {moduleOpen && (
        waitingForActualComponents ? (
          <div className="bg-background-100/40 p-4">
            <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] font-semibold text-sky-800">
              <AppIcon className="ri-loader-4-line animate-spin text-base"></AppIcon>
              <span>
                Loading actual components from Module Builder
                {waitingSeconds >= 3 ? ` - still working (${waitingSeconds}s)` : '...'}
                {waitingSeconds >= 10 ? ' - this is slower than usual, it will stop automatically if it cannot finish.' : ''}
              </span>
            </div>
          </div>
        ) : freeMode ? (
          <div className="space-y-3 bg-background-100/40 p-4">
            {components.length ? (
              components.map(component => (
                <EditableFreeComponentCard
                  key={component.id}
                  component={component}
                  expanded={expandedComponentIds.has(component.id)}
                  dragging={draggingComponentId === component.id}
                  onToggle={() => toggleComponent(component.id)}
                  onChange={patch => onUpdateFreeComponent?.(draft.localId, component.id, patch)}
                  onRemove={() => { void confirmRemoveFreeComponent(component); }}
                  onDragStart={event => handleComponentDragStart(event, component.id)}
                  onDragEnd={() => setDraggingComponentId('')}
                  onDragOver={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={event => handleComponentDrop(event, component.id)}
                />
              ))
            ) : (
              <EmptyState text="No components yet. Choose a component type, then add it to this module." />
            )}
          </div>
        ) : (
        <div className="divide-y divide-background-200/70">
          {moduleBuilderLoadFailed ? (
            <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
              <AppIcon className="ri-error-warning-line mt-0.5 text-base"></AppIcon>
              <span>Unable to load the actual Module Builder components. Try refreshing this step before editing components.</span>
            </div>
          ) : moduleBuilderMissing ? (
            <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
              <AppIcon className="ri-error-warning-line mt-0.5 text-base"></AppIcon>
              <span>This module does not exist in Module Builder yet. Open Module Builder to create or configure it, or choose another linked module.</span>
            </div>
          ) : null}
          {displayWeeks.map(week => {
            const hasComponents = week.components.length > 0;
            const open = hasComponents && expandedWeekIds.has(week.id);
            return (
              <div key={week.id}>
                <button
                  type="button"
                  onClick={() => hasComponents && toggleWeek(week.id)}
                  disabled={!hasComponents}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-smooth hover:bg-background-100/60 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span>
                    <span className="block text-[13px] font-bold text-foreground-900">{week.title}</span>
                    <span className="mt-0.5 block text-[11px] text-foreground-500">{week.day} {week.date} at {week.startTime}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${hasComponents ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}>
                      {week.components.length} components
                    </span>
                    <AppIcon className={`ri-arrow-down-s-line text-lg transition-transform ${hasComponents ? 'text-foreground-400' : 'text-foreground-300'} ${open ? 'rotate-180' : ''}`}></AppIcon>
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
          {!displayWeeks.length ? (
            <EmptyState text="No module-builder weeks are defined for this module yet. Add them in Module Builder." />
          ) : displayComponentCount === 0 && !moduleBuilderMissing && !moduleBuilderLoadFailed ? (
            <EmptyState text="No components have been added to this module yet. Create them in Module Builder." />
          ) : null}
        </div>
        )
      )}
    </div>
  );
}

function EditableFreeComponentCard({
  component,
  expanded,
  dragging,
  onToggle,
  onChange,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  component: ModuleComponent;
  expanded: boolean;
  dragging: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ModuleComponent>) => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const typeMeta = componentTypes.find(item => item.type === component.type);
  const updateSetting = (key: string, value: string | number | boolean | string[]) => {
    onChange({ settings: { ...(component.settings || {}), [key]: value } });
  };
  return (
    <div
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`rounded-xl border bg-background-50 p-3 shadow-sm transition-smooth ${dragging ? 'border-primary-300 opacity-60 ring-2 ring-primary-100' : 'border-background-200 hover:border-primary-200'}`}
    >
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${expanded ? 'mb-3' : ''}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span
            draggable
            onDragStart={onDragStart}
            className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-400 active:cursor-grabbing"
            title="Drag to reorder"
          >
            <AppIcon className="ri-draggable text-base"></AppIcon>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <AppIcon className={typeMeta?.icon || 'ri-shapes-line'}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-foreground-900">{component.title || typeMeta?.label || 'Component'}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">{typeMeta?.label || component.type}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 transition-smooth hover:bg-primary-50 hover:text-primary-700"
            aria-label={expanded ? `Collapse ${component.title || 'component'}` : `Expand ${component.title || 'component'}`}
            title={expanded ? 'Collapse component' : 'Expand component'}
          >
            <AppIcon className={`ri-arrow-down-s-line text-lg transition-transform ${expanded ? 'rotate-180' : ''}`}></AppIcon>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition-smooth hover:bg-red-100"
            aria-label={`Remove ${component.title || 'component'}`}
            title="Remove component"
          >
            <AppIcon className="ri-delete-bin-line"></AppIcon>
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_7rem_7rem]">
            <Field
              label="Component title"
              value={component.title}
              onChange={value => onChange({ title: value })}
              placeholder={typeMeta?.label || 'Component title'}
            />
            <Field
              label="OTJH"
              type="number"
              value={String(component.expectedOtjh ?? 0)}
              onChange={value => onChange({ expectedOtjh: Number(value) || 0 })}
            />
            <Field
              label="Points"
              type="number"
              value={String(component.points ?? 0)}
              onChange={value => onChange({ points: Number(value) || 0 })}
            />
          </div>
          <div className="mt-3">
            <TextArea
              label="Description"
              value={component.description || ''}
              onChange={value => onChange({ description: value })}
              rows={2}
            />
          </div>
          <FreeComponentLmsDetails component={component} onSettingChange={updateSetting} />
        </>
      )}
    </div>
  );
}

function FreeComponentLmsDetails({
  component,
  onSettingChange,
}: {
  component: ModuleComponent;
  onSettingChange: (key: string, value: string | number | boolean | string[]) => void;
}) {
  const settings = component.settings || {};
  const getString = (key: string, fallback = '') => String(settings[key] ?? fallback);
  const getNumber = (key: string, fallback = 0) => Number(settings[key] ?? fallback);
  const getBool = (key: string, fallback = false) => Boolean(settings[key] ?? fallback);
  const videoSourceTypes = ['HTML (MP4)', 'YouTube', 'Vimeo', 'External Link', 'Embed', 'Shortcode'];
  const normaliseVideoSource = (value: string) => {
    const clean = String(value || '').trim();
    if (videoSourceTypes.includes(clean)) return clean;
    if (clean === 'Upload file') return 'HTML (MP4)';
    if (clean === 'External link') return 'External Link';
    return 'YouTube';
  };
  const videoSourceType = normaliseVideoSource(getString('sourceType') || getString('provider'));
  const updateVideoSourceType = (value: string) => {
    onSettingChange('sourceType', value);
    onSettingChange('provider', value === 'HTML (MP4)' ? 'Upload file' : value === 'External Link' ? 'External link' : value);
  };

  return (
    <section className="mt-3 rounded-xl border border-background-200 bg-background-100/60 p-3">
      <div className="flex items-center justify-between gap-3 text-[12px] font-bold text-foreground-800">
        <span className="inline-flex items-center gap-2">
          <AppIcon className="ri-settings-3-line text-primary-600"></AppIcon>
          LMS details
        </span>
      </div>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SelectNative
            label="Content status"
            value={getString('contentStatus', 'Draft')}
            onChange={value => onSettingChange('contentStatus', value)}
            options={['Draft', 'Ready for QA', 'Approved', 'Needs changes']}
          />
          <Field
            label="Version"
            value={getString('version', '0.1')}
            onChange={value => onSettingChange('version', value)}
          />
          <Field
            label="Release timing"
            value={getString('releaseTiming', 'Available immediately')}
            onChange={value => onSettingChange('releaseTiming', value)}
          />
        </div>
        <TextArea
          label="Completion rule"
          value={getString('completionRule', 'Mark complete')}
          onChange={value => onSettingChange('completionRule', value)}
          rows={2}
        />
        <TextArea
          label="Reflection prompt"
          value={getString('reflectionPrompt', 'What did you learn and how will you apply it?')}
          onChange={value => onSettingChange('reflectionPrompt', value)}
          rows={2}
        />

        {component.type === 'video' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectNative label="Source type" value={videoSourceType} onChange={updateVideoSourceType} options={videoSourceTypes} />
            {videoSourceType === 'Embed' ? (
              <TextArea label="Embed iframe content" value={getString('embedCode')} onChange={value => onSettingChange('embedCode', value)} rows={3} />
            ) : videoSourceType === 'Shortcode' ? (
              <TextArea label="Shortcode" value={getString('shortcode')} onChange={value => onSettingChange('shortcode', value)} rows={2} />
            ) : (
              <Field label={videoSourceType === 'HTML (MP4)' ? 'MP4 file URL' : 'Video URL'} value={getString('videoUrl')} onChange={value => onSettingChange('videoUrl', value)} />
            )}
            <Field label="Duration minutes" type="number" value={String(getNumber('durationMinutes', 10))} onChange={value => onSettingChange('durationMinutes', Number(value) || 0)} />
            <FreeCheckbox label="Lesson preview" checked={getBool('lessonPreview')} onChange={value => onSettingChange('lessonPreview', value)} />
            <FreeCheckbox label="Captions available" checked={getBool('captionsAvailable')} onChange={value => onSettingChange('captionsAvailable', value)} />
            <TextArea label="Short description" value={getString('shortDescription') || getString('learningBrief')} onChange={value => { onSettingChange('shortDescription', value); onSettingChange('learningBrief', value); }} rows={2} />
            <TextArea label="Lesson content" value={getString('lessonContent')} onChange={value => onSettingChange('lessonContent', value)} rows={3} />
            <TextArea label="Lesson materials" value={getString('lessonMaterialLinks')} onChange={value => onSettingChange('lessonMaterialLinks', value)} rows={2} />
            <TextArea label="Material instructions" value={getString('lessonMaterialsNotes')} onChange={value => onSettingChange('lessonMaterialsNotes', value)} rows={2} />
            <TextArea label="Markers and questions" value={getString('markersAndQuestions')} onChange={value => onSettingChange('markersAndQuestions', value)} rows={2} />
            <TextArea label="Q&A" value={getString('qAndA')} onChange={value => onSettingChange('qAndA', value)} rows={2} />
            <TextArea label="Post-watch task" value={getString('postWatchTask')} onChange={value => onSettingChange('postWatchTask', value)} rows={2} />
          </div>
        )}

        {component.type === 'podcast' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectNative label="Podcast source" value={getString('podcastSource', 'External URL')} onChange={value => onSettingChange('podcastSource', value)} options={['External URL', 'Upload', 'LMS resource']} />
            <Field label="Podcast URL" value={getString('podcastUrl')} onChange={value => onSettingChange('podcastUrl', value)} />
            <Field label="Duration minutes" type="number" value={String(getNumber('durationMinutes', 20))} onChange={value => onSettingChange('durationMinutes', Number(value) || 0)} />
            <TextArea label="Listening focus" value={getString('listeningFocus')} onChange={value => onSettingChange('listeningFocus', value)} rows={2} />
          </div>
        )}

        {component.type === 'reading' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectNative label="Requirement" value={getString('requirement', 'Required')} onChange={value => onSettingChange('requirement', value)} options={['Required', 'Recommended', 'Stretch']} />
            <SelectNative label="Difficulty" value={getString('difficulty', 'Standard')} onChange={value => onSettingChange('difficulty', value)} options={['Introductory', 'Standard', 'Advanced']} />
            <Field label="Resource URL" value={getString('resourceUrl')} onChange={value => onSettingChange('resourceUrl', value)} />
            <Field label="Estimated reading minutes" type="number" value={String(getNumber('estimatedReadingTime', 20))} onChange={value => onSettingChange('estimatedReadingTime', Number(value) || 0)} />
            <TextArea label="Learner instruction" value={getString('learnerInstruction')} onChange={value => onSettingChange('learnerInstruction', value)} rows={2} />
            <TextArea label="Learning outcomes" value={getString('mainLearningOutcomes')} onChange={value => onSettingChange('mainLearningOutcomes', value)} rows={2} />
          </div>
        )}

        {component.type === 'powerpoint' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="File name or URL" value={getString('fileName') || getString('resourceUrl')} onChange={value => onSettingChange('fileName', value)} />
            <Field label="Slide range" value={getString('slideRange')} onChange={value => onSettingChange('slideRange', value)} />
            <TextArea label="Speaker notes" value={getString('speakerNotes')} onChange={value => onSettingChange('speakerNotes', value)} rows={2} />
            <FreeCheckbox label="Download allowed" checked={getBool('downloadAllowed', true)} onChange={value => onSettingChange('downloadAllowed', value)} />
          </div>
        )}

        {component.type === 'quiz' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Questions" type="number" value={String(getNumber('numberOfQuestions', 10))} onChange={value => onSettingChange('numberOfQuestions', Number(value) || 0)} />
            <Field label="Pass mark %" type="number" value={String(getNumber('passMarkPercentage', 70))} onChange={value => onSettingChange('passMarkPercentage', Number(value) || 0)} />
            <Field label="Attempts" type="number" value={String(getNumber('attemptsAllowed', 2))} onChange={value => onSettingChange('attemptsAllowed', Number(value) || 0)} />
            <TextArea label="Completion feedback" value={getString('completionFeedback')} onChange={value => onSettingChange('completionFeedback', value)} rows={2} />
          </div>
        )}

        {component.type === 'assignment' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextArea label="Assignment brief" value={getString('assignmentBrief')} onChange={value => onSettingChange('assignmentBrief', value)} rows={2} />
            <TextArea label="Submission instructions" value={getString('submissionInstructions')} onChange={value => onSettingChange('submissionInstructions', value)} rows={2} />
            <Field label="Due timing" value={getString('dueTiming', 'End of module')} onChange={value => onSettingChange('dueTiming', value)} />
            <TextArea label="Marking rubric" value={getString('markingRubric')} onChange={value => onSettingChange('markingRubric', value)} rows={2} />
          </div>
        )}

      </div>
    </section>
  );
}

function FreeCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="mt-5 inline-flex items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[12px] font-semibold text-foreground-700">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-4 w-4 rounded border-background-300 text-primary-600 focus:ring-primary-300" />
      {label}
    </label>
  );
}

function ReadOnlyComponentCard({ component }: { component: ModuleComponent }) {
  const typeMeta = componentTypes.find(item => item.type === component.type);
  const description = userFacingComponentDescription(component);
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <AppIcon className={typeMeta?.icon || 'ri-shapes-line'}></AppIcon>
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
          {description ? <p className="mt-2 text-[12px] leading-5 text-foreground-600">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

function TutorConflictWarning({
  conflicts,
  onResolve,
}: {
  conflicts: TutorScheduleConflict[];
  onResolve: (conflict: TutorScheduleConflict) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!conflicts.length) return null;
  const visibleConflicts = showAll ? conflicts : conflicts.slice(0, 3);
  const remaining = conflicts.length - visibleConflicts.length;
  const tutorProfileCreateUrl = '/curriculum/staff-profiles?role=tutor&create=1';

  return (
    <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <AppIcon className="ri-calendar-close-line text-lg"></AppIcon>
          </span>
          <div>
            <p className="text-sm font-heading font-bold text-red-900">Tutor scheduling conflict</p>
            <p className="mt-1 text-[12px] font-semibold leading-5 text-red-700">
              The same tutor cannot be assigned to two sessions that overlap on the same day.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-full bg-white px-3 text-[11px] font-bold text-red-700 shadow-sm">
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}
          </span>
          <a
            href={tutorProfileCreateUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-[11px] font-bold text-red-700 transition-smooth hover:border-red-300 hover:bg-red-100"
          >
            <AppIcon className="ri-user-add-line"></AppIcon>
            Create tutor profile
          </a>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {visibleConflicts.map(conflict => (
          <div key={conflict.id} className="rounded-xl border border-red-200 bg-white/85 px-3 py-2">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-red-900">{conflict.tutor}</p>
                <p className="mt-0.5 text-[12px] font-semibold leading-5 text-red-700">{conflict.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onResolve(conflict)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-red-700"
              >
                <AppIcon className="ri-arrow-left-line"></AppIcon>
                Assign different tutor
              </button>
              <a
                href={tutorProfileCreateUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-[11px] font-bold text-red-700 transition-smooth hover:border-red-300 hover:bg-red-100"
              >
                <AppIcon className="ri-user-add-line"></AppIcon>
                New tutor
              </a>
            </div>
          </div>
        ))}
      </div>
      {conflicts.length > 3 ? (
        <button
          type="button"
          onClick={() => setShowAll(value => !value)}
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-red-700 underline decoration-red-400 decoration-2 underline-offset-4 transition-smooth hover:text-red-900"
        >
          <AppIcon className={showAll ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></AppIcon>
          {showAll ? 'Show fewer conflict details' : `Show all ${conflicts.length} conflict details`}
        </button>
      ) : null}
    </section>
  );
}

function ReviewSummary({
  isEditing = false,
  freeMode = false,
  programme,
  cohortForm,
  groupForm,
  moduleDrafts,
  moduleOptions,
  tutorOptions,
  coachOptions,
  selectedHolidays,
  cohortHolidayExtensionDays,
  cohortDrafts,
  holidays,
}: {
  isEditing?: boolean;
  freeMode?: boolean;
  programme: CurriculumProgramme;
  cohortForm: { name: string; startDate: string; durationMonths: string; endDate: string; color: string; holidayIds: string[] };
  groupForm: { name: string; deliveryDay: string; startTime: string; endTime: string; color: string; coach?: string };
  moduleDrafts: ModuleDraft[];
  moduleOptions: CurriculumModule[];
  tutorOptions: StaffOption[];
  coachOptions: StaffOption[];
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
      coach: groupForm.coach || '',
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
  const componentCount = configuredModules.reduce((total, draft) => total + moduleDraftDisplayComponentCount(draft, freeMode), 0);
  const skippedCount = configuredModules.reduce((total, draft) => total + draft.skippedHolidaySessions.length, 0);
  const programmeColor = programme?.color || '#5b21b6';
  const totalHours = programmeActualComponentHours(configuredCohorts, freeMode);
  const programmeKsbs = programmeKsbMappings(configuredCohorts, freeMode);
  const averageGroupHours = groupCount ? totalHours / groupCount : 0;
  const averageModuleHours = moduleCount ? totalHours / moduleCount : 0;
  const coachCount = countUniqueStaffAssignments(configuredGroups.map(group => group.coach), coachOptions);
  const tutorCount = countUniqueStaffAssignments(configuredModules.map(module => module.tutor), tutorOptions);
  const assignedGroupCount = configuredGroups.filter(group => Boolean(staffIdentityKey(group.coach, coachOptions))).length;
  const assignedModuleCount = configuredModules.filter(module => Boolean(staffIdentityKey(module.tutor, tutorOptions))).length;
  const unassignedGroups = configuredGroups.filter(group => !staffIdentityKey(group.coach, coachOptions)).length;
  const unassignedModules = configuredModules.filter(module => !staffIdentityKey(module.tutor, tutorOptions)).length;
  const deliveryDayCount = new Set(configuredGroups.flatMap(group => group.deliveryDays).filter(Boolean)).size;
  const readinessWarnings = [
    unassignedGroups ? `${unassignedGroups} group${unassignedGroups === 1 ? '' : 's'} need coach cover` : '',
    unassignedModules ? `${unassignedModules} module${unassignedModules === 1 ? '' : 's'} need tutor cover` : '',
    skippedCount ? `${skippedCount} session${skippedCount === 1 ? '' : 's'} shifted by holidays` : '',
  ].filter(Boolean);
  const readinessLabel = readinessWarnings.length ? 'Review warnings' : 'Ready to save';
  const readinessTone = readinessWarnings.length ? 'warning' : 'success';
  const readyBadgeLabel = isEditing ? 'Ready to update' : 'Ready to create';

  if (freeMode) {
    return (
      <div className="space-y-5">
        <ReviewReadinessPanel
          tone={readinessTone}
          title={readinessLabel}
          summary={`${moduleCount} module${moduleCount === 1 ? '' : 's'} - ${componentCount} component${componentCount === 1 ? '' : 's'} - ${formatHoursValue(totalHours)} OTJH`}
          warnings={readinessWarnings}
        />
        <section className="overflow-hidden rounded-2xl border bg-background-50 shadow-sm" style={{ borderColor: hexToRgba(programmeColor, 0.22) }}>
          <div className="border-b px-4 py-4 sm:px-5" style={{ ...reviewTintStyle(programmeColor, 0.09, 0.2), borderBottomColor: hexToRgba(programmeColor, 0.18) }}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm" style={{ backgroundColor: programmeColor }}>
                  <AppIcon className="ri-book-2-line text-xl"></AppIcon>
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-700">Free modules</p>
                    <ReviewBadge tone="success">{readyBadgeLabel}</ReviewBadge>
                  </div>
                  <h3 className="mt-1 truncate text-xl font-heading font-bold text-foreground-950">{programme?.name || 'Untitled programme'}</h3>
                  <p className="mt-1 text-[12px] font-semibold text-foreground-600">{programme?.level || 'Level not set'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:w-[27rem]">
                <ReviewStat label="Programme OTJH" value={formatHoursValue(totalHours)} />
                <ReviewStat label="Modules" value={String(moduleCount)} />
                <ReviewStat label="Components" value={String(componentCount)} />
                <ReviewStat label="KSBs mapped" value={String(programmeKsbs.length)} />
                <ReviewStat label="Avg/module" value={formatHoursValue(averageModuleHours)} />
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <ReviewInsightGrid
              items={[
                { icon: 'ri-time-line', label: 'Programme OTJH', value: formatHoursValue(totalHours), detail: 'From component OTJH across all modules', tone: 'emerald' },
                { icon: 'ri-stack-line', label: 'Module average', value: formatHoursValue(averageModuleHours), detail: `${componentCount} components total`, tone: 'primary' },
                { icon: 'ri-checkbox-circle-line', label: 'Completion model', value: 'Certificate', detail: 'Issued after all components are complete', tone: 'amber' },
              ]}
            />
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-heading font-bold text-foreground-950">Structure preview</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-foreground-500">
                  <span>Programme</span>
                  <AppIcon className="ri-arrow-right-s-line text-foreground-400"></AppIcon>
                  <span>Custom Modules</span>
                  <AppIcon className="ri-arrow-right-s-line text-foreground-400"></AppIcon>
                  <span>Components</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ReviewBadge tone="info">{formatModuleCount(moduleCount)}</ReviewBadge>
                <ReviewBadge tone="success">{componentCount} components</ReviewBadge>
                <ReviewBadge tone={programmeKsbs.length ? 'success' : 'warning'}>{programmeKsbs.length} KSBs</ReviewBadge>
                <ReviewBadge tone="success">{formatHoursValue(totalHours)} OTJH</ReviewBadge>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {configuredModules.length ? configuredModules.map((draft, moduleIndex) => {
                const draftComponentCount = moduleDraftDisplayComponentCount(draft, true);
                const moduleHours = moduleDraftActualComponentHours(draft, true);
                const moduleColor = draft.color || '#7c3aed';
                const moduleKsbs = moduleDraftKsbMappings(draft, true);
                return (
                  <div
                    key={draft.localId}
                    className="rounded-xl border p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
                    style={{ ...reviewTintStyle(moduleColor, 0.045, 0.2), borderLeftColor: moduleColor, borderLeftWidth: 4, borderTopColor: moduleColor, borderTopWidth: 3 }}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: moduleColor }} aria-hidden="true"></span>
                          <p className="truncate text-[13px] font-bold text-foreground-950">{draft.name || `Module ${moduleIndex + 1}`}</p>
                        </div>
                        <p className="mt-1 text-[11px] text-foreground-500">
                          {draftComponentCount} components - {formatHoursValue(moduleHours)} OTJH - certificate on completion
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <ReviewMiniMetric label="OTJH" value={formatHoursValue(moduleHours)} tone="success" />
                      <ReviewMiniMetric label="Components" value={String(draftComponentCount)} tone="info" />
                      <ReviewMiniMetric label="KSBs" value={moduleKsbs.length ? ksbMappingTypeSummary(moduleKsbs) : 'Needs mapping'} tone={moduleKsbs.length ? 'success' : 'warning'} />
                      <ReviewMiniMetric label="Certificate" value="On completion" tone="success" />
                    </div>
                    <ReviewKsbPreview mappings={moduleKsbs} />
                  </div>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-background-200 bg-background-100 px-3 py-4 text-[12px] font-semibold text-foreground-500">No free modules configured.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ReviewReadinessPanel
        tone={readinessTone}
        title={readinessLabel}
        summary={`${cohortCount} cohort${cohortCount === 1 ? '' : 's'} - ${groupCount} group${groupCount === 1 ? '' : 's'} - ${moduleCount} module${moduleCount === 1 ? '' : 's'} - ${componentCount} component${componentCount === 1 ? '' : 's'}`}
        warnings={readinessWarnings}
      />
      <section className="overflow-hidden rounded-2xl border bg-background-50 shadow-sm" style={{ borderColor: hexToRgba(programmeColor, 0.22) }}>
        <div className="border-b px-4 py-4 sm:px-5" style={{ ...reviewTintStyle(programmeColor, 0.09, 0.2), borderBottomColor: hexToRgba(programmeColor, 0.18) }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm" style={{ backgroundColor: programmeColor }}>
                <AppIcon className="ri-book-2-line text-xl"></AppIcon>
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-700">Programme</p>
                  <ReviewBadge tone="success">{readyBadgeLabel}</ReviewBadge>
                </div>
                <h3 className="mt-1 truncate text-xl font-heading font-bold text-foreground-950">{programme?.name || 'Untitled programme'}</h3>
                <p className="mt-1 text-[12px] font-semibold text-foreground-600">{programme?.level || 'Level not set'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:w-[36rem]">
              <ReviewStat label="Programme OTJH" value={formatHoursValue(totalHours)} />
              <ReviewStat label="Cohorts" value={String(cohortCount)} />
            <ReviewStat label="Groups" value={String(groupCount)} />
            <ReviewStat label="Modules" value={String(moduleCount)} />
            <ReviewStat label="Components" value={String(componentCount)} />
            <ReviewStat label="KSBs mapped" value={String(programmeKsbs.length)} />
            <ReviewStat label="Avg/group" value={formatHoursValue(averageGroupHours)} />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <ReviewInsightGrid
            items={[
              { icon: 'ri-time-line', label: 'Programme OTJH', value: formatHoursValue(totalHours), detail: `${formatHoursValue(averageModuleHours)} average per module from components`, tone: 'emerald' },
              { icon: 'ri-calendar-schedule-line', label: 'Delivery pattern', value: `${deliveryDayCount} day${deliveryDayCount === 1 ? '' : 's'}`, detail: `${skippedCount} skipped session${skippedCount === 1 ? '' : 's'} from holidays`, tone: skippedCount ? 'amber' : 'primary' },
              { icon: 'ri-user-star-line', label: 'Coaching cover', value: `${assignedGroupCount}/${groupCount}`, detail: unassignedGroups ? `${unassignedGroups} group${unassignedGroups === 1 ? '' : 's'} need a coach` : `${coachCount} coach${coachCount === 1 ? '' : 'es'} assigned`, tone: unassignedGroups ? 'amber' : 'emerald' },
              { icon: 'ri-user-line', label: 'Tutor cover', value: `${assignedModuleCount}/${moduleCount}`, detail: unassignedModules ? `${unassignedModules} module${unassignedModules === 1 ? '' : 's'} need a tutor` : `${tutorCount} tutor${tutorCount === 1 ? '' : 's'} assigned`, tone: unassignedModules ? 'amber' : 'emerald' },
            ]}
          />
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-heading font-bold text-foreground-950">Structure preview</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-foreground-500">
                <span>Programme</span>
                <AppIcon className="ri-arrow-right-s-line text-foreground-400"></AppIcon>
                <span>Cohorts</span>
                <AppIcon className="ri-arrow-right-s-line text-foreground-400"></AppIcon>
                <span>Groups</span>
                <AppIcon className="ri-arrow-right-s-line text-foreground-400"></AppIcon>
                <span>Modules</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ReviewBadge>{formatGroupCount(groupCount)}</ReviewBadge>
              <ReviewBadge tone="info">{formatModuleCount(moduleCount)}</ReviewBadge>
              <ReviewBadge tone={programmeKsbs.length ? 'success' : 'warning'}>{programmeKsbs.length} KSBs</ReviewBadge>
              <ReviewBadge tone="success">{formatHoursValue(totalHours)} OTJH</ReviewBadge>
              <ReviewBadge tone={skippedCount ? 'warning' : 'success'}>{skippedCount} skipped sessions</ReviewBadge>
            </div>
          </div>

          <div className="space-y-4">
            {configuredCohorts.map((cohort, cohortIndex) => {
              const cohortColor = cohort.color || '#0f766e';
              const selectedForCohort = holidays.filter(holiday => cohort.holidayIds.includes(holidayId(holiday)));
              const groups = cohort.groups.filter(isConfiguredGroup);
              const cohortHours = cohortActualComponentHours(cohort);
              const cohortKsbs = cohortKsbMappings(cohort);
              const hasExtension = cohort.localId === 'current-cohort' && cohortHolidayExtensionDays > 0;
              return (
                <div key={cohort.localId} className="relative pl-8">
                  <span className="absolute left-3 top-12 bottom-0 w-px" style={{ backgroundColor: hexToRgba(cohortColor, 0.22) }} aria-hidden="true"></span>
                  <span className="absolute left-0 top-2 flex h-7 w-7 items-center justify-center rounded-full border-4 border-background-50 text-white shadow-sm" style={{ backgroundColor: cohortColor }}>
                    <AppIcon className="ri-calendar-event-line text-sm"></AppIcon>
                  </span>
                  <div
                    className="rounded-2xl border p-3 shadow-sm"
                    style={{ ...reviewTintStyle(cohortColor, 0.065, 0.2), borderLeftColor: cohortColor, borderLeftWidth: 4 }}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-500">Cohort {cohortIndex + 1}</p>
                          <ReviewBadge>{formatGroupCount(groups.length)}</ReviewBadge>
                          <ReviewBadge tone="success">{formatHoursValue(cohortHours)} OTJH</ReviewBadge>
                          <ReviewBadge tone={cohortKsbs.length ? 'success' : 'warning'}>{cohortKsbs.length} KSBs</ReviewBadge>
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
                        const groupHours = groupActualComponentHours(group);
                        const groupKsbs = groupKsbMappings(group);
                        return (
                          <div
                            key={group.localId}
                            className="relative rounded-xl border p-3 pl-4 shadow-[0_1px_0_rgba(15,23,42,0.03)]"
                            style={{ ...reviewTintStyle(groupColor, 0.052, 0.18), borderLeftColor: groupColor, borderLeftWidth: 4 }}
                          >
                            <span className="absolute -left-[1.05rem] top-5 h-px w-4" style={{ backgroundColor: hexToRgba(groupColor, 0.38) }} aria-hidden="true"></span>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex min-w-0 gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: groupColor }}>
                                  <AppIcon className="ri-team-line"></AppIcon>
                                </span>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-[10px] font-bold uppercase text-foreground-400">Group {groupIndex + 1}</p>
                                    <ReviewBadge tone="info">{formatModuleCount(modules.length)}</ReviewBadge>
                                    <ReviewBadge tone="success">{formatHoursValue(groupHours)} OTJH</ReviewBadge>
                                    <ReviewBadge tone={groupKsbs.length ? 'success' : 'warning'}>{groupKsbs.length} KSBs</ReviewBadge>
                                  </div>
                                  <p className="mt-0.5 truncate text-sm font-bold text-foreground-950">{group.name || `Group ${groupIndex + 1}`}</p>
                                  <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">
                                    {group.deliveryDays.join(', ') || 'No delivery day'} - {group.startTime || '--:--'} to {group.endTime || '--:--'}
                                  </p>
                                  <p className="mt-0.5 text-[11px] font-semibold text-foreground-500">
                                    Coach: {staffDisplayValue(group.coach, coachOptions) || 'Unassigned'}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                              <ReviewMiniMetric label="Group OTJH" value={formatHoursValue(groupHours)} tone="success" />
                              <ReviewMiniMetric label="Modules" value={String(modules.length)} />
                              <ReviewMiniMetric label="KSBs" value={groupKsbs.length ? ksbMappingTypeSummary(groupKsbs) : 'Needs mapping'} tone={groupKsbs.length ? 'success' : 'warning'} />
                              <ReviewMiniMetric label="Coach" value={staffDisplayValue(group.coach, coachOptions) || 'Unassigned'} tone={staffIdentityKey(group.coach, coachOptions) ? 'success' : 'warning'} />
                            </div>

                            <div className="relative mt-3 grid grid-cols-1 gap-2 pl-5 lg:grid-cols-2">
                              <span className="absolute left-1 top-0 bottom-0 w-px" style={{ backgroundColor: hexToRgba(groupColor, 0.24) }} aria-hidden="true"></span>
                              {modules.length ? modules.map((draft, moduleIndex) => {
                                const draftComponentCount = moduleDraftDisplayComponentCount(draft);
                                const moduleHours = moduleDraftActualComponentHours(draft);
                                const moduleColor = draft.color || '#7c3aed';
                                const moduleKsbs = moduleDraftKsbMappings(draft);
                                return (
                                  <div
                                    key={draft.localId}
                                    className="relative rounded-xl border p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
                                    style={{ ...reviewTintStyle(moduleColor, 0.045, 0.2), borderLeftColor: moduleColor, borderLeftWidth: 4, borderTopColor: moduleColor, borderTopWidth: 3 }}
                                  >
                                    <span className="absolute -left-5 top-6 h-px w-5" style={{ backgroundColor: hexToRgba(moduleColor, 0.42) }} aria-hidden="true"></span>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: moduleColor }} aria-hidden="true"></span>
                                          <p className="truncate text-[13px] font-bold text-foreground-950">{draft.name || `Module ${moduleIndex + 1}`}</p>
                                          {draft.extensionDays > 0 ? <ReviewBadge tone="warning">extended {draft.extensionDays}d</ReviewBadge> : null}
                                        </div>
                                        <p className="mt-1 text-[11px] text-foreground-500">
                                          {draft.startDate || 'No start'} to {draft.endDate || 'No end'} - {draft.sessionsNumber || draft.weeks.length || 0} sessions - {formatHoursValue(moduleHours)} OTJH
                                        </p>
                                      </div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      <ReviewMiniMetric label="Module OTJH" value={formatHoursValue(moduleHours)} tone="success" />
                                      <ReviewMiniMetric label="KSBs" value={moduleKsbs.length ? ksbMappingTypeSummary(moduleKsbs) : 'Needs mapping'} tone={moduleKsbs.length ? 'success' : 'warning'} />
                                      <ReviewMiniMetric label="Skipped" value={String(draft.skippedHolidaySessions.length)} tone={draft.skippedHolidaySessions.length ? 'warning' : 'success'} />
                                      <ReviewMiniMetric label="Tutor" value={staffDisplayValue(draft.tutor, tutorOptions) || 'Unassigned'} tone={staffIdentityKey(draft.tutor, tutorOptions) ? 'success' : 'warning'} />
                                    </div>
                                    <ReviewKsbPreview mappings={moduleKsbs} />
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
              <AppIcon className="ri-calendar-close-line text-lg"></AppIcon>
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

function ReviewReadinessPanel({
  tone,
  title,
  summary,
  warnings,
}: {
  tone: 'success' | 'warning';
  title: string;
  summary: string;
  warnings: string[];
}) {
  const isWarning = tone === 'warning';

  return (
    <section className={`rounded-2xl border px-4 py-3 shadow-sm ${isWarning ? 'border-amber-200 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/70'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isWarning ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            <AppIcon className={`${isWarning ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} text-lg`}></AppIcon>
          </span>
          <div>
            <p className="text-sm font-heading font-bold text-foreground-950">{title}</p>
            <p className="mt-0.5 text-[12px] font-semibold text-foreground-600">{summary}</p>
          </div>
        </div>
        {warnings.length ? (
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {warnings.map(warning => (
              <span key={warning} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-[11px] font-bold text-amber-800">
                {warning}
              </span>
            ))}
          </div>
        ) : (
          <span className="rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-[11px] font-bold text-emerald-700">
            No warnings
          </span>
        )}
      </div>
    </section>
  );
}

function ReviewInsightGrid({
  items,
}: {
  items: Array<{ icon: string; label: string; value: string; detail: string; tone: 'primary' | 'emerald' | 'amber' }>;
}) {
  const toneClasses = {
    primary: 'bg-primary-50 text-primary-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className="rounded-xl border border-background-200 bg-white/80 px-3 py-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClasses[item.tone]}`}>
              <AppIcon className={`${item.icon} text-base`}></AppIcon>
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase text-foreground-400">{item.label}</p>
              <p className="mt-0.5 truncate text-sm font-heading font-bold text-foreground-950">{item.value}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-foreground-500">{item.detail}</p>
            </div>
          </div>
        </div>
      ))}
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
    success: 'border-emerald-200 bg-white text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-primary-100 bg-white text-primary-700',
    muted: 'border-background-200 bg-background-100 text-foreground-500',
  }[tone];

  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${classes}`}>{children}</span>;
}

function ReviewMiniMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'info' }) {
  const toneClass = {
    default: 'bg-background-50 text-foreground-900',
    success: 'bg-background-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    info: 'bg-background-50 text-primary-700',
  }[tone];

  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ${toneClass}`}>
      <p className="text-[9px] font-bold uppercase opacity-70">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-bold">{value}</p>
    </div>
  );
}

function ReviewKsbPreview({ mappings }: { mappings: ModuleComponent['ksbMappings'] }) {
  const visibleMappings = mappings.slice(0, 8);
  const remaining = Math.max(0, mappings.length - visibleMappings.length);

  if (!mappings.length) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
        No KSBs mapped yet. Review this module in Module Builder before saving.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-background-200 bg-white/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[9px] font-bold uppercase text-foreground-400">KSBs</span>
        {visibleMappings.map(mapping => {
          const type = ksbMappingTypeInitial(mapping);
          return (
            <span
              key={`${mapping.code}-${mapping.ksbId}-${mapping.id}`}
              title={[mapping.code, mapping.description].filter(Boolean).join(' - ')}
              className="inline-flex min-h-6 items-center gap-1 rounded-full border border-primary-100 bg-primary-50 px-2 text-[10px] font-bold text-primary-700"
            >
              {type ? <span className="text-[9px] text-primary-500">{type}</span> : null}
              {mapping.code || mapping.ksbId}
            </span>
          );
        })}
        {remaining ? <ReviewBadge tone="info">+{remaining} more</ReviewBadge> : null}
      </div>
    </div>
  );
}

function SummaryBlock({ icon, label, title, meta, color, compact = false }: { icon: string; label: string; title: string; meta: string; color?: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-background-200 bg-background-50 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: color || '#2563eb' }}>
          <AppIcon className={icon}></AppIcon>
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
          <AppIcon className={`${icon} text-base`}></AppIcon>
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
  min,
  max,
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
  min?: string;
  max?: string;
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
        min={min}
        max={max}
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
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 'any' : undefined}
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

function StaffSelect({ label, value, onChange, options, onOpen }: { label: string; value: string; onChange: (value: string) => void; options: StaffOption[]; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const selectedOption = findStaffOption(options, value);
  const filtered = options.filter(option => {
    const search = normalise(query);
    if (!search) return true;
    return [option.label, option.value, option.email, ...(option.aliases || [])].some(candidate => normalise(candidate).includes(search));
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}</span>
      <button
        type="button"
        onClick={() => {
          setOpen(current => {
            const next = !current;
            if (next) onOpen?.();
            return next;
          });
        }}
        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 text-left text-[13px] font-semibold text-foreground-900 hover:bg-background-100/60"
      >
        <AppIcon className="ri-user-line text-foreground-400"></AppIcon>
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label || value || 'Unassigned'}</span>
        <AppIcon className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
      </button>
      {open && (
        <div className="absolute left-auto right-0 z-[10030] mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-background-200 bg-background-50 p-2 shadow-2xl">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}...`} className="mb-2 w-full rounded-lg border border-background-200 px-3 py-2 text-[12px] outline-none focus:border-primary-300" />
          <div className="max-h-56 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Unassigned</button>
            {filtered.map(option => (
              <button key={option.value} type="button" onClick={() => { onChange(option.value); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-foreground-700 hover:bg-primary-50">{option.label}</button>
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
      <AppIcon className={`${icon} text-sm`}></AppIcon>
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

function LoadingState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-8 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-background-50 shadow-sm ring-1 ring-primary-100">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
      </span>
      <p className="mt-2 text-[13px] font-heading font-bold text-foreground-950">{title}</p>
      <p className="mt-1 text-[12px] font-semibold text-primary-700">{text}</p>
    </div>
  );
}

function ValidationList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">
      {items.map(item => <p key={item}>{renderValidationItem(item)}</p>)}
    </div>
  );
}

function renderValidationItem(item: string) {
  const match = item.match(/^(Cohort\s+\d+\s+\([^)]+\)),\s+(Group\s+\d+\s+\([^)]+\)):(.*)$/);
  if (!match) return item;
  return (
    <>
      <span className="inline-flex rounded-md bg-white px-2 py-0.5 font-black text-red-800 ring-1 ring-red-200">{match[1]}</span>
      <span className="mx-1 text-red-500">+</span>
      <span className="inline-flex rounded-md bg-white px-2 py-0.5 font-black text-red-800 ring-1 ring-red-200">{match[2]}</span>
      <span>:{match[3]}</span>
    </>
  );
}

function PanelTone({ icon, text, tone = 'info' }: { icon: string; text: string; tone?: 'info' | 'error' }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-semibold ${tone === 'error' ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-primary-200 bg-primary-50 text-primary-700'}`}>
      <AppIcon className={`${icon} text-sm`}></AppIcon>
      {text}
    </div>
  );
}
