import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";

/*
const NotFound = lazy(() => import("../pages/NotFound"));
const Home = lazy(() => import("../pages/home/page"));
const ForgotPasswordPage = lazy(() => import("../pages/forgot-password/page"));
const LearnerOverview = lazy(() => import("../pages/workspace/learner/page"));
const CoachDashboard = lazy(() => import("../pages/workspace/coach/page"));
const AdminUsersPage = lazy(() => import("../pages/admin/users/page"));
const AdminRolesPage = lazy(() => import("../pages/admin/roles/page"));
const AdminPermissionsPage = lazy(() => import("../pages/admin/permissions/page"));
const AdminTenantsPage = lazy(() => import("../pages/admin/tenants/page"));
const AdminOrganisationsPage = lazy(() => import("../pages/admin/organisations/page"));
const AdminEmployersPage = lazy(() => import("../pages/admin/employers/page"));
const AdminProgrammesPage = lazy(() => import("../pages/admin/programmes/page"));
const AdminCohortsPage = lazy(() => import("../pages/admin/cohorts/page"));
const AdminFormsPage = lazy(() => import("../pages/admin/forms/page"));
const AdminTemplatesPage = lazy(() => import("../pages/admin/templates/page"));
const AdminDocumentsPage = lazy(() => import("../pages/admin/documents/page"));
const AdminAutomationsPage = lazy(() => import("../pages/admin/automations/page"));
const AdminNotificationsPage = lazy(() => import("../pages/admin/notifications/page"));
const AdminMessagesPage = lazy(() => import("../pages/admin/messages/page"));
const AdminReportsPage = lazy(() => import("../pages/admin/reports/page"));
const AdminAtRiskPage = lazy(() => import("../pages/admin/at-risk/page"));
const AdminDashboard = lazy(() => import("../pages/workspace/admin/page"));
const InternalPanelPage = lazy(() => import("../pages/internal-panel/page"));
const SettingsHub = lazy(() => import("../pages/admin/settings/page"));
const PreActiveLearnerJourney = lazy(() => import("../pages/compliance/pre-active/page"));
const EmployerContracting = lazy(() => import("../pages/compliance/employer-contracting/page"));
const SelfOnboardingPage = lazy(() => import("../pages/compliance/self-onboarding/page"));
const EnrolmentReviewPage = lazy(() => import("../pages/compliance/enrolment-review/page"));
const EligibilityReviewPage = lazy(() => import("../pages/compliance/eligibility/page"));
const InitialAssessmentPage = lazy(() => import("../pages/compliance/initial-assessment/page"));
const RPLReviewPage = lazy(() => import("../pages/compliance/rpl-review/page"));
const TrainingPlanPage = lazy(() => import("../pages/learner/training-plan/page"));
const ModulesPage = lazy(() => import("../pages/learner/modules/page"));
const AttendancePage = lazy(() => import("../pages/learner/attendance/page"));
const CatchUpPage = lazy(() => import("../pages/learner/catchup/page"));
const ReportAbsencePage = lazy(() => import("../pages/learner/report-absence/page"));
const OTJHPage = lazy(() => import("../pages/learner/otjh/page"));
const KSBsPage = lazy(() => import("../pages/learner/ksbs/page"));
const EvidencePage = lazy(() => import("../pages/learner/evidence/page"));
const QuizzesPage = lazy(() => import("../pages/learner/quizzes/page"));
const MonthlyCyclePage = lazy(() => import("../pages/learner/monthly-cycle/page"));
const MonthlyCoachingPage = lazy(() => import("../pages/learner/monthly-coaching/page"));
const ProgressReviewsPage = lazy(() => import("../pages/learner/progress-reviews/page"));
const RewardsPage = lazy(() => import("../pages/learner/rewards/page"));
const BadgeDetailPage = lazy(() => import("../pages/learner/rewards/badge-detail/page"));
const ClubsPage = lazy(() => import("../pages/learner/clubs/page"));
const ClubDetailPage = lazy(() => import("../pages/learner/clubs/detail/page"));
const ClubBadgeDetailPage = lazy(() => import("../pages/learner/clubs/badge-detail/page"));
const ClubDiscussionDetailPage = lazy(() => import("../pages/learner/clubs/discussion-detail/page"));
const ClubEventsPage = lazy(() => import("../pages/learner/clubs/events/page"));
const EventDetailPage = lazy(() => import("../pages/learner/clubs/events/detail/page"));
const MySchedulePage = lazy(() => import("../pages/learner/clubs/events/schedule/page"));
const LearnerCalendarPage = lazy(() => import("../pages/learner/calendar/page"));
const GatewayReadinessPage = lazy(() => import("../pages/learner/gateway/page"));
const LearnerProfilePage = lazy(() => import("../pages/learner/profile/page"));
const SupportPage = lazy(() => import("../pages/learner/support/page"));
const MessagesPage = lazy(() => import("../pages/learner/messages/page"));
const GeneralNotificationsPage = lazy(() => import("../pages/notifications/page"));
const GeneralTasksPage = lazy(() => import("../pages/tasks/page"));
const GeneralMessagesPage = lazy(() => import("../pages/messages/page"));
const EmployerDashboard = lazy(() => import("../pages/workspace/employer/page"));
const ComplianceDashboard = lazy(() => import("../pages/workspace/compliance/page"));
const NewStartersPage = lazy(() => import("../pages/compliance/new-starters/page"));
const DocumentsPage = lazy(() => import("../pages/compliance/documents/page"));
const SignaturesPage = lazy(() => import("../pages/compliance/signatures/page"));
const EvidencePacksPage = lazy(() => import("../pages/compliance/evidence-packs/page"));
const DASPage = lazy(() => import("../pages/compliance/das/page"));
const ILRPage = lazy(() => import("../pages/compliance/ilr/page"));
const FundingRiskPage = lazy(() => import("../pages/compliance/funding-risk/page"));
const AptemSyncPage = lazy(() => import("../pages/compliance/aptem-sync/page"));
const AuditReportsPage = lazy(() => import("../pages/compliance/audit-reports/page"));
const EnrolmentReportsPage = lazy(() => import("../pages/compliance/reports/page"));
const MISDashboard = lazy(() => import("../pages/workspace/mis/page"));
const QADashboard = lazy(() => import("../pages/workspace/qa/page"));
const TutorDashboard = lazy(() => import("../pages/workspace/tutor/page"));
const EngagementDashboard = lazy(() => import("../pages/workspace/engagement/page"));
const LeadershipDashboard = lazy(() => import("../pages/workspace/leadership/page"));
const CurriculumDashboard = lazy(() => import("../pages/workspace/curriculum/page"));
const CoachCaseload = lazy(() => import("../pages/coach/caseload/page"));
const CoachCaseFiles = lazy(() => import("../pages/coach/case-files/page"));
const CoachAttendance = lazy(() => import("../pages/coach/attendance/page"));
const CoachAbsenceReports = lazy(() => import("../pages/coach/absence-reports/page"));
const CoachCatchupQueue = lazy(() => import("../pages/coach/catchup-queue/page"));
const CoachMarkingQueue = lazy(() => import("../pages/coach/marking-queue/page"));
const CoachAiMarking = lazy(() => import("../pages/coach/ai-marking/page"));
const CoachMeetings = lazy(() => import("../pages/coach/meetings/page"));
const CoachTimetable = lazy(() => import("../pages/coach/timetable/page"));
const CoachMonthlyCycle = lazy(() => import("../pages/coach/monthly-cycle/page"));
const CoachProgressReviews = lazy(() => import("../pages/coach/progress-reviews/page"));
const CoachKsbImpact = lazy(() => import("../pages/coach/ksb-impact/page"));
const CoachOtjhReports = lazy(() => import("../pages/coach/otjh-reports/page"));
const CoachEvidenceValidation = lazy(() => import("../pages/coach/evidence-validation/page"));
const CoachEmployerActions = lazy(() => import("../pages/coach/employer-actions/page"));
const AdminAuditLogsPage = lazy(() => import("../pages/admin/audit-logs/page"));
const AdminAccessLogsPage = lazy(() => import("../pages/admin/access-logs/page"));
const AdminIntegrationsPage = lazy(() => import("../pages/admin/integrations/page"));
const AdminSystemSettingsPage = lazy(() => import("../pages/admin/system/page"));
const EmployerApprentices = lazy(() => import("../pages/employer/apprentices/page"));
const EmployerOTJHConfirmation = lazy(() => import("../pages/employer/otjh-confirm/page"));
const EmployerProgressReviewsPage = lazy(() => import("../pages/employer/progress-reviews/page"));
const EmployerDocumentsToSign = lazy(() => import("../pages/employer/documents/page"));
const ManualModeSettings = lazy(() => import("../pages/admin/manual-mode/page"));
const StandaloneAiSettings = lazy(() => import("../pages/admin/ai-settings/page"));
const LearnerCaseFile = lazy(() => import("../pages/coach/learner-case-file/page"));
const CurriculumProgrammes = lazy(() => import("../pages/curriculum/programmes/page"));
const ModuleBuilder = lazy(() => import("../pages/curriculum/module-builder/page"));
const KSBMapping = lazy(() => import("../pages/curriculum/ksb-mapping/page"));
const CurriculumStandards = lazy(() => import("../pages/curriculum/standards/page"));
const CurriculumWeekBuilder = lazy(() => import("../pages/curriculum/week-builder/page"));
const QuizXmlWorkspace = lazy(() => import("../pages/curriculum/quiz-xml/page"));
const ManualQuizPage = lazy(() => import("../pages/curriculum/quiz-xml/manual/page"));
const CheckpointsPage = lazy(() => import("../pages/curriculum/checkpoints/page"));
const TutorSessionsPage = lazy(() => import("../pages/tutor/sessions/page"));
const TutorEvidenceReview = lazy(() => import("../pages/tutor/evidence-review/page"));
const TutorAssignmentMarking = lazy(() => import("../pages/tutor/assignment-marking/page"));
const TutorQuizResults = lazy(() => import("../pages/tutor/quiz-results/page"));
const TutorLearnersPage = lazy(() => import("../pages/tutor/learners/page"));
const TutorKsbValidationPage = lazy(() => import("../pages/tutor/ksb-validation/page"));
const TutorOtjhValidationPage = lazy(() => import("../pages/tutor/otjh-validation/page"));
const TutorFeedbackQueuePage = lazy(() => import("../pages/tutor/feedback-queue/page"));
const TutorAiMarkingPage = lazy(() => import("../pages/tutor/ai-marking/page"));
const TutorResourcesPage = lazy(() => import("../pages/tutor/resources/page"));
const TutorReportsPage = lazy(() => import("../pages/tutor/reports/page"));
const ProgrammeDetailPage = lazy(() => import("../pages/curriculum/programme-detail/page"));
const SessionCalendarPage = lazy(() => import("../pages/curriculum/session-calendar/page"));
const IfateStandardPage = lazy(() => import("../pages/curriculum/ifate-standard/page"));
const CommunicationPage = lazy(() => import("../pages/communication/page"));
const CurriculumQAPage = lazy(() => import("../pages/curriculum/curriculum-qa/page"));
const FinanceWorkspace = lazy(() => import("../pages/workspace/finance/page"));
const FundingOverviewPage = lazy(() => import("../pages/finance/funding/page"));
const InvoicingPage = lazy(() => import("../pages/finance/invoices/page"));
const PaymentsPage = lazy(() => import("../pages/finance/payments/page"));
const BudgetsPage = lazy(() => import("../pages/finance/budgets/page"));
const FinanceReportsPage = lazy(() => import("../pages/finance/reports/page"));
const AuditorWorkspace = lazy(() => import("../pages/workspace/auditor/page"));
const MisCohortsPage = lazy(() => import("../pages/mis/cohorts/page"));
const MisLearnerAllocationPage = lazy(() => import("../pages/mis/learner-allocation/page"));
const MisProgrammeAllocationPage = lazy(() => import("../pages/mis/programme-allocation/page"));
const MisModuleAllocationPage = lazy(() => import("../pages/mis/module-allocation/page"));
const MisTimetablesPage = lazy(() => import("../pages/mis/timetables/page"));
const MisTeamsSessionsPage = lazy(() => import("../pages/mis/teams-sessions/page"));
const MisAttendanceModesPage = lazy(() => import("../pages/mis/attendance-modes/page"));
const MisCoachAssignmentPage = lazy(() => import("../pages/mis/coach-assignment/page"));
const MisTutorAssignmentPage = lazy(() => import("../pages/mis/tutor-assignment/page"));
const MisCalendarPage = lazy(() => import("../pages/mis/calendar/page"));
const MisDeliveryDatesPage = lazy(() => import("../pages/mis/delivery-dates/page"));
const MisDataQualityPage = lazy(() => import("../pages/mis/data-quality/page"));
const MisDeliveryTimelinePage = lazy(() => import("../pages/mis/delivery-timeline/page"));
const MisReportsPage = lazy(() => import("../pages/mis/reports/page"));
const QaPreActive = lazy(() => import("../pages/qa/pre-active/page"));
const QaModule = lazy(() => import("../pages/qa/module/page"));
const QaEvidence = lazy(() => import("../pages/qa/evidence/page"));
const QaOtjh = lazy(() => import("../pages/qa/otjh/page"));
const QaKsb = lazy(() => import("../pages/qa/ksb/page"));
const QaProgressReview = lazy(() => import("../pages/qa/progress-review/page"));
const QaReport = lazy(() => import("../pages/qa/report/page"));
const QaRejected = lazy(() => import("../pages/qa/rejected/page"));
const QaEscalations = lazy(() => import("../pages/qa/escalations/page"));
const QaSampling = lazy(() => import("../pages/qa/sampling/page"));
const QaFindings = lazy(() => import("../pages/qa/findings/page"));
const QaReports = lazy(() => import("../pages/qa/reports/page"));
const QaEmployerContracting = lazy(() => import("../pages/qa/employer-contracting/page"));
const QaEligibility = lazy(() => import("../pages/qa/eligibility/page"));
const QaInitialAssessment = lazy(() => import("../pages/qa/initial-assessment/page"));
const QaRpl = lazy(() => import("../pages/qa/rpl/page"));
const QaDeliverySetup = lazy(() => import("../pages/qa/delivery-setup/page"));
const QaGatewayEpa = lazy(() => import("../pages/qa/gateway-epa/page"));
const LearnerEngagementPage = lazy(() => import("../pages/engagement/learner-engagement/page"));
const AttendanceRiskPage = lazy(() => import("../pages/engagement/attendance-risk/page"));
const CallLogsPage = lazy(() => import("../pages/engagement/call-logs/page"));
const WhatsAppLogsPage = lazy(() => import("../pages/engagement/whatsapp-logs/page"));
const EmailLogsPage = lazy(() => import("../pages/engagement/email-logs/page"));
const PointsRulesPage = lazy(() => import("../pages/engagement/points-rules/page"));
const RewardsShopPage = lazy(() => import("../pages/engagement/rewards-shop/page"));
const VoucherClaimsPage = lazy(() => import("../pages/engagement/voucher-claims/page"));
const EventsPage = lazy(() => import("../pages/engagement/events/page"));
const EngagementClubsPage = lazy(() => import("../pages/engagement/clubs/page"));
const RecognitionPage = lazy(() => import("../pages/engagement/recognition/page"));
const EngagementReportsPage = lazy(() => import("../pages/engagement/reports/page"));
const FlashCardsPage = lazy(() => import("../pages/engagement/flash-cards/page"));
const EmployerApprenticeRisk = lazy(() => import("@/pages/employer/apprentice-risk/page"));
const EmployerApprenticeProgress = lazy(() => import("@/pages/employer/apprentice-progress/page"));
const EmployerReviewActions = lazy(() => import("@/pages/employer/review-actions/page"));
const EmployerEvidenceSummary = lazy(() => import("@/pages/employer/evidence-summary/page"));
const EmployerGatewayEPA = lazy(() => import("@/pages/employer/gateway-epa/page"));
const EmployerEmployerClubs = lazy(() => import("@/pages/employer/employer-clubs/page"));
const EmployerLearnerClubs = lazy(() => import("@/pages/employer/learner-clubs/page"));
const EmployerEvents = lazy(() => import("@/pages/employer/events/page"));
const EmployerCommunityActivity = lazy(() => import("@/pages/employer/community-activity/page"));
const EmployerWorkplaceConfirmations = lazy(() => import("@/pages/employer/workplace-confirm/page"));
const EmployerKSBProgress = lazy(() => import("@/pages/employer/ksb-progress/page"));
const EmployerReports = lazy(() => import("@/pages/employer/reports/page"));
const EmployerSupportRequests = lazy(() => import("@/pages/employer/support/page"));
const CoachMessagesPage = lazy(() => import("../pages/coach/messages/page"));
const CoachReportsPage = lazy(() => import("../pages/coach/reports/page"));
const CurriculumKsbFrameworksPage = lazy(() => import("../pages/curriculum/ksb-frameworks/page"));
const AuditorEvidencePage = lazy(() => import("../pages/auditor/evidence/page"));
const AuditorTrailPage = lazy(() => import("../pages/auditor/trail/page"));
const AuditorCompliancePage = lazy(() => import("../pages/auditor/compliance/page"));
const AuditorOfstedPage = lazy(() => import("../pages/auditor/ofsted/page"));
const AuditorReportsPage = lazy(() => import("../pages/auditor/reports/page"));
const LeadershipCohortPerformancePage = lazy(() => import("@/pages/leadership/cohort-performance/page"));
const LeadershipProgrammePerformancePage = lazy(() => import("@/pages/leadership/programme-performance/page"));
const LeadershipLearnerProgressPage = lazy(() => import("@/pages/leadership/learner-progress/page"));
const LeadershipAchievementPipelinePage = lazy(() => import("@/pages/leadership/achievement-pipeline/page"));
const LeadershipAttendanceTrendsPage = lazy(() => import("@/pages/leadership/attendance-trends/page"));
const LeadershipEngagementTrendsPage = lazy(() => import("@/pages/leadership/engagement-trends/page"));
const LeadershipEmployerEngagementPage = lazy(() => import("@/pages/leadership/employer-engagement/page"));
const LeadershipOtjhTrendsPage = lazy(() => import("@/pages/leadership/otjh-trends/page"));
const LeadershipKsbProgressPage = lazy(() => import("@/pages/leadership/ksb-progress/page"));
const LeadershipGatewayEpaProgressPage = lazy(() => import("@/pages/leadership/gateway-epa-progress/page"));
const LeadershipTutorSlaPage = lazy(() => import("@/pages/leadership/tutor-sla/page"));
const LeadershipCoachWorkloadPage = lazy(() => import("@/pages/leadership/coach-workload/page"));
const LeadershipDeliveryPerformancePage = lazy(() => import("@/pages/leadership/delivery-performance/page"));
const LeadershipComplianceRiskPage = lazy(() => import("@/pages/leadership/compliance-risk/page"));
const LeadershipQaSamplingPage = lazy(() => import("@/pages/leadership/qa-sampling/page"));
const LeadershipOfstedPage = lazy(() => import("@/pages/leadership/ofsted/page"));
const LeadershipSarQipPage = lazy(() => import("@/pages/leadership/sar-qip/page"));
const LeadershipReportsPage = lazy(() => import("@/pages/leadership/reports/page"));
const PlatformReportPage = lazy(() => import("@/pages/admin/platform-report/page"));
const TenantOnboardingWizard = lazy(() => import("@/pages/admin/tenant-onboarding/page"));
const BulkUserImportPage = lazy(() => import("@/pages/admin/bulk-user-import/page"));
const SupportDashboard = lazy(() => import("@/pages/workspace/support/page"));
const SupportTicketQueue = lazy(() => import("@/pages/support/ticket-queue/page"));
const SupportEscalations = lazy(() => import("@/pages/support/escalations/page"));
const SupportResolved = lazy(() => import("@/pages/support/resolved/page"));
const SupportReports = lazy(() => import("@/pages/support/reports/page"));
const SupportMyTickets = lazy(() => import("@/pages/support/my-tickets/page"));
const SupportKnowledgeBase = lazy(() => import("@/pages/support/knowledge-base/page"));
const AdminSupportSettingsPage = lazy(() => import("@/pages/admin/support-settings/page"));
const SafeguardingDashboard = lazy(() => import("@/pages/workspace/safeguarding/page"));
const SafeguardingOpenCases = lazy(() => import("@/pages/safeguarding/open-cases/page"));
const SafeguardingNewConcerns = lazy(() => import("@/pages/safeguarding/new-concerns/page"));
const SafeguardingHighRiskCases = lazy(() => import("@/pages/safeguarding/high-risk-cases/page"));
const SafeguardingClosedCases = lazy(() => import("@/pages/safeguarding/closed-cases/page"));
const SafeguardingLearnerWellbeing = lazy(() => import("@/pages/safeguarding/learner-wellbeing/page"));
const SafeguardingReferrals = lazy(() => import("@/pages/safeguarding/referrals/page"));
const SafeguardingPreventRisk = lazy(() => import("@/pages/safeguarding/prevent-risk/page"));
const SafeguardingCommunication = lazy(() => import("@/pages/safeguarding/communication/page"));
const SafeguardingQAAudit = lazy(() => import("@/pages/safeguarding/qa-audit/page"));
const SafeguardingReports = lazy(() => import("@/pages/safeguarding/reports/page"));
const WeekDetailPage = lazy(() => import("../pages/learner/week-detail/page"));
const LearnerKnowledgeBase = lazy(() => import("../pages/learner/knowledge-base/page"));
const UserGuidePage = lazy(() => import("../pages/user-guide/page"));
const StarredMessagesPage = lazy(() => import("../pages/starred-messages/page"));
*/
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
import SettingsHub from "../pages/admin/settings/page";
import UsersListPage from "../pages/users/page";
import BoardPage from "../pages/users/BoardPage";
import WizardPage from "../pages/users/wizard/WizardPage";
import TrainingPlanBuilderPage from "../pages/delivery/TrainingPlanPage";
import ThisWeekPage from "../pages/learner/this-week/page";
import TrainingPlanPage from "../pages/learner/training-plan/page";
import QuizTakePage from "../pages/learner/quiz-take/page";
import VideoWatchPage from "../pages/learner/video-watch/page";
import ModulesPage from "../pages/learner/modules/page";
import AttendancePage from "../pages/learner/attendance/page";
import CatchUpPage from "../pages/learner/catchup/page";
import ReportAbsencePage from "../pages/learner/report-absence/page";
import OTJHPage from "../pages/learner/otjh/page";
import KSBsPage from "../pages/learner/ksbs/page";
import EvidencePage from "../pages/learner/evidence/page";
import QuizzesPage from "../pages/learner/quizzes/page";
import MonthlyCyclePage from "../pages/learner/monthly-cycle/page";
import MonthlyCoachingPage, { MonthlyCoachingListPage } from "../pages/learner/monthly-coaching/page";
import ProgressReviewsPage, { ProgressReviewsListPage } from "../pages/learner/progress-reviews/page";
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
import LearnerOnboardingPage from "../pages/learner/onboarding/page";
import SupportPage from "../pages/learner/support/page";
import MessagesPage from "../pages/learner/messages/page";
import GeneralNotificationsPage from "../pages/notifications/page";
import GeneralTasksPage from "../pages/tasks/page";
import GeneralMessagesPage from "../pages/messages/page";
import EmployerDashboard from "../pages/workspace/employer/page";
import MISDashboard from "../pages/workspace/mis/page";
import QADashboard from "../pages/workspace/qa/page";
import TutorDashboard from "../pages/workspace/tutor/page";
import EngagementDashboard from "../pages/workspace/engagement/page";
import LeadershipDashboard from "../pages/workspace/leadership/page";
import CurriculumDashboard from "../pages/workspace/curriculum/page";
import CoachCaseload from "../pages/coach/caseload/page";
import CoachCaseFiles from "../pages/coach/case-files/page";
import CoachAttendance from "../pages/coach/attendance/page";
import CoachAttendanceProfile from "../pages/coach/attendance-profile/page";
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
import QuizXmlWorkspace from "../pages/curriculum/quiz-xml/page";
import ManualQuizPage from "../pages/curriculum/quiz-xml/manual/page";
import QuizEditPage from "../pages/curriculum/quiz-xml/edit/page";
import QuestionBankPage from "../pages/curriculum/question-bank/page";
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
import CurriculumReportsPage from "../pages/curriculum/reports/page";
import StaffProfilesPage from "../pages/curriculum/staff-profiles/page";
import CommunicationPage from "../pages/communication/page";
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
import CallLogsPage from "../pages/engagement/call-logs/page";
import WhatsAppLogsPage from "../pages/engagement/whatsapp-logs/page";
import EmailLogsPage from "../pages/engagement/email-logs/page";
import PointsRulesPage from "../pages/engagement/points-rules/page";
import RewardsShopPage from "../pages/engagement/rewards-shop/page";
import VoucherClaimsPage from "../pages/engagement/voucher-claims/page";
import EventsPage from "../pages/engagement/events/page";
import EngagementClubsPage from "../pages/engagement/clubs/page";
import RecognitionPage from "../pages/engagement/recognition/page";
import EngagementReportsPage from "../pages/engagement/reports/page";
import FlashCardsPage from "../pages/engagement/flash-cards/page";

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

// Pages previously declared via static import (merged in)


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
    path: "/workspace/learner/:kind/:id",
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
    path: "/users",
    element: <UsersListPage />,
  },
  {
    path: "/users/:userId",
    element: <BoardPage />,
  },
  {
    // Single route with an optional param — two sibling routes would remount the
    // wizard (and refetch the board) on every step change.
    path: "/users/:userId/wizard/:stepSlug?",
    element: <WizardPage />,
  },
  {
    path: "/training-plan/:kind/:userId",
    element: <TrainingPlanBuilderPage />,
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
    path: "/learner/training-plan/:kind/:id",
    element: <TrainingPlanPage />,
  },
  {
    path: "/learner/quiz/:kind/:id/:quizId",
    element: <QuizTakePage />,
  },
  {
    path: "/learner/video/:kind/:id/:componentId",
    element: <VideoWatchPage />,
  },
  {
    path: "/learner/component/:kind/:id/:componentId",
    element: <VideoWatchPage />,
  },
  {
    path: "/learner/component/:kind/:id/:componentId",
    element: <VideoWatchPage />,
  },

  {
    path: "/learner/modules",
    element: <ModulesPage />,
  },
  {
    path: "/learner/modules/:kind/:id",
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
    path: "/learner/quizzes/:kind/:id",
    element: <QuizzesPage />,
  },
  {
    path: "/learner/monthly-cycle",
    element: <MonthlyCyclePage />,
  },
  {
    path: "/learner/monthly-cycle/:kind/:id",
    element: <MonthlyCyclePage />,
  },
  {
    path: "/learner/monthly-coaching",
    element: <MonthlyCoachingListPage />,
  },
  {
    path: "/learner/monthly-coaching/:sessionId",
    element: <MonthlyCoachingPage />,
  },
  {
    path: "/learner/progress-reviews",
    element: <ProgressReviewsListPage />,
  },
  {
    path: "/learner/progress-reviews/:reviewId",
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
    // The learner's own enrolment wizard. Paramless: it resolves to the logged-in
    // learner via useMyLearner, like the other /learner/* self-view pages.
    // One route with an optional param, NOT two sibling routes — two separate
    // route entries make React Router unmount/remount the page on every step
    // change, refetching the board and losing in-progress wizard state.
    path: "/learner/onboarding/:stepSlug?",
    element: <LearnerOnboardingPage />,
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
    path: "/coach/attendance/:learnerId",
    element: <CoachAttendanceProfile />,
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
    path: "/curriculum/quiz-xml",
    element: <QuizXmlWorkspace />,
  },
  {
    path: "/curriculum/quiz-xml/manual",
    element: <ManualQuizPage />,
  },
  {
    path: "/curriculum/question-bank",
    element: <QuestionBankPage />,
  },
  {
    path: "/curriculum/quiz-xml/:quizId/edit",
    element: <QuizEditPage />,
  },
  
  {
    path: "/curriculum/checkpoints",
    element: <CheckpointsPage />,
  },
  {
    path: "/curriculum/cohorts/:id/allocate",
    element: <Navigate to="/curriculum/programmes" replace />,
  },
  {
    path: "/curriculum/cohorts/:id",
    element: <Navigate to="/curriculum/programmes" replace />,
  },
  {
    path: "/curriculum/session-calendar",
    element: <SessionCalendarPage />,
  },
  {
    path: "/curriculum/staff-profiles",
    element: <StaffProfilesPage />,
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
    path: "/engagement/flash-cards",
    element: <FlashCardsPage />,
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
