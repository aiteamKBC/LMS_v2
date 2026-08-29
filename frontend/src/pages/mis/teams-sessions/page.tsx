import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface TeamsSession {
  id: string;
  meetingId: string;
  module: string;
  cohort: string;
  day: string;
  time: string;
  duration: string;
  tutor: string;
  platform: string;
  link: string;
  learners: number;
  attendees: number;
  status: 'Scheduled' | 'Live' | 'Completed' | 'Cancelled';
  type: 'Live' | '1:1' | 'Workshop';
  recordingUrl?: string;
}

const SESSIONS: TeamsSession[] = [
  { id: 'ts-1', meetingId: 'MTG-2026-001', module: 'Business Communication', cohort: 'Cohort A — BA', day: 'Mon', time: '09:00', duration: '2h', tutor: 'Rachel Myers', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 14, attendees: 13, status: 'Completed', type: 'Live', recordingUrl: 'https://sharepoint.com/recording-001' },
  { id: 'ts-2', meetingId: 'MTG-2026-002', module: 'Data Analysis & Visualisation', cohort: 'Cohort D — DT', day: 'Mon', time: '11:00', duration: '2h', tutor: 'Dr. Helen Park', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 12, attendees: 11, status: 'Completed', type: 'Live', recordingUrl: 'https://sharepoint.com/recording-002' },
  { id: 'ts-3', meetingId: 'MTG-2026-003', module: '1:1 Coaching', cohort: 'Mixed', day: 'Mon', time: '14:00', duration: '1h', tutor: 'Med Maher', platform: 'Teams 1:1', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 3, attendees: 3, status: 'Completed', type: '1:1' },
  { id: 'ts-4', meetingId: 'MTG-2026-004', module: 'Child Development', cohort: 'Cohort E — EYE', day: 'Tue', time: '09:00', duration: '2h', tutor: 'Louise Baker', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 9, attendees: 8, status: 'Completed', type: 'Live', recordingUrl: 'https://sharepoint.com/recording-004' },
  { id: 'ts-5', meetingId: 'MTG-2026-005', module: 'Marketing Principles', cohort: 'Cohort B — DM', day: 'Tue', time: '11:00', duration: '2h', tutor: 'Dr. Helen Park', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 10, attendees: 10, status: 'Completed', type: 'Live', recordingUrl: 'https://sharepoint.com/recording-005' },
  { id: 'ts-6', meetingId: 'MTG-2026-006', module: 'Programming Fundamentals', cohort: 'Cohort F — SWE', day: 'Thu', time: '09:00', duration: '2h', tutor: 'Mike Harrison', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 6, attendees: 5, status: 'Scheduled', type: 'Live' },
  { id: 'ts-7', meetingId: 'MTG-2026-007', module: 'Business Admin Practice', cohort: 'Cohort A — BA', day: 'Fri', time: '09:00', duration: '2h', tutor: 'Rachel Myers', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 14, attendees: 0, status: 'Scheduled', type: 'Live' },
  { id: 'ts-8', meetingId: 'MTG-2026-008', module: 'Marketing Planning', cohort: 'Cohort C — BA', day: 'Fri', time: '14:00', duration: '2h', tutor: 'Crispin Jones', platform: 'Teams Live', link: 'https://teams.microsoft.com/l/meetup-join/19%3A...', learners: 8, attendees: 0, status: 'Scheduled', type: 'Live' },
];

const statusColour = (s: TeamsSession['status']) => {
  switch (s) {
    case 'Scheduled': return 'bg-primary-100 text-primary-700';
    case 'Live': return 'bg-emerald-100 text-emerald-700';
    case 'Completed': return 'bg-foreground-100 text-foreground-500';
    case 'Cancelled': return 'bg-rose-100 text-rose-700';
    default: return '';
  }
};

const typeBadge = (t: TeamsSession['type']) => {
  switch (t) {
    case 'Live': return 'bg-primary-100 text-primary-700';
    case '1:1': return 'bg-secondary-100 text-secondary-700';
    case 'Workshop': return 'bg-accent-100 text-accent-700';
    default: return '';
  }
};

export default function MisTeamsSessionsPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showSession, setShowSession] = useState<TeamsSession | null>(null);

  const filtered = SESSIONS.filter(s => {
    const matchSearch = s.module.toLowerCase().includes(search.toLowerCase()) || s.cohort.toLowerCase().includes(search.toLowerCase()) || s.tutor.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || s.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Teams Sessions" pageSubtitle="Manage Microsoft Teams virtual sessions, attendance tracking, and recordings"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Sessions', value: String(SESSIONS.length), icon: 'ri-video-line', color: 'primary' },
            { label: 'Completed', value: String(SESSIONS.filter(s => s.status === 'Completed').length), icon: 'ri-check-line', color: 'accent' },
            { label: 'Scheduled', value: String(SESSIONS.filter(s => s.status === 'Scheduled').length), icon: 'ri-calendar-line', color: 'secondary' },
            { label: 'Recordings', value: String(SESSIONS.filter(s => s.recordingUrl).length), icon: 'ri-record-circle-line', color: 'primary' },
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search session, tutor, cohort..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Scheduled', 'Live', 'Completed', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1"></AppIcon> Schedule Session
            </button>
          </div>
        </div>

        {/* Sessions Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(s => {
            const attendancePct = s.learners > 0 ? Math.round((s.attendees / s.learners) * 100) : 0;
            return (
              <div key={s.id} onClick={() => setShowSession(s)} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer hover:border-background-300 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColour(s.status)}`}>{s.status}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeBadge(s.type)}`}>{s.type}</span>
                  </div>
                  <span className="text-[10px] text-foreground-400">{s.day} {s.time} ({s.duration})</span>
                </div>
                <h4 className="text-sm font-semibold text-foreground-900 mb-1">{s.module}</h4>
                <p className="text-[11px] text-foreground-400 mb-2">{s.cohort} &middot; {s.tutor}</p>
                <div className="flex items-center gap-3 text-[11px] text-foreground-400">
                  <span><AppIcon className="ri-group-line mr-1 text-[10px]"></AppIcon> {s.learners} learners</span>
                  {s.status === 'Completed' && (
                    <span className={attendancePct >= 90 ? 'text-emerald-600' : attendancePct >= 75 ? 'text-amber-600' : 'text-rose-600'}>
                      <AppIcon className="ri-user-follow-line mr-1 text-[10px]"></AppIcon> {s.attendees}/{s.learners} ({attendancePct}%)
                    </span>
                  )}
                  {s.recordingUrl && (
                    <span className="text-primary-600">
                      <AppIcon className="ri-record-circle-line mr-1 text-[10px]"></AppIcon> Recording
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-video-line mr-1"></AppIcon> Join
                  </button>
                  <button className="px-3 py-1.5 border border-background-200 bg-background-50 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-settings-3-line mr-1"></AppIcon> Settings
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Session Detail Modal */}
      {showSession && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSession(null)}>
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-heading font-semibold text-foreground-900">{showSession.module}</h2>
              <button onClick={() => setShowSession(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
              </button>
            </div>
            <div className="space-y-3 text-[12px] text-foreground-600">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Meeting ID</p>
                  <p className="font-semibold text-foreground-800">{showSession.meetingId}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Status</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusColour(showSession.status)}`}>{showSession.status}</span>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Cohort</p>
                  <p className="font-semibold text-foreground-800">{showSession.cohort}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Tutor</p>
                  <p className="font-semibold text-foreground-800">{showSession.tutor}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Time</p>
                  <p className="font-semibold text-foreground-800">{showSession.day} {showSession.time} ({showSession.duration})</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Attendance</p>
                  <p className="font-semibold text-foreground-800">{showSession.attendees}/{showSession.learners}</p>
                </div>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 uppercase mb-1">Teams Link</p>
                <p className="text-[11px] text-primary-600 font-medium break-all">{showSession.link}</p>
              </div>
              {showSession.recordingUrl && (
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Recording</p>
                  <p className="text-[11px] text-primary-600 font-medium break-all">{showSession.recordingUrl}</p>
                </div>
              )}
              <div className="flex items-center gap-3 mt-4">
                <button className="meeting-join-action flex-1 px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-video-line mr-1"></AppIcon> Join Teams
                </button>
                <button className="flex-1 px-3 py-2 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-file-copy-line mr-1"></AppIcon> Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
