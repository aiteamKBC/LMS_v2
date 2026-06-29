import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const MEETINGS = [
  { id: 'cm-1', learner: 'Emily Watson', initials: 'EW', date: '11 Jun 2026', time: '10:00–11:00', type: 'Monthly Coaching', status: 'confirmed' as const, platform: 'Teams', agenda: 'Review OTJH progress, discuss upcoming Gateway readiness', notes: 'High performer — discuss early EPA prep' },
  { id: 'cm-2', learner: 'James Okonkwo', initials: 'JO', date: '12 Jun 2026', time: '14:00–15:00', type: 'Intervention Session', status: 'urgent' as const, platform: 'Teams', agenda: 'Attendance intervention, evidence catch-up plan', notes: 'Priority: missed 2 sessions, 3 overdue evidence items' },
  { id: 'cm-3', learner: 'Sarah Mitchell', initials: 'SM', date: '13 Jun 2026', time: '09:00–10:00', type: 'Monthly Coaching', status: 'confirmed' as const, platform: 'Teams', agenda: 'Progress review preparation, OTJH check', notes: 'On track — standard monthly coaching' },
  { id: 'cm-4', learner: 'Aisha Patel', initials: 'AP', date: '14 Jun 2026', time: '11:00–12:00', type: 'Intervention Session', status: 'urgent' as const, platform: 'Teams', agenda: 'KSB stagnant review, evidence submission plan', notes: '3 weeks no new evidence — urgent intervention needed' },
  { id: 'cm-5', learner: 'David Chen', initials: 'DC', date: '16 Jun 2026', time: '14:00–15:00', type: 'Monthly Coaching', status: 'confirmed' as const, platform: 'Teams', agenda: 'Module progress review, next quarter planning', notes: 'Standard monthly coaching' },
  { id: 'cm-6', learner: 'Maya Kapoor', initials: 'MK', date: '17 Jun 2026', time: '10:00–11:00', type: 'Onboarding Coaching', status: 'confirmed' as const, platform: 'Teams', agenda: 'Onboarding week 2 check-in, training plan review', notes: 'New starter — ensure onboarding on track' },
  { id: 'cm-7', learner: 'Sophie Williams', initials: 'SW', date: '18 Jun 2026', time: '14:00–15:00', type: 'Monthly Coaching', status: 'confirmed' as const, platform: 'Teams', agenda: 'OTJH pace concern, catch-up plan', notes: 'Amber risk — focus on OTJH acceleration' },
  { id: 'cm-8', learner: 'Liam Foster', initials: 'LF', date: '19 Jun 2026', time: '09:00–10:00', type: 'Progress Review', status: 'scheduled' as const, platform: 'Teams', agenda: 'Quarter 2 progress review, KSB mapping', notes: 'Progress review session' },
];

export default function CoachMeetings() {
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'urgent' | 'scheduled'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = MEETINGS.filter(m => filter === 'all' || m.status === filter);
  const confirmed = MEETINGS.filter(m => m.status === 'confirmed').length;
  const urgent = MEETINGS.filter(m => m.status === 'urgent').length;
  const scheduled = MEETINGS.filter(m => m.status === 'scheduled').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Coaching Meetings" pageSubtitle="Schedule and manage coaching sessions" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-calendar-check-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Coaching Meetings</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{MEETINGS.length} meetings</strong> scheduled. {confirmed} confirmed, {urgent} urgent intervention, {scheduled} pending schedule.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{MEETINGS.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{urgent}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Urgent</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{confirmed}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Confirmed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({MEETINGS.length})</span></button>
          <button onClick={() => setFilter('confirmed')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'confirmed' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Confirmed <span className="text-[10px] opacity-60">({confirmed})</span></button>
          <button onClick={() => setFilter('urgent')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'urgent' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Urgent <span className="text-[10px] opacity-60">({urgent})</span></button>
          <button onClick={() => setFilter('scheduled')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'scheduled' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Scheduled <span className="text-[10px] opacity-60">({scheduled})</span></button>
        </div>

        {/* Meetings List */}
        <div className="space-y-3">
          {filtered.map(meeting => {
            const isOpen = expanded === meeting.id;
            return (
              <div key={meeting.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setExpanded(isOpen ? null : meeting.id)}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${meeting.status === 'urgent' ? 'bg-red-100 text-red-700 ring-red-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                    <span className="text-sm font-bold">{meeting.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{meeting.learner}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${meeting.status === 'urgent' ? 'bg-red-100 text-red-700' : meeting.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{meeting.status}</span>
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{meeting.type}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{meeting.date} · {meeting.time} · {meeting.platform}</p>
                  </div>
                  <div className="hidden lg:flex items-center gap-3 shrink-0">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Join Teams</button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Reschedule</button>
                  </div>
                  <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                </div>
                {isOpen && (
                  <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold text-foreground-700 mb-1">Agenda</p>
                      <p className="text-[12px] text-foreground-600">{meeting.agenda}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-foreground-700 mb-1">Coach Notes</p>
                      <p className="text-[12px] text-foreground-600">{meeting.notes}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-video-line mr-1"></i> Join Teams</button>
                      <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Mark Complete</button>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-calendar-line mr-1"></i> Reschedule</button>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-add-line mr-1"></i> Add Notes</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}