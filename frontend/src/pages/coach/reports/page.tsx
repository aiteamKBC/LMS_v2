import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  DEFAULT_COACH_EMAIL,
  type CoachCalendarEvent,
  eventDisplayDate,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  parseLocalDate,
} from '../shared/calendarEvents';
import type { GeneratedReport, ReportSection } from './types';

const coachNav = roleNavMap.coach;
const EMPTY_VALUE = '--';
const CASELOAD_ENDPOINT = `/coach_api/coach/caseload?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const ATTENDANCE_ENDPOINT = `/coach_api/coach/attendance?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const REPORT_LIMIT = 50;

type ReportType =
  | 'monthly-otjh'
  | 'date-range'
  | 'module'
  | 'progress-review-period'
  | 'full-journey'
  | 'gateway-readiness';
type ExportFormat = 'pdf' | 'word' | 'excel';
type InclusionKey =
  | 'pendingTutorValidation'
  | 'rejectedHours'
  | 'learnerReflections'
  | 'evidenceLinks'
  | 'employerComments'
  | 'coachingSummaries'
  | 'progressReviewSummaries'
  | 'ksbProgression'
  | 'quizResults'
  | 'checkpointResults';

interface ReportOptions {
  learnerId: string;
  reportType: ReportType;
  fromDate: string;
  toDate: string;
  exportFormat: ExportFormat;
  inclusions: Record<InclusionKey, boolean>;
}

interface ReportTypeMeta {
  label: string;
  title: string;
  description: string;
}

interface InclusionOption {
  key: InclusionKey;
  label: string;
  live: boolean;
  sourceLabel: string;
}

interface LearnerSelectOption {
  value: string;
  label: string;
  searchText: string;
}

interface CaseloadLearner {
  id?: string;
  name?: string;
  initials?: string;
  email?: string | null;
  employer?: string | null;
  employerEmail?: string | null;
  employerPhone?: string | null;
  programme?: string | null;
  cohortName?: string | null;
  cohortId?: string | null;
  group?: string | null;
  status?: string;
  enrollmentStatus?: string;
  rawProgramStatus?: string | null;
  riskFlags?: string[];
  overallProgress?: number;
  overallProgressAvailable?: boolean;
  componentsCompleted?: number;
  componentsPlanned?: number;
  otjhCompleted?: number;
  otjhTarget?: number;
  otjhStatus?: string | null;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string | null;
  ksbProgress?: number;
  ksbProgressAvailable?: boolean;
  knowledgeCompleted?: number;
  knowledgeTarget?: number;
  skillsCompleted?: number;
  skillsTarget?: number;
  behavioursCompleted?: number;
  behavioursTarget?: number;
  nextCoaching?: string | null;
  nextReview?: string | null;
  lastContact?: string | null;
  lastAttendanceDate?: string | null;
  lastProgressReview?: string | null;
  lastReview?: string | null;
  lastCoachingSession?: string | null;
  lastSubmittedEvidence?: string | null;
  recentFlag?: string | null;
  progressVariance?: string | null;
  startDate?: string | null;
  plannedEndDate?: string | null;
  gatewayReviewDate?: string | null;
  coachName?: string | null;
  coachEmail?: string | null;
  coachRag?: string | null;
}

interface CaseloadResponse {
  owner?: { name?: string; email?: string };
  learners?: CaseloadLearner[];
}

interface AttendanceLearner {
  id?: string;
  learner?: string;
  email?: string | null;
  attendance?: number | null;
  sessions?: number | null;
  present?: number | null;
  absent?: number | null;
  late?: number | null;
  catchup?: number | null;
  risk?: 'red' | 'amber' | 'green' | null;
  lastSession?: string | null;
  hasAttendance?: boolean;
}

interface AttendanceResponse {
  owner?: { name?: string; email?: string };
  learners?: AttendanceLearner[];
}

interface LiveReportSnapshot {
  ownerName: string;
  caseloadLearners: CaseloadLearner[];
  attendanceLearners: AttendanceLearner[];
  timetableEvents: CoachCalendarEvent[];
  warnings: string[];
}

const REPORT_TYPE_META: Record<ReportType, ReportTypeMeta> = {
  'monthly-otjh': {
    label: 'Monthly OTJH report',
    title: 'OTJH evidence report',
    description: 'Monthly off-the-job snapshot covering logged hours, compliance position, KSB movement and review activity.',
  },
  'date-range': {
    label: 'Date range report',
    title: 'OTJH date range report',
    description: 'Date-filtered OTJH preview covering live learner hours, coaching markers and review milestones.',
  },
  module: {
    label: 'Module report',
    title: 'OTJH module report',
    description: 'Module-oriented OTJH report using the learner summary data currently available in the caseload source.',
  },
  'progress-review-period': {
    label: 'Progress review period report',
    title: 'OTJH progress review period report',
    description: 'Preview OTJH evidence around the selected review period using live coaching and progress review records.',
  },
  'full-journey': {
    label: 'Full learner journey report',
    title: 'OTJH learner journey report',
    description: 'Long-form OTJH report showing the learner snapshot, progress markers and current source availability.',
  },
  'gateway-readiness': {
    label: 'Gateway readiness OTJH report',
    title: 'OTJH gateway readiness report',
    description: 'Gateway-focused OTJH preview highlighting readiness dates, compliance position and missing source fields.',
  },
};

const EXPORT_FORMAT_META: Record<ExportFormat, { label: string; icon: string }> = {
  pdf: { label: 'PDF', icon: 'ri-file-pdf-line' },
  word: { label: 'Word', icon: 'ri-file-word-line' },
  excel: { label: 'Excel', icon: 'ri-file-excel-line' },
};

const INCLUSION_OPTIONS: InclusionOption[] = [
  { key: 'pendingTutorValidation', label: 'Include pending tutor validation', live: false, sourceLabel: 'Tutor validation feed' },
  { key: 'rejectedHours', label: 'Include rejected hours', live: false, sourceLabel: 'Rejected OTJH entries' },
  { key: 'learnerReflections', label: 'Include learner reflections', live: false, sourceLabel: 'Reflection submissions' },
  { key: 'evidenceLinks', label: 'Include evidence links', live: false, sourceLabel: 'Evidence portfolio links' },
  { key: 'employerComments', label: 'Include employer comments', live: false, sourceLabel: 'Employer feedback stream' },
  { key: 'coachingSummaries', label: 'Include coaching meeting summaries', live: true, sourceLabel: 'Coach timetable events' },
  { key: 'progressReviewSummaries', label: 'Include progress review summaries', live: true, sourceLabel: 'Progress review timetable events' },
  { key: 'ksbProgression', label: 'Include KSB progression', live: true, sourceLabel: 'Caseload KSB fields' },
  { key: 'quizResults', label: 'Include quiz results', live: false, sourceLabel: 'Assessment quiz results' },
  { key: 'checkpointResults', label: 'Include checkpoint results', live: false, sourceLabel: 'Checkpoint assessments' },
];

function displayValue(value?: string | number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const text = String(value).trim();
  if (!text || text === EMPTY_VALUE || text === '\u2014') return EMPTY_VALUE;
  return text;
}

function normalizeIdentity(value?: string | number | null): string {
  return displayValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function toNumber(value?: number | string | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatCount(value?: number | null): string {
  return value === null || value === undefined ? EMPTY_VALUE : String(value);
}

function formatPercent(value?: number | null, available = true): string {
  if (!available || value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${Math.round(value)}%`;
}

function formatRatio(completed?: number | null, target?: number | null): string {
  const completedValue = toNumber(completed);
  const targetValue = toNumber(target);
  if (!targetValue) return EMPTY_VALUE;
  return `${completedValue}/${targetValue}`;
}

function percent(completed?: number | null, target?: number | null): number | null {
  const completedValue = toNumber(completed);
  const targetValue = toNumber(target);
  if (!targetValue) return null;
  return Math.round((completedValue / targetValue) * 100);
}

function average(values: number[]): number | null {
  const usable = values.filter(value => Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function formatInputDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonthRange(referenceDate = new Date()) {
  return {
    fromDate: formatInputDate(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)),
    toDate: formatInputDate(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)),
  };
}

function currentTimestamp(): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function sourceTable(headers: string[], rows: string[][]) {
  return {
    headers,
    rows: rows.length ? rows : [headers.map(() => EMPTY_VALUE)],
  };
}

function learnerProgrammeLabel(learner: CaseloadLearner): string {
  const programme = displayValue(learner.programme);
  return programme !== EMPTY_VALUE ? programme : displayValue(learner.cohortName);
}

function learnerScopeLabel(learner: CaseloadLearner): string {
  const programme = learnerProgrammeLabel(learner);
  const group = displayValue(learner.group);
  return group === EMPTY_VALUE ? programme : `${programme} / ${group}`;
}

function learnerSelectLabel(learner: CaseloadLearner): string {
  return `${displayValue(learner.name)} / ${learnerProgrammeLabel(learner)}`;
}

function isActiveLearner(learner: CaseloadLearner): boolean {
  const rawProgramStatus = displayValue(learner.rawProgramStatus).toLowerCase().replace(/[\s_-]+/g, '');
  const enrollmentStatus = displayValue(learner.enrollmentStatus).toLowerCase().replace(/[\s_-]+/g, '');
  return rawProgramStatus === 'active' || enrollmentStatus === 'active';
}

function findAttendanceRecord(learner: CaseloadLearner, attendanceLearners: AttendanceLearner[]) {
  const learnerId = normalizeIdentity(learner.id);
  const learnerEmail = normalizeIdentity(learner.email);
  const learnerName = normalizeIdentity(learner.name);

  return attendanceLearners.find((attendance) => {
    const attendanceId = normalizeIdentity(attendance.id);
    const attendanceEmail = normalizeIdentity(attendance.email);
    const attendanceName = normalizeIdentity(attendance.learner);

    return Boolean(
      (learnerId && attendanceId && learnerId === attendanceId)
      || (learnerEmail && attendanceEmail && learnerEmail === attendanceEmail)
      || (learnerName && attendanceName && learnerName === attendanceName),
    );
  });
}

function eventMatchesLearner(event: CoachCalendarEvent, learner: CaseloadLearner) {
  const eventLearnerId = displayValue(event.learnerId);
  const learnerId = displayValue(learner.id);
  if (eventLearnerId !== EMPTY_VALUE && learnerId !== EMPTY_VALUE && eventLearnerId === learnerId) return true;

  const eventEmail = displayValue(event.email).toLowerCase();
  const learnerEmail = displayValue(learner.email).toLowerCase();
  if (eventEmail !== EMPTY_VALUE && learnerEmail !== EMPTY_VALUE && eventEmail === learnerEmail) return true;

  return displayValue(event.learner).toLowerCase() === displayValue(learner.name).toLowerCase();
}

function isDateWithinRange(value?: string | null, fromDate?: string, toDate?: string) {
  const date = parseLocalDate(value);
  const from = parseLocalDate(fromDate);
  const to = parseLocalDate(toDate);
  if (!date) return false;
  if (from && date.getTime() < from.getTime()) return false;
  if (to && date.getTime() > to.getTime()) return false;
  return true;
}

function sortEvents(events: CoachCalendarEvent[]) {
  return [...events].sort((a, b) => {
    const aTime = parseLocalDate(eventDisplayDate(a))?.getTime() || 0;
    const bTime = parseLocalDate(eventDisplayDate(b))?.getTime() || 0;
    return aTime - bTime;
  });
}

function formatReportPeriod(fromDate: string, toDate: string): string {
  const fromLabel = formatDateLabel(fromDate);
  const toLabel = formatDateLabel(toDate);
  if (fromLabel === EMPTY_VALUE && toLabel === EMPTY_VALUE) return 'Current snapshot';
  if (fromLabel === toLabel) return fromLabel;
  return `${fromLabel} to ${toLabel}`;
}

function formatHours(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${Number(value).toFixed(value % 1 === 0 ? 0 : 2)}h`;
}

function formatDateTimeCell(value?: string | null) {
  const label = formatDateLabel(value);
  return label === EMPTY_VALUE ? EMPTY_VALUE : label;
}

function parseVariance(value?: string | null): number {
  const match = displayValue(value).match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalisedStatusLabel(value?: string | null): string {
  const normalised = displayValue(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalised === 'atrisk') return 'At Risk';
  if (normalised === 'needattention' || normalised === 'needsattention') return 'Need Attention';
  if (normalised === 'ontrack') return 'On Track';
  return displayValue(value);
}

function describeProgressState(percentValue: number | null): string {
  if (percentValue === null) return EMPTY_VALUE;
  if (percentValue >= 85) return 'Strong';
  if (percentValue >= 65) return 'On Track';
  if (percentValue >= 45) return 'Developing';
  return 'At Risk';
}

function buildWeeklyRanges(fromDate: string, toDate: string) {
  const start = parseLocalDate(fromDate);
  const end = parseLocalDate(toDate);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const ranges: Array<{ label: string; from: string; to: string }> = [];
  const cursor = new Date(start);
  let weekNumber = 1;

  while (cursor.getTime() <= end.getTime()) {
    const rangeStart = new Date(cursor);
    const rangeEnd = new Date(cursor);
    rangeEnd.setDate(rangeEnd.getDate() + 6);
    if (rangeEnd.getTime() > end.getTime()) {
      rangeEnd.setTime(end.getTime());
    }

    ranges.push({
      label: `Week ${weekNumber}`,
      from: formatInputDate(rangeStart),
      to: formatInputDate(rangeEnd),
    });

    cursor.setDate(cursor.getDate() + 7);
    weekNumber += 1;
  }

  return ranges;
}

function firstEventTutor(events: CoachCalendarEvent[]) {
  const withTutor = events.find(event => displayValue(event.tutor) !== EMPTY_VALUE);
  return withTutor ? displayValue(withTutor.tutor) : EMPTY_VALUE;
}

function buildCoachSummaryText({
  learnerLabel,
  reportPeriod,
  loggedHours,
  targetHours,
  attendance,
  ksb,
  otjhStatus,
  riskFlags,
  coachingCount,
  reviewCount,
}: {
  learnerLabel: string;
  reportPeriod: string;
  loggedHours: string;
  targetHours: string;
  attendance: string;
  ksb: string;
  otjhStatus: string;
  riskFlags: string[];
  coachingCount: number;
  reviewCount: number;
}) {
  const flags = riskFlags.length ? riskFlags.join(', ') : 'no additional live risk flags';
  return `${learnerLabel} has ${loggedHours} logged OTJH against ${targetHours} for ${reportPeriod}. Attendance is ${attendance}, KSB progress is ${ksb}, and OTJH status is ${otjhStatus}. The selected period contains ${coachingCount} coaching meeting entries and ${reviewCount} progress review entries. Live risk markers currently show ${flags}. Any declaration, validation, or evidence-entry fields without a connected source remain -- in this preview.`;
}

function buildSourceStatusSection(snapshot: LiveReportSnapshot): ReportSection | null {
  if (!snapshot.warnings.length) return null;
  return {
    title: 'Source status',
    content: 'Some live sources could not be loaded, so affected values are shown as -- in this preview.',
    table: sourceTable(
      ['Source', 'Status'],
      snapshot.warnings.map(source => [source, 'Unavailable']),
    ),
  };
}

function buildUnavailableInclusionsSection(selectedKeys: InclusionKey[]): ReportSection | null {
  const unavailable = INCLUSION_OPTIONS.filter(option => selectedKeys.includes(option.key) && !option.live);
  if (!unavailable.length) return null;

  return {
    title: 'Selected inclusions awaiting live source',
    content: 'These options are included in the generator settings, but they still need a confirmed source before they can populate the report.',
    table: sourceTable(
      ['Inclusion', 'Source', 'Status'],
      unavailable.map(option => [option.label, option.sourceLabel, 'Pending']),
    ),
  };
}

function buildOtjhGeneratedReport(snapshot: LiveReportSnapshot, options: ReportOptions): GeneratedReport {
  const meta = REPORT_TYPE_META[options.reportType];
  const selectedLearners = options.learnerId === 'all'
    ? snapshot.caseloadLearners
    : snapshot.caseloadLearners.filter(learner => displayValue(learner.id) === options.learnerId);
  const selectedLearner = options.learnerId === 'all' ? null : selectedLearners[0] || null;
  const selectedLearnerLabel = options.learnerId === 'all'
    ? `${selectedLearners.length} learners`
    : displayValue(selectedLearners[0]?.name);
  const reportPeriod = formatReportPeriod(options.fromDate, options.toDate);
  const selectedEvents = sortEvents(snapshot.timetableEvents.filter((event) => (
    isDateWithinRange(eventDisplayDate(event), options.fromDate, options.toDate)
    && selectedLearners.some(learner => eventMatchesLearner(event, learner))
  )));
  const coachingEvents = selectedEvents.filter(event => event.source === 'mcr');
  const reviewEvents = selectedEvents.filter(event => event.source === 'progress-review');
  const attendanceRecord = selectedLearner ? findAttendanceRecord(selectedLearner, snapshot.attendanceLearners) || null : null;
  const belowTarget = selectedLearners.filter((learner) => {
    const status = displayValue(learner.otjhStatus).toLowerCase();
    const progress = percent(learner.otjhCompleted, learner.otjhTarget);
    return status.includes('risk') || status.includes('attention') || (progress !== null && progress < 80);
  });
  const totalHours = selectedLearners.reduce((sum, learner) => sum + toNumber(learner.otjhCompleted), 0);
  const totalTargetHours = selectedLearners.reduce((sum, learner) => sum + toNumber(learner.otjhTarget), 0);
  const totalShortfall = selectedLearners.reduce((sum, learner) => {
    const target = toNumber(learner.otjhTarget);
    const completed = toNumber(learner.otjhCompleted);
    return sum + Math.max(target - completed, 0);
  }, 0);
  const attendanceValues = selectedLearners
    .map(learner => findAttendanceRecord(learner, snapshot.attendanceLearners))
    .filter((row): row is AttendanceLearner => Boolean(row))
    .map(row => row.attendance)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const ksbValues = selectedLearners
    .filter(learner => learner.ksbProgressAvailable)
    .map(learner => toNumber(learner.ksbProgress));
  const firstTutor = firstEventTutor(selectedEvents);
  const selectedInclusions = Object.entries(options.inclusions)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key as InclusionKey);
  const aggregatedRiskFlags = Array.from(new Set(
    selectedLearners.flatMap(learner => (learner.riskFlags || []).map(flag => displayValue(flag))).filter(flag => flag !== EMPTY_VALUE),
  ));
  const attendanceValue = selectedLearners.length === 1
    ? formatPercent(attendanceRecord?.attendance ?? null)
    : formatPercent(average(attendanceValues));
  const ksbValue = selectedLearners.length === 1
    ? formatPercent(selectedLearner?.ksbProgress ?? null, selectedLearner?.ksbProgressAvailable)
    : formatPercent(average(ksbValues));
  const learnerStatus = selectedLearner
    ? displayValue(selectedLearner.rawProgramStatus) !== EMPTY_VALUE
      ? displayValue(selectedLearner.rawProgramStatus)
      : normalisedStatusLabel(selectedLearner.otjhStatus)
    : `${selectedLearners.length} learners in scope`;
  const detailMetrics = [
    { label: 'Learner', value: selectedLearnerLabel },
    { label: 'Apprenticeship Standard', value: selectedLearner ? learnerProgrammeLabel(selectedLearner) : 'Multiple programmes' },
    {
      label: 'Employer',
      value: selectedLearner
        ? displayValue(selectedLearner.employer)
        : `${Array.from(new Set(selectedLearners.map(learner => displayValue(learner.employer)).filter(value => value !== EMPTY_VALUE))).length} employers`,
    },
    { label: 'Line Manager', value: EMPTY_VALUE },
    { label: 'Coach', value: selectedLearner ? (displayValue(selectedLearner.coachName) === EMPTY_VALUE ? snapshot.ownerName : displayValue(selectedLearner.coachName)) : snapshot.ownerName },
    { label: 'Tutor', value: firstTutor },
    { label: 'Practical Period Start', value: selectedLearner ? formatDateTimeCell(selectedLearner.startDate || selectedLearner.lastAttendanceDate) : EMPTY_VALUE },
    { label: 'Expected End', value: selectedLearner ? formatDateTimeCell(selectedLearner.plannedEndDate || selectedLearner.lastCoachingSession) : EMPTY_VALUE },
    { label: 'Gateway', value: selectedLearner ? formatDateTimeCell(selectedLearner.gatewayReviewDate || selectedLearner.lastProgressReview || selectedLearner.lastReview) : EMPTY_VALUE },
    { label: 'Report Period', value: reportPeriod },
    { label: 'Status', value: learnerStatus },
  ];
  const weeklyRanges = buildWeeklyRanges(options.fromDate, options.toDate);
  const weeklyRows = (weeklyRanges.length ? weeklyRanges : [{ label: 'Week 1', from: options.fromDate, to: options.toDate }]).map(range => [
    range.label,
    `${formatDateLabel(range.from)} - ${formatDateLabel(range.to)}`,
    EMPTY_VALUE,
    EMPTY_VALUE,
    EMPTY_VALUE,
    EMPTY_VALUE,
    EMPTY_VALUE,
    EMPTY_VALUE,
  ]);
  const ksbRows = selectedLearner
    ? [
        [
          'Overall KSB',
          formatCount(toNumber(selectedLearner.ksbCompleted) || null),
          formatCount(toNumber(selectedLearner.ksbTarget) || null),
          formatPercent(selectedLearner.ksbProgress ?? null, selectedLearner.ksbProgressAvailable),
          normalisedStatusLabel(selectedLearner.ksbStatus),
          formatDateTimeCell(selectedLearner.lastSubmittedEvidence),
        ],
        [
          'Knowledge',
          formatCount(toNumber(selectedLearner.knowledgeCompleted) || null),
          formatCount(toNumber(selectedLearner.knowledgeTarget) || null),
          formatPercent(percent(selectedLearner.knowledgeCompleted, selectedLearner.knowledgeTarget)),
          describeProgressState(percent(selectedLearner.knowledgeCompleted, selectedLearner.knowledgeTarget)),
          formatDateTimeCell(selectedLearner.lastSubmittedEvidence),
        ],
        [
          'Skills',
          formatCount(toNumber(selectedLearner.skillsCompleted) || null),
          formatCount(toNumber(selectedLearner.skillsTarget) || null),
          formatPercent(percent(selectedLearner.skillsCompleted, selectedLearner.skillsTarget)),
          describeProgressState(percent(selectedLearner.skillsCompleted, selectedLearner.skillsTarget)),
          formatDateTimeCell(selectedLearner.lastSubmittedEvidence),
        ],
        [
          'Behaviours',
          formatCount(toNumber(selectedLearner.behavioursCompleted) || null),
          formatCount(toNumber(selectedLearner.behavioursTarget) || null),
          formatPercent(percent(selectedLearner.behavioursCompleted, selectedLearner.behavioursTarget)),
          describeProgressState(percent(selectedLearner.behavioursCompleted, selectedLearner.behavioursTarget)),
          formatDateTimeCell(selectedLearner.lastSubmittedEvidence),
        ],
      ]
    : [
        [
          'Overall KSB',
          EMPTY_VALUE,
          EMPTY_VALUE,
          formatPercent(average(ksbValues)),
          describeProgressState(average(ksbValues)),
          EMPTY_VALUE,
        ],
      ];
  const evidenceRows = [
    [EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE],
  ];
  const coachingRows = coachingEvents.length
    ? coachingEvents.slice(0, REPORT_LIMIT).map(event => [
        formatDateLabel(eventDisplayDate(event)),
        displayValue(selectedLearner?.coachName) === EMPTY_VALUE ? snapshot.ownerName : displayValue(selectedLearner?.coachName),
        displayValue(event.status),
        displayValue(event.title),
        displayValue(event.notes),
      ])
    : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
  const reviewRows = reviewEvents.length
    ? reviewEvents.slice(0, REPORT_LIMIT).map(event => [
        formatDateLabel(eventDisplayDate(event)),
        selectedLearner ? `${displayValue(selectedLearner.employer)} / ${snapshot.ownerName}` : EMPTY_VALUE,
        displayValue(event.status),
        displayValue(event.title),
        displayValue(event.notes),
      ])
    : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
  const riskRows: string[][] = [];
  const progressVarianceLabel = selectedLearner ? displayValue(selectedLearner.progressVariance) : EMPTY_VALUE;
  if (progressVarianceLabel !== EMPTY_VALUE) {
    const variance = parseVariance(progressVarianceLabel);
    riskRows.push([
      variance < 0 ? 'Amber' : 'Green',
      `Progress variance ${progressVarianceLabel}`,
      variance < 0 ? 'Review OTJH catch-up planning for this learner.' : 'Variance currently looks stable.',
    ]);
  }
  if (selectedLearner && displayValue(selectedLearner.otjhStatus) !== EMPTY_VALUE && normalisedStatusLabel(selectedLearner.otjhStatus) !== 'On Track') {
    riskRows.push([
      normalisedStatusLabel(selectedLearner.otjhStatus) === 'At Risk' ? 'Red' : 'Amber',
      `OTJH status is ${normalisedStatusLabel(selectedLearner.otjhStatus)}`,
      'Monitor OTJH completion and review supporting evidence.',
    ]);
  }
  if (selectedLearner && displayValue(selectedLearner.coachRag) !== EMPTY_VALUE && displayValue(selectedLearner.coachRag).toLowerCase() !== 'green') {
    riskRows.push([
      displayValue(selectedLearner.coachRag),
      `Coach RAG is ${displayValue(selectedLearner.coachRag)}`,
      'Use coach RAG alongside OTJH and attendance when reviewing next actions.',
    ]);
  }
  if (attendanceRecord?.risk === 'red' || attendanceRecord?.risk === 'amber') {
    riskRows.push([
      attendanceRecord.risk === 'red' ? 'Red' : 'Amber',
      `Attendance risk is ${attendanceRecord.risk}`,
      'Attendance risk is coming from the live attendance endpoint.',
    ]);
  }
  aggregatedRiskFlags.forEach(flag => {
    riskRows.push(['Amber', flag, 'Live learner risk flag from the caseload source.']);
  });
  if (!riskRows.length) {
    riskRows.push(['Green', 'No live risk flags found', 'Current connected sources do not show any additional OTJH exceptions.']);
  }
  const coachSummary = buildCoachSummaryText({
    learnerLabel: selectedLearnerLabel,
    reportPeriod,
    loggedHours: formatHours(totalHours),
    targetHours: formatHours(totalTargetHours),
    attendance: attendanceValue,
    ksb: ksbValue,
    otjhStatus: selectedLearner ? normalisedStatusLabel(selectedLearner.otjhStatus) : formatCount(belowTarget.length),
    riskFlags: aggregatedRiskFlags,
    coachingCount: coachingEvents.length,
    reviewCount: reviewEvents.length,
  });
  const auditRows: string[][] = [
    ['Report generated', snapshot.ownerName, currentTimestamp()],
  ];
  if (selectedLearner && displayValue(selectedLearner.lastSubmittedEvidence) !== EMPTY_VALUE) {
    auditRows.push(['Latest evidence marker on source', displayValue(selectedLearner.name), formatDateTimeCell(selectedLearner.lastSubmittedEvidence)]);
  }
  if (selectedLearner && displayValue(selectedLearner.lastProgressReview) !== EMPTY_VALUE) {
    auditRows.push(['Latest progress review on source', snapshot.ownerName, formatDateTimeCell(selectedLearner.lastProgressReview)]);
  }
  if (coachingEvents[0]) {
    auditRows.push(['Latest coaching event in selected range', snapshot.ownerName, formatDateLabel(eventDisplayDate(coachingEvents[coachingEvents.length - 1]))]);
  }
  const sourceStatus = buildSourceStatusSection(snapshot);
  const sections: ReportSection[] = [
    {
      title: 'Report details',
      content: 'Top-level learner and report facts. Any unconnected workflow fields remain --.',
      metrics: detailMetrics,
    },
    {
      title: 'Executive summary',
      content: `${meta.description} Scope: ${selectedLearnerLabel}. OTJH totals use the current learner snapshot, while period filtering is applied to timetable-based sections.`,
      metrics: [
        { label: 'Planned OTJH', value: formatHours(totalTargetHours) },
        { label: 'Logged OTJH', value: formatHours(totalHours) },
        { label: 'Validated OTJH', value: EMPTY_VALUE },
        { label: 'Pending Validation', value: EMPTY_VALUE },
        { label: 'Rejected Hours', value: EMPTY_VALUE },
        { label: 'Shortfall', value: formatHours(totalShortfall) },
        { label: 'Attendance', value: attendanceValue },
        { label: 'KSB Progress', value: ksbValue },
      ],
    },
    {
      title: 'Learner declaration',
      content: 'Learner declaration workflow is not connected to a live source yet. Declaration fields stay available here and show -- until that source is linked.',
      table: sourceTable(
        ['Field', 'Value'],
        [
          ['Status', EMPTY_VALUE],
          ['Signed by', EMPTY_VALUE],
          ['Date', EMPTY_VALUE],
          ['Time', EMPTY_VALUE],
          ['Device', EMPTY_VALUE],
        ],
      ),
    },
    {
      title: 'Coach / tutor validation',
      content: 'Validation workflow fields are shown with live reviewer names where available and -- for the unconnected validation values.',
      table: sourceTable(
        ['Field', 'Value'],
        [
          ['Reviewer', selectedLearner ? (displayValue(selectedLearner.coachName) === EMPTY_VALUE ? snapshot.ownerName : displayValue(selectedLearner.coachName)) : snapshot.ownerName],
          ['Tutor', firstTutor],
          ['Accepted hours', EMPTY_VALUE],
          ['Rejected hours', options.inclusions.rejectedHours ? EMPTY_VALUE : EMPTY_VALUE],
          ['Pending validation', options.inclusions.pendingTutorValidation ? EMPTY_VALUE : EMPTY_VALUE],
        ],
      ),
    },
    {
      title: 'Employer confirmation',
      content: 'Employer confirmation details are shown only where the learner source already carries employer contact data.',
      table: sourceTable(
        ['Field', 'Value'],
        [
          ['Employer', selectedLearner ? displayValue(selectedLearner.employer) : EMPTY_VALUE],
          ['Employer email', selectedLearner ? displayValue(selectedLearner.employerEmail) : EMPTY_VALUE],
          ['Employer phone', selectedLearner ? displayValue(selectedLearner.employerPhone) : EMPTY_VALUE],
          ['Confirmation date', EMPTY_VALUE],
          ['Comment', options.inclusions.employerComments ? EMPTY_VALUE : EMPTY_VALUE],
        ],
      ),
    },
    {
      title: 'Weekly OTJH breakdown',
      content: 'Weekly OTJH line items are not available from the current live sources, so this structure is rendered with the selected dates and -- placeholders.',
      table: sourceTable(
        ['Week', 'Dates', 'Topic', 'Planned', 'Logged', 'Validated', 'KSBs', 'Status'],
        weeklyRows,
      ),
    },
  ];

  if (options.inclusions.ksbProgression) {
    sections.push({
      title: 'KSB progression',
      content: 'Per-KSB codes are not exposed by the current live source, so this section shows the aggregated Knowledge / Skills / Behaviours values available today.',
      table: sourceTable(['Area', 'Completed', 'Target', 'Progress', 'Status', 'Last updated'], ksbRows),
    });
  }

  if (
    options.inclusions.evidenceLinks
    || options.inclusions.learnerReflections
    || options.inclusions.quizResults
    || options.inclusions.checkpointResults
  ) {
    sections.push({
      title: 'Component-level OTJH evidence',
      content: 'Detailed evidence, reflection, quiz and checkpoint rows are not connected to a live OTJH activity source yet, so this table shows -- placeholders.',
      table: sourceTable(
        ['Date', 'Week', 'Activity', 'Type', 'KSBs', 'Hours', 'Paid Hours', 'Validation'],
        evidenceRows,
      ),
    });
  }

  sections.push({
    title: 'What counts as OTJH',
    content: 'Use this reminder when reviewing learner activity inside the report.',
    findings: [
      'Live teaching sessions',
      'Pre-recorded learning linked to apprenticeship outcomes',
      'Workplace projects that develop new Knowledge, Skills or Behaviours',
      'Reading, mentoring or shadowing where new KSBs are developed',
      'Assignments and coached catch-up activities tied to the standard',
    ],
    recommendations: [
      'Normal paid duties with no new learning',
      'Examinations and on-programme tests',
      'Progress review meeting duration itself',
      'Standalone English and maths activity',
      'Training outside paid hours unless formally agreed and compensated',
    ],
  });

  if (options.inclusions.coachingSummaries) {
    sections.push({
      title: 'Monthly coaching meeting summary',
      content: 'Coaching meeting summaries are pulled from timetable events in the selected range. Meeting duration itself is not treated as OTJH in this preview.',
      table: sourceTable(
        ['Date', 'Coach', 'Status', 'Summary', 'Notes'],
        coachingRows,
      ),
    });
  }

  if (options.inclusions.progressReviewSummaries) {
    sections.push({
      title: 'Progress review summary',
      content: 'Progress review activity is filtered from timetable events in the selected range. Review duration is not added into OTJH totals.',
      table: sourceTable(
        ['Date', 'Participants', 'Status', 'Summary', 'Notes'],
        reviewRows,
      ),
    });
  }

  sections.push({
    title: 'Risk & exception flags',
    content: 'This section combines live OTJH, attendance, coach RAG and learner risk flags where they are available.',
    table: sourceTable(['Severity', 'Flag', 'Action'], riskRows),
  });

  sections.push({
    title: 'Coach judgement & summary',
    content: coachSummary,
  });

  sections.push({
    title: 'Audit trail',
    content: 'This audit view is limited to the live source markers currently available in the connected OTJH preview.',
    table: sourceTable(['Event', 'By', 'Date'], auditRows),
  });

  const pendingInclusionsSection = buildUnavailableInclusionsSection(selectedInclusions);
  if (pendingInclusionsSection) {
    sections.push(pendingInclusionsSection);
  }

  return {
    id: options.reportType,
    title: meta.title,
    subtitle: `${selectedLearnerLabel} / ${reportPeriod}`,
    generatedAt: currentTimestamp(),
    period: reportPeriod,
    coach: snapshot.ownerName,
    sections: sourceStatus ? [sourceStatus, ...sections] : sections,
  };
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serializeReportText(report: GeneratedReport): string {
  return [
    report.title,
    `Coach: ${report.coach}`,
    `Period: ${report.period}`,
    `Generated: ${report.generatedAt}`,
    '',
    ...report.sections.flatMap(section => {
      const parts: string[] = [`=== ${section.title} ===`];
      if (section.content) parts.push(section.content);
      if (section.metrics?.length) {
        parts.push(...section.metrics.map(metric => `${metric.label}: ${metric.value}`));
      }
      if (section.table) {
        parts.push(section.table.headers.join(' | '));
        parts.push(...section.table.rows.map(row => row.join(' | ')));
      }
      if (section.chart) {
        parts.push(`Chart: ${section.chart.type}`);
        parts.push(...section.chart.datasets.map(dataset => `${dataset.label}: ${dataset.values.join(', ')}`));
      }
      if (section.findings?.length) {
        parts.push(...section.findings.map(item => `- ${item}`));
      }
      if (section.recommendations?.length) {
        parts.push(...section.recommendations.map(item => `- ${item}`));
      }
      parts.push('');
      return parts;
    }),
  ].join('\n');
}

function serializeReportCsv(report: GeneratedReport): string {
  const rows: string[][] = [
    [report.title],
    ['Coach', report.coach],
    ['Period', report.period],
    ['Generated', report.generatedAt],
    [],
  ];

  report.sections.forEach((section) => {
    rows.push([section.title]);
    if (section.content) rows.push([section.content]);
    if (section.metrics?.length) {
      rows.push(['Metric', 'Value']);
      section.metrics.forEach(metric => rows.push([metric.label, metric.value]));
    }
    if (section.table) {
      rows.push(section.table.headers);
      section.table.rows.forEach(row => rows.push(row));
    }
    if (section.chart) {
      rows.push(['Chart Type', section.chart.type]);
      rows.push(['Label', ...section.chart.labels]);
      section.chart.datasets.forEach(dataset => rows.push([dataset.label, ...dataset.values.map(String)]));
    }
    if (section.findings?.length) {
      rows.push(['Counts as OTJH']);
      section.findings.forEach(item => rows.push([item]));
    }
    if (section.recommendations?.length) {
      rows.push(['Does not count as OTJH']);
      section.recommendations.forEach(item => rows.push([item]));
    }
    rows.push([]);
  });

  return rows.map(row => row.map(cell => escapeCsv(String(cell || ''))).join(',')).join('\n');
}

function serializeReportHtml(report: GeneratedReport): string {
  const sections = report.sections.map((section) => `
    <section style="margin-bottom:24px;">
      <h2 style="font-size:18px;margin:0 0 10px;color:#0f172a;">${section.title}</h2>
      ${section.content ? `<p style="margin:0 0 12px;color:#475569;line-height:1.7;">${section.content}</p>` : ''}
      ${section.metrics?.length ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
          ${section.metrics.map(metric => `
            <tr>
              <td style="border:1px solid #dbe4f0;padding:8px;font-weight:600;color:#334155;">${metric.label}</td>
              <td style="border:1px solid #dbe4f0;padding:8px;color:#0f172a;">${metric.value}</td>
            </tr>`).join('')}
        </table>` : ''}
      ${section.table ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
          <thead>
            <tr>${section.table.headers.map(header => `<th style="border:1px solid #dbe4f0;padding:8px;background:#f8fafc;text-align:left;">${header}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${section.table.rows.map(row => `<tr>${row.map(cell => `<td style="border:1px solid #dbe4f0;padding:8px;">${cell}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>` : ''}
      ${section.findings?.length ? `
        <div style="margin-bottom:12px;">
          <p style="margin:0 0 8px;font-weight:700;color:#166534;">Counts as OTJH</p>
          <ul style="margin:0;padding-left:20px;color:#334155;line-height:1.7;">
            ${section.findings.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${section.recommendations?.length ? `
        <div>
          <p style="margin:0 0 8px;font-weight:700;color:#dc2626;">Does not count as OTJH</p>
          <ul style="margin:0;padding-left:20px;color:#334155;line-height:1.7;">
            ${section.recommendations.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>` : ''}
    </section>
  `).join('');

  return `
    <html>
      <body style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#0f172a;">
        <h1 style="margin:0 0 8px;font-size:28px;">${report.title}</h1>
        <p style="margin:0 0 4px;color:#475569;">Coach: ${report.coach}</p>
        <p style="margin:0 0 4px;color:#475569;">Period: ${report.period}</p>
        <p style="margin:0 0 24px;color:#475569;">Generated: ${report.generatedAt}</p>
        ${sections}
      </body>
    </html>
  `;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadGeneratedReport(report: GeneratedReport, format: ExportFormat) {
  const safeTitle = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = report.generatedAt.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, '');

  if (format === 'pdf') {
    const document = new jsPDF({ unit: 'pt', format: 'a4' });
    const lines = serializeReportText(report).split('\n');
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin;

    document.setFont('helvetica', 'normal');
    document.setFontSize(11);

    lines.forEach((line) => {
      const wrapped = document.splitTextToSize(line || ' ', pageWidth - (margin * 2));
      wrapped.forEach((segment: string) => {
        if (y > pageHeight - margin) {
          document.addPage();
          y = margin;
        }
        document.text(segment, margin, y);
        y += 16;
      });
    });

    document.save(`${safeTitle || 'otjh-report'}-${stamp || 'report'}.pdf`);
    return;
  }

  if (format === 'word') {
    const html = serializeReportHtml(report);
    downloadBlob(
      `${safeTitle || 'otjh-report'}-${stamp || 'report'}.doc`,
      new Blob([html], { type: 'application/msword' }),
    );
    return;
  }

  downloadBlob(
    `${safeTitle || 'otjh-report'}-${stamp || 'report'}.csv`,
    new Blob([serializeReportCsv(report)], { type: 'text/csv;charset=utf-8' }),
  );
}

function MiniChart({ chart }: { chart?: GeneratedReport['sections'][number]['chart'] }) {
  if (!chart) return null;
  const maxValue = Math.max(1, ...chart.datasets.flatMap(dataset => dataset.values));

  return (
    <div className="space-y-4 rounded-2xl border border-foreground-200/60 bg-white p-4 shadow-sm">
      {chart.datasets.map((dataset) => (
        <div key={dataset.label} className="space-y-2">
          <p className="text-[11px] font-semibold text-foreground-700">{dataset.label}</p>
          <div className="space-y-2">
            {chart.labels.map((label, index) => (
              <div key={`${dataset.label}-${label}`} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-[10px] text-foreground-500">{label}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-full bg-background-200">
                  <div
                    className="flex h-full items-center justify-end rounded-full px-2 text-[9px] font-bold text-white"
                    style={{ width: `${Math.max(8, (dataset.values[index] / maxValue) * 100)}%`, backgroundColor: dataset.color }}
                  >
                    {dataset.values[index]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function toneForValue(value: string) {
  const normalized = displayValue(value).toLowerCase();
  if (
    normalized === 'red'
    || normalized === 'at risk'
    || normalized === 'pending'
    || normalized === 'unavailable'
    || normalized === 'awaiting'
    || normalized === 'needs-work'
  ) {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (
    normalized === 'amber'
    || normalized === 'need attention'
    || normalized === 'developing'
    || normalized === 'partial'
    || normalized === 'optional'
  ) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (
    normalized === 'green'
    || normalized === 'on track'
    || normalized === 'complete'
    || normalized === 'completed'
    || normalized === 'validated'
    || normalized === 'strong'
    || normalized === 'yes'
    || normalized === 'signed'
    || normalized === 'active'
  ) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-foreground-200 bg-background-100 text-foreground-600';
}

function textToneForValue(value: string) {
  const tone = toneForValue(value);
  if (tone.includes('text-red-700')) return 'font-semibold text-red-600';
  if (tone.includes('text-amber-700')) return 'font-semibold text-amber-600';
  if (tone.includes('text-emerald-700')) return 'font-semibold text-emerald-600';
  return 'text-foreground-700';
}

function PreviewStatusCard({ section }: { section: ReportSection }) {
  return (
    <article className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <i className="ri-alert-line text-lg"></i>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900">{section.title}</h3>
          {section.content && <p className="mt-1 text-xs leading-6 text-amber-800/90">{section.content}</p>}
          {section.table?.rows?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {section.table.rows.map(([source, status]) => (
                <span
                  key={`${source}-${status}`}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-amber-900"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                  {source}: {status}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function PreviewDetailCard({
  report,
  section,
}: {
  report: GeneratedReport;
  section: ReportSection;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-primary-800/15 bg-white shadow-[0_12px_34px_rgba(48,24,90,0.1)]">
      <div className="border-b border-primary-100/80 bg-primary-50/60 px-6 py-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-900 text-2xl font-heading font-bold text-white shadow-sm">
            K
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.24em] text-primary-700/80">Kent Business College</p>
            <h3 className="mt-2 text-3xl font-heading font-bold tracking-tight text-foreground-950">{report.title}</h3>
            {section.content ? <p className="mt-2 max-w-3xl text-sm leading-7 text-foreground-600">{section.content}</p> : null}
          </div>
        </div>

        <div className="space-y-2 text-sm text-foreground-500 lg:text-right">
          <p className="font-medium text-foreground-700">Report v1.0 · Draft</p>
          <p>Generated {report.generatedAt}</p>
          <p>By {report.coach}</p>
        </div>
        </div>
      </div>

      {section.metrics?.length ? (
        <div className="grid gap-3 p-6 md:grid-cols-2 xl:grid-cols-3">
          {section.metrics.map(metric => (
            <div key={metric.label} className="rounded-2xl border border-foreground-200/70 bg-white px-4 py-4 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-400">{metric.label}</p>
              <p className="mt-2 text-lg font-semibold leading-7 text-foreground-900">{metric.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PreviewSectionCard({
  section,
  index,
}: {
  section: ReportSection;
  index: number;
}) {
  const isRuleSection = section.title === 'What counts as OTJH';
  const isCoachSummary = section.title === 'Coach judgement & summary';
  const isRiskSection = section.title === 'Risk & exception flags';
  const isKeyValueTable = Boolean(section.table && section.table.headers.length === 2 && !isRiskSection);

  return (
    <article className="rounded-2xl border border-foreground-200/60 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-primary-100 px-3 text-sm font-semibold text-primary-700">
          {index}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground-900">{section.title}</h3>
          {section.content && !isCoachSummary ? <p className="mt-1 text-[11px] leading-5 text-foreground-500">{section.content}</p> : null}
        </div>
      </div>

      {section.metrics && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {section.metrics.map(metric => (
            <div key={metric.label} className="rounded-2xl border border-foreground-200/60 bg-background-100/45 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">{metric.label}</p>
              <p className="mt-2 text-xl font-heading font-bold text-foreground-900">{metric.value}</p>
            </div>
          ))}
        </div>
      )}

      {isKeyValueTable && section.table ? (
        <div className="grid gap-3 md:grid-cols-2">
          {section.table.rows.map(([label, value]) => (
            <div key={`${section.title}-${label}`} className="rounded-2xl border border-foreground-200/60 bg-background-100/45 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">{label}</p>
              <p className="mt-2 text-sm font-medium leading-6 text-foreground-800">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {isRiskSection && section.table ? (
        <div className="space-y-3">
          {section.table.rows.map(([severity, flag, action], rowIndex) => (
            <div key={`${section.title}-${rowIndex}`} className="rounded-2xl border border-foreground-200/60 bg-background-100/45 px-4 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${toneForValue(severity)}`}>
                  {severity}
                </span>
                <p className="text-sm font-medium text-foreground-900">{flag}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground-600">{action}</p>
            </div>
          ))}
        </div>
      ) : null}

      {section.table && !isKeyValueTable && !isRiskSection ? (
        <div className="overflow-x-auto rounded-2xl border border-foreground-200/60 bg-white">
          <table className="min-w-full text-left text-[11px]">
            <thead className="bg-background-100/80 text-foreground-600">
              <tr>
                {section.table.headers.map(header => (
                  <th key={header} className="px-4 py-3 font-semibold whitespace-nowrap">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, index) => (
                <tr key={`${section.title}-${index}`} className={index % 2 === 1 ? 'bg-background-100/35' : ''}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${section.title}-${index}-${cellIndex}`}
                      className={`px-4 py-3 whitespace-nowrap ${textToneForValue(cell)}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isRuleSection && (section.findings?.length || section.recommendations?.length) ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-emerald-800">
              <i className="ri-checkbox-circle-line text-lg"></i>
              <h4 className="text-sm font-semibold">Counts as OTJH</h4>
            </div>
            <ul className="space-y-2 text-sm leading-6 text-foreground-700">
              {(section.findings || []).map(item => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-red-700">
              <i className="ri-error-warning-line text-lg"></i>
              <h4 className="text-sm font-semibold">Does not count as OTJH</h4>
            </div>
            <ul className="space-y-2 text-sm leading-6 text-foreground-700">
              {(section.recommendations || []).map(item => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-red-500"></span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {isCoachSummary ? (
        <div className="rounded-2xl border border-foreground-200/70 bg-background-100/45 p-4">
          <div className="max-h-56 overflow-y-auto pr-2 text-sm leading-7 text-foreground-700">
            {section.content}
          </div>
        </div>
      ) : null}

      {section.chart && <div className="mt-4"><MiniChart chart={section.chart} /></div>}
    </article>
  );
}

function ExportChip({
  format,
  active,
  busy,
  onClick,
}: {
  format: ExportFormat;
  active: boolean;
  busy?: boolean;
  onClick?: () => void;
}) {
  const meta = EXPORT_FORMAT_META[format];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
        active
          ? 'border-primary-400 bg-primary-500 text-white shadow-md shadow-primary-500/20'
          : 'border-foreground-200 bg-white text-foreground-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'
      }`}
    >
      <i className={`${busy ? 'ri-loader-4-line animate-spin' : meta.icon}`}></i>
      {meta.label}
    </button>
  );
}

export default function CoachReports() {
  const initialRange = currentMonthRange();
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [caseloadLearners, setCaseloadLearners] = useState<CaseloadLearner[]>([]);
  const [attendanceLearners, setAttendanceLearners] = useState<AttendanceLearner[]>([]);
  const [timetableEvents, setTimetableEvents] = useState<CoachCalendarEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  const [downloadState, setDownloadState] = useState<ExportFormat | null>(null);
  const [learnerMenuOpen, setLearnerMenuOpen] = useState(false);
  const [learnerSearch, setLearnerSearch] = useState('');
  const learnerSelectRef = useRef<HTMLDivElement | null>(null);
  const learnerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [options, setOptions] = useState<ReportOptions>({
    learnerId: '',
    reportType: 'monthly-otjh',
    fromDate: initialRange.fromDate,
    toDate: initialRange.toDate,
    exportFormat: 'pdf',
    inclusions: {
      pendingTutorValidation: true,
      rejectedHours: false,
      learnerReflections: true,
      evidenceLinks: true,
      employerComments: true,
      coachingSummaries: true,
      progressReviewSummaries: true,
      ksbProgression: true,
      quizResults: true,
      checkpointResults: true,
    },
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadSources() {
      setLoading(true);
      const nextWarnings: string[] = [];

      const [caseloadResult, attendanceResult, timetableResult] = await Promise.allSettled([
        fetch(CASELOAD_ENDPOINT, { signal: controller.signal }).then(response => readJson<CaseloadResponse>(response)),
        fetch(ATTENDANCE_ENDPOINT, { signal: controller.signal }).then(response => readJson<AttendanceResponse>(response)),
        fetchCoachCalendarEvents(controller.signal),
      ]);

      if (controller.signal.aborted) return;

      if (caseloadResult.status === 'fulfilled') {
        setCaseloadLearners(caseloadResult.value.learners || []);
        if (displayValue(caseloadResult.value.owner?.name) !== EMPTY_VALUE) {
          setOwnerName(String(caseloadResult.value.owner?.name));
        }
      } else {
        setCaseloadLearners([]);
        nextWarnings.push('caseload');
      }

      if (attendanceResult.status === 'fulfilled') {
        setAttendanceLearners(attendanceResult.value.learners || []);
        if (displayValue(attendanceResult.value.owner?.name) !== EMPTY_VALUE) {
          setOwnerName(String(attendanceResult.value.owner?.name));
        }
      } else {
        setAttendanceLearners([]);
        nextWarnings.push('attendance');
      }

      if (timetableResult.status === 'fulfilled') {
        setTimetableEvents(timetableResult.value.events || []);
        if (displayValue(timetableResult.value.owner?.name) !== EMPTY_VALUE) {
          setOwnerName(String(timetableResult.value.owner?.name));
        }
      } else {
        setTimetableEvents([]);
        nextWarnings.push('timetable');
      }

      setWarnings(nextWarnings);
      setLoading(false);
    }

    loadSources();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!options.learnerId && caseloadLearners.length) {
      setOptions(prev => ({ ...prev, learnerId: displayValue(caseloadLearners[0]?.id) }));
    }
  }, [caseloadLearners, options.learnerId]);

  const snapshot = useMemo<LiveReportSnapshot>(() => ({
    ownerName,
    caseloadLearners,
    attendanceLearners,
    timetableEvents,
    warnings,
  }), [ownerName, caseloadLearners, attendanceLearners, timetableEvents, warnings]);

  const learnerOptions = useMemo(() => {
    const activeFirst = [...caseloadLearners].sort((a, b) => {
      if (isActiveLearner(a) === isActiveLearner(b)) return displayValue(a.name).localeCompare(displayValue(b.name));
      return isActiveLearner(a) ? -1 : 1;
    });
    return activeFirst;
  }, [caseloadLearners]);
  const learnerSelectOptions = useMemo<LearnerSelectOption[]>(() => [
    {
      value: 'all',
      label: 'All assigned learners',
      searchText: 'all assigned learners caseload all learners',
    },
    ...learnerOptions.map((learner) => ({
      value: displayValue(learner.id),
      label: learnerSelectLabel(learner),
      searchText: [
        displayValue(learner.name),
        learnerProgrammeLabel(learner),
        displayValue(learner.cohortName),
        displayValue(learner.group),
        displayValue(learner.email),
      ].join(' ').toLowerCase(),
    })),
  ], [learnerOptions]);
  const selectedLearner = useMemo(
    () => learnerOptions.find(learner => displayValue(learner.id) === options.learnerId) || null,
    [learnerOptions, options.learnerId],
  );
  const selectedLearnerOption = useMemo(
    () => learnerSelectOptions.find(option => option.value === options.learnerId) || learnerSelectOptions[0] || null,
    [learnerSelectOptions, options.learnerId],
  );
  const filteredLearnerOptions = useMemo(() => {
    const query = learnerSearch.trim().toLowerCase();
    if (!query) return learnerSelectOptions;
    return learnerSelectOptions.filter(option => (
      option.label.toLowerCase().includes(query) || option.searchText.includes(query)
    ));
  }, [learnerSearch, learnerSelectOptions]);
  const reportTypeMeta = REPORT_TYPE_META[options.reportType];
  const dateRangeInvalid = Boolean(options.fromDate && options.toDate && options.fromDate > options.toDate);
  const liveInclusionCount = INCLUSION_OPTIONS.filter(option => option.live && options.inclusions[option.key]).length;
  const pendingInclusionCount = INCLUSION_OPTIONS.filter(option => !option.live && options.inclusions[option.key]).length;
  const previewSections = useMemo(() => {
    if (!generatedReport) {
      return {
        sourceStatus: null as ReportSection | null,
        detailSection: null as ReportSection | null,
        bodySections: [] as ReportSection[],
      };
    }

    return {
      sourceStatus: generatedReport.sections.find(section => section.title === 'Source status') || null,
      detailSection: generatedReport.sections.find(section => section.title === 'Report details') || null,
      bodySections: generatedReport.sections.filter(section => section.title !== 'Source status' && section.title !== 'Report details'),
    };
  }, [generatedReport]);

  useEffect(() => {
    if (!learnerMenuOpen) return undefined;

    learnerSearchInputRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!learnerSelectRef.current?.contains(target)) {
        setLearnerMenuOpen(false);
        setLearnerSearch('');
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLearnerMenuOpen(false);
        setLearnerSearch('');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [learnerMenuOpen]);

  function updateOption<K extends keyof ReportOptions>(key: K, value: ReportOptions[K]) {
    setOptions(prev => ({ ...prev, [key]: value }));
  }

  function toggleInclusion(key: InclusionKey) {
    setOptions(prev => ({
      ...prev,
      inclusions: {
        ...prev.inclusions,
        [key]: !prev.inclusions[key],
      },
    }));
  }

  function handleGenerate() {
    if (loading || dateRangeInvalid || !caseloadLearners.length) return;
    setGeneratedReport(buildOtjhGeneratedReport(snapshot, options));
  }

  async function handleDownload(format: ExportFormat) {
    if (!generatedReport) return;
    updateOption('exportFormat', format);
    setDownloadState(format);
    try {
      await downloadGeneratedReport(generatedReport, format);
    } finally {
      setDownloadState(null);
    }
  }

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="OTJH Report Generator"
      pageSubtitle="Build compliance-ready OTJH evidence packs and preview them before export"
      userName={ownerName}
      userRole="Progress Coach"
    >
      <main className="min-h-screen bg-[#f7f6fb] p-4 md:p-6">
        <div className="w-full space-y-4">
          <section className="overflow-hidden rounded-2xl border border-primary-800/15 bg-white shadow-[0_12px_34px_rgba(48,24,90,0.1)]">
            <div
              className="px-6 py-7 text-white md:px-8 md:py-8"
              style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-xl backdrop-blur-sm">
                      <i className="ri-file-chart-line"></i>
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/85">
                      Compliance & Evidence
                    </span>
                  </div>
                  <h1 className="mt-5 text-[30px] font-heading font-bold tracking-tight text-white md:text-[36px]">OTJH report generator</h1>
                  <p className="mt-3 max-w-4xl text-sm leading-7 text-white/80 md:text-[15px]">
                    Build a Department for Education-compliant off-the-job training evidence report covering logged hours, KSB progression, coaching activity, review milestones and source availability across your caseload.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-[12px] text-white/80 backdrop-blur-sm">
                  Generate, preview, and export using the same coach workspace data you already have.
                </div>
              </div>
            </div>

          {(loading || warnings.length > 0) && (
            <div className={`mx-4 mt-4 rounded-xl border px-4 py-3 text-[12px] md:mx-5 ${warnings.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-foreground-200/60 bg-background-100/70 text-foreground-500'}`}>
              {loading ? 'Loading OTJH sources...' : `Some OTJH sources are unavailable right now: ${warnings.join(', ')}. Preview values will show ${EMPTY_VALUE} where needed.`}
            </div>
          )}

            <div className="bg-background-100/30 p-4 md:p-5">
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                <aside className="rounded-2xl border border-foreground-200/60 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <h2 className="text-2xl font-heading font-semibold text-foreground-950">Report parameters</h2>
                <p className="mt-2 text-sm leading-6 text-foreground-500">Select scope, period and inclusions for the OTJH preview.</p>
              </div>

              <div className="space-y-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground-700">Learner</span>
                  <div ref={learnerSelectRef} className="relative">
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={learnerMenuOpen}
                      onClick={() => {
                        setLearnerMenuOpen(current => !current);
                        setLearnerSearch('');
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-foreground-200 bg-white px-4 py-3 text-left text-[15px] text-foreground-900 shadow-sm outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                    >
                      <span className="truncate">{selectedLearnerOption?.label || 'Select learner'}</span>
                      <i className={`ri-arrow-down-s-line text-lg text-foreground-500 transition-transform ${learnerMenuOpen ? 'rotate-180' : ''}`}></i>
                    </button>

                    {learnerMenuOpen && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border border-foreground-200/70 bg-white p-2 shadow-xl shadow-foreground-950/10">
                        <div className="relative mb-2">
                          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
                          <input
                            ref={learnerSearchInputRef}
                            type="text"
                            value={learnerSearch}
                            onChange={(event) => setLearnerSearch(event.target.value)}
                            placeholder="Search learner, cohort, group..."
                            className="w-full rounded-xl border border-foreground-200 bg-white py-2.5 pl-9 pr-3 text-[14px] text-foreground-900 outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                          />
                        </div>

                        <div role="listbox" aria-label="Choose learner" className="max-h-64 overflow-y-auto rounded-xl">
                          {filteredLearnerOptions.map((option) => {
                            const active = option.value === options.learnerId;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                  updateOption('learnerId', option.value);
                                  setLearnerMenuOpen(false);
                                  setLearnerSearch('');
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                  active
                                    ? 'bg-primary-50 font-semibold text-primary-700'
                                    : 'text-foreground-700 hover:bg-background-100'
                                }`}
                              >
                                <span className="truncate">{option.label}</span>
                                {active ? <i className="ri-check-line text-base"></i> : null}
                              </button>
                            );
                          })}

                          {!filteredLearnerOptions.length && (
                            <div className="px-3 py-4 text-center text-[12px] text-foreground-400">
                              No learners match your search.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground-700">Report type</span>
                  <select
                    value={options.reportType}
                    onChange={(event) => updateOption('reportType', event.target.value as ReportType)}
                    className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-[15px] text-foreground-900 shadow-sm outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                  >
                    {Object.entries(REPORT_TYPE_META).map(([key, meta]) => (
                      <option key={key} value={key}>{meta.label}</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-foreground-700">From</span>
                    <input
                      type="date"
                      value={options.fromDate}
                      onChange={(event) => updateOption('fromDate', event.target.value)}
                      className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-[15px] text-foreground-900 shadow-sm outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-foreground-700">To</span>
                    <input
                      type="date"
                      value={options.toDate}
                      onChange={(event) => updateOption('toDate', event.target.value)}
                      className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-[15px] text-foreground-900 shadow-sm outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                </div>

                <div className="border-t border-foreground-200/70 pt-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-400">Inclusions</p>
                      <p className="mt-1 text-xs leading-5 text-foreground-500">{liveInclusionCount} live sections selected / {pendingInclusionCount} pending source</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {INCLUSION_OPTIONS.map(option => (
                      <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-foreground-200/60 bg-background-100/40 px-3 py-3 transition hover:border-primary-100 hover:bg-primary-50/50">
                        <input
                          type="checkbox"
                          checked={options.inclusions[option.key]}
                          onChange={() => toggleInclusion(option.key)}
                          className="mt-1 h-5 w-5 rounded border-foreground-300 text-primary-600 focus:ring-primary-200"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground-800">{option.label}</span>
                          <span className="mt-1 block text-[11px] text-foreground-500">
                            {option.live ? `Live from ${option.sourceLabel}` : `Awaiting ${option.sourceLabel}`}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border-t border-foreground-200/70 pt-5">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-foreground-700">Export format</span>
                    <select
                      value={options.exportFormat}
                      onChange={(event) => updateOption('exportFormat', event.target.value as ExportFormat)}
                      className="w-full rounded-xl border border-foreground-200 bg-white px-4 py-3 text-[15px] text-foreground-900 shadow-sm outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                    >
                      {Object.entries(EXPORT_FORMAT_META).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {selectedLearner && (
                  <div className="rounded-2xl border border-primary-100 bg-primary-50/70 px-4 py-3 text-[12px] leading-6 text-primary-800">
                    <p className="font-semibold text-primary-900">{displayValue(selectedLearner.name)}</p>
                    <p>{learnerScopeLabel(selectedLearner)}</p>
                  </div>
                )}

                {dateRangeInvalid && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                    The `From` date must be on or before the `To` date.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading || dateRangeInvalid || !caseloadLearners.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <i className={loading ? 'ri-loader-4-line animate-spin' : 'ri-file-chart-line'}></i>
                  {loading ? 'Loading OTJH sources' : 'Generate OTJH evidence report'}
                </button>
              </div>
            </aside>

                <section className="min-h-[720px] rounded-2xl border border-foreground-200/60 bg-white p-6 shadow-sm">
              {!generatedReport ? (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-primary-200 bg-primary-50/25 px-6 py-12 text-center">
                  <span className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-100 text-primary-500">
                    <i className="ri-file-transfer-line text-5xl"></i>
                  </span>
                  <h2 className="mt-8 text-3xl font-heading font-semibold text-foreground-950">{reportTypeMeta.title}</h2>
                  <p className="mt-4 max-w-2xl text-base leading-8 text-foreground-500">
                    Configure the parameters on the left, then click <span className="font-semibold text-foreground-700">Generate OTJH evidence report</span> to preview the report before export.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    {(Object.keys(EXPORT_FORMAT_META) as ExportFormat[]).map(format => (
                      <ExportChip
                        key={format}
                        format={format}
                        active={options.exportFormat === format}
                        onClick={() => updateOption('exportFormat', format)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <div className="mb-5 flex flex-col gap-4 border-b border-foreground-200/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-700">
                          {reportTypeMeta.label}
                        </span>
                        <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-500">
                          {generatedReport.period}
                        </span>
                      </div>
                      <h2 className="mt-4 text-3xl font-heading font-bold tracking-tight text-foreground-950">{generatedReport.title}</h2>
                      <p className="mt-2 text-sm leading-7 text-foreground-500">{generatedReport.subtitle}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(Object.keys(EXPORT_FORMAT_META) as ExportFormat[]).map(format => (
                        <ExportChip
                          key={format}
                          format={format}
                          active={options.exportFormat === format}
                          busy={downloadState === format}
                          onClick={() => { void handleDownload(format); }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mb-5 flex flex-wrap items-center gap-2 text-[11px] text-foreground-500">
                    <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 shadow-sm"><i className="ri-user-line mr-1 text-primary-500"></i>{generatedReport.coach}</span>
                    <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 shadow-sm"><i className="ri-calendar-line mr-1 text-primary-500"></i>{generatedReport.period}</span>
                    <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 shadow-sm"><i className="ri-time-line mr-1 text-primary-500"></i>{generatedReport.generatedAt}</span>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                    {previewSections.sourceStatus ? <PreviewStatusCard section={previewSections.sourceStatus} /> : null}
                    {previewSections.detailSection ? <PreviewDetailCard report={generatedReport} section={previewSections.detailSection} /> : null}
                    {previewSections.bodySections.map((section, index) => (
                      <PreviewSectionCard key={section.title} section={section} index={index + 1} />
                    ))}
                  </div>
                </div>
              )}
                </section>
              </div>
            </div>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
