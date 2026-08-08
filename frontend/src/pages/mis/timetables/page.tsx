import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

interface TimetableEntry {
  day: string;
  time: string;
  module: string;
  cohort: string;
  tutor: string;
  platform: string;
  duration: string;
  type: 'Live' | 'Workshop' | '1:1' | 'Review';
  room: string;
  learners: number;
}

const ENTRIES: TimetableEntry[] = [
  { day: 'Mon', time: '09:00', module: 'Business Communication', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 14 },
  { day: 'Mon', time: '11:00', module: 'Data Analysis & Visualisation', cohort: 'Cohort D — DT', tutor: 'Dr. Helen Park', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 12 },
  { day: 'Mon', time: '14:00', module: '1:1 Coaching', cohort: 'Mixed', tutor: 'Med Maher', platform: 'Teams 1:1', duration: '1h', type: '1:1', room: 'Virtual', learners: 3 },
  { day: 'Tue', time: '09:00', module: 'Child Development', cohort: 'Cohort E — EYE', tutor: 'Louise Baker', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 9 },
  { day: 'Tue', time: '11:00', module: 'Marketing Principles', cohort: 'Cohort B — DM', tutor: 'Dr. Helen Park', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 10 },
  { day: 'Tue', time: '14:00', module: 'Workshop: Campaign Planning', cohort: 'Cohort B — DM', tutor: 'Dr. Helen Park', platform: 'Teams Live', duration: '2h', type: 'Workshop', room: 'Virtual', learners: 10 },
  { day: 'Wed', time: '09:00', module: 'Customer Segmentation', cohort: 'Cohort C — BA', tutor: 'Crispin Jones', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 8 },
  { day: 'Wed', time: '11:00', module: '1:1 Coaching', cohort: 'Mixed', tutor: 'Med Maher', platform: 'Teams 1:1', duration: '1h', type: '1:1', room: 'Virtual', learners: 4 },
  { day: 'Wed', time: '14:00', module: 'Review: Progress Check', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', platform: 'Teams Live', duration: '1h', type: 'Review', room: 'Virtual', learners: 14 },
  { day: 'Thu', time: '09:00', module: 'Programming Fundamentals', cohort: 'Cohort F — SWE', tutor: 'Mike Harrison', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 6 },
  { day: 'Thu', time: '11:00', module: 'Database Management', cohort: 'Cohort D — DT', tutor: 'Dr. Helen Park', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 12 },
  { day: 'Thu', time: '14:00', module: 'Digital Channels', cohort: 'Cohort B — DM', tutor: 'Dr. Helen Park', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 10 },
  { day: 'Fri', time: '09:00', module: 'Business Admin Practice', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 14 },
  { day: 'Fri', time: '11:00', module: '1:1 Coaching', cohort: 'Mixed', tutor: 'Aisha Khan', platform: 'Teams 1:1', duration: '1h', type: '1:1', room: 'Virtual', learners: 2 },
  { day: 'Fri', time: '14:00', module: 'Marketing Planning', cohort: 'Cohort C — BA', tutor: 'Crispin Jones', platform: 'Teams Live', duration: '2h', type: 'Live', room: 'Virtual', learners: 8 },
];

const typeBadge = (t: TimetableEntry['type']) => {
  switch (t) {
    case 'Live': return 'bg-primary-100 text-primary-700';
    case 'Workshop': return 'bg-accent-100 text-accent-700';
    case '1:1': return 'bg-secondary-100 text-secondary-700';
    case 'Review': return 'bg-amber-100 text-amber-700';
    default: return 'bg-foreground-100 text-foreground-500';
  }
};

export default function MisTimetablesPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterType, setFilterType] = useState('All');
  const [filterCohort, setFilterCohort] = useState('All');
  const [showEntry, setShowEntry] = useState<TimetableEntry | null>(null);

  const cohorts = Array.from(new Set(ENTRIES.map(e => e.cohort)));

  const filtered = ENTRIES.filter(e => {
    const matchType = filterType === 'All' || e.type === filterType;
    const matchCohort = filterCohort === 'All' || e.cohort === filterCohort;
    return matchType && matchCohort;
  });

  const weekLabel = weekOffset === 0 ? 'This Week' : weekOffset > 0 ? `Week +${weekOffset}` : `Week ${weekOffset}`;

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Timetables" pageSubtitle="Weekly delivery schedule across all cohorts, tutors, and delivery modes"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Sessions This Week', value: String(ENTRIES.length), icon: 'ri-calendar-line', color: 'primary' },
            { label: 'Live Sessions', value: String(ENTRIES.filter(e => e.type === 'Live').length), icon: 'ri-video-line', color: 'accent' },
            { label: '1:1 Coaching', value: String(ENTRIES.filter(e => e.type === '1:1').length), icon: 'ri-heart-line', color: 'secondary' },
            { label: 'Tutors Active', value: '5', icon: 'ri-user-settings-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset(weekOffset - 1)} className="w-8 h-8 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
              <AppIcon className="ri-arrow-left-s-line text-foreground-500"></AppIcon>
            </button>
            <span className="text-sm font-semibold text-foreground-900 min-w-[100px] text-center">{weekLabel}</span>
            <button onClick={() => setWeekOffset(weekOffset + 1)} className="w-8 h-8 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
              <AppIcon className="ri-arrow-right-s-line text-foreground-500"></AppIcon>
            </button>
            <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 cursor-pointer whitespace-nowrap">Today</button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Live', 'Workshop', '1:1', 'Review'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterCohort} onChange={e => setFilterCohort(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              <option>All</option>
              {cohorts.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Grid Header */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[80px_repeat(5,1fr)] border-b border-foreground-400/50">
            <div className="p-3 bg-background-100/50 text-[10px] font-bold text-foreground-400 uppercase tracking-wider text-center">Time</div>
            {DAYS.map(d => (
              <div key={d} className="p-3 bg-background-100/50 text-[11px] font-bold text-foreground-700 text-center border-l border-foreground-200/60">{d}</div>
            ))}
          </div>
          {TIME_SLOTS.map(time => (
            <div key={time} className="grid grid-cols-[80px_repeat(5,1fr)] border-b border-foreground-300/50 last:border-b-0">
              <div className="p-3 text-[11px] text-foreground-500 font-medium text-center bg-background-100/30">{time}</div>
              {DAYS.map(day => {
                const entries = filtered.filter(e => e.day === day && e.time === time);
                return (
                  <div key={day} className="p-2 border-l border-background-200/30 min-h-[80px]">
                    {entries.map((e, i) => (
                      <div key={i} onClick={() => setShowEntry(e)} className="p-2 rounded-lg mb-1 cursor-pointer hover:opacity-80 transition-opacity bg-primary-50 border border-primary-200/50">
                        <div className="flex items-center gap-1 mb-1">
                          <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${typeBadge(e.type)}`}>{e.type}</span>
                          <span className="text-[8px] text-foreground-400">{e.duration}</span>
                        </div>
                        <p className="text-[10px] font-semibold text-foreground-800 leading-tight">{e.module}</p>
                        <p className="text-[9px] text-foreground-400 mt-0.5">{e.cohort}</p>
                        <p className="text-[9px] text-primary-600">{e.tutor}</p>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* List View */}
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Session List</h3>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden divide-y divide-background-200/30">
            {filtered.map((e, i) => (
              <div key={i} className="p-3.5 flex items-center gap-4 hover:bg-background-100/50 transition-colors">
                <div className="text-center shrink-0 w-14">
                  <p className="text-[10px] text-foreground-400 uppercase font-semibold">{e.day}</p>
                  <p className="text-[11px] text-foreground-600 font-medium">{e.time}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground-900">{e.module}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-foreground-400">{e.cohort}</span>
                    <span className="text-[8px] text-foreground-300">|</span>
                    <span className="text-[11px] text-foreground-400">{e.tutor}</span>
                    <span className="text-[8px] text-foreground-300">|</span>
                    <span className="text-[11px] text-foreground-400">{e.learners} learners</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeBadge(e.type)}`}>{e.type}</span>
                  <span className="text-[9px] text-foreground-400">{e.duration}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Entry Modal */}
      {showEntry && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowEntry(null)}>
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-heading font-semibold text-foreground-900">{showEntry.module}</h2>
              <button onClick={() => setShowEntry(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
              </button>
            </div>
            <div className="space-y-3 text-[12px] text-foreground-600">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Day</p>
                  <p className="font-semibold text-foreground-800">{showEntry.day}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Time</p>
                  <p className="font-semibold text-foreground-800">{showEntry.time} ({showEntry.duration})</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Cohort</p>
                  <p className="font-semibold text-foreground-800">{showEntry.cohort}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Tutor</p>
                  <p className="font-semibold text-foreground-800">{showEntry.tutor}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Platform</p>
                  <p className="font-semibold text-foreground-800">{showEntry.platform}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Learners</p>
                  <p className="font-semibold text-foreground-800">{showEntry.learners}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <Link to="/mis/teams-sessions" className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer text-center whitespace-nowrap">
                  <AppIcon className="ri-video-line mr-1"></AppIcon> Teams Link
                </Link>
                <Link to="/mis/tutor-assignment" className="flex-1 px-3 py-2 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer text-center whitespace-nowrap">
                  <AppIcon className="ri-user-settings-line mr-1"></AppIcon> Tutor
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}