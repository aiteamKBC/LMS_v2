// Role-specific notifications for workspace sidebar widgets & /notifications page
export interface RoleNotification {
  id: number;
  text: string;
  time: string;
  unread: boolean;
  type: string;
  category: string;
  link?: string;
}

export const roleNotifications: Record<string, RoleNotification[]> = {
  learner: [
    { id: 1, text: 'Coach Martin confirmed your OTJH entry for Week 3', time: '2 minutes ago', unread: true, type: 'otjh', category: 'OTJH', link: '/learner/otjh' },
    { id: 2, text: 'Monthly checkpoint assessment is ready for completion', time: '1 hour ago', unread: true, type: 'assessment', category: 'Assessment', link: '/learner/quizzes' },
    { id: 3, text: 'Employer signed your progress review Q2', time: '3 hours ago', unread: false, type: 'review', category: 'Review', link: '/learner/progress-reviews' },
    { id: 4, text: 'New module available: Data Analysis Fundamentals', time: 'Yesterday', unread: false, type: 'module', category: 'Module', link: '/learner/modules' },
    { id: 5, text: 'Your evidence submission EV-1245 has been validated by your tutor', time: '2 days ago', unread: false, type: 'evidence', category: 'Evidence', link: '/learner/evidence' },
    { id: 6, text: 'Coaching meeting confirmed for 19 June at 14:00 with Med Maher', time: '2 days ago', unread: true, type: 'meeting', category: 'Meeting', link: '/learner/monthly-coaching' },
    { id: 7, text: 'Gateway readiness review due this month — your KSBs are at 88%', time: '3 days ago', unread: false, type: 'gateway', category: 'Gateway', link: '/learner/gateway' },
    { id: 8, text: 'Congratulations! You earned the "Evidence Pro" badge', time: '4 days ago', unread: false, type: 'reward', category: 'Rewards', link: '/learner/rewards' },
    { id: 9, text: 'OTJH reminder: You are 26 hours behind your monthly target', time: '5 days ago', unread: false, type: 'otjh', category: 'OTJH', link: '/learner/otjh' },
    { id: 10, text: 'New club event: Marketing Masterclass on 20 June', time: '6 days ago', unread: false, type: 'event', category: 'Events', link: '/learner/clubs/events' },
  ],
  coach: [
    { id: 1, text: 'Sophie Williams submitted 3 new evidence items for review', time: '30 minutes ago', unread: true, type: 'evidence', category: 'Evidence', link: '/coach/evidence-validation' },
    { id: 2, text: 'Tom Richards missed the Teams session — absence logged', time: '2 hours ago', unread: true, type: 'attendance', category: 'Attendance', link: '/coach/absence-reports' },
    { id: 3, text: 'OTJH alert: Finn Murphy is 2 months behind target', time: '3 hours ago', unread: true, type: 'otjh', category: 'OTJH', link: '/coach/otjh-reports' },
    { id: 4, text: 'Coaching session confirmed with Sophie Williams on 19 June', time: 'Yesterday', unread: false, type: 'meeting', category: 'Meeting', link: '/coach/meetings' },
    { id: 5, text: 'AI marking completed for 8 Module 7 assignments', time: 'Yesterday', unread: false, type: 'marking', category: 'Marking', link: '/coach/ai-marking' },
    { id: 6, text: 'QA finding raised: Evidence pack EV-2024-442 rejected', time: '2 days ago', unread: true, type: 'qa', category: 'QA', link: '/coach/evidence-validation' },
    { id: 8, text: 'Monthly cycle checklist: 6 tasks still pending', time: '3 days ago', unread: false, type: 'cycle', category: 'Monthly Cycle', link: '/coach/monthly-cycle' },
    { id: 9, text: 'Emily Watson is approaching gateway readiness — KSBs at 92%', time: '4 days ago', unread: false, type: 'gateway', category: 'Gateway', link: '/coach/caseload' },
    { id: 10, text: 'New learner allocated to your caseload: Maya Kapoor', time: '5 days ago', unread: false, type: 'assignment', category: 'Caseload', link: '/coach/caseload' },
  ],
  admin: [
    { id: 1, text: 'Security alert: Multiple failed login attempts from IP 203.45.67.89', time: '15 minutes ago', unread: true, type: 'security', category: 'Security', link: '/admin/access-logs' },
    { id: 2, text: 'QA failure: Evidence pack EV-2024-442 requires urgent action', time: '2 hours ago', unread: true, type: 'qa', category: 'QA', link: '/messages' },
    { id: 3, text: 'ILR submission deadline in 4 days — data export ready', time: '3 hours ago', unread: true, type: 'compliance', category: 'Compliance', link: '/mis/data-quality' },
    { id: 4, text: 'Invitation delivery failed for 2 new employer accounts', time: 'Yesterday', unread: false, type: 'email', category: 'Email', link: '/admin/notifications' },
    { id: 5, text: 'New organisation added: Ashford Accounting LLP', time: 'Yesterday', unread: false, type: 'org', category: 'Organisations', link: '/users' },
    { id: 6, text: 'New module published by Crispin Jones: Data Cleaning L4', time: '2 days ago', unread: false, type: 'curriculum', category: 'Curriculum', link: '/curriculum/programmes' },
    { id: 7, text: '12 accounts invited to the platform this week', time: '3 days ago', unread: false, type: 'users', category: 'Accounts', link: '/admin/users' },
    { id: 8, text: 'Platform maintenance scheduled for Saturday 22:00–00:00', time: '4 days ago', unread: false, type: 'system', category: 'System', link: '/admin/system' },
    { id: 9, text: 'Ofsted readiness check: 2 unresolved QA findings remain', time: '5 days ago', unread: true, type: 'qa', category: 'QA', link: '/qa/findings' },
    { id: 10, text: 'DAS payments totalling £45,200 credited for Q2 2026', time: '1 week ago', unread: false, type: 'finance', category: 'Finance', link: '/finance/payments' },
  ],
  tutor: [
    { id: 1, text: '14 assignment submissions ready for marking in Module 7', time: '1 hour ago', unread: true, type: 'marking', category: 'Marking', link: '/tutor/assignment-marking' },
    { id: 2, text: 'Sophie Williams queried PESTLE analysis task — respond needed', time: '2 hours ago', unread: true, type: 'message', category: 'Messages', link: '/messages' },
    { id: 3, text: 'Quiz results for Week 3: Average score 74% across 18 learners', time: 'Yesterday', unread: false, type: 'quiz', category: 'Quiz', link: '/tutor/quiz-results' },
    { id: 4, text: 'Session recording uploaded successfully: Module 4 PESTLE', time: 'Yesterday', unread: false, type: 'resource', category: 'Resources', link: '/tutor/resources' },
    { id: 5, text: 'KSB validation pending: 6 evidence items from Cohort B', time: '2 days ago', unread: true, type: 'ksb', category: 'KSB', link: '/tutor/ksb-validation' },
    { id: 6, text: 'Module QA approved by Tom Bradley: Data Cleaning L4', time: '2 days ago', unread: false, type: 'qa', category: 'QA', link: '/tutor/evidence-review' },
    { id: 7, text: 'New session scheduled: Module 5 — 24 June at 10:00', time: '3 days ago', unread: false, type: 'session', category: 'Sessions', link: '/tutor/sessions' },
  ],
  employer: [
    { id: 1, text: 'Action required: Confirm OTJH hours for Sophie Williams — May 2026', time: '1 hour ago', unread: true, type: 'otjh', category: 'OTJH', link: '/employer/otjh-confirm' },
    { id: 2, text: 'Progress review ready to sign: Sophie Williams Q2 2026', time: '3 hours ago', unread: true, type: 'review', category: 'Review', link: '/employer/progress-reviews' },
    { id: 3, text: 'Joint employer meeting confirmed: 19 June at 11:00 with Med Maher', time: 'Yesterday', unread: false, type: 'meeting', category: 'Meeting', link: '/employer/review-actions' },
    { id: 4, text: 'Sophie Williams KSB portfolio reached 88% completion', time: '2 days ago', unread: false, type: 'ksb', category: 'KSB', link: '/employer/ksb-progress' },
    { id: 5, text: 'Workplace confirmation form due this week', time: '3 days ago', unread: true, type: 'compliance', category: 'Compliance', link: '/employer/workplace-confirm' },
    { id: 6, text: 'Sophie Williams joined the Marketing Excellence club', time: '4 days ago', unread: false, type: 'community', category: 'Community', link: '/employer/learner-clubs' },
    { id: 7, text: 'New employer community event: SME Growth Workshop on 28 June', time: '5 days ago', unread: false, type: 'event', category: 'Events', link: '/employer/events' },
  ],
  compliance: [
    { id: 1, text: 'ILR submission deadline in 4 days — please confirm data is ready', time: '30 minutes ago', unread: true, type: 'compliance', category: 'Compliance', link: '/compliance/ilr' },
    { id: 2, text: 'New starter eligibility approved: James Wilson — begin onboarding', time: '2 hours ago', unread: true, type: 'eligibility', category: 'Eligibility', link: '/compliance/eligibility' },
    { id: 3, text: 'DAS payment received for May 2026: £18,400 credited', time: 'Yesterday', unread: false, type: 'finance', category: 'Finance', link: '/compliance/das' },
    { id: 4, text: 'Employer contracting pack requires signature: TechKent Ltd', time: 'Yesterday', unread: true, type: 'signature', category: 'Signatures', link: '/compliance/signatures' },
    { id: 5, text: 'RPL review completed for James Wilson — 6 months credit applied', time: '2 days ago', unread: false, type: 'rpl', category: 'RPL', link: '/compliance/rpl-review' },
    { id: 6, text: 'Funding risk alert: 3 learners with attendance below 75%', time: '3 days ago', unread: false, type: 'risk', category: 'Funding Risk', link: '/compliance/funding-risk' },
    { id: 7, text: 'Aptem sync completed: 42 learner records updated', time: '4 days ago', unread: false, type: 'sync', category: 'Aptem Sync', link: '/compliance/aptem-sync' },
  ],
  qa: [
    { id: 1, text: 'QA failure: Evidence pack EV-2024-442 rejected — 48h resubmission window started', time: '1 hour ago', unread: true, type: 'qa', category: 'QA', link: '/qa/rejected' },
    { id: 2, text: '3 new evidence items submitted for QA sampling — Cohort B', time: '2 hours ago', unread: true, type: 'evidence', category: 'Evidence', link: '/qa/evidence' },
    { id: 3, text: 'Ofsted readiness: 2 unresolved QA findings must be addressed', time: '3 hours ago', unread: true, type: 'ofsted', category: 'Ofsted', link: '/qa/findings' },
    { id: 4, text: 'AI marking validation completed for Module 7', time: 'Yesterday', unread: false, type: 'marking', category: 'Marking', link: '/qa/module' },
    { id: 5, text: 'Gateway readiness review scheduled for 3 learners — 25 June', time: '2 days ago', unread: false, type: 'gateway', category: 'Gateway', link: '/qa/gateway-epa' },
    { id: 6, text: 'QA sampling report ready: 12 items reviewed, 2 escalations', time: '3 days ago', unread: false, type: 'sampling', category: 'Sampling', link: '/qa/sampling' },
    { id: 7, text: 'Monthly QA cycle completed for Cohort A — all items cleared', time: '4 days ago', unread: false, type: 'cycle', category: 'Monthly Cycle', link: '/qa/reports' },
  ],
  leadership: [
    { id: 1, text: 'June leadership dashboard updated — 3 at-risk learners flagged', time: '1 hour ago', unread: true, type: 'dashboard', category: 'Dashboard', link: '/workspace/leadership' },
    { id: 2, text: 'Ofsted readiness: 2 QA findings unresolved — action required', time: '2 hours ago', unread: true, type: 'ofsted', category: 'Ofsted', link: '/leadership/ofsted' },
    { id: 3, text: 'DAS payments received: £45,200 for Q2 2026', time: 'Yesterday', unread: false, type: 'finance', category: 'Finance', link: '/finance/payments' },
    { id: 4, text: 'Attendance trends alert: Cohort B average dropped to 82%', time: 'Yesterday', unread: true, type: 'attendance', category: 'Attendance', link: '/leadership/attendance-trends' },
    { id: 5, text: 'Coach workload review scheduled for 16 June', time: '2 days ago', unread: false, type: 'review', category: 'Review', link: '/leadership/coach-workload' },
    { id: 6, text: 'Achievement pipeline: 8 learners approaching gateway this quarter', time: '3 days ago', unread: false, type: 'gateway', category: 'Gateway', link: '/leadership/gateway-epa-progress' },
    { id: 7, text: 'SAR/QIP evidence pack submission due: 30 June', time: '5 days ago', unread: false, type: 'compliance', category: 'Compliance', link: '/leadership/sar-qip' },
  ],
  default: [
    { id: 1, text: 'Welcome to KBC LearningOS! Your account is now active.', time: '1 day ago', unread: false, type: 'system', category: 'System', link: '/' },
    { id: 2, text: 'Contact your administrator to set up your workspace.', time: '2 days ago', unread: false, type: 'system', category: 'System', link: '/' },
  ],
};
