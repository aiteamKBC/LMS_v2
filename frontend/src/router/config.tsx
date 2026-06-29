import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import NotFound from "../pages/NotFound";
import Home from "../pages/home/page";
import ForgotPasswordPage from "../pages/forgot-password/page";
import LearnerOverview from "../pages/workspace/learner/page";
import CoachDashboard from "../pages/workspace/coach/page";
import AdminUsersPage from "../pages/admin/users/page";
import AdminRolesPage from "../pages/admin/roles/page";
import AdminPermissionsPage from "../pages/admin/permissions/page";
import AdminTenantsPage from "../pages/admin/tenants/page";
import AdminOrganisationsPage from "../pages/admin/organisations/page";
import AdminEmployersPage from "../pages/admin/employers/page";
import AdminProgrammesPage from "../pages/admin/programmes/page";
import AdminCohortsPage from "../pages/admin/cohorts/page";
import AdminFormsPage from "../pages/admin/forms/page";
import AdminTemplatesPage from "../pages/admin/templates/page";
import AdminDocumentsPage from "../pages/admin/documents/page";
import AdminAutomationsPage from "../pages/admin/automations/page";
import AdminNotificationsPage from "../pages/admin/notifications/page";
import AdminMessagesPage from "../pages/admin/messages/page";
import AdminReportsPage from "../pages/admin/reports/page";
import AdminAtRiskPage from "../pages/admin/at-risk/page";
import AdminDashboard from "../pages/workspace/admin/page";
import InternalPanelPage from "../pages/internal-panel/page";
import OnboardingPage from "../pages/onboarding/page";
import SettingsHub from "../pages/admin/settings/page";
import PreActiveLearnerJourney from "../pages/compliance/pre-active/page";
import EmployerContracting from "../pages/compliance/employer-contracting/page";
import SelfOnboardingPage from "../pages/compliance/self-onboarding/page";
import EnrolmentReviewPage from "../pages/compliance/enrolment-review/page";
import EligibilityReviewPage from "../pages/compliance/eligibility/page";
import InitialAssessmentPage from "../pages/compliance/initial-assessment/page";
import RPLReviewPage from "../pages/compliance/rpl-review/page";
import ThisWeekPage from "../pages/learner/this-week/page";
import TrainingPlanPage from "../pages/learner/training-plan/page";
import ModulesPage from "../pages/learner/modules/page";
import AttendancePage from "../pages/learner/attendance/page";
import CatchUpPage from "../pages/learner/catchup/page";
import ReportAbsencePage from "../pages/learner/report-absence/page";
import OTJHPage from "../pages/learner/otjh/page";
import KSBsPage from "../pages/learner/ksbs/page";
import EvidencePage from "../pages/learner/evidence/page";
import QuizzesPage from "../pages/learner/quizzes/page";
import MonthlyCyclePage from "../pages/learner/monthly-cycle/page";
import MonthlyCoachingPage from "../pages/learner/monthly-coaching/page";
import ProgressReviewsPage from "../pages/learner/progress-reviews/page";
import RewardsPage from "../pages/learner/rewards/page";
import BadgeDetailPage from "../pages/learner/rewards/badge-detail/page";
import ClubsPage from "../pages/learner/clubs/page";
import ClubDetailPage from "../pages/learner/clubs/detail/page";
import ClubBadgeDetailPage from "../pages/learner/clubs/badge-detail/page";
import ClubDiscussionDetailPage from "../pages/learner/clubs/discussion-detail/page";
import ClubEventsPage from "../pages/learner/clubs/events/page";
import EventDetailPage from "../pages/learner/clubs/events/detail/page";
import MySchedulePage from "../pages/learner/clubs/events/schedule/page";
import LearnerCalendarPage from "../pages/learner/calendar/page";
import GatewayReadinessPage from "../pages/learner/gateway/page";
import LearnerProfilePage from "../pages/learner/profile/page";
import SupportPage from "../pages/learner/support/page";
import MessagesPage from "../pages/learner/messages/page";
import GeneralNotificationsPage from "../pages/notifications/page";
import GeneralTasksPage from "../pages/tasks/page";
import GeneralMessagesPage from "../pages/messages/page";
import EmployerDashboard from "../pages/workspace/employer/page";
import ComplianceDashboard from "../pages/workspace/compliance/page";
import NewStartersPage from "../pages/compliance/new-starters/page";
import DocumentsPage from "../pages/compliance/documents/page";
import SignaturesPage from "../pages/compliance/signatures/page";
import EvidencePacksPage from "../pages/compliance/evidence-packs/page";
import DASPage from "../pages/compliance/das/page";
import ILRPage from "../pages/compliance/ilr/page";
import FundingRiskPage from "../pages/compliance/funding-risk/page";
import AptemSyncPage from "../pages/compliance/aptem-sync/page";
import AuditReportsPage from "../pages/compliance/audit-reports/page";
import EnrolmentReportsPage from "../pages/compliance/reports/page";
import MISDashboard from "../pages/workspace/mis/page";
import QADashboard from "../pages/workspace/qa/page";
import TutorDashboard from "../pages/workspace/tutor/page";
import EngagementDashboard from "../pages/workspace/engagement/page";
import LeadershipDashboard from "../pages/workspace/leadership/page";
import CurriculumDashboard from "../pages/workspace/curriculum/page";
import CoachCaseload from "../pages/coach/caseload/page";
import CoachCaseFiles from "../pages/coach/case-files/page";
import CoachAttendance from "../pages/coach/attendance/page";
import CoachAbsenceReports from "../pages/coach/absence-reports/page";
import CoachCatchupQueue from "../pages/coach/catchup-queue/page";
import CoachMarkingQueue from "../pages/coach/marking-queue/page";
import CoachAiMarking from "../pages/coach/ai-marking/page";
import CoachMeetings from "../pages/coach/meetings/page";
import CoachTimetable from "../pages/coach/timetable/page";
import CoachMonthlyCycle from "../pages/coach/monthly-cycle/page";
import CoachProgressReviews from "../pages/coach/progress-reviews/page";
import CoachKsbImpact from "../pages/coach/ksb-impact/page";
import CoachOtjhReports from "../pages/coach/otjh-reports/page";
import CoachEvidenceValidation from "../pages/coach/evidence-validation/page";
import CoachEmployerActions from "../pages/coach/employer-actions/page";
import AdminAuditLogsPage from "../pages/admin/audit-logs/page";
import AdminAccessLogsPage from "../pages/admin/access-logs/page";
import AdminIntegrationsPage from "../pages/admin/integrations/page";
import AdminSystemSettingsPage from "../pages/admin/system/page";
import EmployerApprentices from "../pages/employer/apprentices/page";
import EmployerOTJHConfirmation from "../pages/employer/otjh-confirm/page";
import EmployerProgressReviewsPage from "../pages/employer/progress-reviews/page";
import EmployerDocumentsToSign from "../pages/employer/documents/page";
import ManualModeSettings from "../pages/admin/manual-mode/page";
import StandaloneAiSettings from "../pages/admin/ai-settings/page";
import LearnerCaseFile from "../pages/coach/learner-case-file/page";
import CurriculumProgrammes from "../pages/curriculum/programmes/page";
import ModuleBuilder from "../pages/curriculum/module-builder/page";
import KSBMapping from "../pages/curriculum/ksb-mapping/page";
import CurriculumStandards from "../pages/curriculum/standards/page";
import CurriculumWeekBuilder from "../pages/curriculum/week-builder/page";
import ComponentBuilderPage from "../pages/curriculum/component-builder/page";
import QuizXmlWorkspace from "../pages/curriculum/quiz-xml/page";
import TestBanksPage from "../pages/curriculum/test-banks/page";
import CheckpointsPage from "../pages/curriculum/checkpoints/page";
import TutorSessionsPage from "../pages/tutor/sessions/page";
import TutorEvidenceReview from "../pages/tutor/evidence-review/page";
import TutorAssignmentMarking from "../pages/tutor/assignment-marking/page";
import TutorQuizResults from "../pages/tutor/quiz-results/page";
import TutorLearnersPage from "../pages/tutor/learners/page";
import TutorKsbValidationPage from "../pages/tutor/ksb-validation/page";
import TutorOtjhValidationPage from "../pages/tutor/otjh-validation/page";
import TutorFeedbackQueuePage from "../pages/tutor/feedback-queue/page";
import TutorAiMarkingPage from "../pages/tutor/ai-marking/page";
import TutorResourcesPage from "../pages/tutor/resources/page";
import TutorReportsPage from "../pages/tutor/reports/page";
import ProgrammeDetailPage from "../pages/curriculum/programme-detail/page";
import CohortDetailPage from "../pages/curriculum/cohort-detail/page";
import LearnerAllocationPage from "../pages/curriculum/learner-allocation/page";
import SessionCalendarPage from "../pages/curriculum/session-calendar/page";
import IfateStandardPage from "../pages/curriculum/ifate-standard/page";
import CurriculumMisAllocationPage from "../pages/curriculum/mis-allocation/page";
import CurriculumReportsPage from "../pages/curriculum/reports/page";
import CommunicationPage from "../pages/communication/page";
import SharedCommunicationPage from "../pages/engagement/communication/page";
import CurriculumQAPage from "../pages/curriculum/curriculum-qa/page";
import FinanceWorkspace from "../pages/workspace/finance/page";
import FundingOverviewPage from "../pages/finance/funding/page";
import InvoicingPage from "../pages/finance/invoices/page";
import PaymentsPage from "../pages/finance/payments/page";
import BudgetsPage from "../pages/finance/budgets/page";
import FinanceReportsPage from "../pages/finance/reports/page";
import AuditorWorkspace from "../pages/workspace/auditor/page";
import MisCohortsPage from "../pages/mis/cohorts/page";
import MisLearnerAllocationPage from "../pages/mis/learner-allocation/page";
import MisProgrammeAllocationPage from "../pages/mis/programme-allocation/page";
import MisModuleAllocationPage from "../pages/mis/module-allocation/page";
import MisTimetablesPage from "../pages/mis/timetables/page";
import MisTeamsSessionsPage from "../pages/mis/teams-sessions/page";
import MisAttendanceModesPage from "../pages/mis/attendance-modes/page";
import MisCoachAssignmentPage from "../pages/mis/coach-assignment/page";
import MisTutorAssignmentPage from "../pages/mis/tutor-assignment/page";
import MisCalendarPage from "../pages/mis/calendar/page";
import MisDeliveryDatesPage from "../pages/mis/delivery-dates/page";
import MisDataQualityPage from "../pages/mis/data-quality/page";
import MisDeliveryTimelinePage from "../pages/mis/delivery-timeline/page";
import MisReportsPage from "../pages/mis/reports/page";
import QaPreActive from "../pages/qa/pre-active/page";
import QaModule from "../pages/qa/module/page";
import QaEvidence from "../pages/qa/evidence/page";
import QaOtjh from "../pages/qa/otjh/page";
import QaKsb from "../pages/qa/ksb/page";
import QaProgressReview from "../pages/qa/progress-review/page";
import QaReport from "../pages/qa/report/page";
import QaRejected from "../pages/qa/rejected/page";
import QaEscalations from "../pages/qa/escalations/page";
import QaSampling from "../pages/qa/sampling/page";
import QaFindings from "../pages/qa/findings/page";
import QaReports from "../pages/qa/reports/page";
import QaEmployerContracting from "../pages/qa/employer-contracting/page";
import QaEligibility from "../pages/qa/eligibility/page";
import QaInitialAssessment from "../pages/qa/initial-assessment/page";
import QaRpl from "../pages/qa/rpl/page";
import QaDeliverySetup from "../pages/qa/delivery-setup/page";
import QaGatewayEpa from "../pages/qa/gateway-epa/page";
import LearnerEngagementPage from "../pages/engagement/learner-engagement/page";
import AttendanceRiskPage from "../pages/engagement/attendance-risk/page";
import AbsenceQueuePage from "../pages/engagement/absence-queue/page";
import CatchupOverduePage from "../pages/engagement/catchup-overdue/page";
import CallLogsPage from "../pages/engagement/call-logs/page";
import WhatsAppLogsPage from "../pages/engagement/whatsapp-logs/page";
import EmailLogsPage from "../pages/engagement/email-logs/page";
import EmployerEscalationsPage from "../pages/engagement/employer-escalations/page";
import PointsRulesPage from "../pages/engagement/points-rules/page";
import RewardsShopPage from "../pages/engagement/rewards-shop/page";
import VoucherClaimsPage from "../pages/engagement/voucher-claims/page";
import EventsPage from "../pages/engagement/events/page";
import EngagementClubsPage from "../pages/engagement/clubs/page";
import RecognitionPage from "../pages/engagement/recognition/page";
import EngagementReportsPage from "../pages/engagement/reports/page";
import EmployerApprenticeRisk from '@/pages/employer/apprentice-risk/page';
import EmployerApprenticeProgress from '@/pages/employer/apprentice-progress/page';
import EmployerReviewActions from '@/pages/employer/review-actions/page';
import EmployerEvidenceSummary from '@/pages/employer/evidence-summary/page';
import EmployerGatewayEPA from '@/pages/employer/gateway-epa/page';
import EmployerEmployerClubs from '@/pages/employer/employer-clubs/page';
import EmployerLearnerClubs from '@/pages/employer/learner-clubs/page';
import EmployerEvents from '@/pages/employer/events/page';
import EmployerCommunityActivity from '@/pages/employer/community-activity/page';
import EmployerWorkplaceConfirmations from '@/pages/employer/workplace-confirm/page';
import EmployerKSBProgress from '@/pages/employer/ksb-progress/page';
import EmployerReports from '@/pages/employer/reports/page';
import EmployerSupportRequests from '@/pages/employer/support/page';
import CoachAtRiskPage from "../pages/coach/at-risk/page";
import CoachMessagesPage from "../pages/coach/messages/page";
import CoachReportsPage from "../pages/coach/reports/page";
import CurriculumKsbFrameworksPage from "../pages/curriculum/ksb-frameworks/page";
import CurriculumVersionControlPage from "../pages/curriculum/version-control/page";
import CurriculumPublishedPage from "../pages/curriculum/published/page";
import AuditorEvidencePage from "../pages/auditor/evidence/page";
import AuditorTrailPage from "../pages/auditor/trail/page";
import AuditorCompliancePage from "../pages/auditor/compliance/page";
import AuditorOfstedPage from "../pages/auditor/ofsted/page";
import AuditorReportsPage from "../pages/auditor/reports/page";
import LeadershipCohortPerformancePage from '@/pages/leadership/cohort-performance/page';
import LeadershipProgrammePerformancePage from '@/pages/leadership/programme-performance/page';
import LeadershipLearnerProgressPage from '@/pages/leadership/learner-progress/page';
import LeadershipAchievementPipelinePage from '@/pages/leadership/achievement-pipeline/page';
import LeadershipAttendanceTrendsPage from '@/pages/leadership/attendance-trends/page';
import LeadershipEngagementTrendsPage from '@/pages/leadership/engagement-trends/page';
import LeadershipEmployerEngagementPage from '@/pages/leadership/employer-engagement/page';
import LeadershipOtjhTrendsPage from '@/pages/leadership/otjh-trends/page';
import LeadershipKsbProgressPage from '@/pages/leadership/ksb-progress/page';
import LeadershipGatewayEpaProgressPage from '@/pages/leadership/gateway-epa-progress/page';
import LeadershipTutorSlaPage from '@/pages/leadership/tutor-sla/page';
import LeadershipCoachWorkloadPage from '@/pages/leadership/coach-workload/page';
import LeadershipDeliveryPerformancePage from '@/pages/leadership/delivery-performance/page';
import LeadershipComplianceRiskPage from '@/pages/leadership/compliance-risk/page';
import LeadershipQaSamplingPage from '@/pages/leadership/qa-sampling/page';
import LeadershipOfstedPage from '@/pages/leadership/ofsted/page';
import LeadershipSarQipPage from '@/pages/leadership/sar-qip/page';
import LeadershipReportsPage from '@/pages/leadership/reports/page';
import PlatformReportPage from '@/pages/admin/platform-report/page';
import TenantOnboardingWizard from '@/pages/admin/tenant-onboarding/page';
import BulkUserImportPage from '@/pages/admin/bulk-user-import/page';
import SupportDashboard from '@/pages/workspace/support/page';
import SupportTicketQueue from '@/pages/support/ticket-queue/page';
import SupportEscalations from '@/pages/support/escalations/page';
import SupportResolved from '@/pages/support/resolved/page';
import SupportReports from '@/pages/support/reports/page';
import SupportMyTickets from '@/pages/support/my-tickets/page';
import SupportKnowledgeBase from '@/pages/support/knowledge-base/page';
import AdminSupportSettingsPage from '@/pages/admin/support-settings/page';
import SafeguardingDashboard from '@/pages/workspace/safeguarding/page';
import SafeguardingOpenCases from '@/pages/safeguarding/open-cases/page';
import SafeguardingNewConcerns from '@/pages/safeguarding/new-concerns/page';
import SafeguardingHighRiskCases from '@/pages/safeguarding/high-risk-cases/page';
import SafeguardingClosedCases from '@/pages/safeguarding/closed-cases/page';
import SafeguardingLearnerWellbeing from '@/pages/safeguarding/learner-wellbeing/page';
import SafeguardingReferrals from '@/pages/safeguarding/referrals/page';
import SafeguardingPreventRisk from '@/pages/safeguarding/prevent-risk/page';
import SafeguardingCommunication from '@/pages/safeguarding/communication/page';
import SafeguardingQAAudit from '@/pages/safeguarding/qa-audit/page';
import SafeguardingReports from '@/pages/safeguarding/reports/page';
import WeekDetailPage from "../pages/learner/week-detail/page";
import LearnerKnowledgeBase from "../pages/learner/knowledge-base/page";
import UserGuidePage from "../pages/user-guide/page";
import StarredMessagesPage from "../pages/starred-messages/page";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/internal-panel",
    element: <InternalPanelPage />,
  },
  {
    // Login removed — entry is now the workspace launcher on the home page.
    path: "/login",
    element: <Navigate to="/" replace />,
  },
  {
    path: "/forgot-password",
    element: <ForgotPasswordPage />,
  },
  {
    path: "/workspace/learner",
    element: <LearnerOverview />,
  },
  {
    path: "/workspace/coach",
    element: <CoachDashboard />,
  },
  {
    path: "/workspace/admin",
    element: <AdminDashboard />,
  },
  {
    path: "/admin/users",
    element: <AdminUsersPage />,
  },
  {
    path: "/admin/roles",
    element: <AdminRolesPage />,
  },
  {
    path: "/admin/permissions",
    element: <AdminPermissionsPage />,
  },
  {
    path: "/admin/tenants",
    element: <AdminTenantsPage />,
  },
  {
    path: "/admin/organisations",
    element: <AdminOrganisationsPage />,
  },
  {
    path: "/admin/employers",
    element: <AdminEmployersPage />,
  },
  {
    path: "/admin/programmes",
    element: <AdminProgrammesPage />,
  },
  {
    path: "/admin/cohorts",
    element: <AdminCohortsPage />,
  },
  {
    path: "/admin/forms",
    element: <AdminFormsPage />,
  },
  {
    path: "/admin/templates",
    element: <AdminTemplatesPage />,
  },
  {
    path: "/admin/documents",
    element: <AdminDocumentsPage />,
  },
  {
    path: "/admin/automations",
    element: <AdminAutomationsPage />,
  },
  {
    path: "/admin/notifications",
    element: <AdminNotificationsPage />,
  },
  {
    path: "/admin/messages",
    element: <AdminMessagesPage />,
  },
  {
    path: "/admin/reports",
    element: <AdminReportsPage />,
  },
  {
    path: "/admin/at-risk",
    element: <AdminAtRiskPage />,
  },
  {
    path: "/admin/settings",
    element: <SettingsHub />,
  },
  {
    path: "/onboarding",
    element: <OnboardingPage />,
  },
  {
    path: "/compliance/pre-active",
    element: <PreActiveLearnerJourney />,
  },
  {
    path: "/compliance/employer-contracting",
    element: <EmployerContracting />,
  },
  {
    path: "/compliance/self-onboarding",
    element: <SelfOnboardingPage />,
  },
  {
    path: "/compliance/enrolment-review",
    element: <EnrolmentReviewPage />,
  },
  {
    path: "/compliance/eligibility",
    element: <EligibilityReviewPage />,
  },
  {
    path: "/compliance/initial-assessment",
    element: <InitialAssessmentPage />,
  },
  {
    path: "/compliance/rpl-review",
    element: <RPLReviewPage />,
  },
  {
    path: "/learner/this-week",
    element: <ThisWeekPage />,
  },
  {
    path: "/learner/week/:weekNumber",
    element: <WeekDetailPage />,
  },
  {
    path: "/learner/training-plan",
    element: <TrainingPlanPage />,
  },
  {
    path: "/learner/modules",
    element: <ModulesPage />,
  },
  {
    path: "/learner/attendance",
    element: <AttendancePage />,
  },
  {
    path: "/learner/catchup",
    element: <CatchUpPage />,
  },
  {
    path: "/learner/report-absence",
    element: <ReportAbsencePage />,
  },
  {
    path: "/learner/otjh",
    element: <OTJHPage />,
  },
  {
    path: "/learner/ksbs",
    element: <KSBsPage />,
  },
  {
    path: "/learner/evidence",
    element: <EvidencePage />,
  },
  {
    path: "/learner/quizzes",
    element: <QuizzesPage />,
  },
  {
    path: "/learner/monthly-cycle",
    element: <MonthlyCyclePage />,
  },
  {
    path: "/learner/monthly-coaching",
    element: <MonthlyCoachingPage />,
  },
  {
    path: "/learner/progress-reviews",
    element: <ProgressReviewsPage />,
  },
  {
    path: "/learner/rewards/badge/:badgeId",
    element: <BadgeDetailPage />,
  },
  {
    path: "/learner/rewards",
    element: <RewardsPage />,
  },
  {
    path: "/learner/clubs/badge/:badgeId",
    element: <ClubBadgeDetailPage />,
  },
  {
    path: "/learner/clubs/discussion/:discussionId",
    element: <ClubDiscussionDetailPage />,
  },
  {
    path: "/learner/clubs/events/schedule",
    element: <MySchedulePage />,
  },
  {
    path: "/learner/clubs/events/:eventId",
    element: <EventDetailPage />,
  },
  {
    path: "/learner/clubs/events",
    element: <ClubEventsPage />,
  },
  {
    path: "/learner/clubs/:clubId",
    element: <ClubDetailPage />,
  },
  {
    path: "/learner/clubs",
    element: <ClubsPage />,
  },
  {
    path: "/learner/calendar",
    element: <LearnerCalendarPage />,
  },
  {
    path: "/learner/gateway",
    element: <GatewayReadinessPage />,
  },
  {
    path: "/learner/knowledge-base",
    element: <LearnerKnowledgeBase />,
  },
  {
    path: "/learner/profile",
    element: <LearnerProfilePage />,
  },
  {
    path: "/learner/support",
    element: <SupportPage />,
  },
  {
    path: "/learner/messages",
    element: <MessagesPage />,
  },
  {
    path: "/workspace/employer",
    element: <EmployerDashboard />,
  },
  {
    path: "/workspace/compliance",
    element: <ComplianceDashboard />,
  },
  {
    path: "/workspace/mis",
    element: <MISDashboard />,
  },
  {
    path: "/workspace/qa",
    element: <QADashboard />,
  },
  {
    path: "/workspace/tutor",
    element: <TutorDashboard />,
  },
  {
    path: "/workspace/engagement",
    element: <EngagementDashboard />,
  },
  {
    path: "/workspace/leadership",
    element: <LeadershipDashboard />,
  },
  {
    path: "/workspace/curriculum",
    element: <CurriculumDashboard />,
  },
  {
    path: "/coach/caseload",
    element: <CoachCaseload />,
  },
  {
    path: "/coach/case-files",
    element: <CoachCaseFiles />,
  },
  {
    path: "/coach/attendance",
    element: <CoachAttendance />,
  },
  {
    path: "/coach/absence-reports",
    element: <CoachAbsenceReports />,
  },
  {
    path: "/coach/catchup-queue",
    element: <CoachCatchupQueue />,
  },
  {
    path: "/coach/marking-queue",
    element: <CoachMarkingQueue />,
  },
  {
    path: "/coach/ai-marking",
    element: <CoachAiMarking />,
  },
  {
    path: "/coach/meetings",
    element: <CoachMeetings />,
  },
  {
    path: "/coach/timetable",
    element: <CoachTimetable />,
  },
  {
    path: "/coach/monthly-cycle",
    element: <CoachMonthlyCycle />,
  },
  {
    path: "/coach/progress-reviews",
    element: <CoachProgressReviews />,
  },
  {
    path: "/coach/ksb-impact",
    element: <CoachKsbImpact />,
  },
  {
    path: "/coach/otjh-reports",
    element: <CoachOtjhReports />,
  },
  {
    path: "/coach/evidence-validation",
    element: <CoachEvidenceValidation />,
  },
  {
    path: "/coach/employer-actions",
    element: <CoachEmployerActions />,
  },
  {
    path: "/admin/audit-logs",
    element: <AdminAuditLogsPage />,
  },
  {
    path: "/admin/access-logs",
    element: <AdminAccessLogsPage />,
  },
  {
    path: "/admin/integrations",
    element: <AdminIntegrationsPage />,
  },
  {
    path: "/admin/system",
    element: <AdminSystemSettingsPage />,
  },
  {
    path: "/admin/platform-report",
    element: <PlatformReportPage />,
  },
  {
    path: "/admin/tenant-onboarding",
    element: <TenantOnboardingWizard />,
  },
  {
    path: "/admin/bulk-user-import",
    element: <BulkUserImportPage />,
  },
  {
    path: "/admin/manual-mode",
    element: <ManualModeSettings />,
  },
  {
    path: "/admin/ai-settings",
    element: <StandaloneAiSettings />,
  },
  {
    path: "/employer/apprentices",
    element: <EmployerApprentices />,
  },
  {
    path: "/employer/otjh-confirm",
    element: <EmployerOTJHConfirmation />,
  },
  {
    path: "/employer/progress-reviews",
    element: <EmployerProgressReviewsPage />,
  },
  {
    path: "/employer/documents",
    element: <EmployerDocumentsToSign />,
  },
  {
    path: "/coach/learner-case-file",
    element: <LearnerCaseFile />,
  },
  {
    path: "/curriculum/programmes/:id",
    element: <ProgrammeDetailPage />,
  },
  {
    path: "/curriculum/programmes",
    element: <CurriculumProgrammes />,
  },
  {
    path: "/curriculum/module-builder",
    element: <ModuleBuilder />,
  },
  {
    path: "/curriculum/ksb-mapping",
    element: <KSBMapping />,
  },
  {
    path: "/curriculum/standards/:id",
    element: <IfateStandardPage />,
  },
  {
    path: "/curriculum/standards",
    element: <CurriculumStandards />,
  },
  {
    path: "/curriculum/week-builder",
    element: <CurriculumWeekBuilder />,
  },
  {
    path: "/curriculum/component-builder",
    element: <ComponentBuilderPage />,
  },
  {
    path: "/curriculum/quiz-xml",
    element: <QuizXmlWorkspace />,
  },
  {
    path: "/curriculum/test-banks",
    element: <TestBanksPage />,
  },
  {
    path: "/curriculum/checkpoints",
    element: <CheckpointsPage />,
  },
  {
    path: "/curriculum/cohorts/:id/allocate",
    element: <LearnerAllocationPage />,
  },
  {
    path: "/curriculum/cohorts/:id",
    element: <CohortDetailPage />,
  },
  {
    path: "/curriculum/session-calendar",
    element: <SessionCalendarPage />,
  },
  {
    path: "/tutor/sessions",
    element: <TutorSessionsPage />,
  },
  {
    path: "/tutor/evidence-review",
    element: <TutorEvidenceReview />,
  },
  {
    path: "/tutor/assignment-marking",
    element: <TutorAssignmentMarking />,
  },
  {
    path: "/tutor/quiz-results",
    element: <TutorQuizResults />,
  },
  {
    path: "/workspace/finance",
    element: <FinanceWorkspace />,
  },
  {
    path: "/workspace/auditor",
    element: <AuditorWorkspace />,
  },
  {
    path: "/employer/apprentice-risk",
    element: <EmployerApprenticeRisk />,
  },
  {
    path: "/employer/apprentice-progress",
    element: <EmployerApprenticeProgress />,
  },
  {
    path: "/employer/review-actions",
    element: <EmployerReviewActions />,
  },
  {
    path: "/employer/evidence-summary",
    element: <EmployerEvidenceSummary />,
  },
  {
    path: "/employer/gateway-epa",
    element: <EmployerGatewayEPA />,
  },
  {
    path: "/employer/employer-clubs",
    element: <EmployerEmployerClubs />,
  },
  {
    path: "/employer/learner-clubs",
    element: <EmployerLearnerClubs />,
  },
  {
    path: "/employer/events",
    element: <EmployerEvents />,
  },
  {
    path: "/employer/community-activity",
    element: <EmployerCommunityActivity />,
  },
  {
    path: "/employer/workplace-confirm",
    element: <EmployerWorkplaceConfirmations />,
  },
  {
    path: "/employer/ksb-progress",
    element: <EmployerKSBProgress />,
  },
  {
    path: "/employer/reports",
    element: <EmployerReports />,
  },
  {
    path: "/employer/support",
    element: <EmployerSupportRequests />,
  },
  {
    path: "/coach/at-risk",
    element: <CoachAtRiskPage />,
  },
  {
    path: "/coach/messages",
    element: <CoachMessagesPage />,
  },
  {
    path: "/coach/reports",
    element: <CoachReportsPage />,
  },
  {
    path: "/tutor/learners",
    element: <TutorLearnersPage />,
  },
  {
    path: "/tutor/ksb-validation",
    element: <TutorKsbValidationPage />,
  },
  {
    path: "/tutor/otjh-validation",
    element: <TutorOtjhValidationPage />,
  },
  {
    path: "/tutor/feedback-queue",
    element: <TutorFeedbackQueuePage />,
  },
  {
    path: "/tutor/ai-marking",
    element: <TutorAiMarkingPage />,
  },
  {
    path: "/tutor/resources",
    element: <TutorResourcesPage />,
  },
  {
    path: "/tutor/reports",
    element: <TutorReportsPage />,
  },
  {
    path: "/curriculum/ksb-frameworks",
    element: <CurriculumKsbFrameworksPage />,
  },
  {
    path: "/curriculum/version-control",
    element: <CurriculumVersionControlPage />,
  },
  {
    path: "/curriculum/qa",
    element: <CurriculumQAPage />,
  },
  {
    path: "/communication",
    element: <CommunicationPage />,
  },
  {
    path: "/curriculum/mis-allocation",
    element: <CurriculumMisAllocationPage />,
  },
  {
    path: "/curriculum/reports",
    element: <CurriculumReportsPage />,
  },
  {
    path: "/curriculum/published",
    element: <CurriculumPublishedPage />,
  },
  {
    path: "/engagement/learner-engagement",
    element: <LearnerEngagementPage />,
  },
  {
    path: "/engagement/attendance-risk",
    element: <AttendanceRiskPage />,
  },
  {
    path: "/engagement/absence-queue",
    element: <AbsenceQueuePage />,
  },
  {
    path: "/engagement/catchup-overdue",
    element: <CatchupOverduePage />,
  },
  {
    path: "/engagement/communication",
    element: <SharedCommunicationPage />,
  },
  {
    path: "/engagement/call-logs",
    element: <CallLogsPage />,
  },
  {
    path: "/engagement/whatsapp-logs",
    element: <WhatsAppLogsPage />,
  },
  {
    path: "/engagement/email-logs",
    element: <EmailLogsPage />,
  },
  {
    path: "/engagement/employer-escalations",
    element: <EmployerEscalationsPage />,
  },
  {
    path: "/engagement/points-rules",
    element: <PointsRulesPage />,
  },
  {
    path: "/engagement/rewards-shop",
    element: <RewardsShopPage />,
  },
  {
    path: "/engagement/voucher-claims",
    element: <VoucherClaimsPage />,
  },
  {
    path: "/engagement/events",
    element: <EventsPage />,
  },
  {
    path: "/engagement/clubs",
    element: <EngagementClubsPage />,
  },
  {
    path: "/engagement/recognition",
    element: <RecognitionPage />,
  },
  {
    path: "/engagement/reports",
    element: <EngagementReportsPage />,
  },
  {
    path: "/compliance/new-starters",
    element: <NewStartersPage />,
  },
  {
    path: "/compliance/documents",
    element: <DocumentsPage />,
  },
  {
    path: "/compliance/signatures",
    element: <SignaturesPage />,
  },
  {
    path: "/compliance/das",
    element: <DASPage />,
  },
  {
    path: "/compliance/ilr",
    element: <ILRPage />,
  },
  {
    path: "/compliance/evidence-packs",
    element: <EvidencePacksPage />,
  },
  {
    path: "/compliance/funding-risk",
    element: <FundingRiskPage />,
  },
  {
    path: "/compliance/aptem-sync",
    element: <AptemSyncPage />,
  },
  {
    path: "/compliance/audit-reports",
    element: <AuditReportsPage />,
  },
  {
    path: "/compliance/reports",
    element: <EnrolmentReportsPage />,
  },
  {
    path: "/mis/delivery-timeline",
    element: <MisDeliveryTimelinePage />,
  },
  {
    path: "/mis/cohorts",
    element: <MisCohortsPage />,
  },
  {
    path: "/mis/learner-allocation",
    element: <MisLearnerAllocationPage />,
  },
  {
    path: "/mis/programme-allocation",
    element: <MisProgrammeAllocationPage />,
  },
  {
    path: "/mis/module-allocation",
    element: <MisModuleAllocationPage />,
  },
  {
    path: "/mis/timetables",
    element: <MisTimetablesPage />,
  },
  {
    path: "/mis/teams-sessions",
    element: <MisTeamsSessionsPage />,
  },
  {
    path: "/mis/attendance-modes",
    element: <MisAttendanceModesPage />,
  },
  {
    path: "/mis/coach-assignment",
    element: <MisCoachAssignmentPage />,
  },
  {
    path: "/mis/tutor-assignment",
    element: <MisTutorAssignmentPage />,
  },
  {
    path: "/mis/calendar",
    element: <MisCalendarPage />,
  },
  {
    path: "/mis/delivery-dates",
    element: <MisDeliveryDatesPage />,
  },
  {
    path: "/mis/data-quality",
    element: <MisDataQualityPage />,
  },
  {
    path: "/mis/reports",
    element: <MisReportsPage />,
  },
  {
    path: "/qa/pre-active",
    element: <QaPreActive />,
  },
  {
    path: "/qa/module",
    element: <QaModule />,
  },
  {
    path: "/qa/evidence",
    element: <QaEvidence />,
  },
  {
    path: "/qa/otjh",
    element: <QaOtjh />,
  },
  {
    path: "/qa/ksb",
    element: <QaKsb />,
  },
  {
    path: "/qa/progress-review",
    element: <QaProgressReview />,
  },
  {
    path: "/qa/report",
    element: <QaReport />,
  },
  {
    path: "/qa/rejected",
    element: <QaRejected />,
  },
  {
    path: "/qa/escalations",
    element: <QaEscalations />,
  },
  {
    path: "/qa/sampling",
    element: <QaSampling />,
  },
  {
    path: "/qa/findings",
    element: <QaFindings />,
  },
  {
    path: "/qa/reports",
    element: <QaReports />,
  },
  {
    path: "/qa/employer-contracting",
    element: <QaEmployerContracting />,
  },
  {
    path: "/qa/eligibility",
    element: <QaEligibility />,
  },
  {
    path: "/qa/initial-assessment",
    element: <QaInitialAssessment />,
  },
  {
    path: "/qa/rpl",
    element: <QaRpl />,
  },
  {
    path: "/qa/delivery-setup",
    element: <QaDeliverySetup />,
  },
  {
    path: "/qa/gateway-epa",
    element: <QaGatewayEpa />,
  },
  {
    path: "/leadership/cohort-performance",
    element: <LeadershipCohortPerformancePage />,
  },
  {
    path: "/leadership/programme-performance",
    element: <LeadershipProgrammePerformancePage />,
  },
  {
    path: "/leadership/learner-progress",
    element: <LeadershipLearnerProgressPage />,
  },
  {
    path: "/leadership/achievement-pipeline",
    element: <LeadershipAchievementPipelinePage />,
  },
  {
    path: "/leadership/attendance-trends",
    element: <LeadershipAttendanceTrendsPage />,
  },
  {
    path: "/leadership/engagement-trends",
    element: <LeadershipEngagementTrendsPage />,
  },
  {
    path: "/leadership/employer-engagement",
    element: <LeadershipEmployerEngagementPage />,
  },
  {
    path: "/leadership/otjh-trends",
    element: <LeadershipOtjhTrendsPage />,
  },
  {
    path: "/leadership/ksb-progress",
    element: <LeadershipKsbProgressPage />,
  },
  {
    path: "/leadership/gateway-epa-progress",
    element: <LeadershipGatewayEpaProgressPage />,
  },
  {
    path: "/leadership/tutor-sla",
    element: <LeadershipTutorSlaPage />,
  },
  {
    path: "/leadership/coach-workload",
    element: <LeadershipCoachWorkloadPage />,
  },
  {
    path: "/leadership/delivery-performance",
    element: <LeadershipDeliveryPerformancePage />,
  },
  {
    path: "/leadership/compliance-risk",
    element: <LeadershipComplianceRiskPage />,
  },
  {
    path: "/leadership/qa-sampling",
    element: <LeadershipQaSamplingPage />,
  },
  {
    path: "/leadership/ofsted",
    element: <LeadershipOfstedPage />,
  },
  {
    path: "/leadership/sar-qip",
    element: <LeadershipSarQipPage />,
  },
  {
    path: "/leadership/reports",
    element: <LeadershipReportsPage />,
  },
  {
    path: "/finance/funding",
    element: <FundingOverviewPage />,
  },
  {
    path: "/finance/invoices",
    element: <InvoicingPage />,
  },
  {
    path: "/finance/payments",
    element: <PaymentsPage />,
  },
  {
    path: "/finance/budgets",
    element: <BudgetsPage />,
  },
  {
    path: "/finance/reports",
    element: <FinanceReportsPage />,
  },
  {
    path: "/workspace/support",
    element: <SupportDashboard />,
  },
  {
    path: "/support/ticket-queue",
    element: <SupportTicketQueue />,
  },
  {
    path: "/support/escalations",
    element: <SupportEscalations />,
  },
  {
    path: "/support/resolved",
    element: <SupportResolved />,
  },
  {
    path: "/support/reports",
    element: <SupportReports />,
  },
  {
    path: "/support/my-tickets",
    element: <SupportMyTickets />,
  },
  {
    path: "/support/knowledge-base",
    element: <SupportKnowledgeBase />,
  },
  {
    path: "/admin/support-settings",
    element: <AdminSupportSettingsPage />,
  },
  {
    path: "/workspace/safeguarding",
    element: <SafeguardingDashboard />,
  },
  {
    path: "/safeguarding/open-cases",
    element: <SafeguardingOpenCases />,
  },
  {
    path: "/safeguarding/new-concerns",
    element: <SafeguardingNewConcerns />,
  },
  {
    path: "/safeguarding/high-risk-cases",
    element: <SafeguardingHighRiskCases />,
  },
  {
    path: "/safeguarding/closed-cases",
    element: <SafeguardingClosedCases />,
  },
  {
    path: "/safeguarding/learner-wellbeing",
    element: <SafeguardingLearnerWellbeing />,
  },
  {
    path: "/safeguarding/referrals",
    element: <SafeguardingReferrals />,
  },
  {
    path: "/safeguarding/prevent-risk",
    element: <SafeguardingPreventRisk />,
  },
  {
    path: "/safeguarding/communication",
    element: <SafeguardingCommunication />,
  },
  {
    path: "/safeguarding/qa-audit",
    element: <SafeguardingQAAudit />,
  },
  {
    path: "/safeguarding/reports",
    element: <SafeguardingReports />,
  },
  {
    path: "/auditor/evidence",
    element: <AuditorEvidencePage />,
  },
  {
    path: "/auditor/trail",
    element: <AuditorTrailPage />,
  },
  {
    path: "/auditor/compliance",
    element: <AuditorCompliancePage />,
  },
  {
    path: "/auditor/ofsted",
    element: <AuditorOfstedPage />,
  },
  {
    path: "/auditor/reports",
    element: <AuditorReportsPage />,
  },
  {
    path: "/notifications",
    element: <GeneralNotificationsPage />,
  },
  {
    path: "/tasks",
    element: <GeneralTasksPage />,
  },
  {
    path: "/messages",
    element: <GeneralMessagesPage />,
  },
  {
    path: "/user-guide",
    element: <UserGuidePage />,
  },
  {
    path: "/starred-messages",
    element: <StarredMessagesPage />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;