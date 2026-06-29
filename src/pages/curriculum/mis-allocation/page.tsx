import { useState, useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

// ─────────────────── Types ───────────────────
interface Programme {
  id: string;
  name: string;
  level: number;
  standard: string;
  duration: string;
  modules: ProgrammeModule[];
  versions: string[];
}

interface ProgrammeModule {
  id: string;
  name: string;
  durationWeeks: number;
  selected: boolean;
}

interface UKBankHoliday {
  date: string;
  name: string;
  regions: string[];
}

interface Cohort {
  id: string;
  name: string;
  programme: string;
  programmeVersion: string;
  startDate: string;
  endDate: string;
  liveSlot: string;
  coach: string;
  tutor: string;
  learnerCount: number;
  status: 'draft' | 'active';
  modules: string[];
}

interface ComputedModuleBar {
  name: string;
  startDate: Date;
  endDate: Date;
  weeks: number;
  colorClass: string;
}

// ─────────────────── Mock Data ───────────────────
const PROGRAMMES: Programme[] = [
  {
    id: 'p-ba3', name: 'Business Administrator', level: 3, standard: 'ST0070', duration: '18',
    versions: ['v2.1', 'v2.0', 'v1.9'],
    modules: [
      { id: 'ba-m1', name: 'Module 1: Business Fundamentals & Workplace Context', durationWeeks: 8, selected: true },
      { id: 'ba-m2', name: 'Module 2: Communication & Digital Skills', durationWeeks: 7, selected: true },
      { id: 'ba-m3', name: 'Module 3: Project & Process Management', durationWeeks: 8, selected: true },
      { id: 'ba-m4', name: 'Module 4: Financial & Legal Awareness', durationWeeks: 7, selected: true },
      { id: 'ba-m5', name: 'Module 5: Leadership, Improvement & EPA Preparation', durationWeeks: 8, selected: true },
    ],
  },
  {
    id: 'p-me4', name: 'Marketing Executive', level: 4, standard: 'ST0280', duration: '18',
    versions: ['v2.1', 'v2.0'],
    modules: [
      { id: 'me-m1', name: 'Module 1: Marketing Foundations & the Marketing Environment', durationWeeks: 9, selected: true },
      { id: 'me-m2', name: 'Module 2: Consumer Insight, Research and Data', durationWeeks: 8, selected: true },
      { id: 'me-m3', name: 'Module 3: Campaign Planning & Digital Channels', durationWeeks: 9, selected: true },
      { id: 'me-m4', name: 'Module 4: Evaluation, Improvement & EPA Preparation', durationWeeks: 10, selected: true },
    ],
  },
  {
    id: 'p-dt3', name: 'Data Technician', level: 3, standard: 'ST0118', duration: '18',
    versions: ['v1.2', 'v1.1'],
    modules: [
      { id: 'dt-m1', name: 'Module 1: Data Fundamentals & Ethics', durationWeeks: 8, selected: true },
      { id: 'dt-m2', name: 'Module 2: Data Collection & Storage', durationWeeks: 8, selected: true },
      { id: 'dt-m3', name: 'Module 3: Data Analysis & Visualisation', durationWeeks: 9, selected: true },
      { id: 'dt-m4', name: 'Module 4: Business Intelligence & EPA Prep', durationWeeks: 10, selected: true },
    ],
  },
  {
    id: 'p-sw4', name: 'Software Developer', level: 4, standard: 'ST0116', duration: '24',
    versions: ['v1.3', 'v1.2'],
    modules: [
      { id: 'sw-m1', name: 'Module 1: Software Engineering Principles', durationWeeks: 10, selected: true },
      { id: 'sw-m2', name: 'Module 2: Development Methodologies & Tools', durationWeeks: 10, selected: true },
      { id: 'sw-m3', name: 'Module 3: Testing, Security & DevOps', durationWeeks: 10, selected: true },
      { id: 'sw-m4', name: 'Module 4: Professional Practice & EPA Prep', durationWeeks: 12, selected: true },
    ],
  },
  {
    id: 'p-pm4', name: 'Project Manager', level: 4, standard: 'ST0723', duration: '24',
    versions: ['v1.1', 'v1.0'],
    modules: [
      { id: 'pm-m1', name: 'Module 1: Project Initiation & Governance', durationWeeks: 10, selected: true },
      { id: 'pm-m2', name: 'Module 2: Planning, Risk & Stakeholder Management', durationWeeks: 10, selected: true },
      { id: 'pm-m3', name: 'Module 3: Execution, Monitoring & Change Control', durationWeeks: 10, selected: true },
      { id: 'pm-m4', name: 'Module 4: Closing, Review & EPA Preparation', durationWeeks: 10, selected: true },
    ],
  },
];

const UK_BANK_HOLIDAYS: UKBankHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day", regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2026-04-03', name: 'Good Friday', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2026-04-06', name: 'Easter Monday', regions: ['England', 'Wales', 'N.Ireland'] },
  { date: '2026-05-04', name: 'Early May Bank Holiday', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2026-05-25', name: 'Spring Bank Holiday', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2026-08-31', name: 'Summer Bank Holiday', regions: ['England', 'Wales'] },
  { date: '2026-12-25', name: 'Christmas Day', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2026-12-28', name: 'Boxing Day (substitute)', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2027-01-01', name: "New Year's Day 2027", regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2027-03-26', name: 'Good Friday 2027', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2027-03-29', name: 'Easter Monday 2027', regions: ['England', 'Wales', 'N.Ireland'] },
  { date: '2027-05-03', name: 'Early May Bank Holiday 2027', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2027-05-31', name: 'Spring Bank Holiday 2027', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2027-08-30', name: 'Summer Bank Holiday 2027', regions: ['England', 'Wales'] },
  { date: '2027-12-27', name: 'Christmas Day (substitute) 2027', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
  { date: '2027-12-28', name: 'Boxing Day (substitute) 2027', regions: ['England', 'Wales', 'Scotland', 'N.Ireland'] },
];

const MODULE_COLORS = [
  'bg-primary-400', 'bg-accent-500', 'bg-secondary-500', 'bg-emerald-500', 'bg-amber-500',
];

const TIMELINE_COHORTS: { id: string; name: string; programme: string; startIso: string; durationMonths: number; modules: { name: string; weeks: number }[] }[] = [
  {
    id: 'tc-me-jun26', name: 'May/Jun 2026 — Marketing Exec', programme: 'Marketing Executive L4',
    startIso: '2026-05-04', durationMonths: 18,
    modules: [
      { name: 'Mod 1: Foundations', weeks: 9 }, { name: 'Mod 2: Consumer Insight', weeks: 8 },
      { name: 'Mod 3: Campaign Planning', weeks: 9 }, { name: 'Mod 4: EPA Preparation', weeks: 10 },
    ],
  },
  {
    id: 'tc-ba-mar26', name: 'Mar 2026 — Business Admin', programme: 'Business Administrator L3',
    startIso: '2026-03-10', durationMonths: 18,
    modules: [
      { name: 'Mod 1: Fundamentals', weeks: 8 }, { name: 'Mod 2: Digital Skills', weeks: 7 },
      { name: 'Mod 3: Project Mgmt', weeks: 8 }, { name: 'Mod 4: Financial', weeks: 7 },
      { name: 'Mod 5: EPA Prep', weeks: 8 },
    ],
  },
  {
    id: 'tc-me-sep25', name: 'Sep 2025 — Marketing Exec', programme: 'Marketing Executive L4',
    startIso: '2025-09-08', durationMonths: 18,
    modules: [
      { name: 'Mod 1: Foundations', weeks: 9 }, { name: 'Mod 2: Consumer Insight', weeks: 8 },
      { name: 'Mod 3: Campaign Planning', weeks: 9 }, { name: 'Mod 4: EPA Preparation', weeks: 10 },
    ],
  },
];

const INITIAL_COHORTS: Cohort[] = [
  {
    id: 'co-me-jun26', name: 'May/June 2026 — Marketing Executive', programme: 'Marketing Executive L4',
    programmeVersion: 'v2.1', startDate: '04/05/2026', endDate: '03/09/2027', liveSlot: 'Tuesday 18:00–20:00',
    coach: 'Daniel Okafor', tutor: 'Sarah Lindgren', learnerCount: 14, status: 'draft',
    modules: ['Module 1', 'Module 2', 'Module 3', 'Module 4'],
  },
  {
    id: 'co-me-sep25', name: 'September 2025 — Marketing Executive', programme: 'Marketing Executive L4',
    programmeVersion: 'v2.0', startDate: '08/09/2025', endDate: '08/01/2027', liveSlot: 'Tuesday 14:00–16:00',
    coach: 'Daniel Okafor', tutor: 'Sarah Lindgren', learnerCount: 18, status: 'active',
    modules: ['Module 1', 'Module 2', 'Module 3', 'Module 4'],
  },
  {
    id: 'co-ba-mar26', name: 'March 2026 — Business Administrator', programme: 'Business Administrator L3',
    programmeVersion: 'v2.1', startDate: '10/03/2026', endDate: '09/09/2027', liveSlot: 'Monday 09:30–11:30',
    coach: 'Med Maher', tutor: 'Rachel Myers', learnerCount: 8, status: 'active',
    modules: ['Module 1', 'Module 2', 'Module 3', 'Module 4', 'Module 5'],
  },
];

const COACHES = ['Daniel Okafor', 'Med Maher', 'Sarah Chen', 'James Porter', 'Aisha Khan', 'Tom Briggs'];
const TUTORS = ['Sarah Lindgren', 'Rachel Myers', 'Dr. Helen Park', 'Crispin Jones', 'Louise Baker', 'Mike Harrison'];

const LIVE_SLOTS = [
  'Monday 09:30–11:30', 'Monday 14:00–16:00', 'Monday 18:00–20:00',
  'Tuesday 09:30–11:30', 'Tuesday 14:00–16:00', 'Tuesday 18:00–20:00',
  'Wednesday 09:30–11:30', 'Wednesday 14:00–16:00',
  'Thursday 09:30–11:30', 'Thursday 14:00–16:00',
  'Friday 09:30–11:30',
];

// ─────────────────── Helpers ───────────────────
function calcEndDate(startStr: string, durationMonths: number): string {
  if (!startStr) return '';
  const parts = startStr.split('/');
  if (parts.length !== 3) return '';
  const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  d.setMonth(d.getMonth() + durationMonths);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function getHolidaysInRange(startStr: string, endStr: string, holidays: UKBankHoliday[]): UKBankHoliday[] {
  if (!startStr || !endStr) return [];
  const parseDate = (s: string) => { const p = s.split('/'); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])); };
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  return holidays.filter(h => { const d = new Date(h.date); return d >= start && d <= end; });
}

function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function computeModuleBars(startIso: string, modules: { name: string; weeks: number }[], holidays: string[]): ComputedModuleBar[] {
  const bars: ComputedModuleBar[] = [];
  let cursor = new Date(startIso);
  modules.forEach((m, i) => {
    const start = new Date(cursor);
    let end = addWeeks(start, m.weeks);
    // Skip over bank holidays (add a day for each holiday in the range)
    holidays.forEach(h => {
      const hd = new Date(h);
      if (hd >= start && hd <= end) {
        end = new Date(end);
        end.setDate(end.getDate() + 1);
      }
    });
    bars.push({ name: m.name, startDate: start, endDate: end, weeks: m.weeks, colorClass: MODULE_COLORS[i % MODULE_COLORS.length] });
    // 1 week gap between modules
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 7);
  });
  return bars;
}

function getMonthHeaders(startIso: string, endDate: Date): { label: string; year: number; month: number; daysInMonth: number }[] {
  const months: { label: string; year: number; month: number; daysInMonth: number }[] = [];
  const start = new Date(startIso);
  start.setDate(1);
  const end = new Date(endDate);
  end.setDate(1);
  const cursor = new Date(start);
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  while (cursor <= end) {
    const dim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    months.push({ label: `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`, year: cursor.getFullYear(), month: cursor.getMonth(), daysInMonth: dim });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function barPositionPercent(barDate: Date, totalStart: Date, totalEnd: Date): number {
  const total = totalEnd.getTime() - totalStart.getTime();
  const offset = barDate.getTime() - totalStart.getTime();
  return Math.max(0, Math.min(100, (offset / total) * 100));
}

function fmtDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function generateTimelineFromCohort(cohort: Cohort, programmes: Programme[]): typeof TIMELINE_COHORTS[0] | null {
  const prog = programmes.find(p => cohort.programme.startsWith(p.name));
  if (!prog) return null;
  const parts = cohort.startDate.split('/');
  if (parts.length !== 3) return null;
  const startIso = `${parts[2]}-${parts[1]}-${parts[0]}`;
  const modules = prog.modules
    .filter(m => cohort.modules.some(name => m.name.startsWith(name)))
    .map(m => ({ name: m.name.includes(':') ? m.name.split(':')[1].trim() : m.name, weeks: m.durationWeeks }));
  return { id: cohort.id, name: cohort.name, programme: cohort.programme, startIso, durationMonths: parseInt(prog.duration), modules };
}

// ─────────────────── Timeline Component ───────────────────
function CohortTimeline({ cohort }: { cohort: typeof TIMELINE_COHORTS[0] }) {
  const holidayDates = UK_BANK_HOLIDAYS.map(h => h.date);
  const bars = useMemo(() => computeModuleBars(cohort.startIso, cohort.modules, holidayDates), [cohort]);

  const totalStart = new Date(cohort.startIso);
  const totalEnd = bars.length > 0 ? bars[bars.length - 1].endDate : new Date(cohort.startIso);
  const monthHeaders = getMonthHeaders(cohort.startIso, totalEnd);
  const totalDays = (totalEnd.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24);

  const holidaysInRange = UK_BANK_HOLIDAYS.filter(h => {
    const d = new Date(h.date);
    return d >= totalStart && d <= totalEnd;
  });

  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
      {/* Cohort Header */}
      <div className="px-5 py-3.5 border-b border-foreground-200/60 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-foreground-900">{cohort.name}</p>
          <p className="text-[11px] text-foreground-400 mt-0.5">{cohort.programme} · {fmtDate(totalStart)} — {fmtDate(totalEnd)} · {cohort.modules.length} modules</p>
        </div>
        <div className="flex items-center gap-2">
          {holidaysInRange.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200/50 px-2 py-1 rounded-lg">
              <i className="ri-calendar-close-line text-xs"></i>
              {holidaysInRange.length} bank holiday{holidaysInRange.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Gantt Chart */}
      <div className="px-5 py-4 overflow-x-auto">
        {/* Month Headers */}
        <div className="relative flex mb-2" style={{ minWidth: `${Math.max(monthHeaders.length * 80, 700)}px` }}>
          {monthHeaders.map((m, i) => {
            const widthPct = (m.daysInMonth / totalDays) * 100;
            return (
              <div key={i} className="flex-shrink-0 border-l border-foreground-200/60 pl-1" style={{ width: `${widthPct}%` }}>
                <span className="text-[9px] font-semibold text-foreground-400 uppercase tracking-wide whitespace-nowrap">{m.label}</span>
              </div>
            );
          })}
        </div>

        {/* Gantt Rows */}
        <div className="space-y-2" style={{ minWidth: `${Math.max(monthHeaders.length * 80, 700)}px` }}>
          {bars.map((bar, i) => {
            const leftPct = barPositionPercent(bar.startDate, totalStart, totalEnd);
            const widthPct = barPositionPercent(bar.endDate, totalStart, totalEnd) - leftPct;
            // Find holidays that fall in this bar
            const barHolidays = UK_BANK_HOLIDAYS.filter(h => {
              const d = new Date(h.date);
              return d >= bar.startDate && d <= bar.endDate;
            });

            return (
              <div key={i} className="relative flex items-center gap-3" style={{ height: '36px' }}>
                {/* Module Name Label */}
                <div className="absolute left-0 top-0 bottom-0 flex items-center z-10" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                  <div
                    className={`h-full w-full rounded-lg flex items-center px-3 ${bar.colorClass} relative cursor-pointer transition-all duration-200 ${hoveredBar === i ? 'opacity-100 brightness-110' : 'opacity-90'}`}
                    onMouseEnter={() => setHoveredBar(i)}
                    onMouseLeave={() => setHoveredBar(null)}
                    style={{ minWidth: '20px' }}
                  >
                    <span className="text-[10px] font-semibold text-white truncate whitespace-nowrap">{bar.name}</span>
                    {/* Holiday markers inside bar */}
                    {barHolidays.map(h => {
                      const hleft = barPositionPercent(new Date(h.date), bar.startDate, bar.endDate);
                      return (
                        <div key={h.date} className="absolute top-0 bottom-0 w-0.5 bg-white/40" style={{ left: `${hleft}%` }} title={h.name}></div>
                      );
                    })}
                  </div>
                  {/* Tooltip */}
                  {hoveredBar === i && (
                    <div className="absolute bottom-full mb-1.5 left-0 z-50 bg-foreground-900 text-white rounded-xl px-3 py-2.5 min-w-[200px] pointer-events-none animate-in fade-in duration-150">
                      <p className="text-[12px] font-semibold mb-1">{bar.name}</p>
                      <p className="text-[10px] text-white/70">Start: {fmtDate(bar.startDate)}</p>
                      <p className="text-[10px] text-white/70">End: {fmtDate(bar.endDate)}</p>
                      <p className="text-[10px] text-white/70">{bar.weeks} weeks</p>
                      {barHolidays.length > 0 && <p className="text-[10px] text-amber-300 mt-1">{barHolidays.length} bank holiday{barHolidays.length > 1 ? 's' : ''} within module</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Today marker */}
        {(() => {
          const today = new Date();
          if (today >= totalStart && today <= totalEnd) {
            const todayPct = barPositionPercent(today, totalStart, totalEnd);
            return (
              <div className="relative mt-2" style={{ minWidth: `${Math.max(monthHeaders.length * 80, 700)}px` }}>
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500/60" style={{ left: `${todayPct}%`, height: '100%' }}>
                  <span className="absolute -top-4 left-1 text-[8px] text-red-500 font-semibold whitespace-nowrap">Today</span>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Module Date Summary */}
        <div className="mt-4 pt-3 border-t border-background-200/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {bars.map((bar, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-sm shrink-0 ${bar.colorClass}`}></span>
                <div>
                  <p className="text-[10px] font-medium text-foreground-700">{bar.name}</p>
                  <p className="text-[9px] text-foreground-400">{fmtDate(bar.startDate)} → {fmtDate(bar.endDate)} · {bar.weeks}w</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Main Component ───────────────────
export default function MisAllocationPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>(INITIAL_COHORTS);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [activeView, setActiveView] = useState<'table' | 'timeline'>('table');
  const [selectedTimelineCohortId, setSelectedTimelineCohortId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const [selectedProgrammeId, setSelectedProgrammeId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [cohortName, setCohortName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [selectedCoach, setSelectedCoach] = useState('');
  const [selectedTutor, setSelectedTutor] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [moduleSelections, setModuleSelections] = useState<Record<string, boolean>>({});
  const [customHolidays, setCustomHolidays] = useState<string[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [sendWelcome, setSendWelcome] = useState(true);
  const [welcomeMsg, setWelcomeMsg] = useState("Welcome to your apprenticeship programme. Your training plan is now live — please log in to view your first week.");

  const selectedProgramme = PROGRAMMES.find(p => p.id === selectedProgrammeId);

  const allHolidayDates = useMemo(() => {
    const base = UK_BANK_HOLIDAYS.map(h => h.date);
    return [...base, ...customHolidays];
  }, [customHolidays]);

  const endDate = useMemo(() => {
    if (!selectedProgramme || !startDate) return '';
    return calcEndDate(startDate, parseInt(selectedProgramme.duration));
  }, [selectedProgramme, startDate]);

  const holidaysInRange = useMemo(() => {
    return getHolidaysInRange(startDate, endDate, UK_BANK_HOLIDAYS);
  }, [startDate, endDate]);

  const selectedModules = useMemo(() => {
    if (!selectedProgramme) return [];
    return selectedProgramme.modules.filter(m => moduleSelections[m.id] !== false);
  }, [selectedProgramme, moduleSelections]);

  const totalWeeks = selectedModules.reduce((sum, m) => sum + m.durationWeeks, 0);

  const toggleModule = (id: string) => {
    setModuleSelections(prev => ({ ...prev, [id]: prev[id] === false ? true : false }));
  };

  const handleProgrammeSelect = (id: string) => {
    const prog = PROGRAMMES.find(p => p.id === id);
    setSelectedProgrammeId(id);
    setSelectedVersion(prog?.versions[0] || '');
    const initial: Record<string, boolean> = {};
    prog?.modules.forEach(m => { initial[m.id] = true; });
    setModuleSelections(initial);
  };

  const generateCohortName = () => {
    if (!selectedProgramme || !startDate) return;
    const parts = startDate.split('/');
    if (parts.length !== 3) return;
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const auto = `${months[d.getMonth()]} ${d.getFullYear()} — ${selectedProgramme.name} (${selectedVersion})`;
    setCohortName(auto);
  };

  const handleActivate = () => {
    if (!selectedProgramme || !cohortName || !startDate || !selectedCoach || !selectedTutor || !selectedSlot) return;
    const newCohort: Cohort = {
      id: `co-${Date.now()}`,
      name: cohortName,
      programme: `${selectedProgramme.name} L${selectedProgramme.level}`,
      programmeVersion: selectedVersion,
      startDate,
      endDate,
      liveSlot: selectedSlot,
      coach: selectedCoach,
      tutor: selectedTutor,
      learnerCount: 0,
      status: 'draft',
      modules: selectedModules.map(m => m.name.split(':')[0].trim()),
    };
    setCohorts(prev => [newCohort, ...prev]);
    setShowModal(false);
    setNotification(`Cohort "${cohortName}" created and ready for learner enrolment`);
    resetForm();
    setTimeout(() => setNotification(null), 4000);
  };

  const resetForm = () => {
    setStep(1); setSelectedProgrammeId(''); setSelectedVersion(''); setCohortName('');
    setStartDate(''); setSelectedCoach(''); setSelectedTutor(''); setSelectedSlot('');
    setModuleSelections({}); setCustomHolidays([]); setNewHolidayDate(''); setNewHolidayName('');
    setUploadedFile(null); setSendWelcome(true);
  };

  const addCustomHoliday = () => {
    if (!newHolidayDate) return;
    setCustomHolidays(prev => [...prev, newHolidayDate]);
    setNewHolidayDate(''); setNewHolidayName('');
  };

  const canProceedStep1 = selectedProgrammeId && selectedVersion;
  const canProceedStep2 = cohortName && startDate && selectedCoach && selectedTutor && selectedSlot;
  const canProceedStep3 = selectedModules.length > 0;

  return (
    <WorkspaceShell
      role="curriculum" roleLabel="Curriculum Designer"
      navItems={curriculumNavItems} workspaceLabel="Curriculum Studio"
      pageTitle="MIS Allocation"
      pageSubtitle="Activate programmes for learners — MIS allocates dates, coaches, tutors and learners"
      userName="Rachel Myers" userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-5">

        {notification && (
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200/60 rounded-xl text-[13px] text-emerald-700 font-medium">
            <i className="ri-checkbox-circle-line text-base"></i>
            {notification}
          </div>
        )}

        {/* Header Actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 p-3 bg-primary-50 border border-primary-200/60 rounded-xl text-[12px] text-primary-700 flex-1">
            <i className="ri-information-line text-sm shrink-0"></i>
            <span>Curriculum publishes approved programme versions. MIS creates cohorts and activates learner training plans.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* View Toggle */}
            <div className="flex items-center gap-0.5 p-0.5 bg-background-100 rounded-lg border border-foreground-200/60">
              <button onClick={() => setActiveView('table')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${activeView === 'table' ? 'bg-background-50 text-foreground-900' : 'text-foreground-400 hover:text-foreground-700'}`}>
                <i className="ri-list-check text-sm"></i>Table
              </button>
              <button onClick={() => setActiveView('timeline')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${activeView === 'timeline' ? 'bg-background-50 text-foreground-900' : 'text-foreground-400 hover:text-foreground-700'}`}>
                <i className="ri-bar-chart-horizontal-line text-sm"></i>Timeline
              </button>
            </div>
            <button
              onClick={() => { setShowModal(true); setStep(1); }}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line"></i>New cohort
            </button>
          </div>
        </div>

        {/* ── TABLE VIEW ── */}
        {activeView === 'table' && (
          <>
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
              <div className="px-5 py-4 border-b border-foreground-200/60">
                <div className="flex items-center gap-2">
                  <i className="ri-calendar-check-line text-primary-600 text-base"></i>
                  <h2 className="text-sm font-heading font-semibold text-foreground-900">Active and planned cohorts</h2>
                </div>
                <p className="text-[11px] text-foreground-400 mt-0.5">Each cohort pins a programme version and generates learner training plans.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-foreground-200/60">
                      {['COHORT', 'PROGRAMME · V', 'DATES', 'LIVE SLOT', 'COACH / TUTOR', 'LEARNERS', 'STATUS'].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map(c => (
                      <tr key={c.id} className="border-b border-foreground-300/50 hover:bg-background-100/40 transition-smooth">
                        <td className="px-5 py-3.5">
                          <button onClick={() => { setActiveView('timeline'); setSelectedTimelineCohortId(c.id); }} className="text-[13px] font-medium text-primary-600 hover:text-primary-700 transition-smooth text-left">{c.name}</button>
                          <p className="text-[10px] text-foreground-400 mt-0.5">{c.modules.join(' · ')}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-[12px] text-foreground-700">{c.programme}</p>
                          <span className="text-[10px] text-foreground-400">{c.programmeVersion}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-[12px] text-foreground-700 whitespace-nowrap">{c.startDate} —</p>
                          <p className="text-[12px] text-foreground-700 whitespace-nowrap">{c.endDate}</p>
                        </td>
                        <td className="px-5 py-3.5"><p className="text-[12px] text-foreground-700 whitespace-nowrap">{c.liveSlot}</p></td>
                        <td className="px-5 py-3.5">
                          <p className="text-[12px] text-foreground-700">{c.coach}</p>
                          <p className="text-[11px] text-foreground-400">{c.tutor}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground-700">
                            <i className="ri-user-line text-[10px]"></i>
                            {c.learnerCount > 0 ? c.learnerCount : '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{c.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Training Plan Activation Flow */}
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <i className="ri-flow-chart text-accent-600 text-base"></i>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Training plan activation flow</h3>
              </div>
              <div className="space-y-2.5">
                {[
                  { n: 1, text: 'Curriculum publishes approved programme version.', color: 'primary' },
                  { n: 2, text: 'MIS creates cohort + pins programme version + sets start date.', color: 'accent' },
                  { n: 3, text: 'MIS assigns coach, tutor, employer, learners (manual / invite / bulk upload).', color: 'accent' },
                  { n: 4, text: 'System generates per-learner training plan with module and week dates.', color: 'secondary' },
                  { n: 5, text: 'Calendar + Teams links + planned OTJH applied per learner.', color: 'secondary' },
                  { n: 6, text: 'Learner access activates only after MIS confirms identity + compliance.', color: 'primary' },
                ].map(s => (
                  <div key={s.n} className="flex items-start gap-3">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-700'}`}>{s.n}</span>
                    <p className="text-[12px] text-foreground-600">{s.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── TIMELINE VIEW ── */}
        {activeView === 'timeline' && (() => {
          const selectedCohort = selectedTimelineCohortId ? cohorts.find(c => c.id === selectedTimelineCohortId) : null;
          const selectedTimeline = selectedCohort ? generateTimelineFromCohort(selectedCohort, PROGRAMMES) : null;
          const displayTimelines = selectedTimeline ? [selectedTimeline] : TIMELINE_COHORTS;

          return (
          <div className="space-y-4">
            {selectedTimeline && (
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedTimelineCohortId(null); }} className="flex items-center gap-2 px-4 py-2 bg-background-100 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-arrow-left-line"></i>All cohorts timeline
                </button>
                <span className="text-[11px] text-foreground-400">Viewing: <strong className="text-foreground-700">{selectedCohort?.name}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-3 p-3 bg-background-100/60 border border-foreground-200/60 rounded-xl">
              <div className="flex items-center gap-4 text-[11px] text-foreground-500 flex-wrap">
                <span className="font-semibold text-foreground-700">Timeline key:</span>
                {MODULE_COLORS.slice(0, 4).map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${c}`}></span>Module {i + 1}</span>
                ))}
                <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-white/60 bg-amber-400 inline-block rounded-full"></span>Bank holiday</span>
                <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-red-500 inline-block rounded-full"></span>Today</span>
              </div>
            </div>
            {displayTimelines.map(cohort => (
              <CohortTimeline key={cohort.id} cohort={cohort} />
            ))}
          </div>
          );
        })()}
      </div>

      {/* ──────────── New Cohort Modal ──────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-foreground-400/50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-heading font-semibold text-foreground-900">Create a new cohort</h2>
                  <p className="text-[11px] text-foreground-400 mt-0.5">
                    {step === 1 && 'Pick a programme and start date, assign coach, tutor and live slot.'}
                    {step === 2 && 'Select modules, review bank holidays and add custom closed days.'}
                    {step === 3 && 'Upload learners and configure the welcome message.'}
                  </p>
                </div>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-foreground-500 text-sm"></i>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {[1, 2, 3].map(n => (
                  <div key={n} className="flex items-center gap-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${n === step ? 'bg-primary-500 text-white' : n < step ? 'bg-emerald-100 text-emerald-700' : 'bg-background-200 text-foreground-400'}`}>
                      {n < step ? <i className="ri-check-line text-[10px]"></i> : n}
                    </div>
                    <span className={`text-[10px] ${n === step ? 'text-foreground-700 font-medium' : 'text-foreground-400'}`}>
                      {n === 1 ? 'Programme & Dates' : n === 2 ? 'Modules & Holidays' : 'Learners & Launch'}
                    </span>
                    {n < 3 && <i className="ri-arrow-right-s-line text-foreground-300 text-xs mx-0.5"></i>}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {step === 1 && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Cohort name</label>
                    <div className="flex items-center gap-2">
                      <input type="text" value={cohortName} onChange={e => setCohortName(e.target.value)} placeholder="Marketing Executive Level 4 — Jun 2026 cohort" className="flex-1 px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 outline-none focus:border-primary-400 transition-smooth" />
                      <button onClick={generateCohortName} disabled={!selectedProgramme || !startDate} className="px-3 py-2.5 bg-background-100 border border-background-200 rounded-xl text-[11px] text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed" title="Auto-generate"><i className="ri-magic-line"></i></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Programme</label>
                      <select value={selectedProgrammeId} onChange={e => handleProgrammeSelect(e.target.value)} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
                        <option value="">Select programme...</option>
                        {PROGRAMMES.map(p => <option key={p.id} value={p.id}>{p.name} L{p.level}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Version</label>
                      <select value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)} disabled={!selectedProgramme} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth cursor-pointer disabled:opacity-50">
                        {selectedProgramme?.versions.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Start date</label>
                      <input type="text" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="DD/MM/YYYY" className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 outline-none focus:border-primary-400 transition-smooth" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">End date (calculated)</label>
                      <div className="w-full px-3 py-2.5 border border-foreground-200/60 rounded-xl bg-background-100/50 text-[13px] text-foreground-500 min-h-[42px]">{endDate || <span className="text-foreground-300">—</span>}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Coach</label>
                      <select value={selectedCoach} onChange={e => setSelectedCoach(e.target.value)} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
                        <option value="">Select coach...</option>
                        {COACHES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Tutor</label>
                      <select value={selectedTutor} onChange={e => setSelectedTutor(e.target.value)} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
                        <option value="">Select tutor...</option>
                        {TUTORS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1">Live session slot</label>
                    <select value={selectedSlot} onChange={e => setSelectedSlot(e.target.value)} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
                      <option value="">Select weekly slot...</option>
                      {LIVE_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </>
              )}

              {step === 2 && selectedProgramme && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-2">
                      Modules ({selectedModules.length} selected — {totalWeeks} weeks total)
                    </label>
                    <div className="space-y-1.5">
                      {selectedProgramme.modules.map(m => {
                        const checked = moduleSelections[m.id] !== false;
                        return (
                          <label key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-smooth ${checked ? 'bg-primary-50 border-primary-200/60' : 'bg-background-100/50 border-foreground-200/60 opacity-60'}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleModule(m.id)} className="w-4 h-4 accent-primary-500 cursor-pointer" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-foreground-800">{m.name}</p>
                              <p className="text-[10px] text-foreground-400 mt-0.5">~{m.durationWeeks} weeks</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-2">Bank holidays in range ({holidaysInRange.length} detected)</label>
                    {holidaysInRange.length === 0 ? (
                      <p className="text-[11px] text-foreground-400 italic">Set a start date in Step 1 to detect bank holidays.</p>
                    ) : (
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {holidaysInRange.map(h => (
                          <div key={h.date} className="flex items-center gap-3 px-3 py-2 bg-amber-50 border border-amber-200/50 rounded-lg">
                            <i className="ri-calendar-close-line text-amber-600 text-sm shrink-0"></i>
                            <div><p className="text-[12px] font-medium text-amber-800">{h.name}</p><p className="text-[10px] text-amber-600">{h.date}</p></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-2">Add custom closed days</label>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="date" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)} className="flex-1 px-3 py-2 border border-background-200 rounded-xl bg-background-50 text-[12px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth" />
                      <input type="text" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} placeholder="Reason (optional)" className="flex-1 px-3 py-2 border border-background-200 rounded-xl bg-background-50 text-[12px] text-foreground-800 placeholder:text-foreground-300 outline-none focus:border-primary-400 transition-smooth" />
                      <button onClick={addCustomHoliday} disabled={!newHolidayDate} className="px-3 py-2 bg-primary-500 text-white rounded-xl text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40">Add</button>
                    </div>
                    {customHolidays.map(d => (
                      <div key={d} className="flex items-center justify-between px-3 py-1.5 bg-secondary-50 border border-secondary-200/50 rounded-lg mb-1">
                        <span className="text-[11px] text-secondary-700">{d}</span>
                        <button onClick={() => setCustomHolidays(prev => prev.filter(x => x !== d))} className="text-secondary-400 hover:text-red-500 transition-smooth cursor-pointer"><i className="ri-close-line text-sm"></i></button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-2">Upload learners (.xlsx or .csv)</label>
                    <p className="text-[10px] text-foreground-400 mb-2">Sheet should contain Name and Email columns.</p>
                    <div className="border-2 border-dashed border-background-200 rounded-xl p-5 text-center bg-background-100/50 hover:bg-background-100 transition-smooth cursor-pointer relative">
                      <input type="file" accept=".xlsx,.csv" onChange={e => setUploadedFile(e.target.files?.[0]?.name || null)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      {uploadedFile ? (
                        <div className="flex items-center justify-center gap-2 text-emerald-600">
                          <i className="ri-file-excel-2-line text-xl"></i>
                          <span className="text-[13px] font-medium">{uploadedFile}</span>
                        </div>
                      ) : (
                        <>
                          <i className="ri-upload-cloud-2-line text-2xl text-foreground-300 block mb-1"></i>
                          <p className="text-[12px] text-foreground-400">Choose File &nbsp;·&nbsp; No file chosen</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="p-4 bg-background-100/50 border border-foreground-200/60 rounded-xl">
                    <label className="flex items-center gap-3 cursor-pointer mb-3">
                      <input type="checkbox" checked={sendWelcome} onChange={e => setSendWelcome(e.target.checked)} className="w-4 h-4 accent-primary-500 cursor-pointer" />
                      <div className="flex items-center gap-2">
                        <i className="ri-mail-send-line text-primary-600 text-sm"></i>
                        <span className="text-[12px] font-medium text-foreground-700">Send welcome email when cohort is activated</span>
                      </div>
                    </label>
                    {sendWelcome && (
                      <textarea value={welcomeMsg} onChange={e => setWelcomeMsg(e.target.value)} rows={3} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[12px] text-foreground-700 outline-none focus:border-primary-400 transition-smooth resize-none" />
                    )}
                  </div>
                  {selectedProgramme && (
                    <div className="p-4 bg-primary-50 border border-primary-200/50 rounded-xl space-y-1.5">
                      <h4 className="text-[11px] font-semibold text-primary-800 uppercase tracking-wide mb-2">Cohort Summary</h4>
                      {[
                        { k: 'Name', v: cohortName || '—' },
                        { k: 'Programme', v: `${selectedProgramme.name} L${selectedProgramme.level} (${selectedVersion})` },
                        { k: 'Dates', v: startDate ? `${startDate} — ${endDate}` : '—' },
                        { k: 'Live Slot', v: selectedSlot || '—' },
                        { k: 'Coach', v: selectedCoach || '—' },
                        { k: 'Tutor', v: selectedTutor || '—' },
                        { k: 'Modules', v: `${selectedModules.length} selected (${totalWeeks} weeks)` },
                        { k: 'Bank Holidays', v: `${holidaysInRange.length} detected + ${customHolidays.length} custom` },
                      ].map(r => (
                        <div key={r.k} className="flex items-start gap-2 text-[11px]">
                          <span className="text-primary-500 font-medium w-24 shrink-0">{r.k}:</span>
                          <span className="text-primary-800">{r.v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-foreground-200/60 flex items-center justify-between">
              <button onClick={() => step > 1 ? setStep(step - 1) : (setShowModal(false), resetForm())} className="px-4 py-2 bg-background-100 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                {step === 1 ? 'Cancel' : '← Back'}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-400">Step {step} of 3</span>
                {step < 3 ? (
                  <button onClick={() => setStep(step + 1)} disabled={step === 1 ? !canProceedStep1 : step === 2 ? !canProceedStep3 : false} className="px-5 py-2 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
                    Next →
                  </button>
                ) : (
                  <button onClick={handleActivate} disabled={!canProceedStep2} className="px-5 py-2 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
                    Activate cohort
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}