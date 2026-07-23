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

interface MonthlyActivityItem {
  id: string;
  date: string;
  type: string;
  title: string;
  detail: string;
  tone: ActivityTone;
  source: string;
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
  if (normalized.includes('mcm') || normalized.includes('catch') || normalized.includes('pr')) return 'ri-calendar-check-line';
  return 'ri-checkbox-circle-line';
}

function formatSourceLabel(source: string) {
  return source
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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

function downloadLearnerActivityPdf(learner: MonthlyLearnerActivity, monthLabel: string, monthKey: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const status = safeStatus(learner.status);
  const generatedDate = formatDateLabel(new Date().toISOString());
  const metrics = [
    `Learning: ${formatNumber(learner.learning.total)} total (${learner.learning.quizzes} quiz, ${learner.learning.videos} video, ${learner.learning.components} component, ${learner.learning.reflections} reflection)`,
    `MCM / PR: ${learner.coaching.mcm}/${learner.coaching.progressReviews} (${learner.coaching.booked} booked, ${learner.coaching.needsSchedule} need schedule, ${learner.coaching.catchups} catch-up)`,
    `Evidence: ${formatNumber(learner.evidence.submitted)} submitted${learner.evidence.latestDate ? `, latest ${formatDateLabel(learner.evidence.latestDate)}` : ''}`,
    `KSBs touched: ${formatNumber(learner.ksb.touched)}${learner.ksb.codes.length ? ` (${learner.ksb.codes.join(', ')})` : ''}`,
    `OTJH: ${learner.otjh.monthlyHoursLabel} logged this month (${formatNumber(learner.otjh.completed)}/${formatNumber(learner.otjh.target)} completed, ${learner.otjh.progress}% progress)`,
  ];

  let y = PDF_MARGIN;
  y = addPdfText(doc, { text: 'Learner Activity Report', y, fontSize: 18, fontStyle: 'bold', lineHeight: 8 });
  y = addPdfText(doc, { text: `Monthly Cycle - ${monthLabel}`, y, fontSize: 12, textColor: [79, 70, 229], lineHeight: 6 });
  y = addPdfText(doc, { text: `Generated on ${generatedDate}`, y, fontSize: 10, textColor: [107, 114, 128], lineHeight: 5 });
  y = addPdfDivider(doc, y + 1);

  y = addPdfText(doc, { text: 'Learner Overview', y, fontSize: 12, fontStyle: 'bold', lineHeight: 6 });
  y = addPdfText(doc, { text: `Name: ${learner.name}`, y });
  y = addPdfText(doc, { text: `Status: ${status.label}`, y });
  y = addPdfText(doc, { text: `Programme: ${learner.programme || '--'}`, y });
  y = addPdfText(doc, { text: `Cohort / Group: ${learner.cohortName} / ${learner.group}`, y });
  y = addPdfText(doc, { text: `Last activity: ${learner.lastActivityLabel}${learner.lastActivityDate ? ` on ${formatDateLabel(learner.lastActivityDate)}` : ''}`, y });
  y = addPdfText(doc, { text: `OTJH status: ${learner.otjhStatus}`, y });
  y = addPdfDivider(doc, y + 1);

  y = addPdfText(doc, { text: 'Monthly Summary', y, fontSize: 12, fontStyle: 'bold', lineHeight: 6 });
  metrics.forEach((line) => {
    y = addPdfText(doc, { text: `- ${line}`, y });
  });

  y = addPdfDivider(doc, y + 1);
  y = addPdfText(doc, { text: 'Action Flags', y, fontSize: 12, fontStyle: 'bold', lineHeight: 6 });
  if (learner.needsAction.length === 0) {
    y = addPdfText(doc, { text: 'No action flags recorded for this learner in the selected month.', y, textColor: [75, 85, 99] });
  } else {
    learner.needsAction.forEach((action) => {
      y = addPdfText(doc, { text: `- ${action}`, y, textColor: [75, 85, 99] });
    });
  }

  y = addPdfDivider(doc, y + 1);
  y = addPdfText(doc, { text: 'Activity Timeline', y, fontSize: 12, fontStyle: 'bold', lineHeight: 6 });
  if (learner.activities.length === 0) {
    y = addPdfText(doc, { text: `No captured activity for ${monthLabel}.`, y, textColor: [75, 85, 99] });
  } else {
    learner.activities.forEach((activity, index) => {
      y = ensurePdfSpace(doc, y, 22);
      y = addPdfText(doc, { text: `${index + 1}. ${activity.type} | ${formatDateLabel(activity.date)}`, y, fontSize: 11, fontStyle: 'bold', lineHeight: 5.5 });
      y = addPdfText(doc, { text: `Title: ${activity.title}`, y });
      y = addPdfText(doc, { text: `Detail: ${activity.detail}`, y, textColor: [75, 85, 99] });
      y = addPdfText(doc, { text: `Source: ${formatSourceLabel(activity.source)}`, y, fontSize: 9, textColor: [107, 114, 128], lineHeight: 4.5 });
      y += 2;
    });
  }

  doc.save(`learner-activity-${pdfFileNameSegment(learner.name)}-${monthKey}.pdf`);
}

export default function CoachMonthlyCycle() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [data, setData] = useState<MonthlyActivityResponse | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
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
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setData(null);
        setSelectedLearnerId(null);
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
  const latestActivities = useMemo(
    () => learners
      .flatMap((learner) => learner.activities.map((activity) => ({ ...activity, learnerName: learner.name })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6),
    [learners],
  );
  const selectedLearner = useMemo(
    () => learners.find((learner) => learner.id === selectedLearnerId) || null,
    [learners, selectedLearnerId],
  );

  const handleExportLearnerPdf = (learner: MonthlyLearnerActivity) => {
    setExportingLearnerId(learner.id);
    window.setTimeout(() => {
      try {
        downloadLearnerActivityPdf(learner, monthLabel, selectedMonth);
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

          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
            <SummaryCard icon="ri-checkbox-circle-line" label="Learning Actions" value={summary.learningActivities} accent="primary" detail={`${summary.quizzes} quizzes - ${summary.videos} videos - ${summary.components} components`} />
            <SummaryCard icon="ri-calendar-check-line" label="Coaching & Reviews" value={summary.coachingSessions} accent="emerald" detail={`${summary.bookedSessions} booked - ${summary.needsSchedule} need schedule`} />
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
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-heading font-bold text-foreground-900">Learner Month Log</h3>
                    <p className="text-sm text-foreground-500">Open a learner overview to inspect their month and download the PDF report.</p>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-background-50 border border-foreground-200 text-[11px] font-semibold text-foreground-600">
                    {learners.length} learner{learners.length === 1 ? '' : 's'}
                  </span>
                </div>

                {learners.length === 0 && (
                  <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-10 text-center shadow-sm">
                    <i className="ri-user-search-line text-foreground-300 text-3xl block mb-3"></i>
                    <p className="text-sm font-semibold text-foreground-700">No active learners found</p>
                    <p className="text-xs text-foreground-400 mt-1">There are no active learners assigned to this coach for the selected month.</p>
                  </div>
                )}

                {learners.map((learner) => {
                  const selected = selectedLearnerId === learner.id;
                  const status = safeStatus(learner.status);
                  return (
                    <article key={learner.id} className={`bg-background-50 rounded-2xl border ${selected ? `${status.border} shadow-md ring-1 ring-primary-100` : 'border-foreground-200/70 shadow-sm'} overflow-hidden transition-smooth`}>
                      <div className="p-5">
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
                              <p className="text-[11px] text-foreground-400 mt-2">
                                Last: <span className="font-semibold text-foreground-700">{learner.lastActivityLabel}</span>
                                {learner.lastActivityDate ? ` on ${formatDateLabel(learner.lastActivityDate)}` : ''}
                              </p>
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
                          </div>
                        </div>

                        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mt-5">
                          <MetricTile label="Learning" value={learner.learning.total} detail={`${learner.learning.quizzes} quiz - ${learner.learning.videos} video - ${learner.learning.components} comp`} />
                          <MetricTile label="MCM / PR" value={`${learner.coaching.mcm}/${learner.coaching.progressReviews}`} detail={learner.coaching.needsSchedule ? `${learner.coaching.needsSchedule} need schedule` : `${learner.coaching.booked} booked`} />
                          <MetricTile label="Evidence" value={learner.evidence.submitted} detail="Submitted" />
                          <MetricTile label="KSBs" value={learner.ksb.touched} detail={learner.ksb.codes.slice(0, 3).join(', ') || 'No KSBs'} />
                          <MetricTile label="OTJH" value={learner.otjh.monthlyHoursLabel} detail="Logged this month" />
                        </div>

                        {learner.needsAction.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-4">
                            {learner.needsAction.map((action) => (
                              <span key={action} className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${status.soft}`}>
                                {action}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
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
            onViewFile={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(selectedLearner.id)}`)}
          />
        )}
      </RightSlidePanel>
    </>
  );
}

function LearnerOverviewPanel(
  {
    learner,
    monthLabel,
    isExporting,
    onExport,
    onViewFile,
  }: {
    learner: MonthlyLearnerActivity;
    monthLabel: string;
    isExporting: boolean;
    onExport: () => void;
    onViewFile: () => void;
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
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-700 ring-1 ring-primary-200 flex items-center justify-center text-base font-bold shrink-0">
              {learner.initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-lg font-heading font-bold text-foreground-900">{learner.name}</h4>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full ring-1 text-[10px] font-semibold ${status.pill}`}>{status.label}</span>
              </div>
              <p className="text-sm text-foreground-700 mt-1">{learner.programme || '--'}</p>
              <p className="text-[11px] text-foreground-500 mt-1">{learner.cohortName} · {learner.group}</p>
              <p className="text-[11px] text-foreground-500 mt-3">Monthly cycle snapshot for {monthLabel}</p>
            </div>
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

          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              type="button"
              onClick={onExport}
              disabled={isExporting}
              className="px-4 py-3 rounded-2xl bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <i className={`${isExporting ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-line'} mr-1.5`}></i>
              {isExporting ? 'Preparing PDF...' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={onViewFile}
              className="px-4 py-3 rounded-2xl bg-primary-600 text-white text-[12px] font-semibold hover:bg-primary-700 transition-smooth cursor-pointer"
            >
              <i className="ri-folder-open-line mr-1.5"></i>
              View File
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OverviewMetricCard icon="ri-checkbox-circle-line" label="Learning" value={formatNumber(learner.learning.total)} detail={`${learner.learning.quizzes} quizzes · ${learner.learning.videos} videos · ${learner.learning.components} components`} tone="primary" />
        <OverviewMetricCard icon="ri-calendar-check-line" label="MCM / PR" value={`${learner.coaching.mcm}/${learner.coaching.progressReviews}`} detail={`${learner.coaching.booked} booked · ${learner.coaching.needsSchedule} need schedule`} tone="emerald" />
        <OverviewMetricCard icon="ri-folder-upload-line" label="Evidence" value={formatNumber(learner.evidence.submitted)} detail={learner.evidence.latestDate ? `Latest ${formatDateLabel(learner.evidence.latestDate)}` : 'Submitted this month'} tone="amber" />
        <OverviewMetricCard icon="ri-award-line" label="KSBs" value={formatNumber(learner.ksb.touched)} detail={learner.ksb.codes.join(', ') || 'No KSBs captured'} tone="primary" />
        <OverviewMetricCard icon="ri-time-line" label="OTJH Logged" value={learner.otjh.monthlyHoursLabel} detail={`${formatNumber(learner.otjh.completed)}/${formatNumber(learner.otjh.target)}h completed`} tone="emerald" />
        <OverviewMetricCard icon="ri-history-line" label="Timeline Items" value={formatNumber(learner.activities.length)} detail={`${learner.coaching.catchups} catch-up · ${learner.learning.reflections} reflections`} tone="red" />
      </section>

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
          <OverviewProgressRow label="Coaching coverage" value={coachingCoverage} detail={`${learner.coaching.booked} booked · ${learner.coaching.total} total touchpoints`} color="bg-emerald-500" />
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

function OverviewMetricCard({ icon, label, value, detail, tone }: { icon: string; label: string; value: string; detail: string; tone: ActivityTone }) {
  const palette = safeTone(tone);
  return (
    <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${palette.icon}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-[11px] font-semibold text-foreground-500">{label}</p>
      <p className="text-xl font-heading font-bold text-foreground-900 mt-1">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-2 leading-relaxed">{detail}</p>
    </div>
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

function MetricTile({ label, value, detail, bar }: { label: string; value: number | string; detail: string; bar?: number }) {
  return (
    <div className="rounded-2xl bg-background-100/70 border border-foreground-200/50 p-3 min-w-0">
      <p className="text-[10px] font-semibold text-foreground-500">{label}</p>
      <p className="text-lg font-heading font-bold text-foreground-900 mt-1 truncate">{typeof value === 'number' ? formatNumber(value) : value}</p>
      <p className="text-[10px] text-foreground-400 mt-1 truncate">{detail}</p>
      {typeof bar === 'number' && (
        <div className="h-1.5 rounded-full bg-background-200 overflow-hidden mt-2">
          <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}></div>
        </div>
      )}
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
