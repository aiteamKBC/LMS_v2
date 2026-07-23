import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { DEFAULT_COACH_EMAIL, formatDateLabel } from '@/pages/coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;

type MonthlyStatus = 'on-track' | 'need-attention' | 'at-risk';
type ActivityTone = 'primary' | 'emerald' | 'amber' | 'red';
type InlineActivityFilter = 'all' | 'learning' | 'quiz' | 'video' | 'coaching' | 'evidence';
type CoachingDeliveryKind = 'mcr' | 'pr' | 'catch-up' | 'support';
type CoachingDeliveryStatus = 'booked' | 'completed' | 'cancelled' | 'needs-schedule';

interface MonthlyActivityItem {
  id: string;
  date: string;
  type: string;
  title: string;
  detail: string;
  tone: ActivityTone;
  source: string;
  status?: string;
  timeLabel?: string;
}

interface MonthlyLearnerActivity {
  id: string;
  name: string;
  initials: string;
  email?: string | null;
  cohortName: string;
  group: string;
  programme: string;
  status: MonthlyStatus;
  otjhStatus: string;
  lastActivityDate?: string | null;
  lastActivityLabel: string;
  learning: {
    total: number;
    quizzes: number;
    videos: number;
    components: number;
    reflections: number;
  };
  coaching: {
    total: number;
    booked: number;
    needsSchedule: number;
    mcm: number;
    progressReviews: number;
    catchups: number;
  };
  evidence: {
    submitted: number;
    latestDate?: string | null;
  };
  ksb: {
    touched: number;
    codes: string[];
  };
  otjh: {
    monthlyHours: number;
    monthlyHoursLabel: string;
    monthlyTarget: number;
    progress: number;
    completed: number;
    target: number;
  };
  needsAction: string[];
  activities: MonthlyActivityItem[];
}

interface MonthlySummary {
  activeLearners: number;
  timelineItems: number;
  learningActivities: number;
  quizzes: number;
  videos: number;
  components: number;
  coachingSessions: number;
  bookedSessions: number;
  needsSchedule: number;
  evidence: number;
  ksbTouched: number;
  otjhHours: number;
  needsAction: number;
  onTrack: number;
  needAttention: number;
  atRisk: number;
}

interface MonthlyActivityResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  month: string;
  monthLabel: string;
  summary: MonthlySummary;
  learners: MonthlyLearnerActivity[];
}

interface CoachingDeliveryItem {
  id: string;
  learnerId: string;
  learnerName: string;
  learnerStatus: MonthlyStatus;
  kind: CoachingDeliveryKind;
  label: string;
  title: string;
  detail: string;
  date: string;
  status: CoachingDeliveryStatus;
  timeLabel: string;
}

interface CoachingDeliverySummary {
  byKind: Record<CoachingDeliveryKind, {
    items: CoachingDeliveryItem[];
    counts: Record<CoachingDeliveryStatus, number>;
  }>;
}

const EMPTY_SUMMARY: MonthlySummary = {
  activeLearners: 0,
  timelineItems: 0,
  learningActivities: 0,
  quizzes: 0,
  videos: 0,
  components: 0,
  coachingSessions: 0,
  bookedSessions: 0,
  needsSchedule: 0,
  evidence: 0,
  ksbTouched: 0,
  otjhHours: 0,
  needsAction: 0,
  onTrack: 0,
  needAttention: 0,
  atRisk: 0,
};
const EMPTY_LEARNERS: MonthlyLearnerActivity[] = [];
const LEARNERS_PER_PAGE = 10;

const statusConfig: Record<MonthlyStatus, { label: string; pill: string; border: string; soft: string }> = {
  'on-track': {
    label: 'On Track',
    pill: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    border: 'border-emerald-200',
    soft: 'bg-emerald-50 text-emerald-700',
  },
  'need-attention': {
    label: 'Need Attention',
    pill: 'bg-amber-100 text-amber-700 ring-amber-200',
    border: 'border-amber-200',
    soft: 'bg-amber-50 text-amber-700',
  },
  'at-risk': {
    label: 'At Risk',
    pill: 'bg-red-100 text-red-700 ring-red-200',
    border: 'border-red-200',
    soft: 'bg-red-50 text-red-700',
  },
};

const toneConfig: Record<ActivityTone, { icon: string; badge: string; dot: string }> = {
  primary: {
    icon: 'bg-primary-100 text-primary-700',
    badge: 'bg-primary-50 text-primary-700',
    dot: 'bg-primary-500',
  },
  emerald: {
    icon: 'bg-emerald-100 text-emerald-700',
    badge: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
  amber: {
    icon: 'bg-amber-100 text-amber-700',
    badge: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
  },
  red: {
    icon: 'bg-red-100 text-red-700',
    badge: 'bg-red-50 text-red-700',
    dot: 'bg-red-500',
  },
};

const INLINE_FILTERS: { key: InlineActivityFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'ri-pulse-line' },
  { key: 'learning', label: 'Learning', icon: 'ri-checkbox-circle-line' },
  { key: 'video', label: 'Videos', icon: 'ri-play-circle-line' },
  { key: 'quiz', label: 'Quizzes', icon: 'ri-question-answer-line' },
  { key: 'coaching', label: 'Coaching', icon: 'ri-calendar-check-line' },
  { key: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
];

const COACHING_DELIVERY_CONFIG: Record<CoachingDeliveryKind, { label: string; shortLabel: string; icon: string; tone: ActivityTone }> = {
  mcr: { label: 'MCR / MCM', shortLabel: 'MCR', icon: 'ri-user-voice-line', tone: 'emerald' },
  pr: { label: 'Progress Reviews', shortLabel: 'PR', icon: 'ri-file-list-3-line', tone: 'primary' },
  'catch-up': { label: 'Catch-ups', shortLabel: 'Catch-up', icon: 'ri-chat-check-line', tone: 'amber' },
  support: { label: 'Support', shortLabel: 'Support', icon: 'ri-hand-heart-line', tone: 'red' },
};
const COACHING_DELIVERY_ORDER: CoachingDeliveryKind[] = ['mcr', 'pr', 'catch-up', 'support'];
const COACHING_DELIVERY_STATUS_CONFIG: Record<CoachingDeliveryStatus, { label: string; className: string }> = {
  booked: { label: 'Booked', className: 'bg-sky-50 text-sky-700 ring-sky-100' },
  completed: { label: 'Completed', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  cancelled: { label: 'Cancelled', className: 'bg-red-50 text-red-700 ring-red-100' },
  'needs-schedule': { label: 'Needs schedule', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
};
const COACHING_DELIVERY_STATUS_ORDER: CoachingDeliveryStatus[] = ['booked', 'completed', 'cancelled', 'needs-schedule'];

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthKey(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return currentMonthKey(date);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function monthlyActivityEndpoint(monthKey: string) {
  const params = new URLSearchParams({
    owner_email: DEFAULT_COACH_EMAIL,
    month: monthKey,
  });
  return `/coach_api/coach/monthly-activity?${params.toString()}`;
}

function activityIcon(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes('quiz')) return 'ri-question-answer-line';
  if (normalized.includes('video')) return 'ri-play-circle-line';
  if (normalized.includes('evidence')) return 'ri-folder-upload-line';
  if (normalized.includes('support')) return 'ri-hand-heart-line';
  if (normalized.includes('mcm') || normalized.includes('mcr') || normalized.includes('catch') || normalized.includes('pr')) return 'ri-calendar-check-line';
  return 'ri-checkbox-circle-line';
}

function formatSourceLabel(source: string) {
  return source
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inlineActivityCategory(type: string): InlineActivityFilter {
  const normalized = type.toLowerCase();
  if (normalized.includes('quiz')) return 'quiz';
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('evidence')) return 'evidence';
  if (normalized.includes('mcm') || normalized.includes('mcr') || normalized.includes('catch') || normalized.includes('pr') || normalized.includes('support') || normalized.includes('welfare') || normalized.includes('coaching') || normalized.includes('review')) return 'coaching';
  return 'learning';
}

function coachingDeliveryKind(activity: MonthlyActivityItem): CoachingDeliveryKind | null {
  const type = activity.type.trim().toLowerCase();
  const text = `${activity.type} ${activity.title} ${activity.detail} ${activity.source}`.toLowerCase();
  if (type === 'mcm' || type === 'mcr' || text.includes('monthly coaching')) return 'mcr';
  if (type === 'pr' || text.includes('progress review') || text.includes('progress-review')) return 'pr';
  if (text.includes('catch-up') || text.includes('catch up') || text.includes('catchup')) return 'catch-up';
  if (text.includes('student support') || text.includes('support') || text.includes('welfare')) return 'support';
  return null;
}

function coachingDeliveryStatus(activity: MonthlyActivityItem) {
  return activity.detail.split(' - ')[0]?.trim() || 'Captured';
}

function coachingDeliveryStatusKey(activity: MonthlyActivityItem): CoachingDeliveryStatus {
  const rawStatus = normalizeSearch(activity.status || coachingDeliveryStatus(activity));
  if (rawStatus.includes('completed')) return 'completed';
  if (rawStatus.includes('cancelled') || rawStatus.includes('canceled')) return 'cancelled';
  if (rawStatus.includes('not-scheduled') || rawStatus.includes('needs schedule') || rawStatus.includes('need schedule')) return 'needs-schedule';
  return 'booked';
}

function emptyCoachingDeliveryCounts(): Record<CoachingDeliveryStatus, number> {
  return {
    booked: 0,
    completed: 0,
    cancelled: 0,
    'needs-schedule': 0,
  };
}

function emptyCoachingDeliverySummary(): CoachingDeliverySummary {
  return {
    byKind: COACHING_DELIVERY_ORDER.reduce((acc, kind) => {
      acc[kind] = {
        items: [],
        counts: emptyCoachingDeliveryCounts(),
      };
      return acc;
    }, {} as CoachingDeliverySummary['byKind']),
  };
}

function groupActivitiesByDate(activities: MonthlyActivityItem[]) {
  const groups = new Map<string, MonthlyActivityItem[]>();
  activities.forEach((activity) => {
    const items = groups.get(activity.date) || [];
    groups.set(activity.date, [...items, activity]);
  });
  return Array.from(groups.entries());
}

function uniqueActivityDays(activities: MonthlyActivityItem[]) {
  return new Set(activities.map((activity) => activity.date)).size;
}

function safeTone(tone: ActivityTone) {
  return toneConfig[tone] || toneConfig.primary;
}

function safeStatus(status: MonthlyStatus) {
  return statusConfig[status] || statusConfig['need-attention'];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-GB').format(value);
}

function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

const PDF_MARGIN = 14;
const PDF_PAGE_WIDTH = 210;
const PDF_PAGE_HEIGHT = 297;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - (PDF_MARGIN * 2);

function pdfFileNameSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'learner';
}

function ensurePdfSpace(doc: jsPDF, y: number, heightNeeded: number) {
  if (y + heightNeeded <= PDF_PAGE_HEIGHT - PDF_MARGIN) return y;
  doc.addPage();
  return PDF_MARGIN;
}

function addPdfDivider(doc: jsPDF, y: number) {
  const lineY = ensurePdfSpace(doc, y, 2);
  doc.setDrawColor(226, 232, 240);
  doc.line(PDF_MARGIN, lineY, PDF_PAGE_WIDTH - PDF_MARGIN, lineY);
  return lineY + 4;
}

function addPdfText(
  doc: jsPDF,
  {
    text,
    y,
    x = PDF_MARGIN,
    maxWidth = PDF_CONTENT_WIDTH,
    fontSize = 10,
    fontStyle = 'normal',
    textColor = [17, 24, 39],
    lineHeight = 5,
  }: {
    text: string;
    y: number;
    x?: number;
    maxWidth?: number;
    fontSize?: number;
    fontStyle?: 'normal' | 'bold';
    textColor?: [number, number, number];
    lineHeight?: number;
  },
) {
  doc.setFont('helvetica', fontStyle);
  doc.setFontSize(fontSize);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  const neededHeight = Math.max(lineHeight, lines.length * lineHeight);
  const nextY = ensurePdfSpace(doc, y, neededHeight);

  doc.text(lines, x, nextY);
  return nextY + neededHeight;
}

function downloadLearnerMonthlyCyclePdf(learner: MonthlyLearnerActivity, monthLabel: string, monthKey: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const status = safeStatus(learner.status);
  const learningActivities = learner.activities.filter((activity) => ['learning', 'quiz', 'video'].includes(inlineActivityCategory(activity.type)));
  const counts = {
    quiz: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'quiz').length,
    video: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'video').length,
    learning: learningActivities.length,
    coaching: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'coaching').length,
    evidence: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'evidence').length,
  };
  const generatedDate = formatDateLabel(new Date().toISOString());
  const pageBottom = PDF_PAGE_HEIGHT - 20;
  const colors = {
    navy: [15, 23, 42] as [number, number, number],
    muted: [100, 116, 139] as [number, number, number],
    border: [226, 232, 240] as [number, number, number],
    panel: [248, 250, 252] as [number, number, number],
    purple: [84, 32, 138] as [number, number, number],
    purpleSoft: [245, 243, 255] as [number, number, number],
    emerald: [16, 185, 129] as [number, number, number],
    amber: [245, 158, 11] as [number, number, number],
    red: [239, 68, 68] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
  };
  const statusAccent = learner.status === 'on-track' ? colors.emerald : learner.status === 'at-risk' ? colors.red : colors.amber;
  const activityAccent = (category: InlineActivityFilter): [number, number, number] => {
    if (category === 'quiz') return colors.amber;
    if (category === 'video') return colors.red;
    if (category === 'coaching') return colors.emerald;
    if (category === 'evidence') return colors.purple;
    return [99, 102, 241];
  };
  const setFill = (color: [number, number, number]) => doc.setFillColor(color[0], color[1], color[2]);
  const setStroke = (color: [number, number, number]) => doc.setDrawColor(color[0], color[1], color[2]);
  const setText = (fontSize: number, fontStyle: 'normal' | 'bold' = 'normal', color: [number, number, number] = colors.navy) => {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const ensureSpace = (heightNeeded: number) => {
    if (y + heightNeeded <= pageBottom) return;
    doc.addPage();
    y = PDF_MARGIN;
  };
  const drawSummaryCard = (index: number, label: string, value: string, detail: string) => {
    const gap = 3;
    const width = (PDF_CONTENT_WIDTH - (gap * 3)) / 4;
    const x = PDF_MARGIN + (index * (width + gap));
    setFill(colors.panel);
    setStroke(colors.border);
    doc.roundedRect(x, y, width, 27, 3, 3, 'FD');
    setFill(colors.purpleSoft);
    doc.roundedRect(x + 4, y + 5, 8, 8, 2, 2, 'F');
    setText(7, 'bold', colors.muted);
    doc.text(label.toUpperCase(), x + 15, y + 9);
    setText(16, 'bold', colors.navy);
    doc.text(value, x + 15, y + 17);
    setText(7.5, 'normal', colors.muted);
    doc.text(detail, x + 15, y + 23);
  };
  const drawBreakdownCard = (index: number, label: string, value: number, accent: [number, number, number]) => {
    const gap = 3;
    const columns = 3;
    const width = (PDF_CONTENT_WIDTH - (gap * (columns - 1))) / columns;
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = PDF_MARGIN + (column * (width + gap));
    const cardY = y + (row * 15);
    setFill(colors.white);
    setStroke(colors.border);
    doc.roundedRect(x, cardY, width, 12, 2.5, 2.5, 'FD');
    setFill(accent);
    doc.roundedRect(x + 3, cardY + 3.2, 2.2, 5.6, 1, 1, 'F');
    setText(8.5, 'bold', colors.navy);
    doc.text(label, x + 8, cardY + 7.5);
    setText(11, 'bold', colors.purple);
    doc.text(formatNumber(value), x + width - 5, cardY + 7.5, { align: 'right' });
  };
  const addFooter = () => {
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      setStroke(colors.border);
      doc.line(PDF_MARGIN, PDF_PAGE_HEIGHT - 13, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_PAGE_HEIGHT - 13);
      setText(8, 'normal', colors.muted);
      doc.text(`Generated ${generatedDate}`, PDF_MARGIN, PDF_PAGE_HEIGHT - 8);
      doc.text(`Page ${page} of ${pageCount}`, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_PAGE_HEIGHT - 8, { align: 'right' });
    }
  };

  let y = PDF_MARGIN;

  setFill(colors.panel);
  doc.rect(0, 0, PDF_PAGE_WIDTH, 5, 'F');
  setFill(colors.purple);
  doc.rect(PDF_MARGIN, 0, 46, 3, 'F');

  setFill(colors.white);
  setStroke(colors.border);
  doc.roundedRect(PDF_MARGIN, y + 5, PDF_CONTENT_WIDTH, 38, 4, 4, 'FD');
  setFill(colors.purple);
  doc.roundedRect(PDF_MARGIN, y + 5, 3, 38, 1.5, 1.5, 'F');
  setFill(colors.purpleSoft);
  doc.circle(PDF_MARGIN + 15, y + 24, 9, 'F');
  setText(9, 'bold', colors.purple);
  doc.text(learner.initials || 'LR', PDF_MARGIN + 15, y + 26, { align: 'center' });

  setText(7.5, 'bold', colors.purple);
  doc.text('MONTHLY CYCLE REPORT', PDF_MARGIN + 30, y + 16);
  setText(18, 'bold', colors.navy);
  doc.text(learner.name, PDF_MARGIN + 30, y + 27);
  setText(8.5, 'normal', colors.muted);
  doc.text(`${monthLabel} | ${learner.cohortName} - ${learner.group}`, PDF_MARGIN + 30, y + 35);

  const statusText = status.label.toUpperCase();
  setText(6.7, 'bold', colors.white);
  const statusWidth = Math.max(25, doc.getTextWidth(statusText) + 8);
  const statusX = PDF_PAGE_WIDTH - PDF_MARGIN - statusWidth - 6;
  setFill(statusAccent);
  doc.roundedRect(statusX, y + 14, statusWidth, 8, 4, 4, 'F');
  doc.text(statusText, statusX + (statusWidth / 2), y + 19.2, { align: 'center' });

  setText(7.2, 'normal', colors.muted);
  doc.text('Generated', PDF_PAGE_WIDTH - PDF_MARGIN - 6, y + 31, { align: 'right' });
  setText(8, 'bold', colors.navy);
  doc.text(generatedDate, PDF_PAGE_WIDTH - PDF_MARGIN - 6, y + 37, { align: 'right' });

  y += 53;

  setFill(colors.panel);
  setStroke(colors.border);
  doc.roundedRect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 20, 3, 3, 'FD');
  setText(8, 'bold', colors.muted);
  doc.text('LAST CAPTURED', PDF_MARGIN + 6, y + 8);
  doc.text('PROGRAMME', PDF_MARGIN + 65, y + 8);
  doc.text('OTJH STATUS', PDF_MARGIN + 124, y + 8);
  setText(9.5, 'bold', colors.navy);
  doc.text(learner.lastActivityLabel || 'No activity captured', PDF_MARGIN + 6, y + 15);
  doc.text(learner.programme || '--', PDF_MARGIN + 65, y + 15);
  doc.text(learner.otjhStatus || status.label, PDF_MARGIN + 124, y + 15);

  y += 30;
  drawSummaryCard(0, 'Total events', formatNumber(learner.activities.length), 'Captured items');
  drawSummaryCard(1, 'Active days', formatNumber(uniqueActivityDays(learner.activities)), 'With activity');
  drawSummaryCard(2, 'Time logged', learner.otjh.monthlyHoursLabel, 'OTJH this month');
  drawSummaryCard(3, 'KSBs evidenced', formatNumber(learner.ksb.touched), 'Unique codes');
  y += 35;

  y = addPdfText(doc, { text: 'Activity Breakdown', y, fontSize: 12, fontStyle: 'bold', lineHeight: 6 });
  y += 1;
  const breakdown = [
    { label: 'All', value: learner.activities.length, accent: colors.purple },
    { label: 'Learning', value: counts.learning, accent: activityAccent('learning') },
    { label: 'Videos', value: counts.video, accent: activityAccent('video') },
    { label: 'Quizzes', value: counts.quiz, accent: activityAccent('quiz') },
    { label: 'Coaching', value: counts.coaching, accent: activityAccent('coaching') },
    { label: 'Evidence', value: counts.evidence, accent: activityAccent('evidence') },
  ];
  breakdown.forEach((item, index) => drawBreakdownCard(index, item.label, item.value, item.accent));
  y += 34;

  if (learner.needsAction.length > 0) {
    const actionLines = doc.splitTextToSize(learner.needsAction.join(' | '), PDF_CONTENT_WIDTH - 10) as string[];
    const actionHeight = Math.max(16, 12 + (actionLines.length * 4));
    ensureSpace(actionHeight + 8);
    setFill([254, 242, 242]);
    setStroke([254, 202, 202]);
    doc.roundedRect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, actionHeight, 3, 3, 'FD');
    setText(8, 'bold', colors.red);
    doc.text('ACTION FLAGS', PDF_MARGIN + 5, y + 6);
    setText(8.5, 'normal', colors.navy);
    doc.text(actionLines, PDF_MARGIN + 5, y + 12);
    y += actionHeight + 8;
  }

  y = addPdfDivider(doc, y);
  y = addPdfText(doc, { text: 'Activity Timeline', y, fontSize: 13, fontStyle: 'bold', lineHeight: 7 });

  if (!learner.activities.length) {
    setFill(colors.panel);
    setStroke(colors.border);
    doc.roundedRect(PDF_MARGIN, y + 2, PDF_CONTENT_WIDTH, 24, 3, 3, 'FD');
    y = addPdfText(doc, { text: `No activity captured for ${monthLabel}.`, y: y + 10, x: PDF_MARGIN + 6, maxWidth: PDF_CONTENT_WIDTH - 12, textColor: colors.muted });
  } else {
    let timelineIndex = 1;
    groupActivitiesByDate(learner.activities).forEach(([day, activities]) => {
      ensureSpace(14);
      setFill(colors.purpleSoft);
      setStroke([221, 214, 254]);
      doc.roundedRect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 10, 3, 3, 'FD');
      setText(8.5, 'bold', colors.purple);
      doc.text(formatDateLabel(day), PDF_MARGIN + 5, y + 6.5);
      setText(8, 'normal', colors.muted);
      doc.text(`${activities.length} item${activities.length === 1 ? '' : 's'}`, PDF_PAGE_WIDTH - PDF_MARGIN - 5, y + 6.5, { align: 'right' });
      y += 14;

      activities.forEach((activity) => {
        const category = inlineActivityCategory(activity.type);
        const accent = activityAccent(category);
        const titleLines = doc.splitTextToSize(activity.title || 'Untitled activity', PDF_CONTENT_WIDTH - 38) as string[];
        const detailLines = doc.splitTextToSize(activity.detail || 'No detail captured', PDF_CONTENT_WIDTH - 38) as string[];
        const cardHeight = Math.max(27, 19 + (titleLines.length * 4.5) + (detailLines.length * 4.2));
        ensureSpace(cardHeight + 5);

        setFill(colors.white);
        setStroke(colors.border);
        doc.roundedRect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, cardHeight, 3, 3, 'FD');
        setFill(accent);
        doc.roundedRect(PDF_MARGIN, y, 2.2, cardHeight, 1, 1, 'F');

        setFill(colors.panel);
        doc.roundedRect(PDF_MARGIN + 7, y + 6, 11, 11, 3, 3, 'F');
        setText(8, 'bold', accent);
        doc.text(String(timelineIndex), PDF_MARGIN + 12.5, y + 13, { align: 'center' });

        setFill(colors.purpleSoft);
        doc.roundedRect(PDF_MARGIN + 23, y + 6, 25, 6.5, 2, 2, 'F');
        setText(6.7, 'bold', colors.purple);
        doc.text(activity.type.toUpperCase().slice(0, 18), PDF_MARGIN + 35.5, y + 10.5, { align: 'center' });

        setText(7.5, 'normal', colors.muted);
        doc.text(formatSourceLabel(activity.source), PDF_PAGE_WIDTH - PDF_MARGIN - 6, y + 10.5, { align: 'right' });

        let textY = y + 18;
        setText(9.5, 'bold', colors.navy);
        doc.text(titleLines, PDF_MARGIN + 23, textY);
        textY += titleLines.length * 4.5;
        setText(8.2, 'normal', colors.muted);
        doc.text(detailLines, PDF_MARGIN + 23, textY);

        y += cardHeight + 5;
        timelineIndex += 1;
      });
    });
  }

  addFooter();
  doc.save(`monthly-cycle-${pdfFileNameSegment(learner.name)}-${monthKey}.pdf`);
}

export default function CoachMonthlyCycle() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [data, setData] = useState<MonthlyActivityResponse | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [expandedLearnerId, setExpandedLearnerId] = useState<string | null>(null);
  const [learnerSearch, setLearnerSearch] = useState('');
  const [learnerPage, setLearnerPage] = useState(1);
  const [inlineFilter, setInlineFilter] = useState<InlineActivityFilter>('all');
  const [inlineSearch, setInlineSearch] = useState('');
  const [exportingLearnerId, setExportingLearnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetch(monthlyActivityEndpoint(selectedMonth), { signal: controller.signal })
      .then(readJson<MonthlyActivityResponse>)
      .then((payload) => {
        setData(payload);
        setSelectedLearnerId((current) => {
          if (current && payload.learners.some((learner) => learner.id === current)) return current;
          return null;
        });
        setExpandedLearnerId((current) => {
          if (current && payload.learners.some((learner) => learner.id === current)) return current;
          return null;
        });
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setData(null);
        setSelectedLearnerId(null);
        setExpandedLearnerId(null);
        setError(requestError instanceof Error ? requestError.message : 'Unable to load monthly activity.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedMonth]);

  const summary = data?.summary || EMPTY_SUMMARY;
  const learners = data?.learners || EMPTY_LEARNERS;
  const monthLabel = data?.monthLabel || formatMonthLabel(selectedMonth);
  const learnersNeedingAction = useMemo(
    () => learners.filter((learner) => learner.needsAction.length > 0),
    [learners],
  );
  const filteredLearners = useMemo(() => {
    const query = normalizeSearch(learnerSearch);
    if (!query) return learners;
    return learners.filter((learner) => normalizeSearch(learner.name).includes(query));
  }, [learnerSearch, learners]);
  const totalLearnerPages = Math.max(1, Math.ceil(filteredLearners.length / LEARNERS_PER_PAGE));
  const visibleLearnerPage = Math.min(learnerPage, totalLearnerPages);
  const pageStartIndex = filteredLearners.length === 0 ? 0 : (visibleLearnerPage - 1) * LEARNERS_PER_PAGE;
  const pageEndIndex = Math.min(pageStartIndex + LEARNERS_PER_PAGE, filteredLearners.length);
  const paginatedLearners = useMemo(
    () => filteredLearners.slice(pageStartIndex, pageEndIndex),
    [filteredLearners, pageEndIndex, pageStartIndex],
  );
  const latestActivities = useMemo(
    () => learners
      .flatMap((learner) => learner.activities.map((activity) => ({ ...activity, learnerName: learner.name })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6),
    [learners],
  );
  const coachingDelivery = useMemo<CoachingDeliverySummary>(() => {
    const delivery = emptyCoachingDeliverySummary();

    learners.forEach((learner) => {
      learner.activities.forEach((activity) => {
        const kind = coachingDeliveryKind(activity);
        if (!kind) return;
        const config = COACHING_DELIVERY_CONFIG[kind];
        const status = coachingDeliveryStatusKey(activity);
        delivery.byKind[kind].counts[status] += 1;
        delivery.byKind[kind].items.push({
          id: `${learner.id}-${activity.id}`,
          learnerId: learner.id,
          learnerName: learner.name,
          learnerStatus: learner.status,
          kind,
          label: config.shortLabel,
          title: activity.title,
          detail: activity.detail,
          date: activity.date,
          status,
          timeLabel: activity.timeLabel || activity.detail.split(' - ')[1]?.trim() || 'Time TBC',
        });
      });
    });

    COACHING_DELIVERY_ORDER.forEach((kind) => {
      delivery.byKind[kind].items.sort((a, b) => b.date.localeCompare(a.date));
    });

    return delivery;
  }, [learners]);
  const selectedLearner = useMemo(
    () => learners.find((learner) => learner.id === selectedLearnerId) || null,
    [learners, selectedLearnerId],
  );

  useEffect(() => {
    setLearnerPage(1);
    setExpandedLearnerId(null);
    setInlineFilter('all');
    setInlineSearch('');
  }, [learnerSearch, selectedMonth]);

  useEffect(() => {
    setLearnerPage((page) => Math.min(page, totalLearnerPages));
  }, [totalLearnerPages]);

  const handleExportLearnerPdf = (learner: MonthlyLearnerActivity) => {
    setExportingLearnerId(learner.id);
    window.setTimeout(() => {
      try {
        downloadLearnerMonthlyCyclePdf(learner, monthLabel, selectedMonth);
      } finally {
        setExportingLearnerId((current) => (current === learner.id ? null : current));
      }
    }, 0);
  };

  const handleOpenLearnerOverview = (learnerId: string) => {
    setSelectedLearnerId(learnerId);
  };

  const handleCloseLearnerOverview = () => {
    setSelectedLearnerId(null);
  };

  const handleLearnerPageChange = (nextPage: number) => {
    const clampedPage = Math.max(1, Math.min(totalLearnerPages, nextPage));
    setLearnerPage(clampedPage);
    setExpandedLearnerId(null);
    setInlineFilter('all');
    setInlineSearch('');
  };

  const handleToggleLearnerTimeline = (learnerId: string) => {
    setExpandedLearnerId((current) => {
      const next = current === learnerId ? null : learnerId;
      if (next) {
        setInlineFilter('all');
        setInlineSearch('');
      }
      return next;
    });
  };

  return (
    <>
      <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Cycle" pageSubtitle="See what each learner did this month" userName={data?.owner?.name || 'Med Maher'} userRole="Progress Coach">
        <div className="p-6 space-y-6">
          <section className="rounded-3xl overflow-hidden shadow-sm border border-primary-900/20" style={{ background: 'linear-gradient(135deg, #070211 0%, #17032d 52%, #2a0754 100%)' }}>
            <div className="p-6 sm:p-8">
              <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                <div className="flex items-start gap-5 flex-1">
                  <div className="w-14 h-14 rounded-2xl bg-white/12 ring-1 ring-white/15 flex items-center justify-center shrink-0">
                    <i className="ri-radar-line text-white text-2xl"></i>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-200 mb-2">Monthly learner activity</p>
                    <h2 className="text-2xl font-heading font-bold text-white">Monthly Cycle - {monthLabel}</h2>
                    <p className="text-sm text-white/72 mt-2 max-w-2xl">
                      Track every learner touchpoint in the selected month: learning completions, coaching and reviews, evidence, KSBs, and OTJH logged.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 w-full lg:w-auto">
                  <HeroStat label="Learners" value={summary.activeLearners} />
                  <HeroStat label="Activities" value={summary.timelineItems} />
                  <HeroStat label="OTJH" value={formatHours(summary.otjhHours)} />
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col xl:flex-row xl:items-center gap-4 justify-between">
            <div className="flex items-center gap-2 bg-background-50 border border-foreground-200/70 rounded-2xl p-1 shadow-sm w-fit">
              <button type="button" onClick={() => setSelectedMonth((value) => shiftMonthKey(value, -1))} className="w-9 h-9 rounded-xl text-foreground-500 hover:bg-background-100 hover:text-primary-700 transition-smooth cursor-pointer">
                <i className="ri-arrow-left-s-line text-lg"></i>
              </button>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value || currentMonthKey())}
                className="h-9 px-3 rounded-xl bg-background-100 border border-transparent text-xs font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
              <button type="button" onClick={() => setSelectedMonth((value) => shiftMonthKey(value, 1))} className="w-9 h-9 rounded-xl text-foreground-500 hover:bg-background-100 hover:text-primary-700 transition-smooth cursor-pointer">
                <i className="ri-arrow-right-s-line text-lg"></i>
              </button>
            </div>
            <p className="text-xs text-foreground-500">
              Source: learner progress log, activity feed, and coach calendar for {monthLabel}.
            </p>
          </div>

          {!loading && !error && (
            <CoachDeliveryPanel
              delivery={coachingDelivery}
              monthLabel={monthLabel}
              onOpenLearner={handleOpenLearnerOverview}
            />
          )}

          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <SummaryCard icon="ri-checkbox-circle-line" label="Learning Actions" value={summary.learningActivities} accent="primary" detail={`${summary.quizzes} quizzes - ${summary.videos} videos - ${summary.components} components`} />
            <SummaryCard icon="ri-folder-upload-line" label="Evidence" value={summary.evidence} accent="amber" detail="Submitted this month" />
            <SummaryCard icon="ri-award-line" label="KSBs Touched" value={summary.ksbTouched} accent="primary" detail="Unique KSB codes" />
            <SummaryCard icon="ri-time-line" label="OTJH Logged" value={formatHours(summary.otjhHours)} accent="emerald" detail="From reported activity time" />
            <SummaryCard icon="ri-alarm-warning-line" label="Need Action" value={summary.needsAction} accent="red" detail="Learners with gaps" />
          </section>

          {loading && (
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-10 text-center shadow-sm">
              <i className="ri-loader-4-line text-primary-600 text-3xl animate-spin inline-block mb-3"></i>
              <p className="text-sm font-semibold text-foreground-700">Loading monthly activity...</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
              <i className="ri-error-warning-line text-red-500 text-3xl block mb-3"></i>
              <p className="text-sm font-semibold text-red-700">Unable to load monthly activity</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
              <section className="space-y-4">
                <div className="flex flex-col 2xl:flex-row 2xl:items-end gap-4 justify-between">
                  <div>
                    <h3 className="text-lg font-heading font-bold text-foreground-900">Learner Month Log</h3>
                    <p className="text-sm text-foreground-500">Each learner card shows the monthly cycle summary; use the arrow to open the detailed timeline.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full 2xl:w-auto">
                    <div className="relative w-full sm:w-80">
                      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
                      <input
                        type="search"
                        value={learnerSearch}
                        onChange={(event) => setLearnerSearch(event.target.value)}
                        placeholder="Search learner name..."
                        aria-label="Search learner name"
                        className="w-full h-10 pl-9 pr-9 rounded-xl bg-background-50 border border-foreground-200/80 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-200 shadow-sm"
                      />
                      {learnerSearch && (
                        <button
                          type="button"
                          onClick={() => setLearnerSearch('')}
                          aria-label="Clear learner search"
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
                        >
                          <i className="ri-close-line text-base"></i>
                        </button>
                      )}
                    </div>
                    <span className="px-3 py-1 rounded-full bg-background-50 border border-foreground-200 text-[11px] font-semibold text-foreground-600 w-fit">
                      Showing {filteredLearners.length === 0 ? 0 : pageStartIndex + 1}-{pageEndIndex} of {filteredLearners.length}
                    </span>
                  </div>
                </div>

                {learners.length === 0 && (
                  <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-10 text-center shadow-sm">
                    <i className="ri-user-search-line text-foreground-300 text-3xl block mb-3"></i>
                    <p className="text-sm font-semibold text-foreground-700">No active learners found</p>
                    <p className="text-xs text-foreground-400 mt-1">There are no active learners assigned to this coach for the selected month.</p>
                  </div>
                )}

                {learners.length > 0 && filteredLearners.length === 0 && (
                  <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-10 text-center shadow-sm">
                    <i className="ri-user-search-line text-foreground-300 text-3xl block mb-3"></i>
                    <p className="text-sm font-semibold text-foreground-700">No learners match this search</p>
                    <p className="text-xs text-foreground-400 mt-1">Try a different learner name for {monthLabel}.</p>
                  </div>
                )}

                {paginatedLearners.map((learner) => {
                  const selected = selectedLearnerId === learner.id;
                  const expanded = expandedLearnerId === learner.id;
                  const status = safeStatus(learner.status);
                  return (
                    <article key={learner.id} className={`relative overflow-hidden rounded-2xl border bg-[linear-gradient(135deg,#ffffff_0%,#fbfaff_62%,#f7f3ff_100%)] ${selected ? `${status.border} shadow-md ring-1 ring-primary-100` : 'border-primary-100/80 shadow-sm'} transition-smooth`}>
                      <div className="absolute inset-y-0 left-0 w-1.5 bg-primary-600"></div>
                      <div className="p-5 pl-7">
                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                          <button type="button" onClick={() => handleOpenLearnerOverview(learner.id)} className="flex items-start gap-4 text-left flex-1 min-w-0 cursor-pointer">
                            <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 ring-1 ring-primary-200 flex items-center justify-center text-sm font-bold shrink-0">
                              {learner.initials}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-heading font-bold text-foreground-900 truncate">{learner.name}</h4>
                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full ring-1 text-[10px] font-semibold ${status.pill}`}>{status.label}</span>
                              </div>
                              <p className="text-xs text-foreground-500 mt-1 truncate">{learner.cohortName} - {learner.group}</p>
                            </div>
                          </button>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <button type="button" onClick={() => handleOpenLearnerOverview(learner.id)} className="px-3 py-2 rounded-xl border border-primary-200 bg-primary-50 text-primary-700 text-[11px] font-semibold hover:bg-primary-100 transition-smooth cursor-pointer">
                              <i className="ri-layout-right-line mr-1.5"></i>
                              Overview
                            </button>
                            <button type="button" onClick={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(learner.id)}`)} className="px-3 py-2 rounded-xl bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700 transition-smooth cursor-pointer">
                              View File
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleLearnerTimeline(learner.id)}
                              aria-label={expanded ? 'Collapse learner monthly cycle' : 'Open learner monthly cycle'}
                              className="w-9 h-9 rounded-xl border border-foreground-200 text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer"
                            >
                              <i className={`${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg`}></i>
                            </button>
                          </div>
                        </div>

                        <CoachLearnerMonthlyCycleSummary
                          learner={learner}
                          monthLabel={monthLabel}
                          monthKey={selectedMonth}
                        />
                      </div>

                      {expanded && (
                        <CoachLearnerMonthlyCycleInline
                          learner={learner}
                          monthLabel={monthLabel}
                          filter={inlineFilter}
                          query={inlineSearch}
                          onFilterChange={setInlineFilter}
                          onQueryChange={setInlineSearch}
                        />
                      )}
                    </article>
                  );
                })}

                {filteredLearners.length > LEARNERS_PER_PAGE && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold text-foreground-600">
                      Page {visibleLearnerPage} of {totalLearnerPages} - showing {pageStartIndex + 1}-{pageEndIndex} of {filteredLearners.length} learners
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleLearnerPageChange(visibleLearnerPage - 1)}
                        disabled={visibleLearnerPage === 1}
                        className="h-9 px-3 rounded-xl border border-foreground-200 bg-white text-xs font-semibold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <i className="ri-arrow-left-s-line mr-1"></i>
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLearnerPageChange(visibleLearnerPage + 1)}
                        disabled={visibleLearnerPage === totalLearnerPages}
                        className="h-9 px-3 rounded-xl border border-foreground-200 bg-white text-xs font-semibold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Next
                        <i className="ri-arrow-right-s-line ml-1"></i>
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <aside className="space-y-5">
                <div className="bg-background-50 rounded-2xl border border-foreground-200/70 p-5 shadow-sm">
                  <h3 className="text-sm font-heading font-bold text-foreground-900 mb-4">Month Health</h3>
                  <div className="space-y-3">
                    <HealthRow label="On Track" value={summary.onTrack} total={summary.activeLearners} color="bg-emerald-500" />
                    <HealthRow label="Need Attention" value={summary.needAttention} total={summary.activeLearners} color="bg-amber-500" />
                    <HealthRow label="At Risk" value={summary.atRisk} total={summary.activeLearners} color="bg-red-500" />
                  </div>
                </div>

                <div className="bg-background-50 rounded-2xl border border-foreground-200/70 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-heading font-bold text-foreground-900">Action Queue</h3>
                    <span className="text-[10px] font-semibold text-foreground-400">{learnersNeedingAction.length} learner{learnersNeedingAction.length === 1 ? '' : 's'}</span>
                  </div>
                  {learnersNeedingAction.length === 0 ? (
                    <div className="rounded-2xl bg-emerald-50 p-4 text-center">
                      <i className="ri-check-double-line text-emerald-600 text-2xl block mb-2"></i>
                      <p className="text-xs font-semibold text-emerald-800">No action gaps for this month.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {learnersNeedingAction.slice(0, 5).map((learner) => (
                        <button key={learner.id} type="button" onClick={() => handleOpenLearnerOverview(learner.id)} className="w-full text-left rounded-2xl bg-background-100 hover:bg-background-200/60 border border-foreground-200/50 p-3 transition-smooth cursor-pointer">
                          <p className="text-xs font-bold text-foreground-900">{learner.name}</p>
                          <p className="text-[11px] text-foreground-500 mt-1">{learner.needsAction[0]}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-background-50 rounded-2xl border border-foreground-200/70 p-5 shadow-sm">
                  <h3 className="text-sm font-heading font-bold text-foreground-900 mb-4">Latest Captured</h3>
                  {latestActivities.length === 0 ? (
                    <p className="text-xs text-foreground-400">No captured activity yet for {monthLabel}.</p>
                  ) : (
                    <div className="space-y-3">
                      {latestActivities.map((activity) => {
                        const tone = safeTone(activity.tone);
                        return (
                          <div key={`${activity.learnerName}-${activity.id}`} className="flex gap-3">
                            <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${tone.dot}`}></span>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground-900 truncate">{activity.learnerName}</p>
                              <p className="text-[11px] text-foreground-500 truncate">{activity.title}</p>
                              <p className="text-[10px] text-foreground-400">{formatDateLabel(activity.date)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>
      </WorkspaceShell>

      <RightSlidePanel
        isOpen={!!selectedLearner}
        onClose={handleCloseLearnerOverview}
        title={selectedLearner ? `${selectedLearner.name} Overview` : 'Learner Overview'}
        width="w-[620px]"
        coloredHeader
      >
        {selectedLearner && (
          <LearnerOverviewPanel
            learner={selectedLearner}
            monthLabel={monthLabel}
            isExporting={exportingLearnerId === selectedLearner.id}
            onExport={() => handleExportLearnerPdf(selectedLearner)}
          />
        )}
      </RightSlidePanel>
    </>
  );
}

function CoachDeliveryPanel({
  delivery,
  monthLabel,
  onOpenLearner,
}: {
  delivery: CoachingDeliverySummary;
  monthLabel: string;
  onOpenLearner: (learnerId: string) => void;
}) {
  const totalCaptured = COACHING_DELIVERY_ORDER.reduce(
    (sum, kind) => sum + COACHING_DELIVERY_STATUS_ORDER.reduce((kindSum, status) => kindSum + delivery.byKind[kind].counts[status], 0),
    0,
  );

  return (
    <section className="rounded-3xl border border-foreground-200/80 bg-background-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">
            <i className="ri-user-voice-line text-emerald-600"></i>
            Coaching session status
          </span>
          <h3 className="mt-2 text-lg font-heading font-bold text-foreground-900">MCR, PR, catch-up and support in {monthLabel}</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground-500">Booked, completed, cancelled, and not-yet-scheduled sessions for the selected month.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-foreground-200 bg-white px-3 py-2 text-xs font-semibold text-foreground-500 shadow-sm">
          <span className="text-base font-heading font-bold text-foreground-900">{formatNumber(totalCaptured)}</span>
          captured sessions
        </span>
      </div>

      <div className="mt-4 grid items-start gap-3 xl:grid-cols-2">
        {COACHING_DELIVERY_ORDER.map((kind) => (
          <CoachDeliveryKindCard
            key={kind}
            kind={kind}
            items={delivery.byKind[kind].items}
            counts={delivery.byKind[kind].counts}
            monthLabel={monthLabel}
            onOpenLearner={onOpenLearner}
          />
        ))}
      </div>
    </section>
  );
}

function CoachDeliveryKindCard({
  kind,
  items,
  counts,
  monthLabel,
  onOpenLearner,
}: {
  kind: CoachingDeliveryKind;
  items: CoachingDeliveryItem[];
  counts: Record<CoachingDeliveryStatus, number>;
  monthLabel: string;
  onOpenLearner: (learnerId: string) => void;
}) {
  const config = COACHING_DELIVERY_CONFIG[kind];
  const tone = safeTone(config.tone);
  const total = COACHING_DELIVERY_STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);

  return (
    <article className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
      <div className={`h-1 ${config.tone === 'emerald' ? 'bg-emerald-500' : config.tone === 'amber' ? 'bg-amber-500' : config.tone === 'red' ? 'bg-red-500' : 'bg-primary-500'}`}></div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>
              <i className={`${config.icon} text-base`}></i>
            </span>
            <div>
              <h4 className="text-sm font-heading font-bold text-foreground-900">{config.label}</h4>
              <p className="mt-0.5 text-[11px] text-foreground-500">{formatNumber(total)} item{total === 1 ? '' : 's'}</p>
            </div>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.badge}`}>{config.shortLabel}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {COACHING_DELIVERY_STATUS_ORDER.map((status) => (
            <CoachDeliveryStatusStat key={status} status={status} value={counts[status]} />
          ))}
        </div>

        {items.length === 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-foreground-200 bg-background-50 px-3 py-3">
            <i className={`${config.icon} text-lg text-foreground-300`}></i>
            <p className="text-xs font-semibold text-foreground-700">No {config.label.toLowerCase()} activity in {monthLabel}.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <CoachDeliveryRecentItem key={item.id} item={item} onOpenLearner={onOpenLearner} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function CoachDeliveryStatusStat({ status, value }: { status: CoachingDeliveryStatus; value: number }) {
  const config = COACHING_DELIVERY_STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${config.className}`}>
      <span className="text-sm font-heading font-bold">{formatNumber(value)}</span>
      {config.label}
    </span>
  );
}

function CoachDeliveryRecentItem({
  item,
  onOpenLearner,
}: {
  item: CoachingDeliveryItem;
  onOpenLearner: (learnerId: string) => void;
}) {
  const status = COACHING_DELIVERY_STATUS_CONFIG[item.status];

  return (
    <button
      type="button"
      onClick={() => onOpenLearner(item.learnerId)}
      className="w-full rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2 text-left transition-smooth hover:border-primary-200 hover:bg-primary-50/30 cursor-pointer"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${status.className}`}>{status.label}</span>
            <span className="text-[10px] text-foreground-400">{formatDateLabel(item.date)}</span>
            <span className="text-[10px] text-foreground-400">{item.timeLabel}</span>
          </div>
          <p className="mt-1 truncate text-xs font-bold text-foreground-900">{item.learnerName}</p>
          <p className="mt-0.5 truncate text-[11px] text-foreground-500">{item.title}</p>
        </div>
        <i className="ri-arrow-right-s-line shrink-0 text-lg text-foreground-300"></i>
      </div>
    </button>
  );
}

function CoachLearnerMonthlyCycleSummary({
  learner,
  monthLabel,
  monthKey,
}: {
  learner: MonthlyLearnerActivity;
  monthLabel: string;
  monthKey: string;
}) {
  return (
    <section className="mt-5 border-t border-primary-100/80 pt-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-primary-700">
            <i className="ri-sparkling-2-line text-primary-600"></i>
            Learner monthly cycle
          </span>
          <h4 className="mt-3 text-xl font-heading font-bold text-foreground-900">{monthLabel} activity</h4>
          <p className="mt-1 text-sm text-foreground-500">Monthly activity summary and captured evidence.</p>
        </div>
        <button
          type="button"
          onClick={() => downloadLearnerMonthlyCyclePdf(learner, monthLabel, monthKey)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-white px-4 text-xs font-bold text-primary-700 shadow-sm transition-smooth hover:bg-primary-50 cursor-pointer"
        >
          <i className="ri-file-pdf-line text-sm"></i>
          Download PDF
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MonthlyCycleStat icon="ri-pulse-line" label="Total events" value={learner.activities.length} tone="primary" />
        <MonthlyCycleStat icon="ri-calendar-check-line" label="Active days" value={uniqueActivityDays(learner.activities)} tone="emerald" />
        <MonthlyCycleStat icon="ri-time-line" label="Time logged" value={learner.otjh.monthlyHoursLabel} tone="amber" />
        <MonthlyCycleStat icon="ri-award-line" label="KSBs evidenced" value={learner.ksb.touched} tone="primary" />
      </div>
    </section>
  );
}

function CoachLearnerMonthlyCycleInline({
  learner,
  monthLabel,
  filter,
  query,
  onFilterChange,
  onQueryChange,
}: {
  learner: MonthlyLearnerActivity;
  monthLabel: string;
  filter: InlineActivityFilter;
  query: string;
  onFilterChange: (value: InlineActivityFilter) => void;
  onQueryChange: (value: string) => void;
}) {
  const status = safeStatus(learner.status);
  const filteredActivities = useMemo(() => {
    const needle = normalizeSearch(query);
    return learner.activities.filter((activity) => {
      const category = inlineActivityCategory(activity.type);
      if (filter !== 'all' && category !== filter) return false;
      if (!needle) return true;
      return [activity.type, activity.title, activity.detail, activity.source]
        .some((value) => normalizeSearch(String(value || '')).includes(needle));
    });
  }, [filter, learner.activities, query]);
  const groupedActivities = useMemo(() => groupActivitiesByDate(filteredActivities), [filteredActivities]);
  const filterCounts = useMemo(() => {
    const counts = INLINE_FILTERS.reduce((acc, item) => ({ ...acc, [item.key]: 0 }), {} as Record<InlineActivityFilter, number>);
    learner.activities.forEach((activity) => {
      counts.all += 1;
      counts[inlineActivityCategory(activity.type)] += 1;
    });
    return counts;
  }, [learner.activities]);

  return (
    <div className="border-t border-primary-100/80 bg-primary-50/25 p-5 pl-7">
      <section className="rounded-2xl border border-primary-100/80 bg-white/80 p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1 xl:pb-0">
            {INLINE_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilterChange(item.key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-smooth cursor-pointer ${filter === item.key ? 'bg-primary-600 text-white shadow-sm' : 'bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700'}`}
              >
                <i className={`${item.icon} text-sm`}></i>
                {item.label}
                <span className={filter === item.key ? 'text-white/70' : 'text-foreground-400'}>{filterCounts[item.key]}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full xl:w-72">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search this month..."
              className="h-10 w-full rounded-xl border border-foreground-200 bg-background-50 pl-9 pr-9 text-sm outline-none transition-shadow focus:border-primary-400 focus:ring-4 focus:ring-primary-100"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Clear monthly cycle search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
              >
                <i className="ri-close-line text-base"></i>
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-primary-50/70 px-3 py-2 text-xs text-primary-800">
          <i className="ri-information-line mt-0.5 shrink-0 text-primary-600"></i>
          <p><span className="font-semibold">{filter === 'all' ? 'All activity' : INLINE_FILTERS.find((item) => item.key === filter)?.label}:</span> {filteredActivities.length} matching item{filteredActivities.length === 1 ? '' : 's'} in {monthLabel}.</p>
        </div>
      </section>

      <section className="mt-5">
        {groupedActivities.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-foreground-300 bg-background-50 px-6 py-12 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-background-100 text-foreground-400"><i className="ri-calendar-line text-xl"></i></span>
            <h4 className="mt-3 text-sm font-semibold text-foreground-800">No matching activity</h4>
            <p className="mt-1 text-xs text-foreground-500">Try another filter or search.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedActivities.map(([day, activities]) => (
              <div key={day} className="grid gap-3 lg:grid-cols-[150px_1fr]">
                <div className="lg:pt-1">
                  <div className="inline-flex items-center gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 px-3 py-2 shadow-sm">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-lg font-bold text-primary-700">{new Date(`${day}T12:00:00`).getDate()}</span>
                    <div>
                      <p className="text-xs font-semibold text-foreground-800">{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })}</p>
                      <p className="mt-0.5 text-[10px] text-foreground-400">{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} - {activities.length} item{activities.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                </div>
                <div className="relative space-y-3 border-l-2 border-primary-100 pl-4 before:absolute before:-left-[5px] before:top-4 before:h-2 before:w-2 before:rounded-full before:bg-primary-500 before:ring-4 before:ring-primary-100">
                  {activities.map((activity) => (
                    <InlineActivityCard key={activity.id} activity={activity} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${status.soft}`}>{status.label}</span>
        </div>
      </section>
    </div>
  );
}

function MonthlyCycleStat({ icon, label, value, tone }: { icon: string; label: string; value: number | string; tone: ActivityTone }) {
  const palette = safeTone(tone);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-foreground-200/70 bg-white p-3 shadow-[0_1px_8px_rgba(15,23,42,0.035)]">
      <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex ${palette.icon}`}>
        <i className={`${icon} text-sm`}></i>
      </span>
      <div>
        <p className="text-xl font-bold text-foreground-900">{typeof value === 'number' ? formatNumber(value) : value}</p>
        <p className="text-[11px] text-foreground-500">{label}</p>
      </div>
    </div>
  );
}

function InlineActivityCard({ activity }: { activity: MonthlyActivityItem }) {
  const tone = safeTone(activity.tone);
  return (
    <article className={`rounded-2xl border border-l-[3px] border-foreground-200/70 bg-background-50 p-4 shadow-[0_2px_10px_rgba(25,12,56,0.035)] transition-smooth hover:border-foreground-300 hover:shadow-md ${activity.tone === 'amber' ? 'border-l-amber-400' : activity.tone === 'red' ? 'border-l-red-400' : activity.tone === 'emerald' ? 'border-l-emerald-400' : 'border-l-primary-500'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>
          <i className={`${activityIcon(activity.type)} text-base`}></i>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.badge}`}>{activity.type}</span>
                <span className="text-xs text-foreground-400">{formatSourceLabel(activity.source)}</span>
              </div>
              <h4 className="mt-1 text-sm font-semibold text-foreground-900">{activity.title}</h4>
            </div>
            <span className="shrink-0 text-xs font-medium text-foreground-500">{formatDateLabel(activity.date)}</span>
          </div>
          {activity.detail && <p className="mt-1 text-xs leading-5 text-foreground-500">{activity.detail}</p>}
        </div>
      </div>
    </article>
  );
}

function LearnerOverviewPanel(
  {
    learner,
    monthLabel,
    isExporting,
    onExport,
  }: {
    learner: MonthlyLearnerActivity;
    monthLabel: string;
    isExporting: boolean;
    onExport: () => void;
  },
) {
  const status = safeStatus(learner.status);
  const coachingCoverage = learner.coaching.total > 0
    ? Math.round((learner.coaching.booked / learner.coaching.total) * 100)
    : learner.coaching.needsSchedule > 0 ? 0 : 100;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl overflow-hidden border border-primary-100 shadow-sm">
        <div className="p-5 bg-[linear-gradient(145deg,#faf7ff_0%,#f4f3ff_52%,#eef6ff_100%)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-700 ring-1 ring-primary-200 flex items-center justify-center text-base font-bold shrink-0">
                {learner.initials}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-lg font-heading font-bold text-foreground-900">{learner.name}</h4>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full ring-1 text-[10px] font-semibold ${status.pill}`}>{status.label}</span>
                </div>
                <p className="text-sm text-foreground-700 mt-1">{learner.programme || '--'}</p>
                <p className="text-[11px] text-foreground-500 mt-1">{learner.cohortName} - {learner.group}</p>
                <p className="text-[11px] text-foreground-500 mt-3">Monthly cycle snapshot for {monthLabel}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onExport}
              disabled={isExporting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 text-[12px] font-semibold text-white hover:bg-red-700 transition-smooth cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed sm:ml-auto"
            >
              <i className={`${isExporting ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-line'} text-sm`}></i>
              {isExporting ? 'Preparing PDF...' : 'Download PDF'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-2xl bg-white/80 border border-white/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Last captured</p>
              <p className="text-sm font-semibold text-foreground-900 mt-1">{learner.lastActivityLabel}</p>
              <p className="text-[11px] text-foreground-500 mt-1">{learner.lastActivityDate ? formatDateLabel(learner.lastActivityDate) : 'No date captured'}</p>
            </div>
            <div className="rounded-2xl bg-white/80 border border-white/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">OTJH status</p>
              <p className="text-sm font-semibold text-foreground-900 mt-1">{learner.otjhStatus}</p>
              <p className="text-[11px] text-foreground-500 mt-1">{learner.activities.length} captured item{learner.activities.length === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>
      </section>

      <OverviewMonthlyCycleSummary learner={learner} monthLabel={monthLabel} />

      <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-heading font-bold text-foreground-900">Month Health</h4>
            <p className="text-[11px] text-foreground-500 mt-1">Quick read on logged hours and coaching coverage for the selected month.</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${status.soft}`}>{status.label}</span>
        </div>

        <div className="space-y-4 mt-4">
          <OverviewProgressRow label="OTJH monthly target" value={learner.otjh.progress} detail={`${learner.otjh.monthlyHoursLabel} logged of ${formatHours(learner.otjh.monthlyTarget)}`} color="bg-primary-500" />
          <OverviewProgressRow label="Coaching coverage" value={coachingCoverage} detail={`${learner.coaching.booked} booked - ${learner.coaching.total} total touchpoints`} color="bg-emerald-500" />
        </div>
      </section>

      <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
        <h4 className="text-sm font-heading font-bold text-foreground-900">Action Flags</h4>
        <p className="text-[11px] text-foreground-500 mt-1">Anything needing follow-up for this learner this month.</p>
        {learner.needsAction.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-center">
            <i className="ri-check-double-line text-emerald-600 text-2xl block mb-2"></i>
            <p className="text-xs font-semibold text-emerald-800">No action gaps recorded.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mt-4">
            {learner.needsAction.map((action) => (
              <span key={action} className={`px-3 py-1.5 rounded-full text-[10px] font-semibold ${status.soft}`}>
                {action}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-heading font-bold text-foreground-900">Activity Timeline</h4>
            <p className="text-[11px] text-foreground-500 mt-1">{learner.activities.length} captured item{learner.activities.length === 1 ? '' : 's'} in {monthLabel}</p>
          </div>
          <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">{learner.otjhStatus}</span>
        </div>

        {learner.activities.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-foreground-200 bg-background-100 p-6 text-center">
            <i className="ri-inbox-line text-foreground-300 text-2xl block mb-2"></i>
            <p className="text-xs font-semibold text-foreground-700">No activity captured for {monthLabel}</p>
            <p className="text-[11px] text-foreground-400 mt-1">This learner has no progress log, activity feed, or coach calendar item in the selected month.</p>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {learner.activities.map((activity) => {
              const tone = safeTone(activity.tone);
              return (
                <div key={activity.id} className="rounded-2xl bg-background-100/70 border border-foreground-200/60 p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone.icon}`}>
                      <i className={`${activityIcon(activity.type)} text-base`}></i>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${tone.badge}`}>{activity.type}</span>
                        <span className="text-[10px] text-foreground-400">{formatDateLabel(activity.date)}</span>
                      </div>
                      <p className="text-sm font-semibold text-foreground-900 mt-2">{activity.title}</p>
                      <p className="text-[12px] text-foreground-600 mt-1 leading-relaxed">{activity.detail}</p>
                      <p className="text-[10px] text-foreground-400 mt-2">Source: {formatSourceLabel(activity.source)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 px-4 py-3 text-center backdrop-blur-sm">
      <p className="text-2xl font-bold text-white">{typeof value === 'number' ? formatNumber(value) : value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60">{label}</p>
    </div>
  );
}

function OverviewMonthlyCycleSummary({ learner, monthLabel }: { learner: MonthlyLearnerActivity; monthLabel: string }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary-100/80 bg-[linear-gradient(135deg,#ffffff_0%,#fbfaff_62%,#f7f3ff_100%)] shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-primary-600"></div>
      <div className="p-5 pl-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-primary-700">
          <i className="ri-sparkling-2-line text-primary-600"></i>
          Monthly cycle summary
        </span>
        <h4 className="mt-3 text-lg font-heading font-bold text-foreground-900">{monthLabel} activity</h4>
        <p className="mt-1 text-xs leading-5 text-foreground-500">Same headline numbers shown on the learner card.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <MonthlyCycleStat icon="ri-pulse-line" label="Total events" value={learner.activities.length} tone="primary" />
          <MonthlyCycleStat icon="ri-calendar-check-line" label="Active days" value={uniqueActivityDays(learner.activities)} tone="emerald" />
          <MonthlyCycleStat icon="ri-time-line" label="Time logged" value={learner.otjh.monthlyHoursLabel} tone="amber" />
          <MonthlyCycleStat icon="ri-award-line" label="KSBs evidenced" value={learner.ksb.touched} tone="primary" />
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ icon, label, value, detail, accent }: { icon: string; label: string; value: number | string; detail: string; accent: ActivityTone }) {
  const tone = safeTone(accent);
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/70 p-4 shadow-sm">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-4 ${tone.icon}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-[11px] font-semibold text-foreground-500">{label}</p>
      <p className="text-2xl font-heading font-bold text-foreground-900 mt-1">{typeof value === 'number' ? formatNumber(value) : value}</p>
      <p className="text-[10px] text-foreground-400 mt-2 leading-relaxed">{detail}</p>
    </div>
  );
}

function OverviewProgressRow({ label, value, detail, color }: { label: string; value: number; detail: string; color: string }) {
  const percentage = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div>
          <p className="text-xs font-semibold text-foreground-800">{label}</p>
          <p className="text-[10px] text-foreground-400 mt-0.5">{detail}</p>
        </div>
        <span className="text-xs font-bold text-foreground-900">{percentage}%</span>
      </div>
      <div className="h-2 rounded-full bg-background-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
}

function HealthRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-foreground-700">{label}</span>
        <span className="text-xs font-bold text-foreground-900">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-background-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
}
