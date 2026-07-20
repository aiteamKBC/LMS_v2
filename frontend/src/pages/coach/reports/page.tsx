import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  DEFAULT_COACH_EMAIL,
  type CoachCalendarEvent,
  eventDisplayDate,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskEvent,
  isCompletedEvent,
  needsScheduling,
} from '../shared/calendarEvents';
import type { GeneratedReport, ReportSection } from './types';
import ReportGeneratorModal from './components/ReportGeneratorModal';

const coachNav = roleNavMap.coach;
const EMPTY_VALUE = '--';
const CASELOAD_ENDPOINT = `/coach_api/coach/caseload?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const ATTENDANCE_ENDPOINT = `/coach_api/coach/attendance?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const REPORT_LIMIT = 50;

const COLORS = {
  primary: '#6d28d9',
  accent: '#f59e0b',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#f97316',
  secondary: '#64748b',
};

interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  format: string;
  frequency: string;
}

interface CaseloadLearner {
  id?: string;
  name?: string;
  email?: string | null;
  employer?: string | null;
  cohortName?: string;
  group?: string;
  status?: string;
  enrollmentStatus?: string;
  rawProgramStatus?: string;
  riskFlags?: string[];
  overallProgress?: number;
  overallProgressAvailable?: boolean;
  componentsCompleted?: number;
  componentsPlanned?: number;
  otjhCompleted?: number;
  otjhTarget?: number;
  otjhPlanned?: number;
  otjhStatus?: string;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbProgress?: number;
  ksbProgressAvailable?: boolean;
  knowledgeCompleted?: number;
  knowledgeTarget?: number;
  skillsCompleted?: number;
  skillsTarget?: number;
  behavioursCompleted?: number;
  behavioursTarget?: number;
  startDate?: string;
  plannedEndDate?: string;
  gatewayReviewDate?: string;
  coachName?: string | null;
  coachEmail?: string | null;
  coachRag?: string | null;
}

interface CaseloadResponse {
  owner?: { name?: string; email?: string };
  learners?: CaseloadLearner[];
}

interface AttendanceSummary {
  totalLearners?: number;
  activeLearners?: number;
  onBreakLearners?: number;
  learnersWithAttendance?: number;
  cohortCount?: number;
  averageAttendance?: number | null;
  totalSessions?: number;
  totalPresent?: number;
  totalAbsent?: number;
  onTrack?: number;
  needsAttention?: number;
  atRisk?: number;
  unknown?: number;
  catchupsPending?: number | null;
  scheduledCatchups?: number | null;
  overdueCatchups?: number | null;
}

interface AttendanceLearner {
  id?: string;
  learner?: string;
  email?: string | null;
  programme?: string;
  cohort?: string;
  group?: string;
  enrollmentStatus?: string;
  attendance?: number | null;
  sessions?: number | null;
  present?: number | null;
  absent?: number | null;
  late?: number | null;
  catchup?: number | null;
  risk?: 'red' | 'amber' | 'green' | null;
  lastSession?: string;
  consecutiveMissed?: number | null;
  hasAttendance?: boolean;
}

interface AttendanceResponse {
  owner?: { name?: string; email?: string };
  summary?: AttendanceSummary;
  learners?: AttendanceLearner[];
}

interface LiveReportSnapshot {
  ownerName: string;
  caseloadLearners: CaseloadLearner[];
  attendanceSummary: AttendanceSummary | null;
  attendanceLearners: AttendanceLearner[];
  timetableEvents: CoachCalendarEvent[];
  warnings: string[];
}

const REPORTS: ReportDefinition[] = [
  { id: 'cr-01', title: 'Caseload Progress Summary', description: 'Live overview of learners in your caseload with progress, attendance, OTJH and KSB metrics', category: 'Caseload', format: 'PDF / Excel', frequency: 'Weekly' },
  { id: 'cr-02', title: 'At-risk Learner Report', description: 'Live breakdown of learners currently flagged through RAG, OTJH, attendance or KSB risk signals', category: 'Risk', format: 'PDF', frequency: 'Weekly' },
  { id: 'cr-03', title: 'OTJH Compliance Report', description: 'Off-the-job training hours from learner records with target, completed and remaining values', category: 'Compliance', format: 'PDF / Excel', frequency: 'Monthly' },
  { id: 'cr-04', title: 'Attendance & Catch-up Report', description: 'Attendance records and absence patterns from the attendance endpoint', category: 'Attendance', format: 'PDF', frequency: 'Weekly' },
  { id: 'cr-05', title: 'Intervention Log', description: 'Coaching interventions and follow-up actions when an intervention source is connected', category: 'Interventions', format: 'PDF / Excel', frequency: 'Monthly' },
  { id: 'cr-06', title: 'KSB Progress by Learner', description: 'Knowledge, Skills and Behaviours progression from learner KSB data', category: 'Progress', format: 'PDF', frequency: 'Monthly' },
  { id: 'cr-07', title: 'Monthly Coaching Summary', description: 'Monthly coaching and progress review events generated from the timetable source', category: 'Coaching', format: 'PDF', frequency: 'Monthly' },
  { id: 'cr-08', title: 'Employer Engagement Report', description: 'Employer contact and engagement summary when employer activity source is connected', category: 'Employer', format: 'PDF / Excel', frequency: 'Monthly' },
  { id: 'cr-09', title: 'Evidence Validation Status', description: 'Evidence validation status once the approved evidence source is confirmed', category: 'Evidence', format: 'PDF', frequency: 'Weekly' },
  { id: 'cr-10', title: 'Gateway Readiness Dashboard', description: 'Gateway readiness indicators when gateway criteria source is connected', category: 'Gateway & EPA', format: 'PDF', frequency: 'Monthly' },
  { id: 'cr-11', title: 'Learner Engagement Trends', description: 'Engagement trends when learner engagement events are connected', category: 'Engagement', format: 'PDF / Excel', frequency: 'Monthly' },
  { id: 'cr-12', title: 'Coaching Workload Report', description: 'Coaching workload from timetable events with unavailable workload sources marked as missing', category: 'Workload', format: 'PDF', frequency: 'Monthly' },
];

function displayValue(value?: string | number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const text = String(value).trim();
  if (!text || text === EMPTY_VALUE || text === '\u2014') return EMPTY_VALUE;
  return text;
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

function emailKey(value?: string | null): string {
  return (value || '').trim().toLowerCase();
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

function currentPeriod(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(now);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function statusLabel(status?: string | null): string {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'at-risk') return 'At Risk';
  if (normalized === 'on-track') return 'On Track';
  if (normalized === 'new-starter') return 'New Starter';
  if (normalized === 'high') return 'High';
  return displayValue(status);
}

function attendanceRiskLabel(risk?: AttendanceLearner['risk']): string {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return EMPTY_VALUE;
}

function isRiskLearner(learner: CaseloadLearner, attendance?: AttendanceLearner): boolean {
  const status = (learner.status || '').toLowerCase();
  const rag = (learner.coachRag || '').toLowerCase();
  const otjhStatus = (learner.otjhStatus || '').toLowerCase().replace(/\s+/g, '');
  return (
    status === 'at-risk'
    || rag === 'red'
    || rag === 'amber'
    || otjhStatus === 'atrisk'
    || otjhStatus === 'needattention'
    || attendance?.risk === 'red'
    || attendance?.risk === 'amber'
  );
}

function sourceTable(headers: string[], rows: string[][]): { headers: string[]; rows: string[][] } {
  return { headers, rows: rows.length ? rows : [headers.map(() => EMPTY_VALUE)] };
}

function missingSourceSection(title: string, source: string): ReportSection {
  return {
    title,
    content: `${source} is not connected to a confirmed live source yet.`,
    metrics: [
      { label: 'Live Source', value: EMPTY_VALUE },
      { label: 'Records', value: EMPTY_VALUE },
      { label: 'Last Updated', value: EMPTY_VALUE },
      { label: 'Status', value: EMPTY_VALUE },
    ],
  };
}

function attendanceByEmail(snapshot: LiveReportSnapshot) {
  return new Map(snapshot.attendanceLearners.map(row => [emailKey(row.email), row]));
}

function learnerAttendance(snapshot: LiveReportSnapshot, learner: CaseloadLearner): AttendanceLearner | undefined {
  return attendanceByEmail(snapshot).get(emailKey(learner.email));
}

function buildSourceStatusSection(snapshot: LiveReportSnapshot): ReportSection | null {
  if (!snapshot.warnings.length) return null;
  return {
    title: 'Source Status',
    content: 'Some live sources could not be loaded, so affected values are shown as --.',
    table: sourceTable(
      ['Source', 'Status'],
      snapshot.warnings.map(source => [source, 'Unavailable'])
    ),
  };
}

function buildCaseloadReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const learners = snapshot.caseloadLearners;
  const attendanceMap = attendanceByEmail(snapshot);
  const active = learners.filter(learner => (learner.enrollmentStatus || '').toLowerCase() === 'active').length;
  const riskCount = learners.filter(learner => isRiskLearner(learner, attendanceMap.get(emailKey(learner.email)))).length;
  const avgKsb = average(learners.filter(l => l.ksbProgressAvailable).map(l => toNumber(l.ksbProgress)));
  const avgAttendance = snapshot.attendanceSummary?.averageAttendance ?? null;

  const rows = learners.slice(0, REPORT_LIMIT).map(learner => {
    const attendance = attendanceMap.get(emailKey(learner.email));
    return [
      displayValue(learner.name),
      displayValue(learner.cohortName),
      displayValue(learner.group),
      formatPercent(attendance?.attendance),
      formatPercent(learner.ksbProgress, learner.ksbProgressAvailable),
      formatPercent(percent(learner.otjhCompleted, learner.otjhTarget)),
      statusLabel(learner.status),
    ];
  });

  const cohortGroups = Array.from(
    learners.reduce((map, learner) => {
      const key = displayValue(learner.cohortName);
      const list = map.get(key) || [];
      list.push(learner);
      map.set(key, list);
      return map;
    }, new Map<string, CaseloadLearner[]>())
  ).slice(0, 8);

  return [
    {
      title: 'Executive Summary',
      content: `Live caseload snapshot for ${snapshot.ownerName}. Values without a confirmed source are shown as --.`,
      metrics: [
        { label: 'Total Learners', value: formatCount(learners.length) },
        { label: 'Active Learners', value: formatCount(active) },
        { label: 'Avg Attendance', value: formatPercent(avgAttendance) },
        { label: 'Avg KSB', value: formatPercent(avgKsb) },
        { label: 'At Risk', value: formatCount(riskCount) },
      ],
    },
    {
      title: 'Learner Overview',
      table: sourceTable(['Learner', 'Programme', 'Group', 'Attendance', 'KSB', 'OTJH', 'Status'], rows),
    },
    ...(cohortGroups.length ? [{
      title: 'Cohort Performance',
      chart: {
        type: 'bar' as const,
        labels: cohortGroups.map(([cohort]) => cohort),
        datasets: [
          {
            label: 'KSB %',
            values: cohortGroups.map(([, group]) => average(group.filter(l => l.ksbProgressAvailable).map(l => toNumber(l.ksbProgress))) || 0),
            color: COLORS.primary,
          },
          {
            label: 'OTJH %',
            values: cohortGroups.map(([, group]) => average(group.map(l => percent(l.otjhCompleted, l.otjhTarget) || 0)) || 0),
            color: COLORS.accent,
          },
        ],
      },
    }] : []),
  ];
}

function buildRiskReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const attendanceMap = attendanceByEmail(snapshot);
  const riskLearners = snapshot.caseloadLearners.filter(learner => isRiskLearner(learner, attendanceMap.get(emailKey(learner.email))));
  const rows = riskLearners.slice(0, REPORT_LIMIT).map(learner => {
    const attendance = attendanceMap.get(emailKey(learner.email));
    return [
      displayValue(learner.name),
      displayValue(learner.cohortName),
      displayValue((learner.riskFlags || []).join(', ')),
      formatPercent(attendance?.attendance),
      formatPercent(learner.ksbProgress, learner.ksbProgressAvailable),
      displayValue(learner.coachRag),
      displayValue(learner.otjhStatus),
    ];
  });

  return [
    {
      title: 'Risk Summary',
      content: 'Risk is calculated from live learner status, Coach RAG, OTJH status and attendance risk where available.',
      metrics: [
        { label: 'At Risk Learners', value: formatCount(riskLearners.length) },
        { label: 'Coach RAG Red/Amber', value: formatCount(snapshot.caseloadLearners.filter(l => ['red', 'amber'].includes((l.coachRag || '').toLowerCase())).length) },
        { label: 'Attendance Risk', value: formatCount(snapshot.attendanceLearners.filter(l => l.risk === 'red' || l.risk === 'amber').length) },
        { label: 'Interventions', value: EMPTY_VALUE },
      ],
    },
    {
      title: 'At-risk Learners',
      table: sourceTable(['Learner', 'Programme', 'Risk Flags', 'Attendance', 'KSB', 'Coach RAG', 'OTJH Status'], rows),
    },
    missingSourceSection('Intervention History', 'Intervention log'),
  ];
}

function buildOtjhReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const learners = snapshot.caseloadLearners;
  const complianceValues = learners.map(learner => percent(learner.otjhCompleted, learner.otjhTarget)).filter((value): value is number => value !== null);
  const belowTarget = learners.filter(learner => {
    const status = (learner.otjhStatus || '').toLowerCase();
    const progress = percent(learner.otjhCompleted, learner.otjhTarget);
    return status.includes('risk') || status.includes('attention') || (progress !== null && progress < 80);
  });
  const totalHours = learners.reduce((sum, learner) => sum + toNumber(learner.otjhCompleted), 0);

  const rows = learners.slice(0, REPORT_LIMIT).map(learner => {
    const completed = toNumber(learner.otjhCompleted);
    const target = toNumber(learner.otjhTarget);
    return [
      displayValue(learner.name),
      displayValue(learner.cohortName),
      formatCount(target || null),
      formatCount(completed),
      target ? formatCount(Math.max(target - completed, 0)) : EMPTY_VALUE,
      formatPercent(percent(completed, target)),
      displayValue(learner.otjhStatus),
    ];
  });

  return [
    {
      title: 'Compliance Overview',
      content: 'OTJH values are calculated from completed and target hours in the learner source.',
      metrics: [
        { label: 'Avg Compliance', value: formatPercent(average(complianceValues)) },
        { label: 'Below Target', value: formatCount(belowTarget.length) },
        { label: 'Total Hours Logged', value: formatCount(totalHours) },
        { label: 'Employer Confirm', value: EMPTY_VALUE },
      ],
    },
    {
      title: 'Learner OTJH Details',
      table: sourceTable(['Learner', 'Programme', 'Target Hours', 'Completed', 'Remaining', 'Compliance', 'OTJH Status'], rows),
    },
  ];
}

function buildAttendanceReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const summary = snapshot.attendanceSummary;
  const rows = snapshot.attendanceLearners.slice(0, REPORT_LIMIT).map(learner => [
    displayValue(learner.learner),
    displayValue(learner.programme),
    formatPercent(learner.attendance),
    formatCount(learner.sessions),
    formatCount(learner.present),
    formatCount(learner.absent),
    attendanceRiskLabel(learner.risk),
    displayValue(learner.lastSession),
  ]);

  return [
    {
      title: 'Attendance Summary',
      content: 'Attendance is loaded from the coach attendance endpoint. Catch-up values are shown as -- when unavailable.',
      metrics: [
        { label: 'Attendance Rate', value: formatPercent(summary?.averageAttendance) },
        { label: 'Sessions', value: formatCount(summary?.totalSessions) },
        { label: 'Present', value: formatCount(summary?.totalPresent) },
        { label: 'Absent', value: formatCount(summary?.totalAbsent) },
        { label: 'Catch-ups Pending', value: formatCount(summary?.catchupsPending) },
      ],
    },
    {
      title: 'Attendance by Learner',
      table: sourceTable(['Learner', 'Programme', 'Attendance', 'Sessions', 'Present', 'Absent', 'Risk', 'Last Session'], rows),
    },
  ];
}

function buildKsbReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const learners = snapshot.caseloadLearners;
  const avgKsb = average(learners.filter(l => l.ksbProgressAvailable).map(l => toNumber(l.ksbProgress)));
  const rows = learners.slice(0, REPORT_LIMIT).map(learner => [
    displayValue(learner.name),
    displayValue(learner.cohortName),
    formatRatio(learner.ksbCompleted, learner.ksbTarget),
    formatPercent(learner.ksbProgress, learner.ksbProgressAvailable),
    formatRatio(learner.knowledgeCompleted, learner.knowledgeTarget),
    formatRatio(learner.skillsCompleted, learner.skillsTarget),
    formatRatio(learner.behavioursCompleted, learner.behavioursTarget),
    displayValue(learner.rawProgramStatus || learner.enrollmentStatus),
  ]);

  return [
    {
      title: 'KSB Summary',
      content: 'KSB completion uses completed and target KSB values returned by the caseload endpoint.',
      metrics: [
        { label: 'Avg KSB', value: formatPercent(avgKsb) },
        { label: 'Learners with KSB Data', value: formatCount(learners.filter(l => l.ksbProgressAvailable).length) },
        { label: 'Knowledge', value: EMPTY_VALUE },
        { label: 'Skills', value: EMPTY_VALUE },
        { label: 'Behaviours', value: EMPTY_VALUE },
      ],
    },
    {
      title: 'KSB by Learner',
      table: sourceTable(['Learner', 'Programme', 'KSB', 'Overall', 'Knowledge', 'Skills', 'Behaviours', 'Status'], rows),
    },
  ];
}

function buildCoachingReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const events = snapshot.timetableEvents;
  const monthlyCoaching = events.filter(event => event.source === 'mcr');
  const reviews = events.filter(event => event.source === 'progress-review');
  const rows = events.slice(0, REPORT_LIMIT).map(event => [
    displayValue(event.learner),
    event.source === 'progress-review' ? 'Progress Review' : event.source === 'mcr' ? 'Monthly Coaching' : displayValue(event.title),
    formatDateLabel(eventDisplayDate(event)),
    formatTimeLabel(event),
    displayValue(event.status),
    displayValue(event.meetingLink || event.graphWebLink),
  ]);

  return [
    {
      title: 'Coaching Activity Summary',
      content: 'Coaching and review counts are generated from the timetable endpoint.',
      metrics: [
        { label: 'Total Events', value: formatCount(events.length) },
        { label: 'Monthly Coaching', value: formatCount(monthlyCoaching.length) },
        { label: 'Progress Reviews', value: formatCount(reviews.length) },
        { label: 'Scheduled', value: formatCount(events.filter(event => event.status === 'scheduled' || event.status === 'in-progress').length) },
        { label: 'Completed', value: formatCount(events.filter(isCompletedEvent).length) },
        { label: 'Needs Schedule', value: formatCount(events.filter(needsScheduling).length) },
      ],
    },
    {
      title: 'Event List',
      table: sourceTable(['Learner', 'Type', 'Date', 'Time', 'Status', 'Meeting Link'], rows),
    },
  ];
}

function buildEmployerReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const employers = Array.from(new Set(snapshot.caseloadLearners.map(l => displayValue(l.employer)).filter(value => value !== EMPTY_VALUE)));
  return [
    {
      title: 'Employer Coverage',
      content: 'Employer names are available from caseload. Employer contact activity is not connected to a confirmed live source yet.',
      metrics: [
        { label: 'Assigned Employers', value: formatCount(employers.length) },
        { label: 'Contacts', value: EMPTY_VALUE },
        { label: 'Meetings', value: EMPTY_VALUE },
        { label: 'Open Actions', value: EMPTY_VALUE },
      ],
    },
    {
      title: 'Employer List',
      table: sourceTable(['Employer', 'Learners', 'Last Contact', 'Open Actions'], employers.map(employer => [
        employer,
        formatCount(snapshot.caseloadLearners.filter(l => displayValue(l.employer) === employer).length),
        EMPTY_VALUE,
        EMPTY_VALUE,
      ])),
    },
  ];
}

function buildGatewayReport(snapshot: LiveReportSnapshot): ReportSection[] {
  return [
    missingSourceSection('Gateway Readiness Summary', 'Gateway readiness criteria'),
    {
      title: 'Learner Gateway Dates',
      table: sourceTable(['Learner', 'Programme', 'Gateway Review', 'Planned End', 'Readiness'], snapshot.caseloadLearners.slice(0, REPORT_LIMIT).map(learner => [
        displayValue(learner.name),
        displayValue(learner.cohortName),
        displayValue(learner.gatewayReviewDate),
        displayValue(learner.plannedEndDate),
        EMPTY_VALUE,
      ])),
    },
  ];
}

function buildWorkloadReport(snapshot: LiveReportSnapshot): ReportSection[] {
  const overdue = snapshot.timetableEvents.filter(event => isAtRiskEvent(event));
  return [
    {
      title: 'Workload Summary',
      content: 'Calendar workload is live from timetable. Marking volume, calls and admin time are shown as -- until connected.',
      metrics: [
        { label: 'Calendar Events', value: formatCount(snapshot.timetableEvents.length) },
        { label: 'Overdue Events', value: formatCount(overdue.length) },
        { label: 'Completed Events', value: formatCount(snapshot.timetableEvents.filter(isCompletedEvent).length) },
        { label: 'Marking Volume', value: EMPTY_VALUE },
        { label: 'Admin Time', value: EMPTY_VALUE },
      ],
    },
    {
      title: 'Workload Sources',
      table: sourceTable(['Area', 'Live Source', 'Value'], [
        ['Calendar', 'Timetable endpoint', formatCount(snapshot.timetableEvents.length)],
        ['Marking', EMPTY_VALUE, EMPTY_VALUE],
        ['Employer Contacts', EMPTY_VALUE, EMPTY_VALUE],
        ['Messages', EMPTY_VALUE, EMPTY_VALUE],
      ]),
    },
  ];
}

function buildGeneratedReport(definition: ReportDefinition, snapshot: LiveReportSnapshot): GeneratedReport {
  const sourceStatus = buildSourceStatusSection(snapshot);
  let sections: ReportSection[];

  switch (definition.id) {
    case 'cr-01':
      sections = buildCaseloadReport(snapshot);
      break;
    case 'cr-02':
      sections = buildRiskReport(snapshot);
      break;
    case 'cr-03':
      sections = buildOtjhReport(snapshot);
      break;
    case 'cr-04':
      sections = buildAttendanceReport(snapshot);
      break;
    case 'cr-06':
      sections = buildKsbReport(snapshot);
      break;
    case 'cr-07':
      sections = buildCoachingReport(snapshot);
      break;
    case 'cr-08':
      sections = buildEmployerReport(snapshot);
      break;
    case 'cr-10':
      sections = buildGatewayReport(snapshot);
      break;
    case 'cr-12':
      sections = buildWorkloadReport(snapshot);
      break;
    case 'cr-05':
      sections = [missingSourceSection('Intervention Log', 'Intervention activity')];
      break;
    case 'cr-09':
      sections = [missingSourceSection('Evidence Validation Status', 'Approved evidence validation source')];
      break;
    case 'cr-11':
      sections = [missingSourceSection('Learner Engagement Trends', 'Engagement event stream')];
      break;
    default:
      sections = [missingSourceSection(definition.title, 'Report source')];
  }

  return {
    id: definition.id,
    title: definition.title,
    subtitle: definition.description,
    generatedAt: currentTimestamp(),
    period: currentPeriod(),
    coach: snapshot.ownerName,
    sections: sourceStatus ? [sourceStatus, ...sections] : sections,
  };
}

export default function CoachReports() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeReport, setActiveReport] = useState<GeneratedReport | null>(null);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [caseloadLearners, setCaseloadLearners] = useState<CaseloadLearner[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [attendanceLearners, setAttendanceLearners] = useState<AttendanceLearner[]>([]);
  const [timetableEvents, setTimetableEvents] = useState<CoachCalendarEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
        setAttendanceSummary(attendanceResult.value.summary || null);
        setAttendanceLearners(attendanceResult.value.learners || []);
        if (displayValue(attendanceResult.value.owner?.name) !== EMPTY_VALUE) {
          setOwnerName(String(attendanceResult.value.owner?.name));
        }
      } else {
        setAttendanceSummary(null);
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

  const snapshot = useMemo<LiveReportSnapshot>(() => ({
    ownerName,
    caseloadLearners,
    attendanceSummary,
    attendanceLearners,
    timetableEvents,
    warnings,
  }), [ownerName, caseloadLearners, attendanceSummary, attendanceLearners, timetableEvents, warnings]);

  const filtered = REPORTS.filter(report => {
    if (search && !report.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && report.category !== categoryFilter) return false;
    return true;
  });

  const categories = [...new Set(REPORTS.map(report => report.category))];

  function handleGenerate(report: ReportDefinition) {
    setActiveReport(buildGeneratedReport(report, snapshot));
  }

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Reports" pageSubtitle="Generate caseload reports, progress summaries, and compliance documentation" userName={ownerName} userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-bar-chart-box-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Reports</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{REPORTS.length} report templates</strong> available across {categories.length} categories. Live data loaded from caseload, attendance and timetable sources.
              </p>
            </div>
          </div>
        </div>

        {(loading || warnings.length > 0) && (
          <div className={`rounded-xl border p-3 text-[12px] ${warnings.length ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-background-50 border-foreground-200/60 text-foreground-500'}`}>
            {loading ? 'Loading live report sources...' : `Some report sources are unavailable: ${warnings.join(', ')}. Missing values will show as ${EMPTY_VALUE}.`}
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reports..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 flex-wrap">
            {[{ key: 'all', label: 'All' }, ...categories.map(category => ({ key: category, label: category }))].map(filter => (
              <button key={filter.key} onClick={() => setCategoryFilter(filter.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === filter.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{filter.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(report => {
            const catIcon = report.category === 'Caseload' ? 'ri-group-line' : report.category === 'Risk' ? 'ri-alert-line' : report.category === 'Compliance' ? 'ri-shield-check-line' : report.category === 'Attendance' ? 'ri-calendar-check-line' : report.category === 'Interventions' ? 'ri-chat-smile-2-line' : report.category === 'Progress' ? 'ri-bar-chart-line' : report.category === 'Coaching' ? 'ri-heart-line' : report.category === 'Employer' ? 'ri-building-2-line' : report.category === 'Evidence' ? 'ri-folder-line' : report.category === 'Gateway & EPA' ? 'ri-flag-line' : report.category === 'Engagement' ? 'ri-line-chart-line' : 'ri-pie-chart-line';
            return (
              <div key={report.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0"><i className={`${catIcon} text-lg`}></i></span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground-900">{report.title}</h3>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{report.category}</span>
                  </div>
                </div>
                <p className="text-[12px] text-foreground-500 mb-4">{report.description}</p>
                <div className="flex items-center gap-x-4 gap-y-1 text-[10px] text-foreground-400 mb-3 flex-wrap">
                  <span><i className="ri-calendar-line mr-0.5"></i> {EMPTY_VALUE}</span>
                  <span><i className="ri-file-line mr-0.5"></i> {report.format}</span>
                  <span><i className="ri-loop-left-line mr-0.5"></i> {report.frequency}</span>
                </div>
                <button onClick={() => handleGenerate(report)} disabled={loading} className="w-full px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed">
                  <i className={loading ? 'ri-loader-4-line animate-spin mr-1' : 'ri-download-line mr-1'}></i> {loading ? 'Loading Sources' : 'Generate Report'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ReportGeneratorModal report={activeReport} onClose={() => setActiveReport(null)} />
    </WorkspaceShell>
  );
}
