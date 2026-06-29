import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface Session {
  id: string;
  module: string;
  cohort: string;
  date: string;
  time: string;
  day: string;
  learners: number;
  attended: number;
  status: 'completed' | 'upcoming' | 'scheduled' | 'cancelled';
  type: string;
  recording: string | null;
  resources: number;
  feedback: string;
}

const SESSIONS: Session[] = [
  { id: 's-01', module: 'Business Communication', cohort: 'Cohort A — BA', date: '9 Jun 2026', time: '09:00–11:00', day: 'Mon', learners: 14, attended: 13, status: 'completed', type: 'Live Session', recording: 'Watch (58 min)', resources: 3, feedback: 'Excellent engagement, Sophie answered well' },
  { id: 's-02', module: 'Business Admin Practice', cohort: 'Cohort A — BA', date: '10 Jun 2026', time: '11:00–13:00', day: 'Tue', learners: 14, attended: 12, status: 'completed', type: 'Workshop', recording: 'Watch (72 min)', resources: 5, feedback: 'Group activities went well, Aisha needs catch-up' },
  { id: 's-03', module: 'Business Communication', cohort: 'Cohort A — BA', date: '11 Jun 2026', time: '09:00–11:00', day: 'Wed', learners: 14, attended: 0, status: 'upcoming', type: 'Live Session', recording: null, resources: 4, feedback: '' },
  { id: 's-04', module: 'Programming Fundamentals', cohort: 'Cohort F — SWE', date: '12 Jun 2026', time: '09:00–11:00', day: 'Thu', learners: 6, attended: 0, status: 'upcoming', type: 'Workshop', recording: null, resources: 2, feedback: '' },
  { id: 's-05', module: 'Business Admin Practice', cohort: 'Cohort A — BA', date: '13 Jun 2026', time: '09:00–11:00', day: 'Fri', learners: 14, attended: 0, status: 'upcoming', type: 'Live Session', recording: null, resources: 3, feedback: '' },
  { id: 's-06', module: 'Business Communication', cohort: 'Cohort A — BA', date: '16 Jun 2026', time: '09:00–11:00', day: 'Mon', learners: 14, attended: 0, status: 'scheduled', type: 'Live Session', recording: null, resources: 2, feedback: '' },
  { id: 's-07', module: 'Data Structures', cohort: 'Cohort F — SWE', date: '18 Jun 2026', time: '13:00–15:00', day: 'Wed', learners: 6, attended: 0, status: 'scheduled', type: 'Workshop', recording: null, resources: 4, feedback: '' },
  { id: 's-08', module: 'Business Admin Practice', cohort: 'Cohort A — BA', date: '20 Jun 2026', time: '09:00–11:00', day: 'Fri', learners: 14, attended: 0, status: 'scheduled', type: 'Live Session', recording: null, resources: 3, feedback: '' },
];

const ATTENDANCE_LOG = [
  { learner: 'Sophie Williams', sessions: 8, attended: 8, late: 0, rate: 100 },
  { learner: 'Sarah Mitchell', sessions: 8, attended: 7, late: 1, rate: 88 },
  { learner: 'James Okonkwo', sessions: 8, attended: 6, late: 2, rate: 75 },
  { learner: 'Emily Watson', sessions: 8, attended: 8, late: 0, rate: 100 },
  { learner: 'Aisha Patel', sessions: 8, attended: 5, late: 3, rate: 63 },
  { learner: 'David Chen', sessions: 8, attended: 8, late: 0, rate: 100 },
];

export default function TeachingSessionsPage() {
  const [tab, setTab] = useState<'sessions' | 'attendance'>('sessions');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const filtered = filterStatus === 'all' ? SESSIONS : SESSIONS.filter(s => s.status === filterStatus);
  const upcoming = SESSIONS.filter(s => s.status === 'upcoming').length;
  const completed = SESSIONS.filter(s => s.status === 'completed').length;
  const totalRecordings = SESSIONS.filter(s => s.recording).length;
  const avgAttendance = Math.round(ATTENDANCE_LOG.reduce((s, a) => s + a.rate, 0) / ATTENDANCE_LOG.length);

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Teaching Sessions" pageSubtitle="Session planning, delivery tracking, attendance and recordings" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-presentation-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Teaching Sessions</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{upcoming} upcoming this week · {completed} completed · {totalRecordings} recordings available · Avg attendance {avgAttendance}%</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{SESSIONS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Sessions</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{upcoming}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Upcoming</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{avgAttendance}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Attend.</p></div>
            </div>
          </div>
        </div>

        {/* Tabs + Filters */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            <button onClick={() => setTab('sessions')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'sessions' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Sessions</button>
            <button onClick={() => setTab('attendance')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'attendance' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Attendance Log</button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
              {['all', 'upcoming', 'completed', 'scheduled'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterStatus === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
            <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Session</button>
          </div>
        </div>

        {/* Sessions Tab */}
        {tab === 'sessions' && (
          <div className="space-y-2">
            {filtered.map(s => (
              <div key={s.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)} className="p-4 flex items-center gap-4 cursor-pointer hover:bg-background-100/30 transition-smooth">
                  <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 ${s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : s.status === 'upcoming' ? 'bg-primary-100 text-primary-700' : 'bg-foreground-100 text-foreground-500'}`}>
                    <span className="text-[9px] font-semibold uppercase">{s.day}</span>
                    <span className="text-xs font-bold">{s.date.split(' ')[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{s.module} — {s.type}</p>
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-0.5 text-[11px] text-foreground-400">
                      <span><i className="ri-time-line mr-0.5 text-[10px]"></i>{s.time}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{s.cohort}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{s.learners} learners</span>
                      {s.status === 'completed' && <><span className="text-[8px] text-foreground-300">&middot;</span><span>{s.attended} attended</span></>}
                      {s.status === 'completed' && <><span className="text-[8px] text-foreground-300">&middot;</span><span className="text-emerald-600 font-medium">{Math.round(s.attended / s.learners * 100)}%</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : s.status === 'upcoming' ? 'bg-primary-100 text-primary-700' : s.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-foreground-100 text-foreground-500'}`}>{s.status}</span>
                    <i className={expandedSession === s.id ? 'ri-arrow-up-s-line text-foreground-300' : 'ri-arrow-down-s-line text-foreground-300'}></i>
                  </div>
                </div>
                {expandedSession === s.id && (
                  <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      {[
                        { l: 'Resources', v: String(s.resources), i: 'ri-attachment-2' },
                        { l: 'Learners', v: `${s.learners} enrolled`, i: 'ri-group-line' },
                        { l: 'Recording', v: s.recording || 'N/A', i: 'ri-video-line' },
                        { l: 'Date', v: s.date, i: 'ri-calendar-line' },
                      ].map(st => (
                        <div key={st.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{st.l}</p><p className="text-[12px] font-medium text-foreground-900 truncate">{st.v}</p></div>
                      ))}
                    </div>
                    {s.feedback && <p className="text-[11px] text-foreground-400 mb-3 bg-background-100/50 p-2 rounded-lg"><i className="ri-chat-3-line mr-1"></i>{s.feedback}</p>}
                    <div className="flex items-center gap-2">
                      {s.status === 'upcoming' && <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-video-line mr-1"></i> Start Session</button>}
                      {s.recording && <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-play-circle-line mr-1"></i> Watch Recording</button>}
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-settings-3-line mr-1"></i> Edit</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Attendance Tab */}
        {tab === 'attendance' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Log</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Session attendance tracking for Cohort A — BA</p>
              </div>
              <span className="text-[10px] text-foreground-400">Avg: {avgAttendance}%</span>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                <span>Learner</span>
                <span className="text-center">Sessions</span>
                <span className="text-center">Attended</span>
                <span className="text-center">Late</span>
                <span className="text-center">Rate</span>
              </div>
              <div className="divide-y divide-background-200/30">
                {ATTENDANCE_LOG.map(a => (
                  <div key={a.learner} className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 items-center ${a.rate < 80 ? 'bg-red-50/20' : ''}`}>
                    <span className="text-[12px] font-medium text-foreground-900">{a.learner}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{a.sessions}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{a.attended}</span>
                    <span className={`text-[11px] text-center ${a.late > 0 ? 'text-amber-600 font-semibold' : 'text-foreground-400'}`}>{a.late > 0 ? a.late : '-'}</span>
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="w-12 bg-background-200 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${a.rate >= 90 ? 'bg-emerald-500' : a.rate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${a.rate}%` }}></div>
                      </div>
                      <span className={`text-[11px] font-semibold ${a.rate >= 90 ? 'text-emerald-600' : a.rate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{a.rate}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}