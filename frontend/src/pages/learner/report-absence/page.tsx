import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { PageContainer } from '@/components/ui/PageContainer';
import { SectionHeader } from '@/components/ui/SectionHeader';
import AbsenceReportForm from '@/pages/learner/attendance/components/AbsenceReportForm';

const learnerNav = roleNavMap.learner;

/**
 * Direct-link fallback for the old standalone Absence Report page. The
 * sidebar now only exposes "Report absence" as an action inside the
 * Attendance page, but this route stays wired so existing links keep
 * working — it renders the same shared form and logic.
 */
export default function ReportAbsencePage() {
  const navigate = useNavigate();
  const p = LEARNER_PROFILE;

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Report absence"
      pageSubtitle="Tell us why you missed a session and upload supporting evidence"
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <PageContainer className="max-w-3xl">
        <SectionHeader
          title="Report a missed session"
          description="Your report goes directly to your coach and tutor. Add a written explanation, supporting evidence, or both."
          icon="ri-file-warning-line"
          actions={<button type="button" onClick={() => navigate('/learner/attendance')} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">Back to attendance</button>}
        />
        <AbsenceReportForm showGuidance showHistory />
      </PageContainer>
    </WorkspaceShell>
  );
}
