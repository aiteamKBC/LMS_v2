import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { ATTENDANCE_TIMELINE, ATTENDANCE_STATS } from '@/mocks/attendance';
import AttendanceHero from './components/AttendanceHero';
import AttendanceHealthScore from './components/AttendanceHealthScore';
import MissedSessionAlerts from './components/MissedSessionAlerts';
import AttendanceTimeline from './components/AttendanceTimeline';
import UpcomingSessions from './components/UpcomingSessions';
import AttendanceInsights from './components/AttendanceInsights';
import MissedSessionGuidance from './components/MissedSessionGuidance';
import ReportAbsenceModal from './components/ReportAbsenceModal';

const learnerNav = roleNavMap.learner;

export default function AttendancePage() {
  const p = LEARNER_PROFILE;
  const s = ATTENDANCE_STATS;
  const missed = ATTENDANCE_TIMELINE.filter((r) => r.type === 'Missed').length;
  const attended = s.sessionsAttended;
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Attendance"
      pageSubtitle="Track your attendance, stay compliant, and manage your learning journey"
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <div className="p-4 md:p-6 space-y-6">
        {/* 1. HERO — gradient + donut + stats strip + actions */}
        <AttendanceHero
          missedCount={missed}
          attendedCount={attended}
          onReportAbsence={() => setShowAbsenceModal(true)}
        />

        {/* 2. ACTION REQUIRED — only if needed */}
        <MissedSessionAlerts />

        {/* 3. MAIN GRID — Timeline (2/3) + Side (1/3) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Attendance Timeline */}
            <AttendanceTimeline />

            {/* Attendance Insights — compact */}
            <AttendanceInsights />
          </div>

          <div className="space-y-6">
            {/* Upcoming Sessions */}
            <UpcomingSessions />

            {/* Attendance Health — compact */}
            <AttendanceHealthScore />
          </div>
        </div>

        {/* 4. Attendance Modes — compact horizontal */}
        <section className="bg-background-50 rounded-2xl border border-background-200/60 p-5">
          <div className="flex items-center gap-6 flex-wrap justify-center md:justify-start">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <i className="ri-user-follow-line text-emerald-600 text-sm"></i>
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground-900">Attendance Mode</p>
                <p className="text-[10px] text-foreground-400">Attend live + participate</p>
              </div>
            </div>
            <div className="w-px h-8 bg-background-200/60 hidden sm:block" />
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <i className="ri-timer-line text-amber-600 text-sm"></i>
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground-900">Catch-Up Mode</p>
                <p className="text-[10px] text-foreground-400">Missed session — attend catch-up</p>
              </div>
            </div>
            <div className="w-px h-8 bg-background-200/60 hidden sm:block" />
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
                <i className="ri-play-circle-line text-accent-600 text-sm"></i>
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground-900">Recording Mode</p>
                <p className="text-[10px] text-foreground-400">Watch + submit evidence</p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. WHAT HAPPENS IF I MISS? — collapsed */}
        <MissedSessionGuidance />

        {/* 6. Compact footer policy */}
        <div className="flex items-center gap-2 text-[11px] text-foreground-400 py-2 border-t border-background-200/40">
          <i className="ri-information-line text-secondary-400"></i>
          <span>
            Attendance target is {s.target}%. Report absences 24h ahead.{' '}
            <a href="/learner/catchup" className="text-primary-600 hover:underline font-medium">Catch-Up Hub</a>
            {' · '}
            <a href="/learner/profile" className="text-primary-600 hover:underline font-medium">Profile</a>
          </span>
        </div>
      </div>

      <ReportAbsenceModal
        open={showAbsenceModal}
        onClose={() => setShowAbsenceModal(false)}
        userName={p.fullName}
        coachName={p.coach?.name || 'Med Maher'}
      />
    </WorkspaceShell>
  );
}