import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";

// Route components are code-split: each page becomes its own chunk, fetched on
// first navigation instead of shipping in the entry bundle. `lazy` is provided
// globally by unplugin-auto-import (see vite.config.ts), and router/index.ts
// already wraps every element in a <Suspense> boundary.
const AdminAccessLogsPage = lazy(() => import("../pages/admin/access-logs/page"));
const AdminAtRiskPage = lazy(() => import("../pages/admin/at-risk/page"));
const AdminAuditLogsPage = lazy(() => import("../pages/admin/audit-logs/page"));
const AdminAutomationsPage = lazy(() => import("../pages/admin/automations/page"));
const AdminCohortsPage = lazy(() => import("../pages/admin/cohorts/page"));
const AdminDashboard = lazy(() => import("../pages/workspace/admin/page"));
const AdminDocumentsPage = lazy(() => import("../pages/admin/documents/page"));
const AdminEmployersPage = lazy(() => import("../pages/admin/employers/page"));
const AdminFormsPage = lazy(() => import("../pages/admin/forms/page"));
const AdminIntegrationsPage = lazy(() => import("../pages/admin/integrations/page"));
const AdminMessagesPage = lazy(() => import("../pages/admin/messages/page"));
const AdminNotificationsPage = lazy(() => import("../pages/admin/notifications/page"));
const AdminOrganisationsPage = lazy(() => import("../pages/admin/organisations/page"));
const AdminPermissionsPage = lazy(() => import("../pages/admin/permissions/page"));
const AdminProgrammesPage = lazy(() => import("../pages/admin/programmes/page"));
const AdminReportsPage = lazy(() => import("../pages/admin/reports/page"));
const AdminRolesPage = lazy(() => import("../pages/admin/roles/page"));
const AdminSupportSettingsPage = lazy(() => import("@/pages/admin/support-settings/page"));
const AdminSystemSettingsPage = lazy(() => import("../pages/admin/system/page"));
const AdminTemplatesPage = lazy(() => import("../pages/admin/templates/page"));
const AdminTenantsPage = lazy(() => import("../pages/admin/tenants/page"));
const AdminUsersPage = lazy(() => import("../pages/admin/users/page"));
const AttendancePage = lazy(() => import("../pages/learner/attendance/page"));
const AttendanceRiskPage = lazy(() => import("../pages/engagement/attendance-risk/page"));
const AuditorWorkspace = lazy(() => import("../pages/workspace/auditor/page"));
const BadgeDetailPage = lazy(() => import("../pages/learner/rewards/badge-detail/page"));
const BoardPage = lazy(() => import("../pages/users/BoardPage"));
const BudgetsPage = lazy(() => import("../pages/finance/budgets/page"));
const BulkUserImportPage = lazy(() => import("@/pages/admin/bulk-user-import/page"));
const CallLogsPage = lazy(() => import("../pages/engagement/call-logs/page"));
const CatchUpPage = lazy(() => import("../pages/learner/catchup/page"));
const CheckpointsPage = lazy(() => import("../pages/curriculum/checkpoints/page"));
const ClubBadgeDetailPage = lazy(() => import("../pages/learner/clubs/badge-detail/page"));
const ClubDetailPage = lazy(() => import("../pages/learner/clubs/detail/page"));
const ClubDiscussionDetailPage = lazy(() => import("../pages/learner/clubs/discussion-detail/page"));
const ClubEventsPage = lazy(() => import("../pages/learner/clubs/events/page"));
const ClubsPage = lazy(() => import("../pages/learner/clubs/page"));
const CoachAbsenceReports = lazy(() => import("../pages/coach/absence-reports/page"));
const CoachAiMarking = lazy(() => import("../pages/coach/ai-marking/page"));
const CoachAttendance = lazy(() => import("../pages/coach/attendance/page"));
const CoachAttendanceProfile = lazy(() => import("../pages/coach/attendance-profile/page"));
const CoachCaseFiles = lazy(() => import("../pages/coach/case-files/page"));
const CoachCaseload = lazy(() => import("../pages/coach/caseload/page"));
const CoachCatchupQueue = lazy(() => import("../pages/coach/catchup-queue/page"));
const CoachDashboard = lazy(() => import("../pages/workspace/coach/page"));
const CoachEmployerActions = lazy(() => import("../pages/coach/employer-actions/page"));
const CoachEvidenceValidation = lazy(() => import("../pages/coach/evidence-validation/page"));
const CoachKsbImpact = lazy(() => import("../pages/coach/ksb-impact/page"));
const CoachMarkingQueue = lazy(() => import("../pages/coach/marking-queue/page"));
const CoachMeetings = lazy(() => import("../pages/coach/meetings/page"));
const CoachMessagesPage = lazy(() => import("../pages/coach/messages/page"));
const CoachMonthlyCycle = lazy(() => import("../pages/coach/monthly-cycle/page"));
const CoachOtjhReports = lazy(() => import("../pages/coach/otjh-reports/page"));
const CoachProgressReviews = lazy(() => import("../pages/coach/progress-reviews/page"));
const CoachReportsPage = lazy(() => import("../pages/coach/reports/page"));
const CoachTimetable = lazy(() => import("../pages/coach/timetable/page"));
const CommercialLearnersPage = lazy(() => import("../pages/delivery/LearnersPage"));
const CommunicationPage = lazy(() => import("../pages/communication/page"));
const CurriculumDashboard = lazy(() => import("../pages/workspace/curriculum/page"));
const CurriculumKsbFrameworksPage = lazy(() => import("../pages/curriculum/ksb-frameworks/page"));
const CurriculumProgrammes = lazy(() => import("../pages/curriculum/programmes/page"));
const CurriculumPublishedPage = lazy(() => import("../pages/curriculum/published/page"));
const CurriculumQAPage = lazy(() => import("../pages/curriculum/curriculum-qa/page"));
const CurriculumReportsPage = lazy(() => import("../pages/curriculum/reports/page"));
const CurriculumStandards = lazy(() => import("../pages/curriculum/standards/page"));
const CurriculumVersionControlPage = lazy(() => import("../pages/curriculum/version-control/page"));
const CurriculumWeekBuilder = lazy(() => import("../pages/curriculum/week-builder/page"));
const EmailLogsPage = lazy(() => import("../pages/engagement/email-logs/page"));
const EmployerApprenticeProgress = lazy(() => import("@/pages/employer/apprentice-progress/page"));
const EmployerApprenticeRisk = lazy(() => import("@/pages/employer/apprentice-risk/page"));
const EmployerApprentices = lazy(() => import("../pages/employer/apprentices/page"));
const EmployerCommunityActivity = lazy(() => import("@/pages/employer/community-activity/page"));
const EmployerDashboard = lazy(() => import("../pages/workspace/employer/page"));
const EmployerDocumentsToSign = lazy(() => import("../pages/employer/documents/page"));
const EmployerEmployerClubs = lazy(() => import("@/pages/employer/employer-clubs/page"));
const EmployerEvents = lazy(() => import("@/pages/employer/events/page"));
const EmployerEvidenceSummary = lazy(() => import("@/pages/employer/evidence-summary/page"));
const EmployerGatewayEPA = lazy(() => import("@/pages/employer/gateway-epa/page"));
const EmployerKSBProgress = lazy(() => import("@/pages/employer/ksb-progress/page"));
const EmployerLearnerClubs = lazy(() => import("@/pages/employer/learner-clubs/page"));
const EmployerOTJHConfirmation = lazy(() => import("../pages/employer/otjh-confirm/page"));
const EmployerProgressReviewsPage = lazy(() => import("../pages/employer/progress-reviews/page"));
const EmployerReports = lazy(() => import("@/pages/employer/reports/page"));
const EmployerReviewActions = lazy(() => import("@/pages/employer/review-actions/page"));
const EmployerSupportRequests = lazy(() => import("@/pages/employer/support/page"));
const EmployerWorkplaceConfirmations = lazy(() => import("@/pages/employer/workplace-confirm/page"));
const EngagementClubsPage = lazy(() => import("../pages/engagement/clubs/page"));
const EngagementDashboard = lazy(() => import("../pages/workspace/engagement/page"));
const EngagementReportsPage = lazy(() => import("../pages/engagement/reports/page"));
const EventDetailPage = lazy(() => import("../pages/learner/clubs/events/detail/page"));
const EventsPage = lazy(() => import("../pages/engagement/events/page"));
const EvidencePage = lazy(() => import("../pages/learner/evidence/page"));
const FinanceReportsPage = lazy(() => import("../pages/finance/reports/page"));
const FinanceWorkspace = lazy(() => import("../pages/workspace/finance/page"));
const FlashCardsPage = lazy(() => import("../pages/engagement/flash-cards/page"));
const ForgotPasswordPage = lazy(() => import("../pages/forgot-password/page"));
const FundingOverviewPage = lazy(() => import("../pages/finance/funding/page"));
const GatewayReadinessPage = lazy(() => import("../pages/learner/gateway/page"));
const GeneralMessagesPage = lazy(() => import("../pages/messages/page"));
const GeneralNotificationsPage = lazy(() => import("../pages/notifications/page"));
const GeneralTasksPage = lazy(() => import("../pages/tasks/page"));
const Home = lazy(() => import("../pages/home/page"));
const IfateStandardPage = lazy(() => import("../pages/curriculum/ifate-standard/page"));
const InternalPanelPage = lazy(() => import("../pages/internal-panel/page"));
const InvoicingPage = lazy(() => import("../pages/finance/invoices/page"));
const KSBMapping = lazy(() => import("../pages/curriculum/ksb-mapping/page"));
const KSBsPage = lazy(() => import("../pages/learner/ksbs/page"));
const LeadershipAchievementPipelinePage = lazy(() => import("@/pages/leadership/achievement-pipeline/page"));
const LeadershipAttendanceTrendsPage = lazy(() => import("@/pages/leadership/attendance-trends/page"));
const LeadershipCoachWorkloadPage = lazy(() => import("@/pages/leadership/coach-workload/page"));
const LeadershipCohortPerformancePage = lazy(() => import("@/pages/leadership/cohort-performance/page"));
const LeadershipComplianceRiskPage = lazy(() => import("@/pages/leadership/compliance-risk/page"));
const LeadershipDashboard = lazy(() => import("../pages/workspace/leadership/page"));
const LeadershipDeliveryPerformancePage = lazy(() => import("@/pages/leadership/delivery-performance/page"));
const LeadershipEmployerEngagementPage = lazy(() => import("@/pages/leadership/employer-engagement/page"));
const LeadershipEngagementTrendsPage = lazy(() => import("@/pages/leadership/engagement-trends/page"));
const LeadershipGatewayEpaProgressPage = lazy(() => import("@/pages/leadership/gateway-epa-progress/page"));
const LeadershipKsbProgressPage = lazy(() => import("@/pages/leadership/ksb-progress/page"));
const LeadershipLearnerProgressPage = lazy(() => import("@/pages/leadership/learner-progress/page"));
const LeadershipOfstedPage = lazy(() => import("@/pages/leadership/ofsted/page"));
const LeadershipOtjhTrendsPage = lazy(() => import("@/pages/leadership/otjh-trends/page"));
const LeadershipProgrammePerformancePage = lazy(() => import("@/pages/leadership/programme-performance/page"));
const LeadershipQaSamplingPage = lazy(() => import("@/pages/leadership/qa-sampling/page"));
const LeadershipReportsPage = lazy(() => import("@/pages/leadership/reports/page"));
const LeadershipSarQipPage = lazy(() => import("@/pages/leadership/sar-qip/page"));
const LeadershipTutorSlaPage = lazy(() => import("@/pages/leadership/tutor-sla/page"));
const LearnerCalendarPage = lazy(() => import("../pages/learner/calendar/page"));
const LearnerCaseFile = lazy(() => import("../pages/coach/learner-case-file/page"));
const LearnerEngagementPage = lazy(() => import("../pages/engagement/learner-engagement/page"));
const LearnerKnowledgeBase = lazy(() => import("../pages/learner/knowledge-base/page"));
const LearnerOverview = lazy(() => import("../pages/workspace/learner/page"));
const LearnerProfilePage = lazy(() => import("../pages/learner/profile/page"));
const MISDashboard = lazy(() => import("../pages/workspace/mis/page"));
// These two modules export both a detail page (default) and a list page (named),
// so the named half needs remapping onto `default` for lazy() to accept it.
const MonthlyCoachingPage = lazy(() => import("../pages/learner/monthly-coaching/page"));
const MonthlyCoachingListPage = lazy(() => import("../pages/learner/monthly-coaching/page").then(m => ({ default: m.MonthlyCoachingListPage })));
const ProgressReviewsPage = lazy(() => import("../pages/learner/progress-reviews/page"));
const ProgressReviewsListPage = lazy(() => import("../pages/learner/progress-reviews/page").then(m => ({ default: m.ProgressReviewsListPage })));
const ManualModeSettings = lazy(() => import("../pages/admin/manual-mode/page"));
const ManualQuizPage = lazy(() => import("../pages/curriculum/quiz-xml/manual/page"));
const MessagesPage = lazy(() => import("../pages/learner/messages/page"));
const MisAttendanceModesPage = lazy(() => import("../pages/mis/attendance-modes/page"));
const MisCalendarPage = lazy(() => import("../pages/mis/calendar/page"));
const MisCoachAssignmentPage = lazy(() => import("../pages/mis/coach-assignment/page"));
const MisCohortsPage = lazy(() => import("../pages/mis/cohorts/page"));
const MisDataQualityPage = lazy(() => import("../pages/mis/data-quality/page"));
const MisDeliveryDatesPage = lazy(() => import("../pages/mis/delivery-dates/page"));
const MisDeliveryTimelinePage = lazy(() => import("../pages/mis/delivery-timeline/page"));
const MisLearnerAllocationPage = lazy(() => import("../pages/mis/learner-allocation/page"));
const MisModuleAllocationPage = lazy(() => import("../pages/mis/module-allocation/page"));
const MisProgrammeAllocationPage = lazy(() => import("../pages/mis/programme-allocation/page"));
const MisReportsPage = lazy(() => import("../pages/mis/reports/page"));
const MisTeamsSessionsPage = lazy(() => import("../pages/mis/teams-sessions/page"));
const MisTimetablesPage = lazy(() => import("../pages/mis/timetables/page"));
const MisTutorAssignmentPage = lazy(() => import("../pages/mis/tutor-assignment/page"));
const ModuleBuilder = lazy(() => import("../pages/curriculum/module-builder/page"));
const ModulesPage = lazy(() => import("../pages/learner/modules/page"));
const MonthlyCyclePage = lazy(() => import("../pages/learner/monthly-cycle/page"));
const MySchedulePage = lazy(() => import("../pages/learner/clubs/events/schedule/page"));
const NotFound = lazy(() => import("../pages/NotFound"));
const OTJHPage = lazy(() => import("../pages/learner/otjh/page"));
const PaymentsPage = lazy(() => import("../pages/finance/payments/page"));
const PlatformReportPage = lazy(() => import("@/pages/admin/platform-report/page"));
const PointsRulesPage = lazy(() => import("../pages/engagement/points-rules/page"));
const ProgrammeDetailPage = lazy(() => import("../pages/curriculum/programme-detail/page"));
const QADashboard = lazy(() => import("../pages/workspace/qa/page"));
const QaDeliverySetup = lazy(() => import("../pages/qa/delivery-setup/page"));
const QaEligibility = lazy(() => import("../pages/qa/eligibility/page"));
const QaEmployerContracting = lazy(() => import("../pages/qa/employer-contracting/page"));
const QaEscalations = lazy(() => import("../pages/qa/escalations/page"));
const QaEvidence = lazy(() => import("../pages/qa/evidence/page"));
const QaFindings = lazy(() => import("../pages/qa/findings/page"));
const QaGatewayEpa = lazy(() => import("../pages/qa/gateway-epa/page"));
const QaInitialAssessment = lazy(() => import("../pages/qa/initial-assessment/page"));
const QaKsb = lazy(() => import("../pages/qa/ksb/page"));
const QaModule = lazy(() => import("../pages/qa/module/page"));
const QaOtjh = lazy(() => import("../pages/qa/otjh/page"));
const QaPreActive = lazy(() => import("../pages/qa/pre-active/page"));
const QaProgressReview = lazy(() => import("../pages/qa/progress-review/page"));
const QaRejected = lazy(() => import("../pages/qa/rejected/page"));
const QaReport = lazy(() => import("../pages/qa/report/page"));
const QaReports = lazy(() => import("../pages/qa/reports/page"));
const QaRpl = lazy(() => import("../pages/qa/rpl/page"));
const QaSampling = lazy(() => import("../pages/qa/sampling/page"));
const QuestionBankPage = lazy(() => import("../pages/curriculum/question-bank/page"));
const QuizEditPage = lazy(() => import("../pages/curriculum/quiz-xml/edit/page"));
const QuizTakePage = lazy(() => import("../pages/learner/quiz-take/page"));
const QuizXmlWorkspace = lazy(() => import("../pages/curriculum/quiz-xml/page"));
const QuizzesPage = lazy(() => import("../pages/learner/quizzes/page"));
const RecognitionPage = lazy(() => import("../pages/engagement/recognition/page"));
const ReportAbsencePage = lazy(() => import("../pages/learner/report-absence/page"));
const RewardsPage = lazy(() => import("../pages/learner/rewards/page"));
const RewardsShopPage = lazy(() => import("../pages/engagement/rewards-shop/page"));
const SafeguardingClosedCases = lazy(() => import("@/pages/safeguarding/closed-cases/page"));
const SafeguardingCommunication = lazy(() => import("@/pages/safeguarding/communication/page"));
const SafeguardingDashboard = lazy(() => import("@/pages/workspace/safeguarding/page"));
const SafeguardingHighRiskCases = lazy(() => import("@/pages/safeguarding/high-risk-cases/page"));
const SafeguardingLearnerWellbeing = lazy(() => import("@/pages/safeguarding/learner-wellbeing/page"));
const SafeguardingNewConcerns = lazy(() => import("@/pages/safeguarding/new-concerns/page"));
const SafeguardingOpenCases = lazy(() => import("@/pages/safeguarding/open-cases/page"));
const SafeguardingPreventRisk = lazy(() => import("@/pages/safeguarding/prevent-risk/page"));
const SafeguardingQAAudit = lazy(() => import("@/pages/safeguarding/qa-audit/page"));
const SafeguardingReferrals = lazy(() => import("@/pages/safeguarding/referrals/page"));
const SafeguardingReports = lazy(() => import("@/pages/safeguarding/reports/page"));
const SessionCalendarPage = lazy(() => import("../pages/curriculum/session-calendar/page"));
const SettingsHub = lazy(() => import("../pages/admin/settings/page"));
const StaffProfilesPage = lazy(() => import("../pages/curriculum/staff-profiles/page"));
const StandaloneAiSettings = lazy(() => import("../pages/admin/ai-settings/page"));
const StarredMessagesPage = lazy(() => import("../pages/starred-messages/page"));
const SupportDashboard = lazy(() => import("@/pages/workspace/support/page"));
const SupportEscalations = lazy(() => import("@/pages/support/escalations/page"));
const SupportKnowledgeBase = lazy(() => import("@/pages/support/knowledge-base/page"));
const SupportMyTickets = lazy(() => import("@/pages/support/my-tickets/page"));
const SupportPage = lazy(() => import("../pages/learner/support/page"));
const SupportReports = lazy(() => import("@/pages/support/reports/page"));
const SupportResolved = lazy(() => import("@/pages/support/resolved/page"));
const SupportTicketQueue = lazy(() => import("@/pages/support/ticket-queue/page"));
const TenantOnboardingWizard = lazy(() => import("@/pages/admin/tenant-onboarding/page"));
const TrainingPlanBuilderPage = lazy(() => import("../pages/delivery/TrainingPlanPage"));
const TrainingPlanPage = lazy(() => import("../pages/learner/training-plan/page"));
const TutorAiMarkingPage = lazy(() => import("../pages/tutor/ai-marking/page"));
const TutorAssignmentMarking = lazy(() => import("../pages/tutor/assignment-marking/page"));
const TutorDashboard = lazy(() => import("../pages/workspace/tutor/page"));
const TutorEvidenceReview = lazy(() => import("../pages/tutor/evidence-review/page"));
const TutorFeedbackQueuePage = lazy(() => import("../pages/tutor/feedback-queue/page"));
const TutorKsbValidationPage = lazy(() => import("../pages/tutor/ksb-validation/page"));
const TutorLearnersPage = lazy(() => import("../pages/tutor/learners/page"));
const TutorOtjhValidationPage = lazy(() => import("../pages/tutor/otjh-validation/page"));
const TutorQuizResults = lazy(() => import("../pages/tutor/quiz-results/page"));
const TutorReportsPage = lazy(() => import("../pages/tutor/reports/page"));
const TutorResourcesPage = lazy(() => import("../pages/tutor/resources/page"));
const TutorSessionsPage = lazy(() => import("../pages/tutor/sessions/page"));
const UserGuidePage = lazy(() => import("../pages/user-guide/page"));
const UsersListPage = lazy(() => import("../pages/users/page"));
const VideoWatchPage = lazy(() => import("../pages/learner/video-watch/page"));
const VoucherClaimsPage = lazy(() => import("../pages/engagement/voucher-claims/page"));
const WeekDetailPage = lazy(() => import("../pages/learner/week-detail/page"));
const WhatsAppLogsPage = lazy(() => import("../pages/engagement/whatsapp-logs/page"));
const WizardPage = lazy(() => import("../pages/users/wizard/WizardPage"));



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
    path: "/users/:userId/wizard",
    element: <WizardPage />,
  },
  {
    path: "/users/:userId/wizard/:stepSlug",
    element: <WizardPage />,
  },
  {
    path: "/delivery",
    element: <CommercialLearnersPage />,
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
