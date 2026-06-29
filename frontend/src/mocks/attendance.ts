// ── Attendance & Catch-Up Hub: Mock Data ──

export const ATTENDANCE_STATS = {
  currentRate: 86,
  target: 90,
  sessionsAttended: 37,
  sessionsMissed: 6,
  catchUpOutstanding: 1,
  catchUpCompleted: 4,
  catchUpPending: 1,
  totalSessions: 43,
};

export const ATTENDANCE_HEALTH = {
  status: 'Good Standing',
  statusLevel: 'good' as const,
  factors: {
    attendanceRate: 86,
    missedSessions: 6,
    outstandingCatchUps: 1,
    communicationRecord: 'Good',
  },
  summary: 'Your attendance is slightly below the 90% target but you have completed most catch-up work. One outstanding session needs attention.',
};

export const ATTENDANCE_MODE_CARDS = [
  {
    id: 'mode-attend',
    title: 'Attendance Mode',
    icon: 'ri-user-follow-line',
    description: 'Attend live session, participate fully, and complete all activities.',
    evidence: 'Attendance record',
    color: 'emerald',
  },
  {
    id: 'mode-catchup',
    title: 'Catch-Up Mode',
    icon: 'ri-timer-line',
    description: 'Missed live session — attend catch-up session or complete coach-supported activity.',
    evidence: 'Catch-up activity record',
    color: 'amber',
  },
  {
    id: 'mode-recording',
    title: 'Recording Catch-Up Mode',
    icon: 'ri-play-circle-line',
    description: 'Watch recording instead of live attendance and submit evidence.',
    evidence: 'Reflection, Learning Summary, Workplace Application, KSB Link',
    color: 'accent',
  },
];

export const ATTENDANCE_TIMELINE = [
  {
    id: 'tl-01', date: '17 Jun 2026', day: 'Tue', title: 'Self-Study: Consumer Behaviour Reading', module: 'Marketing Principles', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-02', date: '16 Jun 2026', day: 'Mon', title: 'Live Session: Campaign Targeting', module: 'Marketing Principles', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-03', date: '13 Jun 2026', day: 'Fri', title: 'Workshop: Positioning Strategy', module: 'Marketing Principles', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-04', date: '11 Jun 2026', day: 'Wed', title: 'Live Session: Campaign Budgeting', module: 'Marketing Principles', type: 'Late',
    icon: 'ri-alert-line', color: 'amber', label: 'Arrived Late',
  },
  {
    id: 'tl-05', date: '9 Jun 2026', day: 'Mon', title: 'Self-Study: Segmentation Reading', module: 'Marketing Principles', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-06', date: '6 Jun 2026', day: 'Fri', title: 'Coaching Meeting with Med Maher', module: 'Professional Practice', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-07', date: '4 Jun 2026', day: 'Wed', title: 'Live Session: STP and Customer Segmentation', module: 'Marketing Principles', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-08', date: '2 Jun 2026', day: 'Mon', title: 'Workshop: Customer Persona Builder', module: 'Marketing Principles', type: 'CatchUpComplete',
    icon: 'ri-refresh-line', color: 'primary', label: 'Catch-Up Completed',
  },
  {
    id: 'tl-09', date: '28 May 2026', day: 'Wed', title: 'Live Session: Marketing Environment', module: 'Marketing Principles', type: 'Missed',
    icon: 'ri-close-line', color: 'red', label: 'Missed Session',
  },
  {
    id: 'tl-10', date: '26 May 2026', day: 'Mon', title: 'Self-Study: PESTLE Framework', module: 'Marketing Principles', type: 'RecordingComplete',
    icon: 'ri-play-circle-line', color: 'accent', label: 'Recording Watched',
  },
  {
    id: 'tl-11', date: '23 May 2026', day: 'Fri', title: 'Live Session: Marketing Framework Overview', module: 'Marketing Principles', type: 'CatchUpComplete',
    icon: 'ri-refresh-line', color: 'primary', label: 'Catch-Up Approved',
  },
  {
    id: 'tl-12', date: '21 May 2026', day: 'Wed', title: 'Employer Induction Session', module: 'Induction', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
  {
    id: 'tl-13', date: '19 May 2026', day: 'Mon', title: 'Induction: Getting Started', module: 'Induction', type: 'Attended',
    icon: 'ri-check-line', color: 'emerald', label: 'Attended Live',
  },
];

export const MISSED_SESSION_ALERTS = [
  {
    id: 'miss-01',
    session: 'Live Session: Marketing Environment',
    date: '28 May 2026',
    catchUpStatus: 'Action Required',
    deadline: '11 Jun 2026',
    route: 'Recording + Reflection',
    coach: 'Crispin Jones',
    module: 'Marketing Principles',
  },
];

export const UPCOMING_SESSIONS = [
  {
    id: 'up-01', date: '18 Jun', day: 'Wed', title: 'Live Session: Consumer Behaviour', time: '10:00–12:00',
    type: 'Live', module: 'Marketing Principles', location: 'Microsoft Teams',
    teamsLink: '#', preparation: 'Review reading on consumer decision models',
    tutor: 'Crispin Jones',
  },
  {
    id: 'up-02', date: '18 Jun', day: 'Wed', title: 'Monthly Coaching', time: '14:00–15:00',
    type: 'Coaching', module: 'Professional Practice', location: 'Microsoft Teams',
    teamsLink: '#', preparation: 'Prepare OTJH update and evidence log',
    tutor: 'Med Maher',
  },
  {
    id: 'up-03', date: '20 Jun', day: 'Fri', title: 'Workshop: Campaign Budget Planning', time: '10:00–12:00',
    type: 'Workshop', module: 'Marketing Principles', location: 'Microsoft Teams',
    teamsLink: '#', preparation: 'Bring Tim Hortons budget scenario',
    tutor: 'Crispin Jones',
  },
  {
    id: 'up-04', date: '25 Jun', day: 'Wed', title: 'Progress Review: June', time: '11:00–12:00',
    type: 'Progress Review', module: 'Professional Practice', location: 'Microsoft Teams',
    teamsLink: '#', preparation: 'Complete preparation form',
    tutor: 'Med Maher',
  },
  {
    id: 'up-05', date: '25 Jun', day: 'Wed', title: 'Live Session: Data for Marketing', time: '10:00–12:00',
    type: 'Live', module: 'Marketing Principles', location: 'Microsoft Teams',
    teamsLink: '#', preparation: 'Pre-read: Data-driven marketing PDF',
    tutor: 'Crispin Jones',
  },
];

export const CATCH_UP_QUEUE = {
  outstanding: [
    {
      id: 'cu-out-01', originalSession: 'Live Session: Marketing Environment', date: '28 May 2026',
      reason: 'Personal appointment — coach notified', catchUpRoute: 'Recording + Reflection',
      deadline: '11 Jun 2026', status: 'Overdue', progress: 40,
      recordingWatched: false, reflectionDone: false, workplaceDone: false, ksbLinked: false,
      evidenceSubmitted: false, coach: 'Crispin Jones',
    },
  ],
  completed: [
    {
      id: 'cu-comp-01', originalSession: 'Workshop: Customer Persona Builder', date: '2 Jun 2026',
      reason: 'Illness — absence reported', catchUpRoute: 'Recording + Catch-Up Activity',
      deadline: '9 Jun 2026', status: 'Approved', progress: 100,
      recordingWatched: true, reflectionDone: true, workplaceDone: true, ksbLinked: true,
      evidenceSubmitted: true, approvedDate: '8 Jun 2026', coach: 'Crispin Jones',
    },
    {
      id: 'cu-comp-02', originalSession: 'Live Session: Marketing Framework Overview', date: '23 May 2026',
      reason: 'Employer meeting conflict', catchUpRoute: 'Coach-Supported Activity',
      deadline: '30 May 2026', status: 'Approved', progress: 100,
      recordingWatched: true, reflectionDone: true, workplaceDone: true, ksbLinked: true,
      evidenceSubmitted: true, approvedDate: '29 May 2026', coach: 'Med Maher',
    },
    {
      id: 'cu-comp-03', originalSession: 'Self-Study: PESTLE Framework', date: '26 May 2026',
      reason: 'Recording-based catch-up', catchUpRoute: 'Recording + Reflection',
      deadline: '2 Jun 2026', status: 'Approved', progress: 100,
      recordingWatched: true, reflectionDone: true, workplaceDone: true, ksbLinked: true,
      evidenceSubmitted: true, approvedDate: '1 Jun 2026', coach: 'Crispin Jones',
    },
  ],
};

export const RECORDING_CATCH_UP_FORM = {
  defaults: {
    sessionTitle: 'Live Session: Marketing Environment',
    sessionDate: '28 May 2026',
  },
  fields: [
    { name: 'sessionTitle', label: 'Session Title', type: 'text', required: true },
    { name: 'sessionDate', label: 'Original Session Date', type: 'text', required: true },
    { name: 'recordingDate', label: 'Recording Watched Date', type: 'date', required: true },
    { name: 'timeSpent', label: 'Time Spent', type: 'text', required: true, placeholder: 'e.g. 2 hours' },
    { name: 'keyLearning', label: 'Key Learning Points', type: 'textarea', required: true, maxLength: 500 },
    { name: 'workplaceApplication', label: 'Workplace Application', type: 'textarea', required: true, maxLength: 500 },
    { name: 'ksbLink', label: 'KSB / Learning Outcome Link', type: 'textarea', required: true, maxLength: 500 },
    { name: 'reflection', label: 'Reflection', type: 'textarea', required: true, maxLength: 500 },
  ],
};

export const CATCH_UP_EVIDENCE = {
  outstanding: [
    {
      id: 'ev-out-01', session: 'Live Session: Marketing Environment', date: '28 May 2026',
      evidenceType: 'Reflection + Workplace Application', status: 'Outstanding', deadline: '11 Jun 2026',
      feedback: null,
    },
  ],
  submitted: [
    {
      id: 'ev-sub-01', session: 'Workshop: Customer Persona Builder', date: '2 Jun 2026',
      evidenceType: 'Reflection + Persona Activity', status: 'Submitted', submittedDate: '7 Jun 2026',
      feedback: { from: 'Crispin Jones', date: '8 Jun 2026', text: 'Strong persona work Sophie. The link between your personas and the STP model is clear. Approved.' },
    },
  ],
  approved: [
    {
      id: 'ev-app-01', session: 'Live Session: Marketing Framework Overview', date: '23 May 2026',
      evidenceType: 'Coach-Supported Activity', status: 'Approved', approvedDate: '29 May 2026',
      feedback: { from: 'Med Maher', date: '29 May 2026', text: 'Excellent activity completion. Your framework application to Tim Hortons is spot on.' },
    },
    {
      id: 'ev-app-02', session: 'Self-Study: PESTLE Framework', date: '26 May 2026',
      evidenceType: 'Reflection + PESTLE Analysis', status: 'Approved', approvedDate: '1 Jun 2026',
      feedback: { from: 'Crispin Jones', date: '1 Jun 2026', text: 'Thorough PESTLE analysis. Good linking to KSB K6.' },
    },
  ],
  rejected: [],
};

export const COMMUNICATION_LOG = [
  {
    id: 'log-01', date: '28 May 2026', event: 'Absence Reported',
    detail: 'Informed coach Med Maher via Teams about personal appointment',
    icon: 'ri-message-2-line', color: 'primary',
  },
  {
    id: 'log-02', date: '28 May 2026', event: 'Reason Provided',
    detail: 'Personal appointment — scheduled medical visit',
    icon: 'ri-file-text-line', color: 'secondary',
  },
  {
    id: 'log-03', date: '29 May 2026', event: 'Coach Contacted',
    detail: 'Med Maher acknowledged absence and suggested recording catch-up',
    icon: 'ri-chat-check-line', color: 'emerald',
  },
  {
    id: 'log-04', date: '30 May 2026', event: 'Catch-Up Agreed',
    detail: 'Catch-up route agreed: watch recording + submit reflection by 11 June',
    icon: 'ri-hand-heart-line', color: 'accent',
  },
  {
    id: 'log-05', date: '2 Jun 2026', event: 'Absence Reported',
    detail: 'Reported illness for Workshop: Customer Persona Builder via platform',
    icon: 'ri-message-2-line', color: 'primary',
  },
  {
    id: 'log-06', date: '7 Jun 2026', event: 'Evidence Submitted',
    detail: 'Submitted catch-up evidence for Customer Persona Builder',
    icon: 'ri-upload-cloud-2-line', color: 'accent',
  },
  {
    id: 'log-07', date: '8 Jun 2026', event: 'Catch-Up Approved',
    detail: 'Crispin Jones approved persona builder catch-up evidence',
    icon: 'ri-check-double-line', color: 'emerald',
  },
];

export const ESCALATION_STATUS = {
  level: 'Good Standing',
  levelDescription: 'You are currently in good standing with one missed session requiring catch-up. Complete this before the deadline to maintain your status.',
  history: [
    { stage: 'Good Standing', reached: true, date: 'Started 19 May 2026' },
    { stage: '1 Missed Session', reached: true, date: '28 May 2026' },
    { stage: 'Support Plan Active', reached: false },
    { stage: 'Escalated to Employer', reached: false },
    { stage: 'Programme Intervention', reached: false },
  ],
  policyGuidance: 'KBC Attendance Policy requires 90% attendance. One missed session requires recording catch-up or coach-supported activity. Two missed sessions trigger a coach discussion and support plan. Repeated absence leads to employer escalation and potential programme review.',
};

export const ATTENDANCE_INSIGHTS = {
  last30Days: { trend: [88, 90, 87, 86, 85, 86], label: '+1% from last month' },
  last90Days: { trend: [84, 85, 86, 87, 87, 86], label: 'Stable at 86%' },
  byModule: [
    { module: 'Marketing Principles', rate: 82, sessions: 22, missed: 4 },
    { module: 'Professional Practice', rate: 100, sessions: 8, missed: 0 },
    { module: 'Induction', rate: 100, sessions: 7, missed: 0 },
    { module: 'Employer Engagement', rate: 80, sessions: 5, missed: 1 },
    { module: 'Workshops', rate: 75, sessions: 4, missed: 1 },
  ],
  bySessionType: [
    { type: 'Live Session', rate: 81, sessions: 16, missed: 3 },
    { type: 'Workshop', rate: 75, sessions: 4, missed: 1 },
    { type: 'Coaching', rate: 100, sessions: 8, missed: 0 },
    { type: 'Self-Study', rate: 92, sessions: 12, missed: 1 },
    { type: 'Induction', rate: 100, sessions: 3, missed: 0 },
  ],
  bestModule: 'Professional Practice',
  worstModule: 'Workshops',
  mostMissedType: 'Live Session',
};

export const COHORT_TREND_DATA: Record<string, number[]> = {
  'Cohort A — Marketing': [88, 86, 85, 87, 88, 90, 89, 87, 86, 88, 87, 86],
  'Cohort B — Data & Tech': [82, 80, 78, 79, 81, 80, 82, 83, 84, 83, 82, 84],
  'Cohort C — Finance': [85, 84, 83, 82, 81, 83, 84, 85, 86, 84, 83, 84],
  'Cohort D — HR': [95, 96, 94, 97, 95, 98, 96, 97, 98, 97, 96, 95],
};

export const COHORT_ATTENDANCE_SPARKLINE_DATA: Record<string, Array<{ week: string; rate: number }>> = {
  'Cohort A — Marketing': [
    { week: 'W19', rate: 88 }, { week: 'W20', rate: 86 }, { week: 'W21', rate: 85 },
    { week: 'W22', rate: 87 }, { week: 'W23', rate: 88 }, { week: 'W24', rate: 90 },
    { week: 'W25', rate: 89 }, { week: 'W26', rate: 87 }, { week: 'W27', rate: 86 },
    { week: 'W28', rate: 88 }, { week: 'W29', rate: 87 }, { week: 'W30', rate: 86 },
  ],
  'Cohort B — Data & Tech': [
    { week: 'W19', rate: 82 }, { week: 'W20', rate: 80 }, { week: 'W21', rate: 78 },
    { week: 'W22', rate: 79 }, { week: 'W23', rate: 81 }, { week: 'W24', rate: 80 },
    { week: 'W25', rate: 82 }, { week: 'W26', rate: 83 }, { week: 'W27', rate: 84 },
    { week: 'W28', rate: 83 }, { week: 'W29', rate: 82 }, { week: 'W30', rate: 84 },
  ],
  'Cohort C — Finance': [
    { week: 'W19', rate: 85 }, { week: 'W20', rate: 84 }, { week: 'W21', rate: 83 },
    { week: 'W22', rate: 82 }, { week: 'W23', rate: 81 }, { week: 'W24', rate: 83 },
    { week: 'W25', rate: 84 }, { week: 'W26', rate: 85 }, { week: 'W27', rate: 86 },
    { week: 'W28', rate: 84 }, { week: 'W29', rate: 83 }, { week: 'W30', rate: 84 },
  ],
  'Cohort D — HR': [
    { week: 'W19', rate: 95 }, { week: 'W20', rate: 96 }, { week: 'W21', rate: 94 },
    { week: 'W22', rate: 97 }, { week: 'W23', rate: 95 }, { week: 'W24', rate: 98 },
    { week: 'W25', rate: 96 }, { week: 'W26', rate: 97 }, { week: 'W27', rate: 98 },
    { week: 'W28', rate: 97 }, { week: 'W29', rate: 96 }, { week: 'W30', rate: 95 },
  ],
};

export const MISSED_SESSION_GUIDANCE = [
  {
    level: 'One Missed Session',
    icon: 'ri-error-warning-line',
    color: 'amber',
    steps: ['Reason recorded in the system', 'Coach notified', 'Catch-up route agreed (recording, coach activity, or catch-up session)', 'Complete within 7 calendar days'],
    badge: 'Standard Process',
  },
  {
    level: 'Two Missed Sessions',
    icon: 'ri-alert-line',
    color: 'orange',
    steps: ['Coach discussion required', 'Support plan created', 'Catch-up plan agreed with deadlines', 'Line manager informed'],
    badge: 'Support Trigger',
  },
  {
    level: 'Repeated Absence',
    icon: 'ri-spam-line',
    color: 'red',
    steps: ['Formal attendance review meeting', 'Employer discussion and intervention', 'Programme leader notified', 'Potential impact on programme continuation'],
    badge: 'Escalation',
  },
  {
    level: 'Safeguarding Concern',
    icon: 'ri-shield-user-line',
    color: 'red',
    steps: ['Immediate DSL referral', 'Welfare check initiated', 'Support services engaged', 'Confidential handling throughout'],
    badge: 'Priority',
  },
];

export const NEXT_BEST_ACTION = {
  priority: 'high',
  title: 'Complete Catch-Up Evidence',
  description: 'Watch the recording of Marketing Environment (28 May) and submit your reflection and workplace application evidence.',
  actionLabel: 'Start Catch-Up',
  actionIcon: 'ri-play-circle-line',
  deadline: 'Deadline: 11 June 2026',
  reason: 'You have 1 outstanding catch-up session. Completing this will restore your attendance to good standing.',
};

export const CATCH_UP_JOURNEY_STEPS = [
  { step: 1, label: 'Missed Session', icon: 'ri-calendar-close-line', status: 'completed' as const },
  { step: 2, label: 'Catch-Up Activity', icon: 'ri-timer-line', status: 'in-progress' as const },
  { step: 3, label: 'Evidence Submission', icon: 'ri-upload-cloud-2-line', status: 'pending' as const },
  { step: 4, label: 'Coach Review', icon: 'ri-user-search-line', status: 'pending' as const },
  { step: 5, label: 'Approved', icon: 'ri-check-double-line', status: 'pending' as const },
  { step: 6, label: 'Attendance Restored', icon: 'ri-shield-check-line', status: 'pending' as const },
];

export const CATCH_UP_READINESS = {
  recordingWatched: false,
  reflectionCompleted: false,
  workplaceCompleted: false,
  ksbLinked: false,
  evidenceSubmitted: false,
  approvalStatus: 'Not Submitted',
};

export const COACH_REVIEW_DATA = {
  submittedDate: null,
  feedback: null,
  status: 'Awaiting Submission',
  improvements: null,
};