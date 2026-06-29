import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

/* ────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────── */
interface TimetableEvent {
  id: string;
  title: string;
  type: 'coaching' | 'live-session' | 'review' | 'employer-meeting' | 'welfare' | 'admin' | 'personal';
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  dayOfMonth: number;
  month: number;
  startHour: number;
  endHour: number;
  learner?: string;
  employer?: string;
  programme?: string;
  tutor?: string;
  location?: string;
  platform?: string;
  priority: 'normal' | 'urgent' | 'high';
  status: 'confirmed' | 'pending' | 'cancelled';
  notes?: string;
  cohort?: string;
}

/* ────────────────────────────────────────────────────────────
   Data — June 2026 (spans 4 weeks)
   ──────────────────────────────────────────────────────────── */
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 – 20:00

const ALL_EVENTS: TimetableEvent[] = [
  // ── Week 1: June 1–7 ──
  { id: 'evt-001', title: 'Monthly Coaching', type: 'coaching', dayOfWeek: 0, dayOfMonth: 1, month: 5, startHour: 9, endHour: 10, learner: 'James Okafor', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Discuss Q2 progress & next milestones' },
  { id: 'evt-002', title: 'Live Session: Customer Segmentation', type: 'live-session', dayOfWeek: 0, dayOfMonth: 1, month: 5, startHour: 10, endHour: 12, tutor: 'Crispin Jones', programme: 'Marketing Executive L4', location: 'Room 302', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '18 learners attending', cohort: 'Cohort B' },
  { id: 'evt-003', title: 'Employer Check-in', type: 'employer-meeting', dayOfWeek: 0, dayOfMonth: 1, month: 5, startHour: 13, endHour: 13.5, employer: 'Tim Hortons UK', platform: 'Phone', priority: 'normal', status: 'confirmed', notes: 'Discuss Sophie Williams OTJH pace' },
  { id: 'evt-004', title: 'Welfare & Risk Review', type: 'welfare', dayOfWeek: 0, dayOfMonth: 1, month: 5, startHour: 15, endHour: 16, learner: 'Mia Robinson', programme: 'Project Manager L4', platform: 'Teams', priority: 'urgent', status: 'confirmed', notes: 'CRITICAL: 71% attendance, 4 missed sessions' },
  { id: 'evt-005', title: 'Progress Review', type: 'review', dayOfWeek: 1, dayOfMonth: 2, month: 5, startHour: 9, endHour: 10, learner: 'Connor Walsh', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'high', status: 'confirmed', notes: 'Week 12 review — FS English pending' },
  { id: 'evt-006', title: 'Live Session: Data Visualisation', type: 'live-session', dayOfWeek: 1, dayOfMonth: 2, month: 5, startHour: 10, endHour: 12, tutor: 'Dr. Helen Park', programme: 'Data Analyst L4', location: 'Lab 101', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '14 learners', cohort: 'Cohort D' },
  { id: 'evt-007', title: 'Onboarding Coaching', type: 'coaching', dayOfWeek: 1, dayOfMonth: 2, month: 5, startHour: 11, endHour: 12, learner: 'Priya Sharma', programme: 'Business Admin L3', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Week 2 — new starter support' },
  { id: 'evt-008', title: 'Evidence Review', type: 'admin', dayOfWeek: 1, dayOfMonth: 2, month: 5, startHour: 13, endHour: 14, priority: 'high', status: 'confirmed', notes: 'Mark 5 pending assignments' },
  { id: 'evt-009', title: 'Monthly Coaching', type: 'coaching', dayOfWeek: 2, dayOfMonth: 3, month: 5, startHour: 14, endHour: 15, learner: 'Sophie Williams', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'high', status: 'confirmed', notes: 'OTJH catch-up plan & evidence strategy' },
  { id: 'evt-010', title: 'Live Session: Business Comms', type: 'live-session', dayOfWeek: 2, dayOfMonth: 3, month: 5, startHour: 9, endHour: 11, tutor: 'Rachel Myers', programme: 'Business Admin', location: 'Room 205', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '22 learners', cohort: 'Cohort A' },
  { id: 'evt-011', title: 'Compliance Check-in', type: 'coaching', dayOfWeek: 2, dayOfMonth: 3, month: 5, startHour: 15, endHour: 16, learner: 'Liam Patel', programme: 'Data Analyst L4', platform: 'Teams', priority: 'high', status: 'pending', notes: 'Pre-Active — QA Rejected, needs follow-up' },
  { id: 'evt-012', title: 'Employer Call', type: 'employer-meeting', dayOfWeek: 2, dayOfMonth: 3, month: 5, startHour: 16, endHour: 16.5, employer: 'Pret A Manger', platform: 'Phone', priority: 'normal', status: 'pending', notes: 'James Okafor progress update' },
  { id: 'evt-013', title: 'Progress Review', type: 'review', dayOfWeek: 3, dayOfMonth: 4, month: 5, startHour: 11, endHour: 12, learner: 'Sophie Williams', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'high', status: 'confirmed', notes: 'Week 12 review — prepare Q&A' },
  { id: 'evt-014', title: 'Progress Review', type: 'review', dayOfWeek: 3, dayOfMonth: 4, month: 5, startHour: 10, endHour: 11, learner: 'James Okafor', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Week 12 review' },
  { id: 'evt-015', title: 'AI Marking Queue', type: 'admin', dayOfWeek: 3, dayOfMonth: 4, month: 5, startHour: 13, endHour: 15, priority: 'normal', status: 'confirmed', notes: 'Review AI-generated feedback for 8 submissions' },
  { id: 'evt-016', title: 'Progress Review', type: 'review', dayOfWeek: 4, dayOfMonth: 5, month: 5, startHour: 15, endHour: 16, learner: 'Mia Robinson', programme: 'Project Manager L4', platform: 'Teams', priority: 'urgent', status: 'confirmed', notes: 'Rescheduled review — welfare priority' },
  { id: 'evt-017', title: 'Team Standup', type: 'admin', dayOfWeek: 4, dayOfMonth: 5, month: 5, startHour: 9, endHour: 9.5, priority: 'normal', status: 'confirmed', notes: 'Weekly coach team sync' },
  { id: 'evt-018', title: 'Employer Escalation', type: 'employer-meeting', dayOfWeek: 4, dayOfMonth: 5, month: 5, startHour: 16, endHour: 17, employer: 'Tesco', platform: 'Teams', priority: 'urgent', status: 'pending', notes: 'Mia Robinson attendance escalation' },

  // ── Week 2: June 8–14 ──
  { id: 'evt-019', title: 'Monthly Coaching', type: 'coaching', dayOfWeek: 0, dayOfMonth: 8, month: 5, startHour: 10, endHour: 11, learner: 'Aisha Bakari', programme: 'Digital Marketing L3', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Monthly progress review' },
  { id: 'evt-020', title: 'Live Session: Brand Strategy', type: 'live-session', dayOfWeek: 0, dayOfMonth: 8, month: 5, startHour: 11, endHour: 13, tutor: 'Crispin Jones', programme: 'Marketing Executive L4', location: 'Room 302', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '15 learners', cohort: 'Cohort B' },
  { id: 'evt-021', title: 'Welfare Check', type: 'welfare', dayOfWeek: 1, dayOfMonth: 9, month: 5, startHour: 9, endHour: 9.5, learner: 'David Chen', programme: 'Software Dev L4', platform: 'Phone', priority: 'high', status: 'confirmed', notes: 'Attendance drop — 3 missed sessions' },
  { id: 'evt-022', title: 'Employer Meeting', type: 'employer-meeting', dayOfWeek: 1, dayOfMonth: 9, month: 5, startHour: 14, endHour: 15, employer: 'NHS Trust', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Quarterly review — 3 apprentices' },
  { id: 'evt-023', title: 'Live Session: Python Basics', type: 'live-session', dayOfWeek: 2, dayOfMonth: 10, month: 5, startHour: 9, endHour: 11, tutor: 'Mike Harrison', programme: 'Software Dev L4', location: 'Lab 201', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '12 learners', cohort: 'Cohort F' },
  { id: 'evt-024', title: 'Progress Review', type: 'review', dayOfWeek: 2, dayOfMonth: 10, month: 5, startHour: 13, endHour: 14, learner: 'Aisha Bakari', programme: 'Digital Marketing L3', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Week 8 review' },
  { id: 'evt-025', title: 'Coaching Session', type: 'coaching', dayOfWeek: 3, dayOfMonth: 11, month: 5, startHour: 15, endHour: 16, learner: 'Marcus Webb', programme: 'Project Manager L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Gateway readiness assessment' },
  { id: 'evt-026', title: 'Admin: Report Writing', type: 'admin', dayOfWeek: 3, dayOfMonth: 11, month: 5, startHour: 9, endHour: 11, priority: 'high', status: 'confirmed', notes: 'Monthly compliance reports due' },
  { id: 'evt-027', title: 'Progress Review', type: 'review', dayOfWeek: 4, dayOfMonth: 12, month: 5, startHour: 10, endHour: 11, learner: 'David Chen', programme: 'Software Dev L4', platform: 'Teams', priority: 'high', status: 'confirmed', notes: 'Week 12 — attendance action plan' },
  { id: 'evt-028', title: 'Team Standup', type: 'admin', dayOfWeek: 4, dayOfMonth: 12, month: 5, startHour: 9, endHour: 9.5, priority: 'normal', status: 'confirmed', notes: 'Weekly coach sync' },

  // ── Week 3: June 15–21 (CURRENT WEEK) ──
  { id: 'evt-029', title: 'Monthly Coaching', type: 'coaching', dayOfWeek: 0, dayOfMonth: 15, month: 5, startHour: 9, endHour: 10, learner: 'Fatima Al-Rashid', programme: 'Business Admin L3', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'OTJH review & evidence check' },
  { id: 'evt-030', title: 'Live Session: Data Ethics', type: 'live-session', dayOfWeek: 0, dayOfMonth: 15, month: 5, startHour: 11, endHour: 13, tutor: 'Dr. Helen Park', programme: 'Data Analyst L4', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '10 learners', cohort: 'Cohort D' },
  { id: 'evt-031', title: 'Employer Escalation', type: 'employer-meeting', dayOfWeek: 1, dayOfMonth: 16, month: 5, startHour: 14, endHour: 15, employer: 'Sainsbury\'s', platform: 'Teams', priority: 'urgent', status: 'confirmed', notes: 'Marcus Webb — OTJH below 20%' },
  { id: 'evt-032', title: 'Progress Review', type: 'review', dayOfWeek: 2, dayOfMonth: 17, month: 5, startHour: 10, endHour: 11, learner: 'Fatima Al-Rashid', programme: 'Business Admin L3', platform: 'Teams', priority: 'high', status: 'confirmed', notes: 'Week 8 review — KSB evidence gathering' },
  { id: 'evt-033', title: 'Live Session: React Advanced', type: 'live-session', dayOfWeek: 2, dayOfMonth: 17, month: 5, startHour: 9, endHour: 11, tutor: 'Mike Harrison', programme: 'Software Dev L4', location: 'Lab 201', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '8 learners', cohort: 'Cohort F' },
  { id: 'evt-034', title: 'Welfare Meeting', type: 'welfare', dayOfWeek: 3, dayOfMonth: 18, month: 5, startHour: 13, endHour: 14, learner: 'Connor Walsh', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'high', status: 'pending', notes: 'Wellbeing check — recent disengagement' },
  { id: 'evt-035', title: 'Coaching Session', type: 'coaching', dayOfWeek: 3, dayOfMonth: 18, month: 5, startHour: 15, endHour: 16, learner: 'Sophie Williams', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Evidence portfolio review' },
  { id: 'evt-036', title: 'Team Standup', type: 'admin', dayOfWeek: 4, dayOfMonth: 19, month: 5, startHour: 9, endHour: 9.5, priority: 'normal', status: 'confirmed', notes: 'Weekly coach sync' },
  { id: 'evt-037', title: 'Progress Review', type: 'review', dayOfWeek: 4, dayOfMonth: 19, month: 5, startHour: 14, endHour: 15, learner: 'James Okafor', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Gateway readiness checkpoint' },
  { id: 'evt-038', title: 'Personal CPD', type: 'personal', dayOfWeek: 5, dayOfMonth: 20, month: 5, startHour: 10, endHour: 12, priority: 'normal', status: 'confirmed', notes: 'Online safeguarding refresher course' },
  { id: 'evt-039', title: 'Learner Catch-up', type: 'coaching', dayOfWeek: 5, dayOfMonth: 20, month: 5, startHour: 13, endHour: 14, learner: 'David Chen', programme: 'Software Dev L4', platform: 'Teams', priority: 'normal', status: 'pending', notes: 'Extra session — Python support' },
  { id: 'evt-040', title: 'Compliance Audit Prep', type: 'admin', dayOfWeek: 6, dayOfMonth: 21, month: 5, startHour: 14, endHour: 16, priority: 'high', status: 'confirmed', notes: 'Prepare files for Ofsted readiness review' },

  // ── Week 4: June 22–28 ──
  { id: 'evt-041', title: 'Monthly Coaching', type: 'coaching', dayOfWeek: 0, dayOfMonth: 22, month: 5, startHour: 9, endHour: 10, learner: 'Marcus Webb', programme: 'Project Manager L4', platform: 'Teams', priority: 'high', status: 'confirmed', notes: 'Intensive OTJH recovery plan' },
  { id: 'evt-042', title: 'Live Session: Campaign Analytics', type: 'live-session', dayOfWeek: 0, dayOfMonth: 22, month: 5, startHour: 11, endHour: 13, tutor: 'Crispin Jones', programme: 'Marketing Executive L4', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '16 learners', cohort: 'Cohort B' },
  { id: 'evt-043', title: 'Employer Review', type: 'employer-meeting', dayOfWeek: 1, dayOfMonth: 23, month: 5, startHour: 10, endHour: 11, employer: 'Barclays', platform: 'Teams', priority: 'normal', status: 'pending', notes: 'Quarterly apprentice progress update' },
  { id: 'evt-044', title: 'Progress Review', type: 'review', dayOfWeek: 2, dayOfMonth: 24, month: 5, startHour: 11, endHour: 12, learner: 'Priya Sharma', programme: 'Business Admin L3', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Week 6 review' },
  { id: 'evt-045', title: 'Live Session: Database Design', type: 'live-session', dayOfWeek: 2, dayOfMonth: 24, month: 5, startHour: 9, endHour: 11, tutor: 'Dr. Helen Park', programme: 'Data Analyst L4', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '10 learners', cohort: 'Cohort D' },
  { id: 'evt-046', title: 'Coaching Session', type: 'coaching', dayOfWeek: 3, dayOfMonth: 25, month: 5, startHour: 14, endHour: 15, learner: 'Liam Patel', programme: 'Data Analyst L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Pre-Active follow-up' },
  { id: 'evt-047', title: 'Welfare Check', type: 'welfare', dayOfWeek: 3, dayOfMonth: 25, month: 5, startHour: 10, endHour: 10.5, learner: 'Mia Robinson', programme: 'Project Manager L4', platform: 'Phone', priority: 'urgent', status: 'confirmed', notes: 'Follow-up after last review' },
  { id: 'evt-048', title: 'Team Standup', type: 'admin', dayOfWeek: 4, dayOfMonth: 26, month: 5, startHour: 9, endHour: 9.5, priority: 'normal', status: 'confirmed', notes: 'Weekly coach sync' },
  { id: 'evt-049', title: 'Progress Review', type: 'review', dayOfWeek: 4, dayOfMonth: 26, month: 5, startHour: 15, endHour: 16, learner: 'Aisha Bakari', programme: 'Digital Marketing L3', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Week 10 review' },
  { id: 'evt-050', title: 'End-of-Month Reports', type: 'admin', dayOfWeek: 5, dayOfMonth: 27, month: 5, startHour: 9, endHour: 12, priority: 'high', status: 'confirmed', notes: 'Compile monthly KPI reports for leadership' },

  // ── Week 5: June 29–30 ──
  { id: 'evt-051', title: 'Monthly Coaching', type: 'coaching', dayOfWeek: 0, dayOfMonth: 29, month: 5, startHour: 10, endHour: 11, learner: 'Connor Walsh', programme: 'Marketing Executive L4', platform: 'Teams', priority: 'normal', status: 'confirmed', notes: 'Month-end review' },
  { id: 'evt-052', title: 'Live Session: Final Projects', type: 'live-session', dayOfWeek: 0, dayOfMonth: 29, month: 5, startHour: 11, endHour: 13, tutor: 'Rachel Myers', programme: 'Business Admin', location: 'Room 205', platform: 'Teams Live', priority: 'normal', status: 'confirmed', notes: '14 learners', cohort: 'Cohort A' },
  { id: 'evt-053', title: 'Employer Check-in', type: 'employer-meeting', dayOfWeek: 1, dayOfMonth: 30, month: 5, startHour: 15, endHour: 16, employer: 'Costa Coffee', platform: 'Phone', priority: 'normal', status: 'pending', notes: 'Monthly apprentice review call' },
];

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */
function typeConfig(type: TimetableEvent['type']) {
  const map: Record<TimetableEvent['type'], { label: string; bg: string; border: string; text: string; icon: string; dot: string; barBg: string }> = {
    coaching: { label: 'Coaching', bg: 'bg-primary-100', border: 'border-primary-300', text: 'text-primary-800', icon: 'ri-chat-smile-2-line', dot: 'bg-primary-500', barBg: 'bg-primary-500' },
    'live-session': { label: 'Live Session', bg: 'bg-accent-100', border: 'border-accent-300', text: 'text-accent-800', icon: 'ri-video-line', dot: 'bg-accent-500', barBg: 'bg-accent-500' },
    review: { label: 'Review', bg: 'bg-secondary-100', border: 'border-secondary-300', text: 'text-secondary-800', icon: 'ri-file-chart-line', dot: 'bg-secondary-500', barBg: 'bg-secondary-500' },
    'employer-meeting': { label: 'Employer', bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-800', icon: 'ri-building-2-line', dot: 'bg-amber-500', barBg: 'bg-amber-500' },
    welfare: { label: 'Welfare', bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800', icon: 'ri-heart-pulse-line', dot: 'bg-red-500', barBg: 'bg-red-500' },
    admin: { label: 'Admin', bg: 'bg-background-100', border: 'border-background-300', text: 'text-foreground-700', icon: 'ri-settings-3-line', dot: 'bg-foreground-400', barBg: 'bg-foreground-400' },
    personal: { label: 'Personal', bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-800', icon: 'ri-user-line', dot: 'bg-emerald-500', barBg: 'bg-emerald-500' },
  };
  return map[type];
}

function priorityBadge(p: TimetableEvent['priority']) {
  if (p === 'urgent') return 'bg-red-100 text-red-700 border-red-200';
  if (p === 'high') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
}

function formatTime(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ─── Month calendar helpers ─── */
function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const mondayOffset = startDow === 0 ? 6 : startDow - 1;
  const totalDays = lastDay.getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < mondayOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  return cells;
}

function getWeekDates(year: number, month: number, selectedDay: number) {
  const date = new Date(year, month, selectedDay);
  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - mondayOffset);
  const week: { day: number; month: number; monthName: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push({ day: d.getDate(), month: d.getMonth(), monthName: MONTH_NAMES[d.getMonth()] });
  }
  return week;
}

/* ─── Donut Ring ─── */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-white/10' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = { primary: 'stroke-primary-400', accent: 'stroke-accent-400', emerald: 'stroke-emerald-400', amber: 'stroke-amber-400', red: 'stroke-red-400' };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

type ViewMode = 'month' | 'week' | 'day';

/* ────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────── */
export default function CoachTimetablePage() {
  const now = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewYear, setViewYear] = useState(2026);
  const [viewMonth, setViewMonth] = useState(5); // June
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [selectedEvent, setSelectedEvent] = useState<TimetableEvent | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();
  const currentHour = now.getHours();

  const isToday = useCallback((day: number, month: number, year: number) => {
    return day === todayDay && month === todayMonth && year === todayYear;
  }, [todayDay, todayMonth, todayYear]);

  const getEventsForDay = useCallback((day: number, month: number): TimetableEvent[] => {
    return ALL_EVENTS.filter(ev => ev.dayOfMonth === day && ev.month === month);
  }, []);

  const filteredEvents = ALL_EVENTS.filter(e => {
    if (filterType !== 'all' && e.type !== filterType) return false;
    if (searchTerm && !(
      e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.learner?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.employer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.tutor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.programme?.toLowerCase().includes(searchTerm.toLowerCase())
    )) return false;
    return true;
  });

  const monthCells = useMemo(() => getMonthData(viewYear, viewMonth), [viewYear, viewMonth]);
  const weekDates = useMemo(() => getWeekDates(viewYear, viewMonth, selectedDay), [viewYear, viewMonth, selectedDay]);
  const selectedDayEvents = useMemo(() => getEventsForDay(selectedDay, viewMonth), [selectedDay, viewMonth, getEventsForDay]);

  const totalEvents = ALL_EVENTS.length;
  const confirmedEvents = ALL_EVENTS.filter(e => e.status === 'confirmed').length;
  const urgentEvents = ALL_EVENTS.filter(e => e.priority === 'urgent').length;
  const coachingHours = ALL_EVENTS.filter(e => e.type === 'coaching').reduce((s, e) => s + (e.endHour - e.startHour), 0);
  const completionRate = totalEvents > 0 ? Math.round((confirmedEvents / totalEvents) * 100) : 0;

  const handlePrev = () => {
    if (viewMode === 'month') { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }
    else if (viewMode === 'day') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 7); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
  };
  const handleNext = () => {
    if (viewMode === 'month') { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }
    else if (viewMode === 'day') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 7); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
  };
  const handleToday = () => { setViewYear(todayYear); setViewMonth(todayMonth); setSelectedDay(todayDay); };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    if (viewMode === 'month') setViewMode('day');
  };

  const titleLabel = viewMode === 'month'
    ? `${MONTH_NAMES[viewMonth]} ${viewYear}`
    : viewMode === 'week'
      ? `${weekDates[0].monthName} ${weekDates[0].day} – ${weekDates[6].monthName} ${weekDates[6].day}, ${viewYear}`
      : `${selectedDay} ${MONTH_NAMES[viewMonth]} ${viewYear}`;

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Calendar" pageSubtitle="Your coaching schedule, sessions, and meetings — all in one place"
      userName="Med Maher" userRole="Progress Coach"
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════ HERO BANNER ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute opacity-20" style={{ width: '50%', height: '40%', left: '-5%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute opacity-15" style={{ width: '60%', height: '30%', right: '-10%', top: '20%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[150px]">
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">Progress Coach</span>
                <span className="text-xs font-medium text-white/40">June 2026</span>
              </div>
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1">My Calendar</h1>
              <p className="text-sm text-white/40 max-w-lg">Manage your coaching sessions, live classes, reviews, and employer meetings</p>
            </div>
            <div className="lg:w-[380px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center">
              <div className="flex items-center gap-6 w-full">
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative">
                    <DonutRing pct={completionRate} size={68} stroke={6} color="emerald" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-heading font-bold text-white leading-none">{completionRate}%</span></div>
                  </div>
                  <div>
                    <p className="text-xs text-white/40 mb-0.5">Completion</p>
                    <p className="text-base font-heading font-bold text-white">{totalEvents}<span className="text-white/30 text-sm font-normal"> events</span></p>
                  </div>
                </div>
                <div className="w-px h-14 bg-accent-400/10 shrink-0" />
                <div className="grid grid-cols-2 gap-2 flex-1">
                  <div className="bg-white/8 backdrop-blur-sm rounded-xl px-3 py-2 text-center"><p className="text-lg font-heading font-bold text-emerald-300">{confirmedEvents}</p><p className="text-[10px] text-white/50">Confirmed</p></div>
                  <div className="bg-white/8 backdrop-blur-sm rounded-xl px-3 py-2 text-center"><p className="text-lg font-heading font-bold text-accent-300">{Math.round(coachingHours)}h</p><p className="text-[10px] text-white/50">Coaching</p></div>
                  <div className="bg-white/8 backdrop-blur-sm rounded-xl px-3 py-2 text-center"><p className="text-lg font-heading font-bold text-red-300">{urgentEvents}</p><p className="text-[10px] text-white/50">Urgent</p></div>
                  <div className="bg-white/8 backdrop-blur-sm rounded-xl px-3 py-2 text-center"><p className="text-lg font-heading font-bold text-amber-300">{ALL_EVENTS.filter(e => e.status === 'pending').length}</p><p className="text-[10px] text-white/50">Pending</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ CONTROLS BAR ═══════════ */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {([
              { key: 'month' as ViewMode, label: 'Month', icon: 'ri-calendar-2-line' },
              { key: 'week' as ViewMode, label: 'Week', icon: 'ri-calendar-view' },
              { key: 'day' as ViewMode, label: 'Day', icon: 'ri-calendar-line' },
            ]).map(v => (
              <button
                key={v.key}
                onClick={() => { setViewMode(v.key); if (v.key === 'month') setSelectedDay(todayDay); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${viewMode === v.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
              >
                <i className={`${v.icon} text-xs`}></i>{v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrev} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-arrow-left-s-line"></i></button>
            <button onClick={handleToday} className="px-3 py-1.5 text-[11px] font-semibold text-primary-600 bg-primary-100 rounded-lg hover:bg-primary-200 transition-smooth cursor-pointer whitespace-nowrap">Today</button>
            <span className="text-sm font-heading font-bold text-foreground-900 min-w-[150px] text-center whitespace-nowrap">{titleLabel}</span>
            <button onClick={handleNext} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-arrow-right-s-line"></i></button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs"></i>
              <input
                type="text" placeholder="Search..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-xs text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 w-32 sm:w-44 transition-all"
              />
            </div>
            <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
              {(['all', 'coaching', 'live-session', 'review', 'employer-meeting', 'welfare'] as const).map(type => {
                const isAll = type === 'all';
                const label = isAll ? 'All' : typeConfig(type).label;
                const dot = isAll ? 'bg-foreground-400' : typeConfig(type).dot;
                const isActive = filterType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setFilterType(isActive ? 'all' : type)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1 ${isActive ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══════════ MAIN CONTENT ═══════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Calendar Area (2/3) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* MONTH VIEW */}
            {viewMode === 'month' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-7 border-b border-foreground-200/60">
                  {DAYS_OF_WEEK.map(d => (
                    <div key={d} className="px-2 py-3 text-center bg-background-100/50">
                      <span className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wide">{d}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthCells.map((day, idx) => {
                    if (day === null) return <div key={`empty-${idx}`} className="aspect-[4/3] bg-background-50/30 border-b border-r border-background-100/50" />;
                    const eventsForDay = filteredEvents.filter(e => e.dayOfMonth === day && e.month === viewMonth);
                    const isSel = day === selectedDay;
                    const isTdy = isToday(day, viewMonth, viewYear);
                    return (
                      <button
                        key={`d-${day}`}
                        onClick={() => handleDayClick(day)}
                        className={`aspect-[4/3] border-b border-r border-background-100/50 p-1.5 flex flex-col items-start cursor-pointer transition-all duration-200 ease-out hover:bg-background-50 hover:shadow-sm hover:z-10 text-left ${isSel ? 'ring-2 ring-primary-400 ring-inset bg-primary-50/40 z-10 rounded-lg shadow-sm' : ''}`}
                      >
                        <span className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full transition-all duration-200 ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'bg-primary-100 text-primary-700' : 'text-foreground-600'}`}>
                          {day}
                        </span>
                        <div className="flex-1 w-full overflow-hidden space-y-0.5">
                          {eventsForDay.slice(0, 3).map(ev => {
                            const tc = typeConfig(ev.type);
                            return (
                              <div
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm border-l-2 truncate leading-tight transition-all duration-150 hover:brightness-95 cursor-pointer ${tc.bg} ${tc.border} ${tc.text}`}
                                title={ev.title}
                              >
                                {formatTime(ev.startHour)} {ev.title}
                              </div>
                            );
                          })}
                          {eventsForDay.length > 3 && (
                            <span className="text-[9px] text-foreground-400 font-semibold pl-1">+{eventsForDay.length - 3} more</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WEEK VIEW */}
            {viewMode === 'week' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-8 border-b border-foreground-200/60">
                  <div className="px-2 py-2.5 bg-background-100/50"></div>
                  {weekDates.map(wd => {
                    const isTdy = isToday(wd.day, wd.month, viewYear);
                    const isSel = wd.day === selectedDay && wd.month === viewMonth;
                    const weekdayIdx = new Date(viewYear, wd.month, wd.day).getDay();
                    const mappedDow = weekdayIdx === 0 ? 6 : weekdayIdx - 1;
                    return (
                      <button
                        key={`wh-${wd.day}-${wd.month}`}
                        onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); }}
                        className={`px-2 py-2.5 text-center cursor-pointer transition-smooth ${isSel ? 'bg-primary-50/60' : 'hover:bg-background-100/50'}`}
                      >
                        <span className="text-xs font-semibold text-foreground-400 block">{DAYS_OF_WEEK[mappedDow]}</span>
                        <span className={`text-sm font-bold inline-flex items-center justify-center w-7 h-7 rounded-full mt-0.5 ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'text-primary-700' : 'text-foreground-700'}`}>
                          {wd.day}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map(hour => {
                    const isCurrentRow = currentHour === hour && weekDates.some(wd => isToday(wd.day, wd.month, viewYear));
                    return (
                      <div key={`h-${hour}`} className={`grid grid-cols-8 border-b border-background-100/50 min-h-[56px] ${isCurrentRow ? 'bg-primary-50/20' : ''}`}>
                        <div className="px-3 py-2 text-right border-r border-background-100/50">
                          <span className="text-[11px] font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        {weekDates.map(wd => {
                          const eventsInSlot = getEventsForDay(wd.day, wd.month).filter(ev => {
                            const startH = ev.startHour;
                            return startH >= hour && startH < hour + 1;
                          });
                          const isSel = wd.day === selectedDay && wd.month === viewMonth;
                          return (
                            <div
                              key={`ws-${wd.day}-${wd.month}-${hour}`}
                              className={`p-1 border-r border-background-100/50 cursor-pointer transition-smooth hover:bg-primary-50/15 ${isSel ? 'bg-primary-50/30' : ''}`}
                              onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); }}
                            >
                              {eventsInSlot.map(ev => {
                                const tc = typeConfig(ev.type);
                                const duration = ev.endHour - ev.startHour;
                                const heightPx = Math.max(24, duration * 48);
                                return (
                                  <div
                                    key={ev.id}
                                    onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                    className={`${tc.bg} ${tc.border} border rounded-md px-1.5 py-1 mb-0.5 cursor-pointer transition-all duration-150 hover:brightness-95`}
                                    style={{ minHeight: `${heightPx}px` }}
                                  >
                                    <p className={`text-[9px] font-semibold leading-tight truncate ${tc.text}`}>{ev.title}</p>
                                    <p className="text-[8px] text-foreground-400 truncate">{formatTime(ev.startHour)} – {formatTime(ev.endHour)}</p>
                                    {ev.learner && <p className="text-[8px] text-foreground-400 truncate font-medium">{ev.learner}</p>}
                                    {ev.priority !== 'normal' && (
                                      <span className={`text-[7px] px-1 py-0.5 rounded-full border font-semibold ${priorityBadge(ev.priority)}`}>
                                        {ev.priority === 'urgent' ? '!' : 'High'}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DAY VIEW */}
            {viewMode === 'day' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-foreground-200/60 flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${isToday(selectedDay, viewMonth, viewYear) ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-700'}`}>
                    {selectedDay}
                  </span>
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">
                      {DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {MONTH_NAMES[viewMonth]} {selectedDay}
                    </p>
                    <p className="text-[11px] text-foreground-400">{selectedDayEvents.length} events</p>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map(hour => {
                    const eventsInSlot = selectedDayEvents.filter(ev => {
                      const startH = ev.startHour;
                      return startH >= hour && startH < hour + 1;
                    });
                    const isCurrentRow = currentHour === hour && isToday(selectedDay, viewMonth, viewYear);
                    return (
                      <div key={`dh-${hour}`} className={`flex items-start border-b border-background-100/50 min-h-[64px] ${isCurrentRow ? 'bg-primary-50/20' : ''}`}>
                        <div className="w-16 shrink-0 px-3 py-3 text-right border-r border-background-100/50">
                          <span className="text-[11px] font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        <div className="flex-1 py-2 px-3 relative">
                          {isCurrentRow && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary-400 rounded-full" />}
                          <div className="space-y-1.5">
                            {eventsInSlot.map(ev => {
                              const tc = typeConfig(ev.type);
                              return (
                                <div
                                  key={ev.id}
                                  onClick={() => setSelectedEvent(ev)}
                                  className={`p-3 rounded-lg border-l-[3px] cursor-pointer transition-smooth hover:shadow-sm hover:brightness-95 ${tc.bg} ${tc.border} ${selectedEvent?.id === ev.id ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-sm font-semibold ${tc.text}`}>{ev.title}</span>
                                    <div className="flex items-center gap-1.5">
                                      {ev.priority !== 'normal' && (
                                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${priorityBadge(ev.priority)}`}>
                                          {ev.priority === 'urgent' ? 'Urgent' : 'High'}
                                        </span>
                                      )}
                                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${ev.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ev.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                        {ev.status === 'confirmed' ? 'Confirmed' : ev.status === 'pending' ? 'Pending' : 'Cancelled'}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-500">
                                    <span><i className="ri-time-line mr-0.5"></i>{formatTime(ev.startHour)} – {formatTime(ev.endHour)}</span>
                                    {ev.platform && <span><i className="ri-video-line mr-0.5"></i>{ev.platform}</span>}
                                    {ev.location && <span><i className="ri-map-pin-line mr-0.5"></i>{ev.location}</span>}
                                    {ev.learner && <span className="font-medium text-foreground-600">{ev.learner}</span>}
                                    {ev.employer && <span className="font-medium text-foreground-600">{ev.employer}</span>}
                                    {ev.cohort && <span className="text-foreground-400">{ev.cohort}</span>}
                                  </div>
                                </div>
                              );
                            })}
                            {eventsInSlot.length === 0 && isCurrentRow && (
                              <div className="py-1 px-2">
                                <span className="text-[10px] text-primary-500 font-medium">Now</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Day events list when in month view ── */}
            {viewMode === 'month' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">
                    {DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {selectedDay} {MONTH_NAMES[viewMonth]}
                  </h3>
                  <button onClick={() => setViewMode('day')} className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                    Day view <i className="ri-arrow-right-line ml-0.5"></i>
                  </button>
                </div>
                {selectedDayEvents.length === 0 ? (
                  <div className="text-center py-8">
                    <span className="w-10 h-10 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-2">
                      <i className="ri-calendar-2-line text-foreground-300"></i>
                    </span>
                    <p className="text-sm text-foreground-400">No events for this day</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.sort((a, b) => a.startHour - b.startHour).map(ev => {
                      const tc = typeConfig(ev.type);
                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-smooth hover:shadow-sm hover:brightness-95 ${tc.bg} ${tc.border} ${selectedEvent?.id === ev.id ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tc.bg} ${tc.text}`}>
                            <i className={tc.icon}></i>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${tc.text}`}>{ev.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-foreground-500">
                              <span>{formatTime(ev.startHour)} – {formatTime(ev.endHour)}</span>
                              {ev.learner && <span className="text-foreground-400">· {ev.learner}</span>}
                              {ev.employer && <span className="text-foreground-400">· {ev.employer}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {ev.priority !== 'normal' && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${priorityBadge(ev.priority)}`}>
                                {ev.priority === 'urgent' ? 'Urgent' : 'High'}
                              </span>
                            )}
                            <span className={`w-2 h-2 rounded-full ${tc.dot}`}></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Sidebar (1/3) ── */}
          <div className="space-y-4">
            {/* Event Detail */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              {selectedEvent ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Event Details</h3>
                    <button onClick={() => setSelectedEvent(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 cursor-pointer">
                      <i className="ri-close-line"></i>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${typeConfig(selectedEvent.type).bg}`}>
                      <i className={`${typeConfig(selectedEvent.type).icon} ${typeConfig(selectedEvent.type).text} text-sm`}></i>
                    </span>
                    <div>
                      <h4 className="text-sm font-heading font-semibold text-foreground-900">{selectedEvent.title}</h4>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${priorityBadge(selectedEvent.priority)}`}>
                        {selectedEvent.priority === 'urgent' ? 'Urgent' : selectedEvent.priority === 'high' ? 'High Priority' : 'Normal'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                      <i className="ri-calendar-line text-foreground-400 w-4 text-center"></i>
                      <span className="font-medium">{DAYS_OF_WEEK[selectedEvent.dayOfWeek]}, {selectedEvent.dayOfMonth} {MONTH_NAMES[selectedEvent.month]}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                      <i className="ri-time-line text-foreground-400 w-4 text-center"></i>
                      <span className="font-medium">{formatTime(selectedEvent.startHour)} – {formatTime(selectedEvent.endHour)}</span>
                      <span className="text-foreground-300">({selectedEvent.endHour - selectedEvent.startHour}h)</span>
                    </div>
                    {selectedEvent.learner && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-user-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.learner}</span>
                        {selectedEvent.programme && <span className="text-foreground-300">— {selectedEvent.programme}</span>}
                      </div>
                    )}
                    {selectedEvent.employer && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-building-2-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.employer}</span>
                      </div>
                    )}
                    {selectedEvent.tutor && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-user-settings-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">Tutor: {selectedEvent.tutor}</span>
                      </div>
                    )}
                    {selectedEvent.platform && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-video-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.platform}</span>
                        {selectedEvent.location && <span className="text-foreground-300">/ {selectedEvent.location}</span>}
                      </div>
                    )}
                    {selectedEvent.cohort && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-group-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.cohort}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                      <i className="ri-checkbox-circle-line text-foreground-400 w-4 text-center"></i>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${selectedEvent.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : selectedEvent.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {selectedEvent.status === 'confirmed' ? 'Confirmed' : selectedEvent.status === 'pending' ? 'Pending' : 'Cancelled'}
                      </span>
                    </div>
                    {selectedEvent.notes && (
                      <div className="bg-background-100 rounded-lg p-3 mt-2">
                        <p className="text-[10px] text-foreground-400 uppercase font-semibold mb-1">Notes</p>
                        <p className="text-[11px] text-foreground-600 leading-relaxed">{selectedEvent.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-background-200/30">
                    <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-edit-line mr-1"></i> Edit
                    </button>
                    <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-delete-bin-line mr-1"></i> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4 flex items-center gap-2">
                    <i className="ri-information-line text-foreground-400"></i>Event Details
                  </h3>
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <span className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mb-3">
                      <i className="ri-calendar-event-line text-foreground-300 text-lg"></i>
                    </span>
                    <p className="text-sm font-semibold text-foreground-400">Select an event</p>
                    <p className="text-[11px] text-foreground-300 mt-1">Click on any event in the calendar to view details here</p>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Links */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
                <i className="ri-links-line text-primary-500"></i>Quick Links
              </h3>
              <div className="space-y-1">
                <Link to="/coach/meetings" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-calendar-check-line text-primary-500"></i>Coaching Meetings
                </Link>
                <Link to="/coach/progress-reviews" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-file-chart-line text-accent-500"></i>Progress Reviews
                </Link>
                <Link to="/coach/caseload" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-user-line text-secondary-500"></i>My Caseload
                </Link>
                <Link to="/coach/attendance" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-pulse-line text-amber-500"></i>Attendance Records
                </Link>
                <Link to="/coach/reports" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-bar-chart-line text-emerald-500"></i>Reports
                </Link>
              </div>
            </div>

            {/* Upcoming Events */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
                <i className="ri-calendar-todo-line text-accent-500"></i>Upcoming
              </h3>
              <div className="space-y-2">
                {ALL_EVENTS
                  .filter(ev => {
                    const evDate = new Date(2026, ev.month, ev.dayOfMonth);
                    return evDate >= now && ev.status !== 'cancelled';
                  })
                  .slice(0, 5)
                  .map(ev => {
                    const tc = typeConfig(ev.type);
                    return (
                      <div
                        key={ev.id}
                        onClick={() => { setSelectedDay(ev.dayOfMonth); setViewMonth(ev.month); setSelectedEvent(ev); }}
                        className="flex items-start gap-2.5 p-2 -mx-2 rounded-lg cursor-pointer transition-smooth hover:bg-background-100"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${tc.dot}`}></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-foreground-800 leading-tight truncate">{ev.title}</p>
                          <p className="text-[10px] text-foreground-400">
                            {ev.dayOfMonth} {MONTH_NAMES[ev.month]} · {formatTime(ev.startHour)}
                            {ev.learner && <span> · {ev.learner}</span>}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                {ALL_EVENTS.filter(ev => {
                  const evDate = new Date(2026, ev.month, ev.dayOfMonth);
                  return evDate >= now && ev.status !== 'cancelled';
                }).length === 0 && (
                  <p className="text-[11px] text-foreground-400 text-center py-3">No upcoming events</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}