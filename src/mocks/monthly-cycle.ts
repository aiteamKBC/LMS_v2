// ── Per-Month Data ──────────────────────────────

export const MONTHS_META = [
  { key: 'may', label: 'May 2026', status: 'completed' as const, current: false },
  { key: 'jun', label: 'June 2026', status: 'in-progress' as const, current: true },
  { key: 'jul', label: 'July 2026', status: 'not-started' as const, current: false },
];

export const MAY_STAGES = [
  { id: 'week-1', step: 'Week 1', label: 'Learning & OTJH', description: 'Complete weekly learning components and log OTJH evidence', status: 'completed' as const, date: '5–11 May' },
  { id: 'week-2', step: 'Week 2', label: 'Learning & OTJH', description: 'Complete weekly learning components and log OTJH evidence', status: 'completed' as const, date: '12–18 May' },
  { id: 'week-3', step: 'Week 3', label: 'Learning + Assignment Prep', description: 'Learning, OTJH evidence and KSB progress', status: 'completed' as const, date: '19–25 May' },
  { id: 'week-4', step: 'Week 4', label: 'Learning + Checkpoint Quiz', description: 'Learning, OTJH evidence and KSB progress', status: 'completed' as const, date: '26–31 May' },
  { id: 'assignment', step: 'Assignment', label: 'Monthly Portfolio Submission', description: 'Submit monthly portfolio & evidence — due 20th', status: 'completed' as const, date: '20 May' },
  { id: 'checkpoint', step: 'Checkpoint Quiz', label: 'KSB Progress Assessment', description: 'Measure KSB progress before coaching', status: 'completed' as const, date: 'After Week 4' },
  { id: 'coaching', step: 'Coaching', label: 'Monthly Coaching Meeting', description: 'Review progress with coach, set next month goals', status: 'completed' as const, date: '21–31 May' },
  { id: 'summary', step: 'Monthly Summary', label: 'OTJH & KSB Review', description: 'Auto-generated monthly progress summary', status: 'completed' as const, date: 'End of month' },
];

export const JUNE_STAGES = [
  { id: 'week-1', step: 'Week 1', label: 'Learning & OTJH', description: 'Complete weekly learning components and log OTJH evidence', status: 'completed' as const, date: '2–8 Jun' },
  { id: 'week-2', step: 'Week 2', label: 'Learning & OTJH', description: 'Complete weekly learning components and log OTJH evidence', status: 'completed' as const, date: '9–15 Jun' },
  { id: 'week-3', step: 'Week 3', label: 'Learning + Assignment Prep', description: 'Learning, OTJH evidence and KSB progress', status: 'in-progress' as const, date: '16–22 Jun' },
  { id: 'week-4', step: 'Week 4', label: 'Learning + Checkpoint Quiz', description: 'Learning, OTJH evidence and KSB progress', status: 'not-started' as const, date: '23–29 Jun' },
  { id: 'assignment', step: 'Assignment', label: 'Monthly Portfolio Submission', description: 'Submit monthly portfolio & evidence — due 20th', status: 'pending' as const, date: '20 Jun' },
  { id: 'checkpoint', step: 'Checkpoint Quiz', label: 'KSB Progress Assessment', description: 'Measure KSB progress before coaching', status: 'locked' as const, date: 'After Week 4' },
  { id: 'coaching', step: 'Coaching', label: 'Monthly Coaching Meeting', description: 'Review progress with coach, set next month goals', status: 'locked' as const, date: '21–30 Jun' },
  { id: 'summary', step: 'Monthly Summary', label: 'OTJH & KSB Review', description: 'Auto-generated monthly progress summary', status: 'locked' as const, date: 'End of month' },
];

export const JULY_STAGES = [
  { id: 'week-1', step: 'Week 1', label: 'Learning & OTJH', description: 'Complete weekly learning components and log OTJH evidence', status: 'not-started' as const, date: '30 Jun–6 Jul' },
  { id: 'week-2', step: 'Week 2', label: 'Learning & OTJH', description: 'Complete weekly learning components and log OTJH evidence', status: 'not-started' as const, date: '7–13 Jul' },
  { id: 'week-3', step: 'Week 3', label: 'Learning + Assignment Prep', description: 'Learning, OTJH evidence and KSB progress', status: 'not-started' as const, date: '14–20 Jul' },
  { id: 'week-4', step: 'Week 4', label: 'Learning + Checkpoint Quiz', description: 'Learning, OTJH evidence and KSB progress', status: 'not-started' as const, date: '21–27 Jul' },
  { id: 'assignment', step: 'Assignment', label: 'Monthly Portfolio Submission', description: 'Submit monthly portfolio & evidence — due 20th', status: 'pending' as const, date: '20 Jul' },
  { id: 'checkpoint', step: 'Checkpoint Quiz', label: 'KSB Progress Assessment', description: 'Measure KSB progress before coaching', status: 'locked' as const, date: 'After Week 4' },
  { id: 'coaching', step: 'Coaching', label: 'Monthly Coaching Meeting', description: 'Review progress with coach, set next month goals', status: 'locked' as const, date: '21–31 Jul' },
  { id: 'summary', step: 'Monthly Summary', label: 'OTJH & KSB Review', description: 'Auto-generated monthly progress summary', status: 'locked' as const, date: 'End of month' },
];

// ── Readiness per month ──
export const MAY_READINESS = {
  progress: 100,
  status: 'Completed' as 'On Track' | 'At Risk' | 'Completed',
  monthLabel: 'May 2026',
  week: 4,
  totalWeeks: 4,
  summary: 'Completed — 32/32 hrs OTJH, 94% attendance, assignment submitted',
};

export const JUNE_READINESS = {
  progress: 48,
  status: 'On Track' as 'On Track' | 'At Risk' | 'Completed',
  monthLabel: 'June 2026',
  week: 3,
  totalWeeks: 4,
  summary: 'Week 3 of 4 — assignment due 20/06/2026',
};

export const JULY_READINESS = {
  progress: 0,
  status: 'On Track' as 'On Track' | 'At Risk' | 'Completed',
  monthLabel: 'July 2026',
  week: 1,
  totalWeeks: 4,
  summary: 'Week 1 starts 30 June — get ready for your next month',
};

// ── Current focus per month ──
export const MAY_FOCUS = {
  title: 'Month Completed',
  description: 'May 2026 is complete. Great work — your assignment, checkpoint quiz, coaching, and evidence were all submitted on time.',
  actionLabel: 'Review May Summary',
  actionUrl: '/learner/monthly-cycle',
  icon: 'ri-check-double-line',
  priority: 'Normal',
  deadline: 'Completed',
};

export const JUNE_FOCUS = {
  title: 'Continue Week 3 Learning',
  description: 'Complete Video 2: Campaign Targeting and the Week 3 Quiz before Thursday to stay on track for your monthly assignment.',
  actionLabel: 'Go to Week 3',
  actionUrl: '/learner/this-week',
  icon: 'ri-focus-3-line',
  priority: 'High',
  deadline: 'Thu 12 Jun',
};

export const JULY_FOCUS = {
  title: 'Prepare for Week 1',
  description: 'July 2026 starts soon. Review your training plan and prepare your OTJH evidence log. Week 1 begins on 30 June.',
  actionLabel: 'View Training Plan',
  actionUrl: '/learner/training-plan',
  icon: 'ri-calendar-line',
  priority: 'High',
  deadline: 'Mon 30 Jun',
};

// ── Next best action per month ──
export const MAY_NEXT_ACTION = {
  title: 'Review May Coaching Feedback',
  description: 'Your coach left feedback on your May progress. Review it before July starts to set next month goals.',
  impact: 'Prepares you for July',
  icon: 'ri-user-voice-line',
  actionLabel: 'View Feedback',
  actionUrl: '/learner/messages',
};

export const JUNE_NEXT_ACTION = {
  title: 'Complete Week 3 Quiz: Segmentation and Targeting',
  description: 'This quiz validates K5 and K6 — both are essential for your monthly assignment. It takes 15 minutes and is due Friday.',
  impact: 'Unlocks checkpoint quiz progress',
  icon: 'ri-rocket-line',
  actionLabel: 'Start Quiz',
  actionUrl: '/learner/quizzes',
};

export const JULY_NEXT_ACTION = {
  title: 'Review June Monthly Summary',
  description: 'The June end-of-month summary is generated. Review your KSB progress and OTJH before the new month starts.',
  impact: 'Sets your July baseline',
  icon: 'ri-file-list-line',
  actionLabel: 'View Summary',
  actionUrl: '/learner/monthly-cycle',
};

// ── Health per month ──
export const MAY_HEALTH = {
  status: 'On Track' as 'On Track' | 'At Risk',
  label: 'Completed On Time',
  message: 'All monthly requirements were completed by 31 May. Coaching, assignment, and evidence were fully submitted.',
  projectedCompletionDate: '31 May 2026',
};

export const JUNE_HEALTH = {
  status: 'On Track' as 'On Track' | 'At Risk',
  label: 'Likely To Complete On Time',
  message: 'Based on your current pace, you are on track to complete all monthly requirements by 30 June.',
  projectedCompletionDate: '28 Jun 2026',
};

export const JULY_HEALTH = {
  status: 'On Track' as 'On Track' | 'At Risk',
  label: 'Upcoming — On Track',
  message: 'July 2026 has not started yet. You are on track to begin Week 1 on time.',
  projectedCompletionDate: '27 Jul 2026',
};

// ── End of month outcomes per month ──
export const MAY_OUTCOME = {
  projected: false,
  summary: 'Completed — all monthly outcomes achieved',
  outcomes: [
    { label: 'Evidence Generated', projected: '18 pieces', status: 'On Track' as const, icon: 'ri-folder-upload-line' },
    { label: 'OTJH Logged', projected: '32 of 32 hours', status: 'On Track' as const, icon: 'ri-time-line' },
    { label: 'KSB Progress Updated', projected: '56% overall', status: 'On Track' as const, icon: 'ri-bar-chart-2-line' },
    { label: 'Assignment Submitted', projected: '20 May 2026', status: 'On Track' as const, icon: 'ri-file-text-line' },
    { label: 'Coaching Completed', projected: '28 May 2026', status: 'On Track' as const, icon: 'ri-user-voice-line' },
  ],
};

export const JUNE_OUTCOME = {
  projected: true,
  summary: 'Projected — based on current progress',
  outcomes: [
    { label: 'Evidence Generated', projected: '12–15 pieces', status: 'On Track' as const, icon: 'ri-folder-upload-line' },
    { label: 'OTJH Logged', projected: '28 of 30 hours', status: 'Behind' as const, icon: 'ri-time-line' },
    { label: 'KSB Progress Updated', projected: '42% overall', status: 'On Track' as const, icon: 'ri-bar-chart-2-line' },
    { label: 'Assignment Submitted', projected: '20 Jun 2026', status: 'On Track' as const, icon: 'ri-file-text-line' },
    { label: 'Coaching Completed', projected: '28 Jun 2026', status: 'On Track' as const, icon: 'ri-user-voice-line' },
  ],
};

export const JULY_OUTCOME = {
  projected: true,
  summary: 'Projected — upcoming month targets',
  outcomes: [
    { label: 'Evidence Generated', projected: '0–15 pieces', status: 'On Track' as const, icon: 'ri-folder-upload-line' },
    { label: 'OTJH Logged', projected: '30 of 32 hours', status: 'On Track' as const, icon: 'ri-time-line' },
    { label: 'KSB Progress Updated', projected: '60% overall', status: 'On Track' as const, icon: 'ri-bar-chart-2-line' },
    { label: 'Assignment Submitted', projected: '20 Jul 2026', status: 'On Track' as const, icon: 'ri-file-text-line' },
    { label: 'Coaching Completed', projected: '28 Jul 2026', status: 'On Track' as const, icon: 'ri-user-voice-line' },
  ],
};

// ── Month summary panel data ──
export const MONTH_SUMMARY = {
  may: {
    status: 'Completed',
    completionDate: '31 May 2026',
    overallScore: 94,
    otjh: '32 / 32 hrs',
    attendance: '94%',
    assignment: 'Submitted',
    coaching: 'Completed',
    checkpoint: '82%',
    evidence: '18 pieces',
    ksbProgress: '56%',
  },
  jun: {
    status: 'In Progress',
    completionDate: '30 June 2026',
    overallScore: 48,
    otjh: '10.5 / 30 hrs',
    attendance: '86%',
    assignment: 'Due 20 Jun',
    coaching: '21–30 Jun',
    checkpoint: 'Pending',
    evidence: '5 pieces',
    ksbProgress: '42%',
  },
  jul: {
    status: 'Not Started',
    completionDate: '31 July 2026',
    overallScore: 0,
    otjh: '0 / 32 hrs',
    attendance: '—',
    assignment: 'Due 20 Jul',
    coaching: '21–31 Jul',
    checkpoint: 'Pending',
    evidence: '0 pieces',
    ksbProgress: '42%',
  },
};

// ── Legacy data (keep for compatibility) ──
export const MONTHLY_READINESS = JUNE_READINESS;
export const CURRENT_FOCUS = JUNE_FOCUS;
export const NEXT_BEST_ACTION = JUNE_NEXT_ACTION;
export const MONTHLY_JOURNEY_STAGES = JUNE_STAGES;
export const MONTHLY_HEALTH = JUNE_HEALTH;
export const END_OF_MONTH_OUTCOME = JUNE_OUTCOME;
export const ASSIGNMENT_PROGRESS = {
  overallReadiness: 52,
  dueDate: '20/06/2026',
  autoGenerated: true,
  evidenceSources: [
    { label: 'Reflections', count: 4, icon: 'ri-chat-quote-line', status: 'Good' as const, detail: '4 of 4 weekly reflections completed' },
    { label: 'Evidence', count: 5, icon: 'ri-folder-upload-line', status: 'Needs Work' as const, detail: '5 items — 3 validated, 2 pending review' },
    { label: 'OTJH', count: 10.5, icon: 'ri-time-line', status: 'Behind' as const, detail: '10.5 of 30 target hours logged' },
    { label: 'Attendance', count: null, icon: 'ri-calendar-check-line', status: 'On Track' as const, detail: '86% — 37/43 sessions attended', percentage: 86 },
    { label: 'Quiz Results', count: 2, icon: 'ri-questionnaire-line', status: 'Good' as const, detail: '2 quizzes — average score 82%', percentage: 82 },
    { label: 'Coach Feedback', count: 3, icon: 'ri-user-voice-line', status: 'Good' as const, detail: '3 feedback items received this month' },
  ],
};
export const CHECKPOINT_QUIZ_RULES = {
  available: false,
  unlockConditions: [
    { label: 'Week 4 Complete', met: false, icon: 'ri-calendar-check-line' },
    { label: 'Assignment Submitted', met: false, icon: 'ri-file-text-line' },
  ],
  ksbCoverage: ['K2.1', 'K2.2', 'S3.1', 'B1.2', 'K3.1'],
  estimatedTime: '25 minutes',
  passingScore: 80,
};
export const COACHING_READINESS_DATA = {
  score: 40,
  completedItems: 2,
  totalItems: 5,
  items: [
    { label: 'Monthly assignment submitted', status: 'Pending' as const },
    { label: 'Checkpoint quiz completed', status: 'Pending' as const },
    { label: 'OTJH uploaded', status: 'Pending' as const },
    { label: 'KSB self-review completed', status: 'Completed' as const },
    { label: 'Evidence uploaded', status: 'Completed' as const },
  ],
  message: 'You can book the meeting even if some items are pending — these must be complete before the meeting itself.',
};