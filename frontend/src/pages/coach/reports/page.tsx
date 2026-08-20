import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import {
  fetchLearnerDetail,
  type LearnerDetail,
  type LearnerKind,
} from '@/api/learnerDetail';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { buildLearnerJourney, type JourneyModule } from '@/utils/learnerJourney';
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  fetchCoachCalendarEvents,
  formatDateLabel,
  parseLocalDate,
} from '../shared/calendarEvents';
import type { GeneratedReport, ReportSection } from './types';

const coachNav = roleNavMap.coach;
const EMPTY_VALUE = '--';
const CASELOAD_ENDPOINT = '/coach_api/coach/caseload';
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';
const MARKING_QUEUE_ENDPOINT = '/coach_api/coach/marking-queue';
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
  | 'learnerReflections'
  | 'evidenceLinks'
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
  sourceLabel: string;
  scope: 'all' | 'single';
}

interface LearnerSelectOption {
  value: string;
  label: string;
  searchText: string;
}

interface MarkingQueueSubmission {
  learnerKind: string;
  learnerId: string;
  activityType: string;
  activityId: string;
  activityTitle: string;
  module: string;
  week: string;
  status: string;
  learningReflection: string;
  evidenceFiles: string[];
  qualityScore: number;
  coachFeedback: string | null;
  submittedAt: string | null;
  dateCompleted: string | null;
  actualTimeHours: string;
}

interface MarkingQueueResponse {
  items?: MarkingQueueSubmission[];
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

interface ReportKsbCoverageRow {
  code: string;
  category: string;
  description: string;
  linked: boolean;
  latestSeen: string | null;
}

interface ReportProgressEntry {
  at: string;
  module: string;
  week: string;
  activity: string;
  type: string;
  ksbs: string[];
  hoursLabel: string;
  minutes: number;
  status: string;
}

interface LearnerReportDetailContext {
  kind: LearnerKind;
  detail: LearnerDetail;
  journey: JourneyModule[];
  ksbRows: ReportKsbCoverageRow[];
  progressEntries: ReportProgressEntry[];
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
  { key: 'learnerReflections', label: 'Include learner reflections', sourceLabel: 'Coach marking queue', scope: 'single' },
  { key: 'evidenceLinks', label: 'Include evidence links', sourceLabel: 'Evidence portfolio records', scope: 'single' },
  { key: 'coachingSummaries', label: 'Include coaching meeting summaries', sourceLabel: 'Coach timetable events', scope: 'all' },
  { key: 'progressReviewSummaries', label: 'Include progress review summaries', sourceLabel: 'Progress review timetable events', scope: 'all' },
  { key: 'ksbProgression', label: 'Include KSB progression', sourceLabel: 'Caseload KSB fields', scope: 'all' },
  { key: 'quizResults', label: 'Include quiz results', sourceLabel: 'Learner quiz attempts', scope: 'single' },
  { key: 'checkpointResults', label: 'Include checkpoint results', sourceLabel: 'Learner checkpoint attempts', scope: 'single' },
];

const SINGLE_LEARNER_ONLY_INCLUSIONS = INCLUSION_OPTIONS
  .filter(option => option.scope === 'single')
  .map(option => option.key);

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

async function fetchCoachMarkingQueue(learnerId?: string, signal?: AbortSignal): Promise<MarkingQueueResponse> {
  const query = new URLSearchParams({ page_size: '100' });
  if (learnerId) query.set('learner', learnerId);
  const response = await coachFetch(`${MARKING_QUEUE_ENDPOINT}?${query}`, { signal });
  return readJson<MarkingQueueResponse>(response);
}

function sourceTable(headers: string[], rows: string[][]) {
  return {
    headers,
    rows: rows.length ? rows : [headers.map(() => EMPTY_VALUE)],
  };
}

function normalizeComponentType(value?: string | null) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function truncateText(value?: string | null, max = 88) {
  const text = String(value || '').trim();
  if (!text) return EMPTY_VALUE;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function listSummary(values: string[], max = 2) {
  const usable = values.map(value => displayValue(value)).filter(value => value !== EMPTY_VALUE);
  if (!usable.length) return EMPTY_VALUE;
  if (usable.length <= max) return usable.join(', ');
  return `${usable.slice(0, max).join(', ')} +${usable.length - max}`;
}

function reviewStatusLabel(value?: string | null) {
  const normalized = normalizeComponentType(value);
  if (!normalized) return EMPTY_VALUE;
  return ({
    pending: 'Pending review',
    accepted: 'Accepted',
    partial: 'Partial award',
    referred: 'Referred back',
    escalated: 'Escalated',
    rejected: 'Rejected',
    approved: 'Approved',
  } as Record<string, string>)[normalized] || titleCaseLabel(value);
}

function trainingPlanContextLabel(details?: EvidenceRecord['trainingPlanDetails'] | null) {
  const parts = [
    displayValue(details?.moduleTitle),
    displayValue(details?.weekTitle),
    displayValue(details?.componentTitle),
  ].filter(value => value !== EMPTY_VALUE);
  return parts.length ? parts.join(' / ') : EMPTY_VALUE;
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

function isPlaceholderDate(value?: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  const compact = normalized.split('T')[0].split(' ')[0];
  if (compact === '1899-11-30' || compact === '1900-01-01') return true;

  const parsed = parseLocalDate(normalized);
  return Boolean(parsed && parsed.getFullYear() <= 1900);
}

function formatDateTimeCell(value?: string | null) {
  if (isPlaceholderDate(value)) return EMPTY_VALUE;
  const label = formatDateLabel(value);
  return label === EMPTY_VALUE ? EMPTY_VALUE : label;
}

function normalizeKsbCode(value?: string | null) {
  return String(value || '').trim().toUpperCase().split('.')[0];
}

function categoryFromKsb(typeValue?: string | null, codeValue?: string | null) {
  const normalizedType = String(typeValue || '').trim().toLowerCase();
  const normalizedCode = normalizeKsbCode(codeValue);
  if (normalizedType.startsWith('k') || normalizedType.includes('knowledge') || normalizedCode.startsWith('K')) return 'Knowledge';
  if (normalizedType.startsWith('s') || normalizedType.includes('skill') || normalizedCode.startsWith('S')) return 'Skills';
  if (normalizedType.startsWith('b') || normalizedType.includes('behaviour') || normalizedCode.startsWith('B')) return 'Behaviours';
  return 'Other';
}

function titleCaseLabel(value?: string | null) {
  const normalized = String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ');
  if (!normalized) return 'Activity';
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function reportedMinutes(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 0;

  if (text.includes(':')) {
    const [minutesPart, secondsPart] = text.split(':');
    const minutes = Number(minutesPart);
    const seconds = Number(secondsPart);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return minutes + (seconds / 60);
    }
  }

  const hourMatch = text.match(/([\d.]+)\s*(?:h|hr|hour)/i);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  const minuteMatch = text.match(/([\d.]+)\s*(?:m|min|minute)/i);
  if (minuteMatch) return Number(minuteMatch[1]);

  const numberMatch = text.match(/\d+(?:\.\d+)?/);
  return numberMatch ? Number(numberMatch[0]) : 0;
}

function formatLoggedTime(reportedTime?: string | null, timeTaken?: string | null) {
  const reported = displayValue(reportedTime);
  if (reported !== EMPTY_VALUE) return reported;
  const tracked = displayValue(timeTaken);
  return tracked !== EMPTY_VALUE ? tracked : EMPTY_VALUE;
}

async function fetchAnyLearnerDetail(id: string) {
  const [commercial, apprenticeship] = await Promise.allSettled([
    fetchLearnerDetail('commercial', id),
    fetchLearnerDetail('apprenticeship', id),
  ]);

  if (commercial.status === 'fulfilled') {
    return { kind: 'commercial' as const, detail: commercial.value };
  }

  if (apprenticeship.status === 'fulfilled') {
    return { kind: 'apprenticeship' as const, detail: apprenticeship.value };
  }

  const commercialMessage = commercial.status === 'rejected' && commercial.reason instanceof Error
    ? commercial.reason.message
    : null;
  const apprenticeshipMessage = apprenticeship.status === 'rejected' && apprenticeship.reason instanceof Error
    ? apprenticeship.reason.message
    : null;
  const non404 = [commercialMessage, apprenticeshipMessage].find(message => message && !message.includes('404'));

  throw new Error(non404 || commercialMessage || apprenticeshipMessage || 'Could not load learner detail.');
}

function buildReportKsbCoverageRows(detail: LearnerDetail): ReportKsbCoverageRow[] {
  const detailKsbs = (detail.ksbs || []).map((ksb) => ({
    code: normalizeKsbCode(ksb.code),
    category: categoryFromKsb(ksb.type, ksb.code),
    description: String(ksb.description || '').trim() || EMPTY_VALUE,
  }));

  const ksbMap = new Map<string, { code: string; category: string; description: string }>();
  for (const item of detailKsbs) {
    if (!item.code) continue;
    ksbMap.set(item.code, item);
  }

  if (!ksbMap.size) {
    for (const component of detail.components || []) {
      for (const mapping of component.ksbMappings || []) {
        const code = normalizeKsbCode(mapping.code);
        if (!code || ksbMap.has(code)) continue;
        ksbMap.set(code, {
          code,
          category: categoryFromKsb(mapping.classification, code),
          description: String(mapping.description || '').trim() || `Mapped KSB ${code}`,
        });
      }
    }
  }

  const touched = new Set<string>();
  const latestByCode = new Map<string, string>();
  for (const attempt of detail.quizAttempts || []) {
    for (const rawCode of attempt.ksbs || []) {
      const code = normalizeKsbCode(rawCode);
      if (!code) continue;
      touched.add(code);
      const currentLatest = latestByCode.get(code);
      if (!currentLatest || attempt.submittedAt > currentLatest) {
        latestByCode.set(code, attempt.submittedAt);
      }
    }
  }

  return Array.from(ksbMap.values())
    .map((item) => ({
      ...item,
      linked: touched.has(item.code),
      latestSeen: latestByCode.get(item.code) || null,
    }))
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }));
}

function buildReportProgressEntries(detail: LearnerDetail): ReportProgressEntry[] {
  const componentById = new Map(
    (detail.components || [])
      .filter(component => displayValue(component.componentId) !== EMPTY_VALUE)
      .map(component => [String(component.componentId), component] as const),
  );
  const componentByQuizId = new Map(
    (detail.components || [])
      .filter(component => component.quizMeta?.quizId != null)
      .map(component => [String(component.quizMeta?.quizId), component] as const),
  );
  const entries: ReportProgressEntry[] = [];

  for (const attempt of detail.quizAttempts || []) {
    const component = componentByQuizId.get(String(attempt.quizId));
    entries.push({
      at: attempt.submittedAt,
      module: displayValue(component?.module),
      week: displayValue(component?.week),
      activity: displayValue(component?.component) !== EMPTY_VALUE ? displayValue(component?.component) : `Quiz ${attempt.quizId}`,
      type: 'Quiz',
      ksbs: (attempt.ksbs || []).map(code => normalizeKsbCode(code)).filter(Boolean),
      hoursLabel: formatLoggedTime(attempt.reportedTime, attempt.timeTaken),
      minutes: reportedMinutes(attempt.reportedTime || attempt.timeTaken || ''),
      status: attempt.passed ? 'Passed' : 'Attempted',
    });
  }

  for (const video of detail.videoProgress || []) {
    const component = componentById.get(String(video.componentId));
    entries.push({
      at: video.submittedAt,
      module: displayValue(component?.module),
      week: displayValue(component?.week),
      activity: displayValue(component?.component) !== EMPTY_VALUE ? displayValue(component?.component) : 'Video',
      type: 'Video',
      ksbs: (video.ksbs || []).map(code => normalizeKsbCode(code)).filter(Boolean),
      hoursLabel: formatLoggedTime(video.reportedTime, video.timeTaken),
      minutes: reportedMinutes(video.reportedTime || video.timeTaken || ''),
      status: 'Completed',
    });
  }

  for (const progress of detail.componentProgress || []) {
    const component = componentById.get(String(progress.componentId));
    entries.push({
      at: progress.submittedAt,
      module: displayValue(component?.module),
      week: displayValue(component?.week),
      activity: displayValue(component?.component) !== EMPTY_VALUE
        ? displayValue(component?.component)
        : titleCaseLabel(progress.componentType),
      type: titleCaseLabel(progress.componentType),
      ksbs: (progress.ksbs || []).map(code => normalizeKsbCode(code)).filter(Boolean),
      hoursLabel: formatLoggedTime(progress.reportedTime, progress.timeTaken),
      minutes: reportedMinutes(progress.reportedTime || progress.timeTaken || ''),
      status: 'Completed',
    });
  }

  return entries.sort((left, right) => right.at.localeCompare(left.at));
}

function buildDetailedReportContext(kind: LearnerKind, detail: LearnerDetail): LearnerReportDetailContext {
  return {
    kind,
    detail,
    journey: buildLearnerJourney(detail),
    ksbRows: buildReportKsbCoverageRows(detail),
    progressEntries: buildReportProgressEntries(detail),
  };
}

function formatKsbList(codes: string[]) {
  const uniqueCodes = Array.from(new Set(codes.map(code => normalizeKsbCode(code)).filter(Boolean)));
  if (!uniqueCodes.length) return EMPTY_VALUE;
  if (uniqueCodes.length <= 4) return uniqueCodes.join(', ');
  return `${uniqueCodes.slice(0, 4).join(', ')} +${uniqueCodes.length - 4}`;
}

function ksbCoverageStatus(linked: number, total: number) {
  if (!total || linked === 0) return 'Not evidenced';
  if (linked >= total) return 'Evidence linked';
  return 'Partial coverage';
}

function latestKsbSeen(rows: ReportKsbCoverageRow[]) {
  const dates = rows
    .map(row => row.latestSeen)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left));
  return dates[0] || null;
}

function buildKsbProgressSummaryRows(rows: ReportKsbCoverageRow[]) {
  const summaryRows: string[][] = [];
  const overallLinked = rows.filter(row => row.linked).length;
  const overallLatest = latestKsbSeen(rows);

  summaryRows.push([
    'Overall KSB',
    formatCount(overallLinked),
    formatCount(rows.length),
    formatPercent(rows.length ? Math.round((overallLinked / rows.length) * 100) : 0),
    ksbCoverageStatus(overallLinked, rows.length),
    formatDateTimeCell(overallLatest),
  ]);

  ['Knowledge', 'Skills', 'Behaviours'].forEach((category) => {
    const categoryRows = rows.filter(row => row.category === category);
    const linked = categoryRows.filter(row => row.linked).length;
    summaryRows.push([
      category,
      formatCount(linked),
      formatCount(categoryRows.length),
      formatPercent(categoryRows.length ? Math.round((linked / categoryRows.length) * 100) : 0),
      ksbCoverageStatus(linked, categoryRows.length),
      formatDateTimeCell(latestKsbSeen(categoryRows)),
    ]);
  });

  return summaryRows;
}

function buildProgrammeKsbDetailRows(rows: ReportKsbCoverageRow[]) {
  return rows
    .filter(row => row.linked)
    .map((row) => ([
    row.code,
    row.category,
    row.description,
    'Evidence linked',
    formatDateTimeCell(row.latestSeen),
  ]));
}

function buildJourneyWeeklyRows(
  journey: JourneyModule[],
  progressEntries: ReportProgressEntry[],
  fromDate: string,
  toDate: string,
) {
  const byWeekKey = new Map<string, ReportProgressEntry[]>();
  const weekKey = (module: string, week: string) => `${normalizeIdentity(module)}::${normalizeIdentity(week)}`;

  progressEntries
    .filter(entry => isDateWithinRange(entry.at, fromDate, toDate))
    .forEach((entry) => {
    const module = displayValue(entry.module);
    const week = displayValue(entry.week);
    if (module === EMPTY_VALUE || week === EMPTY_VALUE) return;
    const key = weekKey(module, week);
    const bucket = byWeekKey.get(key) || [];
    bucket.push(entry);
    byWeekKey.set(key, bucket);
    });

  const rows = journey.flatMap((module) =>
    module.weeks.map((week) => {
      const matchedEntries = byWeekKey.get(weekKey(module.module, week.week)) || [];
      if (!matchedEntries.length) return null;
      const linkedMinutes = matchedEntries.reduce((sum, entry) => sum + entry.minutes, 0);
      const linkedKsbs = matchedEntries.flatMap(entry => entry.ksbs);
      return [
        module.module,
        week.week,
        formatCount(week.components.length),
        formatCount(week.components.filter(component => component.isQuiz).length),
        formatHours(week.otjh || null),
        matchedEntries.length ? formatHours(linkedMinutes / 60) : EMPTY_VALUE,
        formatKsbList(linkedKsbs),
        'Evidence linked',
      ];
    }).filter((row): row is string[] => Boolean(row)),
  );

  return rows.length ? rows : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
}

function buildAssessmentRows(
  detailContext: LearnerReportDetailContext,
  fromDate: string,
  toDate: string,
  assessmentType: 'quiz' | 'checkpoint',
) {
  const componentByQuizId = new Map(
    (detailContext.detail.components || [])
      .filter(component => component.quizMeta?.quizId != null)
      .map(component => [String(component.quizMeta?.quizId), component] as const),
  );

  const rows = (detailContext.detail.quizAttempts || [])
    .filter((attempt) => {
      if (!isDateWithinRange(attempt.submittedAt, fromDate, toDate)) return false;
      const componentType = normalizeComponentType(componentByQuizId.get(String(attempt.quizId))?.type);
      if (assessmentType === 'checkpoint') return componentType === 'checkpoint';
      return componentType !== 'checkpoint';
    })
    .slice(0, REPORT_LIMIT)
    .map((attempt) => {
      const component = componentByQuizId.get(String(attempt.quizId));
      const grade = Number(attempt.grade);
      const percentLabel = Number.isFinite(grade)
        ? `${Math.round(grade <= 1 ? grade * 100 : grade)}%`
        : EMPTY_VALUE;
      const scoreLabel = attempt.achievedScore != null && attempt.totalScore != null
        ? `${attempt.achievedScore}/${attempt.totalScore}`
        : percentLabel;
      return [
        formatDateLabel(attempt.submittedAt),
        displayValue(component?.week),
        displayValue(component?.component) !== EMPTY_VALUE ? displayValue(component?.component) : `Assessment ${attempt.quizId}`,
        scoreLabel,
        attempt.passed ? 'Passed' : 'Attempted',
        formatKsbList(attempt.ksbs || []),
        formatLoggedTime(attempt.reportedTime, attempt.timeTaken),
        displayValue(component?.module),
      ];
    });

  return rows.length ? rows : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
}

function buildReflectionRows(submissions: MarkingQueueSubmission[], fromDate: string, toDate: string) {
  const rows = submissions
    .filter(submission => isDateWithinRange(submission.submittedAt || submission.dateCompleted, fromDate, toDate))
    .sort((left, right) => String(right.submittedAt || right.dateCompleted || '').localeCompare(String(left.submittedAt || left.dateCompleted || '')))
    .slice(0, REPORT_LIMIT)
    .map((submission) => ([
      formatDateLabel(submission.submittedAt || submission.dateCompleted),
      displayValue(submission.activityTitle),
      displayValue(submission.module),
      displayValue(submission.week),
      reviewStatusLabel(submission.status),
      submission.qualityScore ? `${submission.qualityScore}/100` : EMPTY_VALUE,
      listSummary(submission.evidenceFiles),
      truncateText(submission.learningReflection),
    ]));

  return rows.length ? rows : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
}

function buildEvidenceLinkRows(records: EvidenceRecord[], fromDate: string, toDate: string) {
  const rows = records
    .filter(record => isDateWithinRange(record.uploadedAt, fromDate, toDate))
    .slice(0, REPORT_LIMIT)
    .map((record) => ([
      formatDateLabel(record.uploadedAt),
      displayValue(record.filename),
      reviewStatusLabel(record.status),
      displayValue(record.sectionRef),
      trainingPlanContextLabel(record.trainingPlanDetails),
    ]));

  return rows.length ? rows : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
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
  return `${learnerLabel} has ${loggedHours} logged OTJH against ${targetHours} for ${reportPeriod}. Attendance is ${attendance}, KSB progress is ${ksb}, and OTJH status is ${otjhStatus}. The selected period contains ${coachingCount} coaching meeting entries and ${reviewCount} progress review entries. Live risk markers currently show ${flags}. Detailed learner sections use only the connected sources selected for this export.`;
}

function buildSourceStatusSection(snapshot: LiveReportSnapshot, additionalWarnings: string[] = []): ReportSection | null {
  const warnings = Array.from(new Set([...snapshot.warnings, ...additionalWarnings].filter(Boolean)));
  if (!warnings.length) return null;
  return {
    title: 'Source status',
    content: 'Some live sources could not be loaded, so affected values are shown as -- in this preview.',
    table: sourceTable(
      ['Source', 'Status'],
      warnings.map(source => [source, 'Unavailable']),
    ),
  };
}

function buildOtjhGeneratedReport(
  snapshot: LiveReportSnapshot,
  options: ReportOptions,
  detailContext: LearnerReportDetailContext | null = null,
  reflectionSubmissions: MarkingQueueSubmission[] = [],
  evidenceRecords: EvidenceRecord[] = [],
  additionalWarnings: string[] = [],
): GeneratedReport {
  const meta = REPORT_TYPE_META[options.reportType];
  const selectedLearners = options.learnerId === 'all'
    ? snapshot.caseloadLearners
    : snapshot.caseloadLearners.filter(learner => displayValue(learner.id) === options.learnerId);
  const selectedLearner = options.learnerId === 'all' ? null : selectedLearners[0] || null;
  const detail = detailContext?.detail || null;
  const selectedLearnerLabel = detail
    ? displayValue(detail.name)
    : options.learnerId === 'all'
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
      : displayValue(detail?.programmeStatus) !== EMPTY_VALUE
        ? displayValue(detail?.programmeStatus)
      : normalisedStatusLabel(selectedLearner.otjhStatus)
    : `${selectedLearners.length} learners in scope`;
  const detailMetrics = [
    { label: 'Learner', value: selectedLearnerLabel },
    {
      label: 'Apprenticeship Standard',
      value: detail
        ? displayValue(detail.programme)
        : selectedLearner
          ? learnerProgrammeLabel(selectedLearner)
          : 'Multiple programmes',
    },
    {
      label: 'Employer',
      value: detail
        ? displayValue(detail.employer)
        : selectedLearner
          ? displayValue(selectedLearner.employer)
        : `${Array.from(new Set(selectedLearners.map(learner => displayValue(learner.employer)).filter(value => value !== EMPTY_VALUE))).length} employers`,
    },
    { label: 'Line Manager', value: detail ? displayValue(detail.lineManager) : EMPTY_VALUE },
    { label: 'Coach', value: selectedLearner ? (displayValue(selectedLearner.coachName) === EMPTY_VALUE ? snapshot.ownerName : displayValue(selectedLearner.coachName)) : snapshot.ownerName },
    { label: 'Tutor', value: firstTutor },
    { label: 'Practical Period Start', value: selectedLearner ? formatDateTimeCell(selectedLearner.startDate || selectedLearner.lastAttendanceDate) : EMPTY_VALUE },
    { label: 'Expected End', value: selectedLearner ? formatDateTimeCell(selectedLearner.plannedEndDate || selectedLearner.lastCoachingSession) : EMPTY_VALUE },
    { label: 'Gateway', value: selectedLearner ? formatDateTimeCell(selectedLearner.gatewayReviewDate || selectedLearner.lastProgressReview || selectedLearner.lastReview) : EMPTY_VALUE },
    { label: 'Report Period', value: reportPeriod },
    { label: 'Status', value: learnerStatus },
  ];
  const weeklyRanges = buildWeeklyRanges(options.fromDate, options.toDate);
  const weeklyHeaders = detailContext
    ? ['Module', 'Week', 'Components', 'Quizzes', 'Planned OTJH', 'Logged Activity', 'KSBs', 'Status']
    : ['Week', 'Dates', 'Topic', 'Planned', 'Logged', 'Validated', 'KSBs', 'Status'];
  const weeklyRows = detailContext
    ? buildJourneyWeeklyRows(detailContext.journey, detailContext.progressEntries, options.fromDate, options.toDate)
    : (weeklyRanges.length ? weeklyRanges : [{ label: 'Week 1', from: options.fromDate, to: options.toDate }]).map(range => [
        range.label,
        `${formatDateLabel(range.from)} - ${formatDateLabel(range.to)}`,
        EMPTY_VALUE,
        EMPTY_VALUE,
        EMPTY_VALUE,
        EMPTY_VALUE,
        EMPTY_VALUE,
        EMPTY_VALUE,
      ]);
  const ksbRows = detailContext
    ? buildKsbProgressSummaryRows(detailContext.ksbRows)
    : selectedLearner
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
  const programmeKsbRows = detailContext ? buildProgrammeKsbDetailRows(detailContext.ksbRows) : [];
  const quizRows = detailContext
    ? buildAssessmentRows(detailContext, options.fromDate, options.toDate, 'quiz')
    : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
  const checkpointRows = detailContext
    ? buildAssessmentRows(detailContext, options.fromDate, options.toDate, 'checkpoint')
    : [[EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE]];
  const reflectionRows = buildReflectionRows(reflectionSubmissions, options.fromDate, options.toDate);
  const evidenceLinkRows = buildEvidenceLinkRows(evidenceRecords, options.fromDate, options.toDate);
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
  if (detailContext?.progressEntries[0]) {
    auditRows.push(['Latest learner progress activity', selectedLearnerLabel, formatDateTimeCell(detailContext.progressEntries[0].at)]);
  }
  if (coachingEvents[0]) {
    auditRows.push(['Latest coaching event in selected range', snapshot.ownerName, formatDateLabel(eventDisplayDate(coachingEvents[coachingEvents.length - 1]))]);
  }
  const sourceStatus = buildSourceStatusSection(snapshot, additionalWarnings);
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
        { label: 'Coaching meetings', value: formatCount(coachingEvents.length) },
        { label: 'Progress reviews', value: formatCount(reviewEvents.length) },
        { label: 'Shortfall', value: formatHours(totalShortfall) },
        { label: 'Attendance', value: attendanceValue },
        { label: 'KSB Progress', value: ksbValue },
      ],
    },
    {
      title: 'Coach / tutor validation',
      content: 'Reviewer identities below come from the live coach snapshot and timetable records used for this report.',
      table: sourceTable(
        ['Field', 'Value'],
        [
          ['Reviewer', selectedLearner ? (displayValue(selectedLearner.coachName) === EMPTY_VALUE ? snapshot.ownerName : displayValue(selectedLearner.coachName)) : snapshot.ownerName],
          ['Tutor', firstTutor],
        ],
      ),
    },
    {
      title: 'Employer contact',
      content: 'Employer contact details come directly from the learner source when they are available.',
      table: sourceTable(
        ['Field', 'Value'],
        [
          ['Employer', selectedLearner ? displayValue(selectedLearner.employer) : EMPTY_VALUE],
          ['Employer email', selectedLearner ? displayValue(selectedLearner.employerEmail) : EMPTY_VALUE],
          ['Employer phone', selectedLearner ? displayValue(selectedLearner.employerPhone) : EMPTY_VALUE],
        ],
      ),
    },
    {
      title: 'Weekly OTJH breakdown',
      content: detailContext
        ? 'These rows show only learner journey weeks with live progress activity inside the selected report period.'
        : 'Weekly OTJH line items are not available from the current live sources, so this structure is rendered with the selected dates and -- placeholders.',
      table: sourceTable(
        weeklyHeaders,
        weeklyRows,
      ),
    },
  ];

  if (options.inclusions.ksbProgression) {
    sections.push({
      title: 'KSB progression',
      content: detailContext
        ? 'This summary mirrors the learner case file view, showing how many programme KSBs currently surface evidence links in the live learner snapshot.'
        : 'Per-KSB codes are not exposed by the current live source, so this section shows the aggregated Knowledge / Skills / Behaviours values available today.',
      table: sourceTable(['Area', 'Completed', 'Target', 'Progress', 'Status', 'Last updated'], ksbRows),
    });

    if (detailContext && programmeKsbRows.length) {
      sections.push({
        title: 'Programme KSB evidence detail',
        content: 'Only programme KSBs with live evidence linked in the learner snapshot are listed below.',
        table: sourceTable(
          ['Code', 'Category', 'Description', 'Evidence status', 'Last seen'],
          programmeKsbRows,
        ),
      });
    }
  }

  if (options.inclusions.evidenceLinks) {
    sections.push({
      title: 'Evidence links',
      content: 'Evidence rows list the uploaded portfolio records stored against this learner inside the selected report period.',
      table: sourceTable(
        ['Uploaded', 'File', 'Status', 'Section ref', 'Training plan'],
        evidenceLinkRows,
      ),
    });
  }

  if (options.inclusions.learnerReflections) {
    sections.push({
      title: 'Learner reflections',
      content: 'Reflection submissions are pulled from the live coach marking queue and filtered to this learner and report period.',
      table: sourceTable(
        ['Submitted', 'Activity', 'Module', 'Week', 'Status', 'Quality', 'Evidence files', 'Summary'],
        reflectionRows,
      ),
    });
  }

  if (options.inclusions.quizResults) {
    sections.push({
      title: 'Quiz results',
      content: detailContext
        ? 'Quiz rows below include only learner attempts matched to non-checkpoint assessment components in the selected period.'
        : 'Learner assessment detail could not be loaded for this report, so quiz rows are unavailable right now.',
      table: sourceTable(
        ['Date', 'Week', 'Assessment', 'Score', 'Result', 'KSBs', 'Hours', 'Module'],
        quizRows,
      ),
    });
  }

  if (options.inclusions.checkpointResults) {
    sections.push({
      title: 'Checkpoint results',
      content: detailContext
        ? 'Checkpoint rows below include only learner attempts matched to checkpoint assessment components in the selected period.'
        : 'Learner assessment detail could not be loaded for this report, so checkpoint rows are unavailable right now.',
      table: sourceTable(
        ['Date', 'Week', 'Assessment', 'Score', 'Result', 'KSBs', 'Hours', 'Module'],
        checkpointRows,
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

  sections.push({
    title: 'Coach approval & lock',
    content: 'Locking the report stores this version with a dated signature in the learner evidence file.',
    approval: {
      checklistLabel: 'I have reviewed the learner declaration, validated the hours, and approve this OTJH report.',
      actions: [
        { label: 'Sign & lock report v1.0', kind: 'download-pdf' },
        { label: 'Send to learner for declaration', kind: 'workflow' },
        { label: 'Send to employer for confirmation', kind: 'workflow' },
        { label: 'Send to compliance', kind: 'workflow' },
      ],
    },
  });

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

function buildTabularExportRows(report: GeneratedReport): string[][] {
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
    if (section.approval) {
      rows.push(['Approval checklist', section.approval.checklistLabel]);
      visibleApprovalActions(section.approval.actions).forEach(action => rows.push(['Workflow action', action.label]));
    }
    rows.push([]);
  });

  return rows;
}

function workbookSheetName(input: string, used: Set<string>) {
  const base = input
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';

  let next = base;
  let counter = 2;
  while (used.has(next)) {
    const suffix = ` ${counter}`;
    next = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    counter += 1;
  }
  used.add(next);
  return next;
}

function buildSectionSheetRows(section: ReportSection): string[][] {
  const rows: string[][] = [[section.title]];
  if (section.content) rows.push([section.content]);
  if (section.metrics?.length) {
    rows.push([]);
    rows.push(['Metric', 'Value']);
    section.metrics.forEach(metric => rows.push([metric.label, metric.value]));
  }
  if (section.table) {
    rows.push([]);
    rows.push(section.table.headers);
    section.table.rows.forEach(row => rows.push(row));
  }
  if (section.chart) {
    rows.push([]);
    rows.push(['Chart type', section.chart.type]);
    rows.push(['Label', ...section.chart.labels]);
    section.chart.datasets.forEach(dataset => rows.push([dataset.label, ...dataset.values.map(String)]));
  }
  if (section.findings?.length) {
    rows.push([]);
    rows.push(['Counts as OTJH']);
    section.findings.forEach(item => rows.push([item]));
  }
  if (section.recommendations?.length) {
    rows.push([]);
    rows.push(['Does not count as OTJH']);
    section.recommendations.forEach(item => rows.push([item]));
  }
  if (section.approval) {
    rows.push([]);
    rows.push(['Approval checklist', section.approval.checklistLabel]);
    visibleApprovalActions(section.approval.actions).forEach(action => rows.push(['Workflow action', action.label]));
  }
  return rows;
}

function downloadWorkbook(filename: string, report: GeneratedReport) {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildTabularExportRows(report)),
    workbookSheetName('Overview', usedNames),
  );

  report.sections.forEach((section) => {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(buildSectionSheetRows(section)),
      workbookSheetName(section.title, usedNames),
    );
  });

  XLSX.writeFile(workbook, filename, { compression: true });
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
      ${section.approval ? `
        <div style="margin-top:12px;">
          <div style="display:flex;align-items:flex-start;gap:10px;border:1px solid #dbe4f0;border-radius:14px;padding:12px 14px;background:#f8fafc;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:2px solid #94a3b8;border-radius:999px;font-size:11px;color:#64748b;"> </span>
            <p style="margin:0;color:#334155;line-height:1.7;">${section.approval.checklistLabel}</p>
          </div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">
            ${visibleApprovalActions(section.approval.actions).map(action => `<span style="display:inline-flex;align-items:center;border:1px solid #cbd5e1;border-radius:12px;padding:8px 12px;background:#f8fafc;color:#334155;font-weight:600;font-size:12px;">${action.label}</span>`).join('')}
          </div>
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

function renderStyledPdfReport(document: jsPDF, report: GeneratedReport) {
  const colors = {
    ink: [15, 23, 42] as const,
    body: [51, 65, 85] as const,
    muted: [100, 116, 139] as const,
    accent: [82, 82, 91] as const,
    accentDeep: [39, 39, 42] as const,
    accentSoft: [244, 244, 245] as const,
    border: [228, 228, 231] as const,
    panel: [250, 250, 250] as const,
    white: [255, 255, 255] as const,
    green: [5, 150, 105] as const,
    amber: [217, 119, 6] as const,
    red: [220, 38, 38] as const,
  };
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const marginX = 42;
  const topMargin = 52;
  const bottomMargin = 42;
  const contentWidth = pageWidth - (marginX * 2);
  const rowGap = 12;
  let y = topMargin;

  const setTextColor = (color: readonly [number, number, number]) => document.setTextColor(...color);
  const setDrawColor = (color: readonly [number, number, number]) => document.setDrawColor(...color);
  const setFillColor = (color: readonly [number, number, number]) => document.setFillColor(...color);
  const valueText = (value?: string | null) => {
    const text = String(value || '').trim();
    return text ? text : EMPTY_VALUE;
  };
  const statusColor = (value?: string | null) => {
    const normalized = valueText(value).toLowerCase();
    if (
      normalized.includes('risk')
      || normalized.includes('rejected')
      || normalized.includes('declined')
      || normalized.includes('unavailable')
      || normalized.includes('overdue')
    ) return colors.red;
    if (
      normalized.includes('pending')
      || normalized.includes('partial')
      || normalized.includes('developing')
      || normalized.includes('attention')
    ) return colors.amber;
    if (
      normalized.includes('accepted')
      || normalized.includes('approved')
      || normalized.includes('validated')
      || normalized.includes('complete')
      || normalized.includes('active')
      || normalized.includes('on track')
      || normalized.includes('strong')
    ) return colors.green;
    if (normalized === EMPTY_VALUE.toLowerCase()) return colors.muted;
    return colors.ink;
  };
  const wrapText = (text: string, width: number, fontSize: number, style: 'normal' | 'bold' = 'normal') => {
    document.setFont('helvetica', style);
    document.setFontSize(fontSize);
    return document.splitTextToSize(valueText(text), width);
  };
  const runningHeader = () => {
    setTextColor(colors.muted);
    document.setFont('helvetica', 'bold');
    document.setFontSize(9);
    document.text(report.title.toUpperCase(), marginX, 28);
    document.setFont('helvetica', 'normal');
    document.text(report.period, pageWidth - marginX, 28, { align: 'right' });
    setDrawColor(colors.border);
    document.setLineWidth(1);
    document.line(marginX, 36, pageWidth - marginX, 36);
  };
  const addPage = () => {
    document.addPage('a4', 'portrait');
    runningHeader();
    y = 54;
  };
  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - bottomMargin) addPage();
  };
  const drawParagraph = (text: string, fontSize = 10.5, color = colors.body, leading = 1.45) => {
    const lines = wrapText(text, contentWidth, fontSize, 'normal');
    const height = Math.max(fontSize * leading, lines.length * fontSize * leading);
    ensureSpace(height);
    document.setFont('helvetica', 'normal');
    document.setFontSize(fontSize);
    setTextColor(color);
    document.text(lines, marginX, y);
    y += height;
  };
  const drawSectionTitle = (title: string) => {
    ensureSpace(34);
    setFillColor(colors.accentSoft);
    document.roundedRect(marginX, y, contentWidth, 26, 10, 10, 'F');
    document.setFont('helvetica', 'bold');
    document.setFontSize(13);
    setTextColor(colors.ink);
    document.text(title, marginX + 14, y + 17);
    y += 38;
  };
  const drawMetaPill = (x: number, top: number, width: number, height: number, label: string, value: string) => {
    const valueLines = wrapText(value, width - 20, 10, 'bold');
    setFillColor(colors.white);
    document.roundedRect(x, top, width, height, 11, 11, 'F');
    document.setLineWidth(0.8);
    setDrawColor(colors.border);
    document.roundedRect(x, top, width, height, 11, 11, 'S');
    document.setFont('helvetica', 'bold');
    document.setFontSize(7.5);
    setTextColor(colors.muted);
    document.text(label.toUpperCase(), x + 10, top + 13);
    document.setFont('helvetica', 'bold');
    document.setFontSize(10);
    setTextColor(colors.ink);
    document.text(valueLines, x + 10, top + 28);
  };
  const drawMetricCards = (metrics: { label: string; value: string }[], columns = 2) => {
    if (!metrics.length) return;
    const gap = 10;
    const cardWidth = (contentWidth - (gap * (columns - 1))) / columns;
    let index = 0;
    while (index < metrics.length) {
      const rowMetrics = metrics.slice(index, index + columns);
      const cardHeights = rowMetrics.map((metric) => {
        const labelLines = wrapText(metric.label, cardWidth - 22, 7.5, 'bold');
        const valueLines = wrapText(metric.value, cardWidth - 22, 13, 'bold');
        return 24 + (labelLines.length * 9) + (valueLines.length * 15);
      });
      const rowHeight = Math.max(...cardHeights, 58);
      ensureSpace(rowHeight);
      rowMetrics.forEach((metric, metricIndex) => {
        const x = marginX + ((cardWidth + gap) * metricIndex);
        setFillColor(colors.white);
        document.roundedRect(x, y, cardWidth, rowHeight, 12, 12, 'F');
        setDrawColor(colors.border);
        document.setLineWidth(0.9);
        document.roundedRect(x, y, cardWidth, rowHeight, 12, 12, 'S');

        const labelLines = wrapText(metric.label, cardWidth - 22, 7.5, 'bold');
        const valueLines = wrapText(metric.value, cardWidth - 22, 13, 'bold');
        document.setFont('helvetica', 'bold');
        document.setFontSize(7.5);
        setTextColor(colors.muted);
        document.text(labelLines, x + 11, y + 20);

        document.setFont('helvetica', 'bold');
        document.setFontSize(13);
        setTextColor(statusColor(metric.value));
        document.text(valueLines, x + 11, y + 20 + (labelLines.length * 9) + 11);
      });
      y += rowHeight + rowGap;
      index += columns;
    }
  };
  const tableWeights = (headers: string[]) => {
    const weights = headers.map((header) => {
      const normalized = header.toLowerCase();
      if (normalized.includes('summary') || normalized.includes('description') || normalized.includes('content')) return 2.6;
      if (normalized.includes('activity') || normalized.includes('module') || normalized.includes('training') || normalized.includes('participants')) return 1.7;
      if (normalized.includes('file') || normalized.includes('section')) return 1.6;
      if (normalized.includes('status') || normalized.includes('result') || normalized.includes('quality') || normalized.includes('score')) return 1.05;
      if (normalized.includes('date') || normalized.includes('week') || normalized.includes('hours')) return 0.95;
      if (normalized.includes('ksb')) return 1.15;
      return 1.2;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => (weight / total) * contentWidth);
  };
  const drawTable = (headers: string[], rows: string[][]) => {
    if (!headers.length) return;
    const widths = tableWeights(headers);
    const headerFontSize = headers.length >= 7 ? 7.2 : 8.2;
    const bodyFontSize = headers.length >= 7 ? 7 : 8.4;
    const lineHeight = headers.length >= 7 ? 8.3 : 9.6;
    const paddingX = 5;
    const paddingY = 4;

    const drawHeaderRow = () => {
      const headerLines = headers.map((header, index) => wrapText(header, widths[index] - (paddingX * 2), headerFontSize, 'bold'));
      const headerHeight = Math.max(22, ...headerLines.map(lines => (lines.length * lineHeight) + (paddingY * 2)));
      ensureSpace(headerHeight);
      let x = marginX;
      headers.forEach((_, index) => {
        setFillColor(colors.accentSoft);
        setDrawColor(colors.border);
        document.rect(x, y, widths[index], headerHeight, 'FD');
        document.setFont('helvetica', 'bold');
        document.setFontSize(headerFontSize);
        setTextColor(colors.ink);
        document.text(headerLines[index], x + paddingX, y + paddingY + headerFontSize);
        x += widths[index];
      });
      y += headerHeight;
    };

    drawHeaderRow();
    rows.forEach((row, rowIndex) => {
      const normalizedRow = headers.map((_, index) => valueText(String(row[index] ?? '')).replace(/\s*\|\s*/g, ' - '));
      const cellLines = normalizedRow.map((cell, index) => wrapText(cell, widths[index] - (paddingX * 2), bodyFontSize, 'normal'));
      const rowHeight = Math.max(18, ...cellLines.map(lines => (lines.length * lineHeight) + (paddingY * 2)));
      if (y + rowHeight > pageHeight - bottomMargin) {
        addPage();
        drawHeaderRow();
      }
      let x = marginX;
      normalizedRow.forEach((cell, index) => {
        setFillColor(rowIndex % 2 === 0 ? colors.white : colors.panel);
        setDrawColor(colors.border);
        document.rect(x, y, widths[index], rowHeight, 'FD');
        document.setFont('helvetica', 'normal');
        document.setFontSize(bodyFontSize);
        setTextColor(statusColor(cell));
        document.text(cellLines[index], x + paddingX, y + paddingY + bodyFontSize);
        x += widths[index];
      });
      y += rowHeight;
    });
    y += rowGap;
  };
  const drawListBlock = (heading: string, items: string[], color: readonly [number, number, number], fill: readonly [number, number, number]) => {
    if (!items.length) return;
    ensureSpace(32);
    setFillColor(fill);
    document.roundedRect(marginX, y, contentWidth, 26, 10, 10, 'F');
    document.setFont('helvetica', 'bold');
    document.setFontSize(11);
    setTextColor(color);
    document.text(heading, marginX + 12, y + 17);
    y += 34;

    items.forEach((item) => {
      const bulletLines = wrapText(item, contentWidth - 28, 9.5, 'normal');
      const itemHeight = Math.max(16, bulletLines.length * 13);
      ensureSpace(itemHeight);
      setFillColor(color);
      document.circle(marginX + 7, y + 6, 2, 'F');
      document.setFont('helvetica', 'normal');
      document.setFontSize(9.5);
      setTextColor(colors.body);
      document.text(bulletLines, marginX + 16, y + 10);
      y += itemHeight;
    });
    y += 4;
  };
  const drawChartSummary = (chart: NonNullable<ReportSection['chart']>) => {
    const chartRows = chart.labels.map((label, labelIndex) => [
      label,
      ...chart.datasets.map(dataset => String(dataset.values[labelIndex] ?? EMPTY_VALUE)),
    ]);
    drawTable(['Label', ...chart.datasets.map(dataset => dataset.label)], chartRows);
  };

  const pdfSections = report.sections.filter(section => !section.approval);
  const executiveSection = pdfSections.find(section => section.title === 'Executive summary');
  const detailSection = pdfSections.find(section => section.title === 'Report details');
  const coverMetrics = (detailSection?.metrics || [])
    .filter(metric => ['Learner', 'Apprenticeship Standard', 'Employer', 'Status'].includes(metric.label))
    .filter(metric => valueText(metric.value) !== EMPTY_VALUE);
  const heroTop = y;
  const heroPaddingX = 24;
  const heroPaddingTop = 24;
  const titleLines = wrapText(report.title, contentWidth - (heroPaddingX * 2), 26, 'bold');
  const subtitleLines = wrapText(report.subtitle, contentWidth - (heroPaddingX * 2), 11, 'normal');
  const metaEntries = [
    { label: 'Coach', value: report.coach },
    { label: 'Period', value: report.period },
    { label: 'Generated', value: report.generatedAt },
  ];
  const pillGap = 12;
  const pillWidth = (contentWidth - (pillGap * 2) - (heroPaddingX * 2)) / 3;
  const pillHeight = Math.max(
    46,
    ...metaEntries.map((entry) => 24 + (wrapText(entry.value, pillWidth - 20, 10, 'bold').length * 11)),
  );
  const titleHeight = titleLines.length * 28;
  const subtitleHeight = subtitleLines.length * 14;
  const heroHeight = heroPaddingTop + titleHeight + subtitleHeight + 28 + pillHeight + 22;

  setFillColor(colors.panel);
  document.roundedRect(marginX + 10, heroTop + 10, contentWidth - 20, heroHeight, 18, 18, 'F');
  setFillColor(colors.accentDeep);
  document.roundedRect(marginX, heroTop, contentWidth, heroHeight, 18, 18, 'F');
  document.setFont('helvetica', 'bold');
  document.setFontSize(8.5);
  setTextColor([228, 228, 231]);
  document.text('OTJH COMPLIANCE EXPORT', marginX + heroPaddingX, heroTop + 32);
  document.setFont('helvetica', 'bold');
  document.setFontSize(26);
  setTextColor(colors.white);
  const titleTop = heroTop + 58;
  document.text(titleLines, marginX + heroPaddingX, titleTop);
  document.setFont('helvetica', 'normal');
  document.setFontSize(11);
  setTextColor([244, 244, 245]);
  const subtitleTop = titleTop + titleHeight;
  document.text(subtitleLines, marginX + heroPaddingX, subtitleTop);

  const pillTop = heroTop + heroHeight - pillHeight - 18;
  drawMetaPill(marginX + heroPaddingX, pillTop, pillWidth, pillHeight, 'Coach', report.coach);
  drawMetaPill(marginX + heroPaddingX + pillWidth + pillGap, pillTop, pillWidth, pillHeight, 'Period', report.period);
  drawMetaPill(marginX + heroPaddingX + ((pillWidth + pillGap) * 2), pillTop, pillWidth, pillHeight, 'Generated', report.generatedAt);
  y = heroTop + heroHeight + 24;

  if (coverMetrics.length) {
    drawSectionTitle('Learner At A Glance');
    drawMetricCards(coverMetrics, 2);
  }

  if (executiveSection?.metrics?.length) {
    drawSectionTitle('Export Snapshot');
    drawMetricCards(executiveSection.metrics, executiveSection.metrics.length >= 6 ? 3 : 2);
  }

  if (pdfSections.length) {
    addPage();
  }

  pdfSections.forEach((section) => {
    if (section.title === 'Executive summary' && executiveSection?.metrics?.length) {
      if (!section.content) return;
      drawSectionTitle(section.title);
      drawParagraph(section.content);
      y += 8;
      return;
    }
    drawSectionTitle(section.title);
    if (section.content) {
      drawParagraph(section.content);
      y += 6;
    }
    if (section.metrics?.length) {
      drawMetricCards(section.metrics, section.metrics.length >= 6 ? 3 : 2);
    }
    if (section.table) {
      drawTable(section.table.headers, section.table.rows);
    }
    if (section.chart) {
      drawChartSummary(section.chart);
    }
    if (section.findings?.length) {
      drawListBlock('Counts as OTJH', section.findings, colors.green, [236, 253, 245]);
    }
    if (section.recommendations?.length) {
      drawListBlock('Does not count as OTJH', section.recommendations, colors.red, [254, 242, 242]);
    }
    y += 2;
  });

  const totalPages = document.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    document.setPage(page);
    if (page > 1) runningHeader();
    setDrawColor(colors.border);
    document.setLineWidth(1);
    document.line(marginX, pageHeight - 24, pageWidth - marginX, pageHeight - 24);
    document.setFont('helvetica', 'normal');
    document.setFontSize(8);
    setTextColor(colors.muted);
    document.text(report.generatedAt, marginX, pageHeight - 10);
    document.text(`Page ${page} of ${totalPages}`, pageWidth - marginX, pageHeight - 10, { align: 'right' });
  }
}

async function downloadGeneratedReport(report: GeneratedReport, format: ExportFormat) {
  const safeTitle = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = report.generatedAt.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, '');

  if (format === 'pdf') {
    const document = new jsPDF({ unit: 'pt', format: 'a4' });
    renderStyledPdfReport(document, report);
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

  downloadWorkbook(`${safeTitle || 'otjh-report'}-${stamp || 'report'}.xlsx`, report);
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

function normalizeApprovalAction(
  action: string | { label: string; kind: 'download-pdf' | 'workflow' },
) {
  if (typeof action === 'string') {
    return {
      label: action,
      kind: action === 'Sign & lock report v1.0' ? 'download-pdf' as const : 'workflow' as const,
    };
  }

  return action;
}

function visibleApprovalActions(
  actions: Array<string | { label: string; kind: 'download-pdf' | 'workflow' }>,
) {
  return actions
    .map(normalizeApprovalAction)
    .filter(action => action.label.trim().length > 0);
}

function PreviewStatusCard({ section }: { section: ReportSection }) {
  return (
    <article className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <AppIcon className="ri-alert-line text-lg"></AppIcon>
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
  onApprovalAction,
  approvalBusy = false,
}: {
  section: ReportSection;
  index: number;
  onApprovalAction?: (kind: ReportSection['approval'] extends infer T ? T extends { actions: Array<infer A> } ? A extends { kind: infer K } ? K : never : never : never) => void;
  approvalBusy?: boolean;
}) {
  const isRuleSection = section.title === 'What counts as OTJH';
  const isCoachSummary = section.title === 'Coach judgement & summary';
  const isRiskSection = section.title === 'Risk & exception flags';
  const isApprovalSection = Boolean(section.approval);
  const isKeyValueTable = Boolean(section.table && section.table.headers.length === 2 && !isRiskSection);
  const [approvalChecked, setApprovalChecked] = useState(false);

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
              <AppIcon className="ri-checkbox-circle-line text-lg"></AppIcon>
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
              <AppIcon className="ri-error-warning-line text-lg"></AppIcon>
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

      {isApprovalSection && section.approval ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-foreground-200/70 bg-background-100/45 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={approvalChecked}
                onChange={(event) => setApprovalChecked(event.target.checked)}
                className="mt-1 h-5 w-5 rounded border-foreground-300 text-primary-600 focus:ring-primary-300"
              />
              <span className="text-sm leading-6 text-foreground-800">{section.approval.checklistLabel}</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            {visibleApprovalActions(section.approval.actions).map((action) => {
              return (
              <button
                key={`${section.title}-${action.label}`}
                type="button"
                onClick={() => {
                  if (action.kind === 'download-pdf' && approvalChecked && onApprovalAction) {
                    onApprovalAction(action.kind);
                  }
                }}
                disabled={action.kind === 'download-pdf' ? !approvalChecked || approvalBusy : true}
                title={action.kind === 'workflow' ? 'Workflow action preview only' : undefined}
                className={`inline-flex items-center rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition ${
                  action.kind === 'download-pdf'
                    ? 'border-primary-400 bg-primary-600 text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:border-foreground-200 disabled:bg-background-100 disabled:text-foreground-400'
                    : 'cursor-not-allowed border-foreground-200 bg-background-100/70 text-foreground-400'
                }`}
              >
                {action.kind === 'download-pdf' && approvalBusy ? (
                  <AppIcon className="ri-loader-4-line mr-2 animate-spin"></AppIcon>
                ) : null}
                {action.label}
              </button>
              );
            })}
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
      <AppIcon className={`${busy ? 'ri-loader-4-line animate-spin' : meta.icon}`}></AppIcon>
      {meta.label}
    </button>
  );
}

export default function CoachReports() {
  const coach = useCoachIdentity();
  const initialRange = currentMonthRange();
  const [ownerName, setOwnerName] = useState('Coach');
  const [caseloadLearners, setCaseloadLearners] = useState<CaseloadLearner[]>([]);
  const [attendanceLearners, setAttendanceLearners] = useState<AttendanceLearner[]>([]);
  const [timetableEvents, setTimetableEvents] = useState<CoachCalendarEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [buildingReport, setBuildingReport] = useState(false);
  const [reportStatus, setReportStatus] = useState<{ tone: 'warning' | 'error'; message: string } | null>(null);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  const [generatedSignature, setGeneratedSignature] = useState<string | null>(null);
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
      learnerReflections: true,
      evidenceLinks: true,
      coachingSummaries: true,
      progressReviewSummaries: true,
      ksbProgression: true,
      quizResults: true,
      checkpointResults: true,
    },
  });

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setOwnerName(coach.name);
      setCaseloadLearners([]);
      setAttendanceLearners([]);
      setTimetableEvents([]);
      setWarnings(['coach access']);
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    async function loadSources() {
      setLoading(true);
      const nextWarnings: string[] = [];

      const [caseloadResult, attendanceResult, timetableResult] = await Promise.allSettled([
        coachFetch(CASELOAD_ENDPOINT, { signal: controller.signal }).then(response => readJson<CaseloadResponse>(response)),
        coachFetch(ATTENDANCE_ENDPOINT, { signal: controller.signal }).then(response => readJson<AttendanceResponse>(response)),
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
  }, [coach.email, coach.isInitialized, coach.name]);

  useEffect(() => {
    if (!options.learnerId && caseloadLearners.length) {
      setOptions(prev => ({ ...prev, learnerId: displayValue(caseloadLearners[0]?.id) }));
    }
  }, [caseloadLearners, options.learnerId]);

  useEffect(() => {
    if (options.learnerId !== 'all') return;
    setOptions((prev) => {
      const nextInclusions = { ...prev.inclusions };
      let changed = false;
      for (const key of SINGLE_LEARNER_ONLY_INCLUSIONS) {
        if (nextInclusions[key]) {
          nextInclusions[key] = false;
          changed = true;
        }
      }
      return changed ? { ...prev, inclusions: nextInclusions } : prev;
    });
  }, [options.learnerId]);

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
  const reportSignature = useMemo(() => JSON.stringify({
    learnerId: options.learnerId,
    reportType: options.reportType,
    fromDate: options.fromDate,
    toDate: options.toDate,
    inclusions: options.inclusions,
  }), [options.fromDate, options.inclusions, options.learnerId, options.reportType, options.toDate]);
  const dateRangeInvalid = Boolean(options.fromDate && options.toDate && options.fromDate > options.toDate);
  const visibleInclusionOptions = useMemo(
    () => INCLUSION_OPTIONS.filter(option => option.scope === 'all' || options.learnerId !== 'all'),
    [options.learnerId],
  );
  const selectedInclusionCount = visibleInclusionOptions.filter(option => options.inclusions[option.key]).length;
  const hiddenSingleLearnerCount = options.learnerId === 'all' ? SINGLE_LEARNER_ONLY_INCLUSIONS.length : 0;
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

  useEffect(() => {
    if (!generatedReport || !generatedSignature) return;
    if (generatedSignature === reportSignature) return;

    setGeneratedReport(null);
    setGeneratedSignature(null);
    setReportStatus({
      tone: 'warning',
      message: 'Report parameters changed. Generate the report again to refresh the preview for the currently selected learner and date range.',
    });
  }, [generatedReport, generatedSignature, reportSignature]);

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

  async function buildAndStoreReport(reportOptions: ReportOptions, signature: string) {
    setBuildingReport(true);
    setReportStatus(null);

    try {
      let detailContext: LearnerReportDetailContext | null = null;
      let detailKind: LearnerKind | null = null;
      let reflectionSubmissions: MarkingQueueSubmission[] = [];
      let evidenceRecords: EvidenceRecord[] = [];
      const extraWarnings: string[] = [];
      const warningMessages: string[] = [];

      if (reportOptions.learnerId && reportOptions.learnerId !== 'all') {
        try {
          const detailResult = await fetchAnyLearnerDetail(reportOptions.learnerId);
          detailKind = detailResult.kind;
          detailContext = buildDetailedReportContext(detailResult.kind, detailResult.detail);
        } catch (error) {
          extraWarnings.push('learner detail');
          warningMessages.push('Could not load full learner detail. Assessment sections may be unavailable in this export.');
          console.error(error);
        }
      }

      if (detailKind && reportOptions.learnerId && reportOptions.learnerId !== 'all') {
        const [reflectionResult, evidenceResult] = await Promise.allSettled([
          reportOptions.inclusions.learnerReflections
            ? fetchCoachMarkingQueue(reportOptions.learnerId).then(data => data.items || [])
            : Promise.resolve([] as MarkingQueueSubmission[]),
          reportOptions.inclusions.evidenceLinks
            ? fetchEvidence(detailKind, reportOptions.learnerId)
            : Promise.resolve([] as EvidenceRecord[]),
        ]);

        if (reflectionResult.status === 'fulfilled') {
          reflectionSubmissions = reflectionResult.value.filter(item => (
            String(item.learnerId) === reportOptions.learnerId
            && normalizeComponentType(item.learnerKind) === normalizeComponentType(detailKind)
          ));
        } else if (reportOptions.inclusions.learnerReflections) {
          extraWarnings.push('reflection submissions');
          warningMessages.push('Could not load learner reflections from the marking queue.');
          console.error(reflectionResult.reason);
        }

        if (evidenceResult.status === 'fulfilled') {
          evidenceRecords = evidenceResult.value;
        } else if (reportOptions.inclusions.evidenceLinks) {
          extraWarnings.push('evidence files');
          warningMessages.push('Could not load learner evidence records for this export.');
          console.error(evidenceResult.reason);
        }
      }

      if (warningMessages.length) {
        setReportStatus({
          tone: 'warning',
          message: warningMessages.join(' '),
        });
      }

      const report = buildOtjhGeneratedReport(
        snapshot,
        reportOptions,
        detailContext,
        reflectionSubmissions,
        evidenceRecords,
        extraWarnings,
      );
      setGeneratedReport(report);
      setGeneratedSignature(signature);
      return report;
    } catch (error) {
      setReportStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to generate the OTJH report right now.',
      });
      return null;
    } finally {
      setBuildingReport(false);
    }
  }

  async function handleGenerate() {
    if (loading || buildingReport || dateRangeInvalid || !caseloadLearners.length) return;
    await buildAndStoreReport(options, reportSignature);
  }

  async function handleDownload(format: ExportFormat) {
    updateOption('exportFormat', format);
    if (loading || buildingReport || dateRangeInvalid || !caseloadLearners.length) return;
    setDownloadState(format);
    try {
      const report = generatedReport && generatedSignature === reportSignature
        ? generatedReport
        : await buildAndStoreReport({ ...options, exportFormat: format }, reportSignature);
      if (!report) return;
      await downloadGeneratedReport(report, format);
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
                      <AppIcon className="ri-file-chart-line"></AppIcon>
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
                      <AppIcon className={`ri-arrow-down-s-line text-lg text-foreground-500 transition-transform ${learnerMenuOpen ? 'rotate-180' : ''}`}></AppIcon>
                    </button>

                    {learnerMenuOpen && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border border-foreground-200/70 bg-white p-2 shadow-xl shadow-foreground-950/10">
                        <div className="relative mb-2">
                          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
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
                                {active ? <AppIcon className="ri-check-line text-base"></AppIcon> : null}
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
                      <p className="mt-1 text-xs leading-5 text-foreground-500">
                        {selectedInclusionCount} sections selected
                        {hiddenSingleLearnerCount ? ` · ${hiddenSingleLearnerCount} detailed sections unlock when you pick one learner` : ''}
                      </p>
                    </div>
                  </div>
                  {hiddenSingleLearnerCount ? (
                    <div className="mb-3 rounded-xl border border-primary-100 bg-primary-50/70 px-3 py-3 text-[11px] leading-5 text-primary-800">
                      Select a single learner to include learner reflections, evidence links, quiz results, and checkpoint results in the export.
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    {visibleInclusionOptions.map(option => (
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
                            {option.scope === 'single'
                              ? `Live from ${option.sourceLabel} · single learner detail`
                              : `Live from ${option.sourceLabel}`}
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

                {reportStatus && (
                  <div className={`rounded-2xl px-4 py-3 text-[12px] ${
                    reportStatus.tone === 'error'
                      ? 'border border-red-200 bg-red-50 text-red-700'
                      : 'border border-amber-200 bg-amber-50 text-amber-800'
                  }`}>
                    {reportStatus.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => { void handleGenerate(); }}
                  disabled={loading || buildingReport || dateRangeInvalid || !caseloadLearners.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AppIcon className={loading || buildingReport ? 'ri-loader-4-line animate-spin' : 'ri-file-chart-line'}></AppIcon>
                  {loading ? 'Loading OTJH sources' : buildingReport ? 'Generating OTJH report' : 'Generate OTJH evidence report'}
                </button>
              </div>
            </aside>

                <section className="min-h-[720px] rounded-2xl border border-foreground-200/60 bg-white p-6 shadow-sm">
              {!generatedReport ? (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-primary-200 bg-primary-50/25 px-6 py-12 text-center">
                  <span className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-100 text-primary-500">
                    <AppIcon className="ri-file-transfer-line text-5xl"></AppIcon>
                  </span>
                  <h2 className="mt-8 text-3xl font-heading font-semibold text-foreground-950">{reportTypeMeta.title}</h2>
                  <p className="mt-4 max-w-2xl text-base leading-8 text-foreground-500">
                    Configure the parameters on the left, then click <span className="font-semibold text-foreground-700">Generate OTJH evidence report</span> to preview it, or choose a format below to generate and download immediately.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
                    <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 shadow-sm"><AppIcon className="ri-user-line mr-1 text-primary-500"></AppIcon>{generatedReport.coach}</span>
                    <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 shadow-sm"><AppIcon className="ri-calendar-line mr-1 text-primary-500"></AppIcon>{generatedReport.period}</span>
                    <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 shadow-sm"><AppIcon className="ri-time-line mr-1 text-primary-500"></AppIcon>{generatedReport.generatedAt}</span>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                    {previewSections.sourceStatus ? <PreviewStatusCard section={previewSections.sourceStatus} /> : null}
                    {previewSections.detailSection ? <PreviewDetailCard report={generatedReport} section={previewSections.detailSection} /> : null}
                    {previewSections.bodySections.map((section, index) => (
                      <PreviewSectionCard
                        key={section.title}
                        section={section}
                        index={index + 1}
                        approvalBusy={downloadState === 'pdf'}
                        onApprovalAction={(kind) => {
                          if (kind === 'download-pdf') {
                            void handleDownload('pdf');
                          }
                        }}
                      />
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
