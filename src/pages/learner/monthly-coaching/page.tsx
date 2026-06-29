import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import CoachingHeroSection from './components/CoachingHeroSection';
import CoachingReadinessScore from './components/CoachingReadinessScore';
import KSBPresentationSection from './components/KSBPresentationSection';
import MeetingAgendaSection from './components/MeetingAgendaSection';
import MonthlyCoachingDashboard from './components/MonthlyCoachingDashboard';
import WorkplaceApplicationSection from './components/WorkplaceApplicationSection';
import CoachingActionTracker from './components/CoachingActionTracker';
import LastCoachingMeetingSection from './components/LastCoachingMeetingSection';
import OTJHSignOffSection from './components/OTJHSignOffSection';
import NextTwoMeetingsSection from './components/NextTwoMeetingsSection';
import CoachSupportSection from './components/CoachSupportSection';
import CoachingOutcomePredictorSection from './components/CoachingOutcomePredictorSection';
import MonthlyCoachingJourneySection from './components/MonthlyCoachingJourneySection';

const learnerNav = roleNavMap.learner;

export default function MonthlyCoachingPage() {
  const p = LEARNER_PROFILE;

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Monthly Coaching"
      pageSubtitle="Coaching Workspace & Preparation Hub"
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <div className="p-6 space-y-8">
        {/* Section 1: Next Coaching Meeting Hero */}
        <CoachingHeroSection />

        {/* Section 2: Coaching Readiness Score */}
        <CoachingReadinessScore />

        {/* Section 3: My 15-Min KSB Presentation */}
        <KSBPresentationSection />

        {/* Section 4: Meeting Agenda */}
        <MeetingAgendaSection />

        {/* Section 5: Monthly Coaching Dashboard */}
        <MonthlyCoachingDashboard />

        {/* Section 6: Workplace Application Summary */}
        <WorkplaceApplicationSection />

        {/* Section 7: Coaching Action Tracker */}
        <CoachingActionTracker />

        {/* Section 8: Last Coaching Meeting */}
        <LastCoachingMeetingSection />

        {/* Section 9: OTJH Sign-Off */}
        <OTJHSignOffSection />

        {/* Section 10: Next Two Coaching Meetings */}
        <NextTwoMeetingsSection />

        {/* Section 11: Coach Support */}
        <CoachSupportSection />

        {/* Section 12: Coaching Outcome Predictor */}
        <CoachingOutcomePredictorSection />

        {/* Section 13: Monthly Coaching Journey */}
        <MonthlyCoachingJourneySection />
      </div>
    </WorkspaceShell>
  );
}