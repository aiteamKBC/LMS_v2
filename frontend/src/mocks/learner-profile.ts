export const LEARNER_PROFILE = {
  id: 'sophie-williams',
  firstName: 'Sophie',
  lastName: 'Williams',
  fullName: 'Sophie Williams',
  email: 'sophie.williams@timhortons.co.uk',
  phone: '07700 900 824',
  programme: 'Marketing Executive',
  programmeLevel: 'Level 4',
  standardCode: 'ST0803',
  employer: 'Tim Hortons UK',
  coach: { name: 'Med Maher', role: 'Coach', email: 'med.maher@kbc.ac.uk', avatar: 'M' },
  tutor: { name: 'Crispin Jones', role: 'Tutor', email: 'crispin.jones@kbc.ac.uk', avatar: 'C' },
  lineManager: { name: 'Lauren Mitchell', role: 'Line Manager', email: 'lauren.mitchell@timhortons.co.uk', avatar: 'L' },
  status: 'Active Learner',
  cohort: 'ME-L4 June 2026',
  riskStatus: 'Amber',
  overallProgress: 42,
  attendanceRate: 86,
  attendanceTarget: 90,
  sessionsAttended: 37,
  sessionsMissed: 6,
  otjhCompleted: 74,
  otjhTarget: 120,
  otjhValidated: 68,
  otjhPending: 6,
  otjhRejected: 0,
  ksbProgress: 38,
  ksbTotal: 72,
  ksbValidated: 18,
  ksbPending: 9,
  ksbNotStarted: 45,
  evidenceCount: 12,
  evidenceValidated: 9,
  evidenceSubmitted: 2,
  evidenceDraft: 1,
  currentModule: 'Marketing Planning and Campaign Delivery',
  currentWeek: 4,
  nextLiveSession: { day: 'Wednesday', time: '10:00–12:00', date: '11 Jun 2026' },
  nextCoachingMeeting: { date: '18 Jun 2026', time: '14:00–15:00' },
  nextProgressReview: { date: '25 Jun 2026', time: '11:00–12:00' },
  startDate: '19 May 2026',
  plannedEndDate: '18 Nov 2027',
  gatewayTargetDate: 'October 2027',
  epaTargetDate: 'November 2027',
  durationMonths: 18,
  pointsBalance: 850,
  pointsThisMonth: 120,
  recognitionLevel: 'Gold Club',
  streakWeeks: 8,
  learningStyle: 'Visual',
  secondaryStyle: 'Reading/Writing',
  uln: '4872 1039 5612',
};

export const LEARNER_QUICK_STATS = [
  { label: 'Overall Progress', value: '42%', icon: 'ri-pie-chart-line', color: 'primary' as const, detail: 'Week 4 of 72' },
  { label: 'Attendance', value: '86%', icon: 'ri-calendar-check-line', color: 'accent' as const, detail: '37/43 sessions' },
  { label: 'OTJH Hours', value: '74 hrs', icon: 'ri-time-line', color: 'secondary' as const, detail: 'Target: 120 hrs' },
  { label: 'KSB Progress', value: '38%', icon: 'ri-bar-chart-2-line', color: 'primary' as const, detail: '18 of 72 validated' },
  { label: 'Evidence', value: '12 items', icon: 'ri-folder-upload-line', color: 'accent' as const, detail: '9 validated' },
  { label: 'Quizzes Passed', value: '8/10', icon: 'ri-questionnaire-line', color: 'secondary' as const, detail: '80% pass rate' },
];

export const LEARNER_UPCOMING_DEADLINES = [
  { date: '11 Jun', title: 'Week 4 Live Session', type: 'Session', urgent: false },
  { date: '13 Jun', title: 'Weekly Quiz: Segmentation', type: 'Quiz', urgent: false },
  { date: '14 Jun', title: 'Customer Persona Activity', type: 'Assignment', urgent: true },
  { date: '15 Jun', title: 'Workplace Reflection Due', type: 'Evidence', urgent: true },
  { date: '18 Jun', title: 'Monthly Coaching Meeting', type: 'Coaching', urgent: false },
  { date: '25 Jun', title: 'Progress Review June', type: 'Review', urgent: false },
];

export const LEARNER_RECENT_FEEDBACK = [
  { from: 'Med Maher', role: 'Coach', date: '7 Jun 2026', text: 'Excellent progress on your campaign planning KSBs Sophie. Your customer segmentation work is showing real depth — keep linking your evidence to KSB K5, K6, and S8.' },
  { from: 'Crispin Jones', role: 'Tutor', date: '5 Jun 2026', text: 'Your STP model worksheet was well-structured. For this week, focus on applying persona development to a real Tim Hortons scenario — the more workplace-specific, the stronger your portfolio.' },
  { from: 'Lauren Mitchell', role: 'Line Manager', date: '3 Jun 2026', text: 'Sophie applied segmentation thinking in our team meeting — suggested we look at our breakfast customer vs lunch customer profiles differently. Great to see the learning translating directly.' },
];

export const LEARNER_MESSAGES = [
  { from: 'Med Maher', role: 'Coach', date: '8 Jun 2026', text: 'Looking forward to our coaching session on the 18th. Please prepare your reflection on how the segmentation learning has impacted your day-to-day work at Tim Hortons.', unread: true },
  { from: 'Crispin Jones', role: 'Tutor', date: '6 Jun 2026', text: 'I have uploaded the recording of last week\'s session on the marketing environment. Please watch before Wednesday if you missed it.', unread: false },
];

export const LEARNER_RISK_FLAGS = [
  { label: 'Attendance', status: 'Amber', detail: '86% — below 90% target, 6 sessions missed', action: 'Book catch-up sessions' },
  { label: 'OTJH', status: 'Amber', detail: '74 of 120 hours — slightly behind planned pace at Week 4', action: 'Log 2.5 hrs this week' },
  { label: 'Evidence', status: 'Green', detail: '12 items submitted, 9 validated — on track', action: '' },
  { label: 'KSB Progression', status: 'Amber', detail: '38% at Week 4 — keep linking workplace evidence to KSBs', action: 'Review KSB mapping' },
];

export const LEARNER_FULL_PROFILE = {
  /* ── Identity ── */
  id: 'sophie-williams',
  firstName: 'Sophie',
  lastName: 'Williams',
  fullName: 'Sophie Williams',
  username: 'sophie.williams',
  pronouns: 'She/Her',
  dateOfBirth: '14/03/2001',
  referenceNumber: 'KBC-2025-08472',
  groups: 'ME-L4 Cohort A, Gold Club, Student Council',
  linkedInProfile: 'linkedin.com/in/sophie-williams-marketing',

  /* ── Contact ── */
  email: 'sophie.williams@aesa.com',
  mobile: '07700 900 824',
  landline: '',
  address: 'Meadowhall Rd',
  postcode: 'S9 1EP',
  country: 'United Kingdom',

  /* ── Programme ── */
  programme: 'Marketing Executive',
  programmeLevel: 'Level 4',
  programmeType: 'Apprenticeship Standard',
  standardCode: 'ST0803',
  qualification: 'Level 4 Market Research Executive Diploma',
  registrationStatus: 'Registered',
  learningProvider: 'KBC Academy',
  startDate: '08/09/2025',
  plannedEndDate: '08/03/2027',
  practicalPeriodStart: '08/09/2025',
  practicalPeriodEnd: '08/03/2027',
  plannedHours: 780,
  minimumRequiredHours: 720,
  currentModule: 'Module 2 — Managing Change',
  status: 'Active Learner',

  /* ── Employer ── */
  employer: 'Tim Hortons UK',
  employerAddress: 'Meadowhall Rd, Sheffield, S9 1EP',

  /* ── Manager ── */
  lineManager: { name: 'Lauren Mitchell', email: 'lauren.mitchell@timhortons.co.uk', phone: '07700 900 824' },

  /* ── Mentor ── */
  mentor: { name: 'Med Maher', email: 'med.maher@kbc.ac.uk', phone: '07722 334 455' },

  /* ── Coach ── */
  coach: { name: 'Med Maher', email: 'med.maher@kbc.ac.uk', phone: '07722 334 455' },

  /* ── Tutor ── */
  tutor: { name: 'Sarah Lindgren', email: 'sarah.lindgren@kbc.ac.uk', phone: '07733 445 566' },

  /* ── Key People (for snapshot) ── */
  snapshotCoach: 'Med Maher',
  snapshotTutor: 'Sarah Lindgren',
  snapshotLineManager: 'Lauren Mitchell',

  /* ── ULN ── */
  uln: '4872 1039 5612',

  /* ── Programme Status Snapshot ── */
  ragStatus: 'On Track',
  gatewayReadiness: 'Developing',
  snapshotDate: '12/06/2026',

  /* ── Key Dates ── */
  nextLiveSession: '21/10/2025 · 14:00',
  nextCoaching: '28/10/2025 · 14:00',
  nextProgressReview: '12/11/2025 · 10:30',
  nextCheckpoint: '05/11/2025',
  nextCheckpointTitle: 'Checkpoint Assessment #2',
  monthlyPortfolioDue: '27/10/2025',
  expectedGateway: '18/01/2027',
  epaTargetDate: 'March 2027',

  /* ── Personal Learning Summary ── */
  programmeProgress: 42,
  attendanceRate: 86,
  attendanceTarget: 90,
  sessionsAttended: 37,
  sessionsMissed: 6,
  otjhCompleted: 74,
  otjhTarget: 120,
  evidenceSubmitted: 12,
  evidenceApproved: 9,
  ksbProgress: 38,
  ksbTotal: 72,
  ksbValidated: 18,
  coachingAttendance: 4,
  coachingScheduled: 5,
  portfolioCompletion: 35,
  checkpointProgress: 50,
  checkpointsCompleted: 1,
  checkpointsTotal: 4,
  latestCoachingDate: '28/10/2025',
  latestCoachingTopic: 'Campaign planning and workplace integration',
  nextReviewDate: '12/11/2025',
  nextReviewFocus: 'Mid-module progress check',

  /* ── EPA ── */
  epaStatus: 'Pre-Gateway',
  epaOrganisation: 'NCFE',
  gatewayDate: '18/01/2027',
  epaPreparationProgress: 15,
  mockAssessmentStatus: 'Not Scheduled',
  portfolioReadiness: 'Developing',
  professionalDiscussionReadiness: 'Not Started',
  interviewReadiness: 'Not Started',

  /* ── Learning Support ── */
  hasDisability: 'No',
  functionalSkillsMaths: { level: 'Level 1', date: '02/08/2024' },
  functionalSkillsEnglish: { level: 'Level 1', date: '02/08/2024' },
  additionalSupportRequirements: 'None identified',
  learningPreferences: 'Visual, Reading/Writing',
  reasonableAdjustments: 'None required',
  supportNotes: 'Sophie is progressing well with no additional support needs identified. Prefers visual learning materials and written instructions.',

  /* ── Onboarding ── */
  onboardingProgress: 75,
  onboardingSteps: [
    { label: 'Introduction', status: 'completed' as const },
    { label: 'Individual Learner Record (ILR)', status: 'completed' as const },
    { label: 'Additional Information', status: 'completed' as const },
    { label: 'Initial Assessments', status: 'completed' as const },
    { label: 'Personal Learning Record', status: 'completed' as const },
    { label: 'CV / Job Description', status: 'completed' as const },
    { label: 'Policies', status: 'pending' as const },
    { label: 'Next Steps', status: 'pending' as const },
  ],

  /* ── Referrer ── */
  referrer: { name: 'N/A', address: 'N/A', contact: 'N/A' },
  markers: 'No markers',

  /* ── Virtual Assistant History ── */
  virtualAssistantHistory: [] as { date: string; topic: string; summary: string; status: string }[],
};

/* ═══════════════════════════════════════════════════════════════
   WEEKLY LEARNING COMPONENTS — This Week page
   ═══════════════════════════════════════════════════════════════ */
export const WEEKLY_LEARNING_COMPONENTS = [
  {
    id: 'w4-c1',
    title: 'Live Session: Campaign Targeting and Customer Segmentation',
    type: 'Live Session',
    typeIcon: 'ri-presentation-line',
    ksbCodes: ['K5', 'K6', 'S8'],
    ksbLabels: 'Customer segmentation strategies, Marketing planning frameworks, Apply segmentation to campaign planning',
    duration: '2 hours',
    plannedOTJH: 2.0,
    actualOTJH: 2.0,
    dueDate: 'Wed 11 Jun',
    dateDueFormatted: '11/06/2026',
    points: 30,
    status: 'In Progress' as const,
    primaryAction: 'Continue Learning',
    primaryIcon: 'ri-presentation-line',
    isLive: true,
    teamsMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NzA1MmE5ZTQtYzY4Ny00YjQ2LWEyZTYtZmZmZDc0MmJkMzE1%40thread.v2/0?context=%7b%22Tid%22%3a%22kbc-academy%22%2c%22Oid%22%3a%22sophie-williams%22%7d',
    assessmentMethod: null as 'ai-assisted' | 'tutor-assessed' | null,
    coachApprovedDate: null as string | null,
    qaApprovedDate: null as string | null,
    qaVerifiedBy: null as string | null,
    validatedBy: null as string | null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [] as string[],
    completedDate: null as string | null,
    evidenceSubmittedDate: null as string | null,
    coachFeedback: null as { from: string; date: string; text: string } | null,
    qaFeedback: null as { from: string; date: string; text: string } | null,
    aiFeedback: null as { score: number; summary: string; date: string } | null,
    referralReason: null as string | null,
    referralSource: null as string | null,
    requiredActions: null as string | null,
    score: null as number | null,
  },
  {
    id: 'w4-c2',
    title: 'Video 1: Customer Segmentation in Practice',
    type: 'Video',
    typeIcon: 'ri-video-line',
    ksbCodes: ['K5'],
    ksbLabels: 'Customer segmentation and targeting strategies',
    duration: '45 mins',
    plannedOTJH: 0.75,
    actualOTJH: 0.75,
    dueDate: 'Tue 10 Jun',
    dateDueFormatted: '10/06/2026',
    points: 10,
    status: 'Completed' as const,
    primaryAction: 'View Summary',
    primaryIcon: 'ri-file-list-line',
    isLive: false,
    assessmentMethod: 'ai-assisted' as const,
    coachApprovedDate: '9 Jun 2026',
    qaApprovedDate: '10 Jun 2026',
    qaVerifiedBy: 'QA Team — Internal Verification',
    validatedBy: 'Crispin Jones',
    otjhAwarded: 0.75,
    pointsEarned: 10,
    ksbsAchieved: ['K5'],
    completedDate: '10 Jun 2026',
    evidenceSubmittedDate: '8 Jun 2026',
    coachFeedback: { from: 'Crispin Jones', date: '9 Jun 2026', text: 'Excellent engagement with the segmentation concepts Sophie. Your understanding of STP is developing well — particularly the link between segmentation and targeting. Keep applying these frameworks to real Tim Hortons scenarios in your workplace evidence.' },
    qaFeedback: { from: 'QA Team', date: '10 Jun 2026', text: 'Coach assessment verified. Evidence quality meets the Level 4 standard. KSB K5 mapping is accurate and the assessment decision is consistent with cross-cohort benchmarking.' },
    aiFeedback: { score: 88, summary: 'AI assessment confirms strong comprehension of segmentation fundamentals. The learner demonstrates ability to identify segmentation variables and apply them to practical scenarios. Recommended for validation.', date: '8 Jun 2026' },
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c3',
    title: 'Podcast 1: The Psychology of Customer Targeting',
    type: 'Podcast',
    typeIcon: 'ri-headphone-line',
    ksbCodes: ['K5', 'B1'],
    ksbLabels: 'Customer segmentation strategies, Proactively apply learning in the workplace',
    duration: '20 mins',
    plannedOTJH: 0.3,
    actualOTJH: 0,
    dueDate: 'Thu 12 Jun',
    dateDueFormatted: '12/06/2026',
    points: 5,
    status: 'Evidence Submitted' as const,
    primaryAction: 'View Submission',
    primaryIcon: 'ri-file-list-line',
    isLive: false,
    assessmentMethod: 'ai-assisted' as const,
    coachApprovedDate: null,
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: '11 Jun 2026',
    coachFeedback: null,
    qaFeedback: null,
    aiFeedback: { score: 72, summary: 'AI assessment indicates adequate comprehension of targeting psychology concepts. The learner connects podcast content to workplace context but could strengthen the application examples. Recommend coach review before validation.', date: '11 Jun 2026' },
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c4',
    title: 'Reading 1: STP Model and Customer Personas',
    type: 'Reading',
    typeIcon: 'ri-book-open-line',
    ksbCodes: ['K5', 'K6'],
    ksbLabels: 'Customer segmentation strategies, Marketing planning frameworks',
    duration: '30 mins',
    plannedOTJH: 0.5,
    actualOTJH: 0.5,
    dueDate: 'Mon 9 Jun',
    dateDueFormatted: '09/06/2026',
    points: 10,
    status: 'Completed' as const,
    primaryAction: 'View Summary',
    primaryIcon: 'ri-file-list-line',
    isLive: false,
    assessmentMethod: 'tutor-assessed' as const,
    coachApprovedDate: '8 Jun 2026',
    qaApprovedDate: '9 Jun 2026',
    qaVerifiedBy: 'QA Team — Internal Verification',
    validatedBy: 'Crispin Jones',
    otjhAwarded: 0.5,
    pointsEarned: 10,
    ksbsAchieved: ['K5', 'K6'],
    completedDate: '9 Jun 2026',
    evidenceSubmittedDate: '7 Jun 2026',
    coachFeedback: { from: 'Crispin Jones', date: '8 Jun 2026', text: 'Well-structured STP analysis Sophie. Your persona development work shows good understanding of demographic and psychographic variables. For next steps, try linking persona insights directly to campaign messaging decisions — that will strengthen your S8 evidence.' },
    qaFeedback: { from: 'QA Team', date: '9 Jun 2026', text: 'Tutor assessment verified. KSB K5 and K6 mapping confirmed accurate. Evidence package is complete and meets apprenticeship standard requirements.' },
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c5',
    title: 'Quiz 1: Segmentation and Targeting Check',
    type: 'Quiz',
    typeIcon: 'ri-questionnaire-line',
    ksbCodes: ['K5', 'K6'],
    ksbLabels: 'Customer segmentation strategies, Marketing planning frameworks',
    duration: '15 mins',
    plannedOTJH: 1.0,
    actualOTJH: 0,
    dueDate: 'Fri 13 Jun',
    dateDueFormatted: '13/06/2026',
    points: 15,
    status: 'Not Started' as const,
    primaryAction: 'Start Learning',
    primaryIcon: 'ri-play-circle-line',
    isLive: false,
    assessmentMethod: null,
    coachApprovedDate: null,
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: null,
    coachFeedback: null,
    qaFeedback: null,
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c6',
    title: 'Video 2: Campaign Targeting and Media Planning',
    type: 'Video',
    typeIcon: 'ri-video-line',
    ksbCodes: ['K6', 'S8'],
    ksbLabels: 'Marketing planning frameworks, Apply segmentation to campaign planning',
    duration: '40 mins',
    plannedOTJH: 0.7,
    actualOTJH: 0,
    dueDate: 'Thu 12 Jun',
    dateDueFormatted: '12/06/2026',
    points: 10,
    status: 'Not Started' as const,
    primaryAction: 'Start Learning',
    primaryIcon: 'ri-play-circle-line',
    isLive: false,
    assessmentMethod: null,
    coachApprovedDate: null,
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: null,
    coachFeedback: null,
    qaFeedback: null,
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c7',
    title: 'Podcast 2: Behavioural Targeting in Digital Marketing',
    type: 'Podcast',
    typeIcon: 'ri-headphone-line',
    ksbCodes: ['K5', 'K6', 'B1'],
    ksbLabels: 'Customer segmentation strategies, Marketing planning frameworks, Proactively apply learning in the workplace',
    duration: '25 mins',
    plannedOTJH: 0.4,
    actualOTJH: 0,
    dueDate: 'Fri 13 Jun',
    dateDueFormatted: '13/06/2026',
    points: 5,
    status: 'Evidence Required' as const,
    primaryAction: 'Log Evidence',
    primaryIcon: 'ri-file-add-line',
    isLive: false,
    assessmentMethod: null,
    coachApprovedDate: null,
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: null,
    coachFeedback: null,
    qaFeedback: null,
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c8',
    title: 'Reading 2: Positioning Strategy and Brand Differentiation',
    type: 'Reading',
    typeIcon: 'ri-book-open-line',
    ksbCodes: ['K6', 'S8'],
    ksbLabels: 'Marketing planning frameworks, Apply segmentation to campaign planning',
    duration: '35 mins',
    plannedOTJH: 0.5,
    actualOTJH: 0,
    dueDate: 'Sat 14 Jun',
    dateDueFormatted: '14/06/2026',
    points: 10,
    status: 'Not Started' as const,
    primaryAction: 'Start Learning',
    primaryIcon: 'ri-play-circle-line',
    isLive: false,
    assessmentMethod: null,
    coachApprovedDate: null,
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: null,
    coachFeedback: null,
    qaFeedback: null,
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c9',
    title: 'Quiz 2: Targeting and Positioning',
    type: 'Quiz',
    typeIcon: 'ri-questionnaire-line',
    ksbCodes: ['K6', 'S8'],
    ksbLabels: 'Marketing planning frameworks, Apply segmentation to campaign planning',
    duration: '15 mins',
    plannedOTJH: 1.0,
    actualOTJH: 0,
    dueDate: 'Sat 14 Jun',
    dateDueFormatted: '14/06/2026',
    points: 15,
    status: 'Not Started' as const,
    primaryAction: 'Start Learning',
    primaryIcon: 'ri-play-circle-line',
    isLive: false,
    assessmentMethod: null,
    coachApprovedDate: null,
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: null,
    coachFeedback: null,
    qaFeedback: null,
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c10',
    title: 'Reflection: Segmentation at Tim Hortons',
    type: 'Reflection',
    typeIcon: 'ri-chat-quote-line',
    ksbCodes: ['K6', 'S8', 'B1'],
    ksbLabels: 'Marketing planning frameworks, Apply segmentation to campaign planning, Proactively apply learning in the workplace',
    duration: '20 mins',
    plannedOTJH: 0.5,
    actualOTJH: 0,
    dueDate: 'Sun 15 Jun',
    dateDueFormatted: '15/06/2026',
    points: 20,
    status: 'Evidence Submitted' as const,
    primaryAction: 'View Submission',
    primaryIcon: 'ri-file-list-line',
    isLive: false,
    assessmentMethod: 'tutor-assessed' as const,
    coachApprovedDate: '11 Jun 2026',
    qaApprovedDate: null,
    qaVerifiedBy: null,
    validatedBy: 'Crispin Jones',
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: '10 Jun 2026',
    coachFeedback: { from: 'Crispin Jones', date: '11 Jun 2026', text: 'Strong reflection Sophie. Your analysis of how Tim Hortons segments its customer base shows real workplace application. The link between breakfast commuter and family lunch segments is insightful. I have approved this for QA review.' },
    qaFeedback: null,
    aiFeedback: null,
    referralReason: null,
    referralSource: null,
    requiredActions: null,
    score: null as number | null,
  },
  {
    id: 'w4-c11',
    title: 'Upload Workplace Project Evidence',
    type: 'Evidence',
    typeIcon: 'ri-folder-upload-line',
    ksbCodes: ['K6', 'S7', 'S8'],
    ksbLabels: 'Marketing planning frameworks, Develop customer personas, Apply segmentation to campaign planning',
    duration: '90 mins',
    plannedOTJH: 2.5,
    actualOTJH: 0,
    dueDate: 'Sun 15 Jun',
    dateDueFormatted: '15/06/2026',
    points: 40,
    status: 'Referred' as const,
    primaryAction: 'Update Submission',
    primaryIcon: 'ri-edit-line',
    isLive: false,
    assessmentMethod: null,
    coachApprovedDate: '11 Jun 2026',
    qaApprovedDate: null,
    qaVerifiedBy: 'QA Team — Internal Verification',
    validatedBy: null,
    otjhAwarded: 0,
    pointsEarned: 0,
    ksbsAchieved: [],
    completedDate: null,
    evidenceSubmittedDate: '10 Jun 2026',
    coachFeedback: { from: 'Med Maher', date: '11 Jun 2026', text: 'The persona activity is well-structured Sophie. Your Tim Hortons customer profiles show good research. However, the QA team has flagged the need for more specific workplace application evidence before final approval.' },
    qaFeedback: { from: 'QA Team', date: '12 Jun 2026', text: 'The QA team has reviewed your workplace project evidence. Please provide additional detail on how your persona work directly links to campaign planning decisions at Tim Hortons. Include specific examples of how segmentation insights informed your marketing recommendations.' },
    aiFeedback: null,
    referralReason: 'Insufficient direct workplace application evidence. The persona activity lacks specific linkage to actual campaign planning decisions at Tim Hortons. Additional workplace context is required to demonstrate KSB S8 application.',
    referralSource: 'QA Team — Internal Verification',
    requiredActions: '1. Add specific Tim Hortons campaign examples showing how your personas informed marketing decisions. 2. Link the persona work to at least one KSB (S7 or S8) with concrete workplace evidence. 3. Include any internal Tim Hortons customer data or reports you referenced. 4. Resubmit by Sunday 15 June for re-review.',
  },
];

/* ═══════════════════════════════════════════════════════════════
   WEEKLY KSB DEVELOPMENT
   ═══════════════════════════════════════════════════════════════ */
export const WEEKLY_KSBS = [
  {
    code: 'K5',
    desc: 'Customer segmentation and targeting strategies',
    type: 'Knowledge' as const,
    components: ['Video 1', 'Reading 1', 'Live Session', 'Podcast 1', 'Podcast 2', 'Quiz 1'],
    progress: 60,
  },
  {
    code: 'K6',
    desc: 'Marketing planning frameworks and campaign development',
    type: 'Knowledge' as const,
    components: ['Reading 1', 'Reading 2', 'Live Session', 'Reflection', 'Quiz 2', 'Upload Project'],
    progress: 40,
  },
  {
    code: 'S7',
    desc: 'Develop customer personas to inform marketing activity',
    type: 'Skill' as const,
    components: ['Upload Workplace Project'],
    progress: 10,
  },
  {
    code: 'S8',
    desc: 'Apply segmentation data to campaign planning',
    type: 'Skill' as const,
    components: ['Live Session', 'Video 2', 'Reflection', 'Reading 2', 'Quiz 2', 'Upload Project'],
    progress: 35,
  },
  {
    code: 'B1',
    desc: 'Proactively apply learning in the workplace',
    type: 'Behaviour' as const,
    components: ['Podcast 1', 'Podcast 2', 'Reflection'],
    progress: 20,
  },
];

/* ═══════════════════════════════════════════════════════════════
   WEEKLY DEADLINES
   ═══════════════════════════════════════════════════════════════ */
export const WEEKLY_DEADLINES = [
  { title: 'Reading 1: STP Model', priority: 'completed' as const, date: 'Mon 9 Jun' },
  { title: 'Video 1: Customer Segmentation', priority: 'completed' as const, date: 'Tue 10 Jun' },
  { title: 'Live Session Attendance', priority: 'today' as const, date: 'Wed 11 Jun' },
  { title: 'Podcast 1: Psychology', priority: 'due-this-week' as const, date: 'Thu 12 Jun' },
  { title: 'Video 2: Campaign Targeting', priority: 'due-this-week' as const, date: 'Thu 12 Jun' },
  { title: 'Quiz 1: Segmentation', priority: 'due-this-week' as const, date: 'Fri 13 Jun' },
  { title: 'Podcast 2: Behavioural Targeting', priority: 'due-this-week' as const, date: 'Fri 13 Jun' },
  { title: 'Reading 2: Positioning', priority: 'due-this-week' as const, date: 'Sat 14 Jun' },
  { title: 'Quiz 2: Targeting', priority: 'due-this-week' as const, date: 'Sat 14 Jun' },
  { title: 'Reflection: Segmentation', priority: 'due-this-week' as const, date: 'Sun 15 Jun' },
  { title: 'Upload Workplace Project', priority: 'due-this-week' as const, date: 'Sun 15 Jun' },
  { title: 'Weekly Review', priority: 'upcoming' as const, date: 'Mon 16 Jun' },
];

/* ═══════════════════════════════════════════════════════════════
   WEEKLY LEARNING RESOURCES
   ═══════════════════════════════════════════════════════════════ */
export const WEEKLY_RESOURCES = [
  { title: 'Live Session Recording', type: 'Recording', icon: 'ri-play-circle-line', href: '#', description: 'Campaign Targeting and Customer Segmentation — full recording' },
  { title: 'STP Model Framework PDF', type: 'Reading', icon: 'ri-file-text-line', href: '#', description: 'Segmentation, Targeting, Positioning — complete framework guide' },
  { title: 'Customer Persona Template', type: 'Template', icon: 'ri-file-copy-line', href: '#', description: 'Downloadable persona builder template for your activity' },
  { title: 'Market Segmentation Data Pack', type: 'Download', icon: 'ri-download-line', href: '#', description: 'Tim Hortons customer data pack for analysis' },
  { title: 'Podcast: Psychology of Targeting', type: 'Podcast', icon: 'ri-headphone-line', href: '#', description: '20-min episode on customer targeting psychology' },
  { title: 'Segmentation Case Studies', type: 'Video', icon: 'ri-film-line', href: '#', description: '3 real-world segmentation case study videos' },
  { title: 'Quiz Study Guide', type: 'Reading', icon: 'ri-booklet-line', href: '#', description: 'Key concepts to review before the quiz' },
  { title: 'Reflection Prompt Sheet', type: 'Template', icon: 'ri-chat-quote-line', href: '#', description: 'Guided questions for your workplace reflection' },
];

/* ═══════════════════════════════════════════════════════════════
   WEEKLY COACH & TUTOR GUIDANCE
   ═══════════════════════════════════════════════════════════════ */
export const WEEKLY_TUTOR_GUIDANCE = {
  notes: 'This week is all about applying STP to a real workplace scenario Sophie. Your persona activity should draw on genuine Tim Hortons customer data — ask Lauren for any internal reports on customer demographics and purchasing patterns. The richer the persona, the stronger your evidence for KSBs K6 and S7. In the live session, we will walk through how campaign targeting flows from good segmentation work — come ready with questions about the Tim Hortons customer base.',
  suggestedFocus: 'Spend the most time on your Customer Persona Activity — this is the key piece of evidence for three KSBs this week. After the live session, immediately draft your persona while the segmentation concepts are fresh.',
  supportAvailable: 'I am available for 1:1 support on Thursday afternoon if you need help with the persona activity. Drop me a message on Teams or book a slot through the platform.',
};

export const WEEKLY_COACH_GUIDANCE = {
  notes: 'Sophie, great momentum from last week. Your segmentation video reflection showed strong understanding — let us build on that with the persona activity. Remember to log your OTJH as you go this week rather than leaving it all for Friday. You are slightly behind on OTJH pace, but the 2.5 hours from the persona activity will help close that gap significantly.',
  suggestedFocus: 'Prioritise the live session and persona activity first — those carry the most KSB weight and OTJH this week. The podcast and quiz are supplementary and can be wrapped up Thursday/Friday if you are short on time.',
  supportAvailable: 'We have our coaching session on 18 June where we will review KSB progress across K5, K6, S7, S8, and B1. Keep your evidence log updated throughout the week so we can review it together. If anything feels stuck, message me any time.',
};

/* ═══════════════════════════════════════════════════════════════
   QUIZ DATA
   ═══════════════════════════════════════════════════════════════ */
export interface QuizQuestion {
  id: number;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  ksbRef: string;
}

export interface QuizData {
  id: string;
  title: string;
  description: string;
  timeLimit: number;
  passingScore: number;
  totalPoints: number;
  questions: QuizQuestion[];
  score?: number;
  completed?: boolean;
  completedDate?: string;
}

export const QUIZ_1_DATA: QuizData = {
  id: 'quiz-1',
  title: 'Quiz 1: Segmentation and Targeting Check',
  description: 'Test your understanding of customer segmentation fundamentals and targeting strategies. You need 80% to pass.',
  timeLimit: 15,
  passingScore: 80,
  totalPoints: 15,
  questions: [
    {
      id: 1,
      text: 'Which of the following is NOT one of the four main segmentation bases?',
      options: ['Demographic', 'Geographic', 'Psychographic', 'Financial'],
      correctIndex: 3,
      explanation: 'The four main segmentation bases are Demographic, Geographic, Psychographic, and Behavioural. Financial is not a primary segmentation base, though income falls under Demographic.',
      ksbRef: 'K5',
    },
    {
      id: 2,
      text: 'What does the "T" in STP marketing stand for?',
      options: ['Testing', 'Targeting', 'Tracking', 'Timing'],
      correctIndex: 1,
      explanation: 'STP stands for Segmentation, Targeting, and Positioning — the three-step framework for developing customer-focused marketing strategies.',
      ksbRef: 'K5',
    },
    {
      id: 3,
      text: 'A company decides to focus its marketing efforts exclusively on one specific market segment. This is an example of:',
      options: ['Differentiated targeting', 'Concentrated targeting', 'Mass marketing', 'Micromarketing'],
      correctIndex: 1,
      explanation: 'Concentrated (or niche) targeting is when a company focuses on a single market segment with a specialised marketing mix. Differentiated targets multiple segments with separate offers.',
      ksbRef: 'K6',
    },
    {
      id: 4,
      text: 'Which segmentation variable would be MOST useful for a luxury watch brand?',
      options: ['Geographic location', 'Income and lifestyle', 'Age only', 'Education level only'],
      correctIndex: 1,
      explanation: 'Luxury brands benefit most from combining income (demographic) and lifestyle (psychographic) variables, as both purchasing power and aspirational values drive luxury purchases.',
      ksbRef: 'K5',
    },
    {
      id: 5,
      text: 'Behavioural segmentation includes all of the following EXCEPT:',
      options: ['Purchase occasion', 'Brand loyalty', 'Usage rate', 'Personality traits'],
      correctIndex: 3,
      explanation: 'Personality traits fall under Psychographic segmentation, not Behavioural. Behavioural segmentation focuses on purchase behaviour, usage patterns, loyalty, and decision-making processes.',
      ksbRef: 'K5',
    },
    {
      id: 6,
      text: 'When Tim Hortons creates different morning and afternoon menu promotions, which segmentation approach are they primarily using?',
      options: ['Geographic segmentation', 'Occasion-based segmentation', 'Demographic segmentation', 'Benefit segmentation'],
      correctIndex: 1,
      explanation: 'Occasion-based segmentation targets customers based on when they purchase or use a product. Tim Hortons tailoring promotions by time of day is a classic example of occasion-based behavioural segmentation.',
      ksbRef: 'K6',
    },
    {
      id: 7,
      text: 'A marketing plan that defines specific segments, selects target segments, and creates a distinct position for each is following the:',
      options: ['Marketing mix framework', 'STP framework', 'SWOT analysis', 'PESTLE framework'],
      correctIndex: 1,
      explanation: 'The STP framework (Segmentation → Targeting → Positioning) is the strategic approach for dividing markets, selecting target audiences, and crafting distinct value propositions.',
      ksbRef: 'K6',
    },
    {
      id: 8,
      text: 'Which of the following best describes "positioning"?',
      options: ['Choosing which segments to serve', 'Dividing the market into groups', 'Creating a distinct image in the customer\'s mind', 'Setting product prices competitively'],
      correctIndex: 2,
      explanation: 'Positioning is about creating a clear, distinctive, and desirable place in the target customer\'s mind relative to competing products. It follows segmentation and targeting in the STP process.',
      ksbRef: 'K6',
    },
    {
      id: 9,
      text: 'A persona is best described as:',
      options: ['A real customer the company knows well', 'A fictional representation of an ideal customer based on research', 'The company\'s target market size estimate', 'A list of all customer demographics'],
      correctIndex: 1,
      explanation: 'A customer persona is a semi-fictional representation of your ideal customer based on market research and real data about your existing customers. Personas help teams understand and empathise with target audiences.',
      ksbRef: 'K5',
    },
    {
      id: 10,
      text: 'What is the primary risk of undifferentiated (mass) marketing?',
      options: ['Higher production costs', 'Limited market reach', 'Failing to meet specific customer needs', 'Too much product variety'],
      correctIndex: 2,
      explanation: 'Undifferentiated marketing treats the entire market as one segment with a single marketing mix. The primary risk is that the generic offer may not satisfy any specific customer group well enough, making it vulnerable to more targeted competitors.',
      ksbRef: 'K6',
    },
  ],
};

export const QUIZ_2_DATA: QuizData = {
  id: 'quiz-2',
  title: 'Quiz 2: Targeting and Positioning',
  description: 'Assess your ability to apply targeting strategies and positioning concepts to real marketing scenarios. You need 80% to pass.',
  timeLimit: 15,
  passingScore: 80,
  totalPoints: 15,
  questions: [
    {
      id: 1,
      text: 'Which targeting strategy is Tim Hortons using when it offers the same coffee menu nationwide but runs regional ads featuring local sports teams?',
      options: ['Undifferentiated marketing', 'Differentiated marketing', 'Concentrated marketing', 'Micromarketing'],
      correctIndex: 1,
      explanation: 'Differentiated marketing targets multiple segments with different marketing mixes. Tim Hortons uses a core product (same coffee) with tailored promotional approaches per region — a differentiated strategy.',
      ksbRef: 'K6',
    },
    {
      id: 2,
      text: 'A perceptual map is used to:',
      options: ['Calculate market share by region', 'Visualise how customers perceive brands relative to competitors', 'Map store locations geographically', 'Track customer purchase history'],
      correctIndex: 1,
      explanation: 'A perceptual map is a visual tool that plots brands or products on two dimensions (e.g. price vs quality, traditional vs modern) to show how target customers perceive their relative positions in the market.',
      ksbRef: 'S8',
    },
    {
      id: 3,
      text: 'The term "competitive advantage" in positioning means:',
      options: ['Having the lowest prices in the market', 'Offering something customers value that competitors do not', 'Being the first company in the market', 'Having the largest marketing budget'],
      correctIndex: 1,
      explanation: 'A competitive advantage is a unique attribute or benefit that a company offers which customers value and competitors cannot easily replicate. It is the foundation of effective positioning.',
      ksbRef: 'K6',
    },
    {
      id: 4,
      text: 'When a brand positions itself as "the most reliable" in its category, it is using:',
      options: ['Price-based positioning', 'Attribute-based positioning', 'Competitor-based positioning', 'Usage-based positioning'],
      correctIndex: 1,
      explanation: 'Attribute-based positioning highlights a specific product feature or characteristic — in this case, "reliability." Other common attributes include quality, innovation, durability, or design.',
      ksbRef: 'S8',
    },
    {
      id: 5,
      text: 'Which segmentation approach would be MOST effective for a B2B marketing campaign targeting small business owners?',
      options: ['Firmographics and buyer behaviour', 'Psychographics only', 'Geographic location only', 'Age demographics'],
      correctIndex: 0,
      explanation: 'B2B segmentation typically combines firmographics (company size, industry, revenue) with buyer behaviour (purchase process, decision-makers, usage rate). Psychographics and age are less relevant in B2B contexts.',
      ksbRef: 'K6',
    },
    {
      id: 6,
      text: 'A positioning statement should include all of the following EXCEPT:',
      options: ['Target audience', 'Brand or product name', 'Detailed financial projections', 'Point of differentiation'],
      correctIndex: 2,
      explanation: 'A positioning statement typically includes the target audience, brand/product name, category, point of differentiation, and key benefit. Financial projections belong in a business plan, not a positioning statement.',
      ksbRef: 'S8',
    },
    {
      id: 7,
      text: 'Repositioning is necessary when:',
      options: ['The company wants to change its logo', 'Customer perceptions have shifted or the market has evolved', 'A new CEO is appointed', 'Sales targets are not met in one quarter'],
      correctIndex: 1,
      explanation: 'Repositioning is a strategic decision triggered by fundamental market shifts — evolving customer needs, new competitors, technological disruption, or declining brand relevance. It goes far deeper than a logo change.',
      ksbRef: 'K6',
    },
    {
      id: 8,
      text: 'In applying segmentation data to campaign planning, which step comes FIRST?',
      options: ['Design creative assets', 'Select media channels', 'Analyse segment attractiveness and select targets', 'Set the campaign budget'],
      correctIndex: 2,
      explanation: 'Before designing creatives or selecting channels, you must first evaluate which segments are attractive (size, growth, profitability, accessibility) and decide which to target — this drives all subsequent campaign planning decisions.',
      ksbRef: 'S8',
    },
    {
      id: 9,
      text: 'Which of the following is an example of benefit segmentation?',
      options: ['Grouping customers by age bracket', 'Grouping customers by the primary value they seek from a product', 'Grouping customers by city', 'Grouping customers by gender'],
      correctIndex: 1,
      explanation: 'Benefit segmentation groups customers based on the specific benefits they seek from a product — e.g. convenience vs price vs quality. It is one of the most powerful behavioural segmentation approaches.',
      ksbRef: 'K5',
    },
    {
      id: 10,
      text: 'A marketing executive recommends launching different social media campaigns for commuter customers vs family customers at Tim Hortons. This approach demonstrates:',
      options: ['Mass marketing strategy', 'Segmentation-driven campaign planning', 'Product development strategy', 'Pricing strategy'],
      correctIndex: 1,
      explanation: 'Designing distinct campaigns for different customer segments based on their unique characteristics and needs is the essence of segmentation-driven campaign planning — directly applying segmentation insights to marketing execution.',
      ksbRef: 'S8',
    },
  ],
};

/* ═══════════════════════════════════════════════════════════════
   READING CONTENT DATA
   ═══════════════════════════════════════════════════════════════ */
export interface ReadingSection {
  heading: string;
  content: string;
  boldTerms?: string[];
}

export interface ReadingContent {
  id: string;
  title: string;
  author: string;
  estimatedRead: string;
  sections: ReadingSection[];
  keyTakeaways: string[];
  ksbRefs: string[];
  learningOutcomes: string[];
  keyDefinitions: { term: string; definition: string }[];
}

export const READING_1_DATA: ReadingContent = {
  id: 'reading-1',
  title: 'STP Model and Customer Personas',
  author: 'Crispin Jones · KBC Academy',
  estimatedRead: '30 mins',
  sections: [
    {
      heading: 'Introduction to the STP Model',
      content: 'The STP model — Segmentation, Targeting, and Positioning — is the cornerstone of modern marketing strategy. First formalised by Philip Kotler in the 1980s, this three-step framework enables marketers to move from a broad, undifferentiated market view to a focused, customer-centric approach that maximises return on marketing investment.\n\nAt its core, STP acknowledges a fundamental truth: no company can be everything to everyone. Resources are finite, customer needs vary widely, and competition is fierce. The STP framework provides a systematic methodology for identifying the most valuable customer groups, selecting those that align with organisational capabilities, and crafting a compelling value proposition that resonates with chosen segments.',
      boldTerms: ['Segmentation', 'Targeting', 'Positioning'],
    },
    {
      heading: 'Step 1: Segmentation — Dividing the Market',
      content: 'Market segmentation is the process of dividing a heterogeneous market into smaller, more homogeneous groups of customers who share similar needs, characteristics, or behaviours. Effective segmentation is measurable, accessible, substantial, differentiable, and actionable.\n\nThe four primary segmentation bases are:\n\n• Demographic: Age, gender, income, education, occupation, family size, life stage. For example, a premium coffee chain might segment by income level and occupation type.\n\n• Geographic: Region, city size, climate, urban vs rural, population density. A retail brand might adapt store formats and product ranges based on local demographics.\n\n• Psychographic: Lifestyle, personality, values, interests, social class. Luxury brands heavily rely on psychographic segmentation to align with aspirational values.\n\n• Behavioural: Purchase occasion, usage rate, loyalty status, benefits sought, buyer readiness. This is often the most actionable base because it reflects actual customer behaviour rather than assumed characteristics.\n\nFor Tim Hortons, effective segmentation might combine geographic (urban commuter hubs vs suburban family locations), behavioural (breakfast rush vs afternoon treat), and demographic variables.',
      boldTerms: ['Demographic', 'Geographic', 'Psychographic', 'Behavioural'],
    },
    {
      heading: 'Step 2: Targeting — Selecting the Right Segments',
      content: 'Once segments are identified, the next step is evaluating their attractiveness and selecting which to serve. This evaluation considers segment size and growth potential, structural attractiveness (competition, substitute threats, supplier/buyer power), and alignment with company objectives and resources.\n\nThere are four broad targeting strategies:\n\n• Undifferentiated (Mass) Marketing: One offer for the entire market. Rarely effective today except for essential commodities.\n\n• Differentiated Marketing: Target multiple segments with separate offers. This is the approach of large FMCG brands like Unilever or P&G.\n\n• Concentrated (Niche) Marketing: Focus on one or a few segments. Ideal for specialist brands or companies with limited resources.\n\n• Micromarketing: Tailor offers to individual customers or very small groups. Enabled by digital marketing and CRM technology.\n\nThe choice of targeting strategy should reflect the organisation\'s capabilities, the nature of the market, competitor positioning, and the product lifecycle stage. For apprenticeship-level marketing planning, differentiated or concentrated strategies are most commonly applied.',
      boldTerms: ['Undifferentiated (Mass) Marketing', 'Differentiated Marketing', 'Concentrated (Niche) Marketing', 'Micromarketing'],
    },
    {
      heading: 'Step 3: Positioning — Creating a Distinct Image',
      content: 'Positioning is the art and science of designing a company\'s offering and image to occupy a distinctive place in the target customer\'s mind. The goal is to create a clear, unique, and desirable perception that differentiates the brand from competitors.\n\nA strong positioning strategy answers three questions:\n1. Who is the target customer?\n2. What is the key benefit or point of difference?\n3. Why should the customer believe this claim?\n\nCommon positioning approaches include:\n\n• Attribute positioning: Based on a specific product feature (e.g. "the safest car in its class")\n• Benefit positioning: Based on the primary benefit delivered (e.g. "whitens teeth in 3 days")\n• Use/application positioning: Based on a specific use case (e.g. "the breakfast of champions")\n• Competitor positioning: Explicitly positioned against a rival (e.g. Avis: "We try harder")\n• Quality/price positioning: Premium or value positioning (e.g. "reassuringly expensive")\n\nA good positioning strategy is single-minded, meaningful to the target, credible, and distinctive. It should be captured in a concise positioning statement that guides all marketing activity.',
      boldTerms: ['Attribute positioning', 'Benefit positioning', 'Use/application positioning', 'Competitor positioning', 'Quality/price positioning'],
    },
    {
      heading: 'Building Customer Personas',
      content: 'A customer persona is a semi-fictional representation of an ideal customer based on research and real data. Personas bring segmentation to life by humanising data points into relatable characters that teams can empathise with and design for.\n\nEffective personas include:\n\n• Demographics: Name, age, job title, income, location\n• Psychographics: Goals, motivations, frustrations, values\n• Behaviours: Shopping habits, media consumption, brand preferences\n• A representative photo (illustrative) and a memorable quote\n\nFor example, a Tim Hortons persona might be:\n\n"Commuter Chris" — Age 34, Marketing Manager, earns £45k, lives in Sheffield. Grabs a medium double-double and a breakfast wrap every weekday morning on his way to the office. Values speed and consistency. Active on LinkedIn and Twitter. Quote: "I just need my coffee to be fast and right — every single morning."\n\nPersonas should be grounded in real data — customer surveys, interviews, transaction analysis, and CRM insights — not assumptions. They are living documents that evolve as the market and customer base change.\n\nFor your workplace project, you will create 2-3 personas based on actual Tim Hortons customer data, linking each persona to specific segmentation variables and explaining how persona insights would influence campaign planning decisions.',
      boldTerms: ['customer persona'],
    },
    {
      heading: 'From STP to Campaign Planning',
      content: 'The STP framework directly feeds into campaign planning. Once you have defined your segments, selected targets, and crafted a positioning, the marketing mix (the 4Ps or 7Ps) becomes the tactical expression of that strategy.\n\nFor Tim Hortons, this might look like:\n\n• Segmentation: Commuter customers vs family lunch customers vs student study customers\n• Targeting: Concentrate on commuter segment for weekday breakfast campaign\n• Positioning: "Your reliable morning partner — quality coffee, served fast, every time"\n• Campaign: Morning rush radio ads, loyalty app push notifications at 7:30am, train station billboards\n\nThe key insight is that every campaign decision — creative message, media channel, offer structure, timing — should trace back to a clear STP logic. This alignment is what transforms marketing from guesswork into a strategic discipline.',
      boldTerms: ['4Ps', '7Ps'],
    },
  ],
  keyTakeaways: [
    'STP framework provides a systematic approach from market analysis to campaign execution',
    'Effective segmentation uses measurable, accessible, and actionable customer characteristics',
    'Targeting strategy choice depends on segment attractiveness and organisational capabilities',
    'Strong positioning creates a clear, distinctive, and credible place in the customer\'s mind',
    'Customer personas humanise segmentation data for better campaign design',
    'Every campaign decision should be traceable back to STP logic',
  ],
  ksbRefs: ['K5', 'K6'],
  learningOutcomes: [
    'Define the STP framework and explain each component',
    'Identify the four primary segmentation bases and give examples',
    'Compare and contrast targeting strategies (mass, differentiated, concentrated, micromarketing)',
    'Explain what a customer persona is and how to build one from research data',
    'Describe how STP logic connects to campaign planning decisions',
  ],
  keyDefinitions: [
    { term: 'Segmentation', definition: 'Dividing a heterogeneous market into smaller, more homogeneous groups of customers who share similar needs, characteristics, or behaviours.' },
    { term: 'Targeting', definition: 'Evaluating the attractiveness of market segments and selecting which segments to serve with a tailored marketing mix.' },
    { term: 'Positioning', definition: 'Designing a company\'s offering and image to occupy a distinctive place in the target customer\'s mind relative to competitors.' },
    { term: 'Customer Persona', definition: 'A semi-fictional representation of an ideal customer based on research and real data, used to guide marketing and product decisions.' },
    { term: 'Differentiated Marketing', definition: 'A strategy that targets multiple segments with separate marketing mixes for each segment.' },
    { term: 'Concentrated Marketing', definition: 'A strategy that focuses on one or a few market segments with a specialised marketing mix.' },
  ],
};

export const READING_2_DATA: ReadingContent = {
  id: 'reading-2',
  title: 'Positioning Strategy and Brand Differentiation',
  author: 'Crispin Jones · KBC Academy',
  estimatedRead: '35 mins',
  sections: [
    {
      heading: 'The Importance of Brand Positioning',
      content: 'In today\'s crowded marketplace, where consumers are bombarded with thousands of marketing messages daily, a clear and compelling brand position is not just advantageous — it is essential for survival. Positioning is the strategic foundation upon which all brand communications are built.\n\nBrand positioning defines how your brand is uniquely perceived in the mind of your target customer relative to competitors. It is not about what you do to the product; it is about what you do to the mind of the prospect. A well-positioned brand owns a specific mental territory that competitors cannot easily invade.\n\nConsider the difference between a brand that merely exists and one that is positioned: Dove is not just soap — it is "real beauty for real women." Apple is not just technology — it is "creative tools that empower individuals." These positions transcend product features to connect at a deeper emotional level.',
    },
    {
      heading: 'The Positioning Statement Framework',
      content: 'A positioning statement is an internal document that crystallises your brand\'s unique value. While customers never see it directly, it guides every external communication. The standard framework includes:\n\nFor [target audience], [brand name] is the [category] that [point of differentiation] because [reason to believe].\n\nLet us break this down:\n\n• Target audience: The specific, defined customer segment(s) you are addressing. Not "everyone" — be precise.\n\n• Brand name: Self-explanatory, but it anchors the statement to a specific entity.\n\n• Category: The competitive frame of reference. What business are you really in? (Hint: it is usually broader than you think — Starbucks is not in the coffee business; it is in the "third place" experience business.)\n\n• Point of differentiation: The single most compelling reason your target should choose you. This must be meaningful, distinctive, and credible.\n\n• Reason to believe: The evidence or proof that supports your differentiation claim. This could be heritage, expertise, technology, endorsements, or performance data.\n\nExample for a hypothetical brand: "For time-pressed urban professionals, Pret A Manger is the fresh food-to-go brand that delivers natural, handmade quality because every item is prepared in-store daily with no sell-by date needed."',
    },
    {
      heading: 'Differentiation Strategies',
      content: 'Differentiation is the strategic heart of positioning. Without meaningful differentiation, your brand competes on price alone — a race to the bottom that no brand wins in the long term.\n\nThere are six primary differentiation strategies:\n\n1. Product Differentiation: Features, performance, durability, design, style. Think Dyson\'s engineering-led approach to household appliances.\n\n2. Service Differentiation: Delivery, installation, customer support, training, repair. Zappos built a billion-dollar business primarily on service, not shoes.\n\n3. Channel Differentiation: How and where customers access your brand. Amazon\'s one-click ordering and same-day delivery transformed retail expectations.\n\n4. People Differentiation: Hiring and training better people. The Ritz-Carlton\'s legendary service culture is its primary differentiator.\n\n5. Image Differentiation: Brand identity, symbols, associations, atmosphere. Nike\'s swoosh and "Just Do It" have transcended athletic apparel into cultural icon status.\n\n6. Price Differentiation: Being the lowest-cost provider (Aldi, Ryanair) or commanding a premium through perceived value (Rolex, Hermès).\n\nThe most defensible differentiation strategies combine multiple elements. Apple differentiates on product (design), image (creative identity), channel (Apple Store experience), and service (Genius Bar).',
    },
    {
      heading: 'Perceptual Mapping for Competitive Analysis',
      content: 'A perceptual map is a visual tool that plots competing brands on a two-dimensional grid based on how customers perceive them. It reveals competitive positioning gaps and opportunities.\n\nCommon perceptual map dimensions include:\n\n• Price (low to high) vs Quality (low to high)\n• Traditional vs Modern/Innovative\n• Functional vs Emotional/Lifestyle\n• Niche/Specialist vs Broad/Generalist\n• Basic vs Premium\n\nCreating a perceptual map involves:\n1. Select two dimensions relevant to your category\n2. Plot major competitors based on customer research (not your own assumptions)\n3. Identify clusters, gaps, and your brand\'s current position\n4. Determine your desired position and the strategic gap to close\n\nPerceptual maps are particularly valuable for:\n• Identifying unserved or underserved market positions\n• Understanding competitive threats from adjacent positions\n• Tracking brand positioning shifts over time\n• Testing repositioning scenarios before implementing them\n\nFor your workplace project, mapping Tim Hortons against competitors like Costa, Starbucks, and independent coffee shops on dimensions like "convenience vs experience" and "value vs premium" would provide rich strategic insight.',
    },
    {
      heading: 'Repositioning: When and How',
      content: 'Repositioning is the process of changing the target market\'s understanding or perception of a brand. It is a high-stakes strategic move — done well, it can revitalise a declining brand; done poorly, it can alienate existing customers without attracting new ones.\n\nWhen should a brand consider repositioning?\n\n• Market evolution: Customer needs have fundamentally changed\n• Competitive pressure: A new entrant has claimed your territory\n• Brand stagnation: Research shows your brand is perceived as outdated\n• Category decline: Your category is shrinking and you need to expand relevance\n• Strategic pivot: The company is entering new markets or segments\n\nSuccessful repositioning examples:\n\n• Old Spice transformed from "your grandfather\'s aftershave" to a viral, youth-oriented men\'s grooming brand through a radical creative campaign.\n\n• Burberry shed its association with football hooligan culture to become a global luxury fashion house through designer collaborations and digital-first marketing.\n\n• McDonald\'s repositioned from "cheap fast food" to "quality, transparent, modern dining" through McCafé, restaurant redesign, and ingredient sourcing transparency.\n\nThe key lesson: repositioning must be authentic. You cannot simply declare a new position — you must earn it through genuine changes in product, experience, and communication.',
    },
    {
      heading: 'Applying Positioning to Campaign Planning',
      content: 'Your campaign plan is the execution vehicle for your positioning strategy. Every element of your campaign — message, creative, channel, offer, timing — should express and reinforce your brand position.\n\nPractical steps to ensure positioning-driven campaigns:\n\n1. Start with the positioning statement: Before writing any brief, ensure the positioning is crystal clear. If you cannot articulate it in one sentence, it is not sharp enough.\n\n2. Test creative against positioning: Does this advert / social post / email reinforce our desired position, dilute it, or contradict it?\n\n3. Consistency across touchpoints: A brand positioned as "premium" cannot have a discount-driven Facebook ad. A brand positioned as "innovative" cannot have a dated, clunky website.\n\n4. Measure positioning impact: Beyond clicks and conversions, track brand perception metrics — awareness, consideration, preference, association strength.\n\nFor Tim Hortons, if the desired position is "Canada\'s welcoming coffee home — quality without pretension," then every campaign element should feel warm, accessible, and genuine. A slick, minimalist campaign that feels like a luxury brand would undermine, not support, that position.',
    },
  ],
  keyTakeaways: [
    'Brand positioning creates a distinct mental territory that competitors cannot easily invade',
    'A positioning statement crystallises strategy and guides all marketing communications',
    'Six differentiation strategies provide multiple paths to competitive advantage',
    'Perceptual mapping reveals competitive gaps and strategic opportunities',
    'Repositioning is high-stakes and must be authentic — backed by real change',
    'All campaign planning decisions should express and reinforce brand position',
  ],
  ksbRefs: ['K6', 'S8'],
  learningOutcomes: [
    'Explain why brand positioning is essential in crowded markets',
    'Write a complete positioning statement using the target-audience framework',
    'Compare the six differentiation strategies and give real-world examples',
    'Describe how perceptual mapping works and when to use it',
    'Explain the risks and requirements of successful repositioning',
    'Apply positioning logic to campaign creative, channel, and timing decisions',
  ],
  keyDefinitions: [
    { term: 'Positioning', definition: 'Designing a company\'s offering and image to occupy a distinctive place in the target customer\'s mind relative to competitors.' },
    { term: 'Positioning Statement', definition: 'An internal document that crystallises the brand\'s unique value using a target-audience, category, point-of-difference, and reason-to-believe framework.' },
    { term: 'Differentiation', definition: 'The strategic process of creating meaningful differences between a brand and its competitors to gain competitive advantage.' },
    { term: 'Perceptual Map', definition: 'A visual tool that plots competing brands on a two-dimensional grid based on how customers perceive them, revealing gaps and opportunities.' },
    { term: 'Repositioning', definition: 'The strategic process of changing the target market\'s understanding or perception of a brand in response to market shifts or competitive pressure.' },
    { term: 'Competitive Advantage', definition: 'A unique attribute or benefit that a company offers which customers value and competitors cannot easily replicate.' },
  ],
};

/* ═══════════════════════════════════════════════════════════════
   PODCAST CONTENT DATA
   ═══════════════════════════════════════════════════════════════ */
export interface PodcastChapter {
  title: string;
  startTime: string;
  duration: string;
  description: string;
}

export interface PodcastContent {
  id: string;
  title: string;
  host: string;
  episode: string;
  totalDuration: string;
  totalDurationSecs: number;
  chapters: PodcastChapter[];
  transcript: string;
  ksbRefs: string[];
  learningOutcomes: string[];
}

export const PODCAST_1_DATA: PodcastContent = {
  id: 'podcast-1',
  title: 'The Psychology of Customer Targeting',
  host: 'Crispin Jones & Sarah Lindgren',
  episode: 'Episode 4',
  totalDuration: '20:00',
  totalDurationSecs: 1200,
  chapters: [
    { title: 'Introduction', startTime: '00:00', duration: '1:30', description: 'Welcome and episode overview — why psychology matters in targeting decisions' },
    { title: 'Cognitive Biases in Targeting', startTime: '01:30', duration: '5:00', description: 'How confirmation bias, anchoring, and availability heuristics affect marketer targeting decisions' },
    { title: 'Customer Decision Psychology', startTime: '06:30', duration: '4:30', description: 'The mental models customers use when evaluating targeted offers' },
    { title: 'Emotional vs Rational Targeting', startTime: '11:00', duration: '5:00', description: 'When to appeal to emotion and when to lead with rational benefits' },
    { title: 'Case Study: Tim Hortons', startTime: '16:00', duration: '2:30', description: 'Applying psychological targeting principles to the Tim Hortons customer base' },
    { title: 'Key Takeaways', startTime: '18:30', duration: '1:30', description: 'Summary of actionable insights for your campaign planning' },
  ],
  transcript: 'Welcome to Episode 4 of the Marketing Minds podcast. I\'m Crispin Jones, and today we\'re exploring the fascinating intersection of psychology and customer targeting. Joining me is Sarah Lindgren, behavioural science specialist...',
  ksbRefs: ['K5', 'B1'],
  learningOutcomes: [
    'Explain how cognitive biases influence marketer targeting decisions',
    'Describe the mental models customers use when evaluating targeted offers',
    'Compare emotional vs rational targeting approaches and when to use each',
    'Apply psychological targeting principles to a real customer base',
  ],
};

export const PODCAST_2_DATA: PodcastContent = {
  id: 'podcast-2',
  title: 'Behavioural Targeting in Digital Marketing',
  host: 'Crispin Jones',
  episode: 'Episode 5',
  totalDuration: '25:00',
  totalDurationSecs: 1500,
  chapters: [
    { title: 'What is Behavioural Targeting?', startTime: '00:00', duration: '3:00', description: 'Defining behavioural targeting and how it differs from demographic and psychographic approaches' },
    { title: 'Data Sources for Behavioural Insights', startTime: '03:00', duration: '5:30', description: 'Browsing history, purchase data, app usage, location signals — what data powers behavioural targeting' },
    { title: 'Personalisation at Scale', startTime: '08:30', duration: '5:00', description: 'How AI and machine learning enable mass personalisation through behavioural signals' },
    { title: 'Ethics and Privacy', startTime: '13:30', duration: '5:00', description: 'The regulatory landscape — GDPR, cookie consent, and the balance between relevance and privacy' },
    { title: 'Retail Case Studies', startTime: '18:30', duration: '4:00', description: 'How Tesco, Amazon, and Sephora use behavioural targeting to drive loyalty and conversion' },
    { title: 'Practical Application', startTime: '22:30', duration: '2:30', description: 'How to start applying behavioural targeting principles in your own campaign planning today' },
  ],
  transcript: 'Welcome back to the Marketing Minds podcast, Episode 5. I\'m Crispin Jones, and today we\'re diving into one of the most powerful — and controversial — tools in the modern marketer\'s arsenal: behavioural targeting...',
  ksbRefs: ['K5', 'K6', 'B1'],
  learningOutcomes: [
    'Define behavioural targeting and explain how it differs from demographic and psychographic approaches',
    'Identify the key data sources that power behavioural targeting',
    'Explain how AI enables personalisation at scale',
    'Describe the ethical and regulatory considerations around behavioural targeting',
    'Apply behavioural targeting principles to campaign planning',
  ],
};

export const COHORT_CONNECTIONS = [
  { id: 'c1', name: 'James Taylor', initials: 'JT', programme: 'Marketing Executive L4', employer: 'Costa Coffee', progress: 45, attendance: 92, avatarColor: 'bg-amber-500' },
  { id: 'c2', name: 'Aisha Khan', initials: 'AK', programme: 'Marketing Executive L4', employer: 'Greggs PLC', progress: 38, attendance: 88, avatarColor: 'bg-emerald-500' },
  { id: 'c3', name: 'Daniel Brooks', initials: 'DB', programme: 'Marketing Executive L4', employer: 'Pret A Manger', progress: 52, attendance: 95, avatarColor: 'bg-primary-500' },
  { id: 'c4', name: 'Emily Chen', initials: 'EC', programme: 'Marketing Executive L4', employer: 'Nandos UK', progress: 31, attendance: 84, avatarColor: 'bg-accent-500' },
  { id: 'c5', name: 'Marcus Riley', initials: 'MR', programme: 'Marketing Executive L4', employer: 'Starbucks UK', progress: 48, attendance: 91, avatarColor: 'bg-secondary-500' },
  { id: 'c6', name: 'Olivia Harper', initials: 'OH', programme: 'Marketing Executive L4', employer: 'Wagamama', progress: 41, attendance: 89, avatarColor: 'bg-rose-500' },
];

export const ATTENDANCE_HEATMAP = [
  { week: 'Wk 1 (19–23 May)', days: [
    { day: 'Mon', date: '19 May', status: 'attended', sessions: 2 },
    { day: 'Tue', date: '20 May', status: 'attended', sessions: 1 },
    { day: 'Wed', date: '21 May', status: 'attended', sessions: 2 },
    { day: 'Thu', date: '22 May', status: 'no-session', sessions: 0 },
    { day: 'Fri', date: '23 May', status: 'attended', sessions: 1 },
  ]},
  { week: 'Wk 2 (26–30 May)', days: [
    { day: 'Mon', date: '26 May', status: 'late', sessions: 1 },
    { day: 'Tue', date: '27 May', status: 'no-session', sessions: 0 },
    { day: 'Wed', date: '28 May', status: 'attended', sessions: 1 },
    { day: 'Thu', date: '29 May', status: 'attended', sessions: 2 },
    { day: 'Fri', date: '30 May', status: 'attended', sessions: 1 },
  ]},
  { week: 'Wk 3 (2–6 Jun)', days: [
    { day: 'Mon', date: '2 Jun', status: 'absent', sessions: 2 },
    { day: 'Tue', date: '3 Jun', status: 'no-session', sessions: 0 },
    { day: 'Wed', date: '4 Jun', status: 'attended', sessions: 2 },
    { day: 'Thu', date: '5 Jun', status: 'no-session', sessions: 0 },
    { day: 'Fri', date: '6 Jun', status: 'attended', sessions: 1 },
  ]},
  { week: 'Wk 4 (9–13 Jun)', days: [
    { day: 'Mon', date: '9 Jun', status: 'attended', sessions: 1 },
    { day: 'Tue', date: '10 Jun', status: 'attended', sessions: 1 },
    { day: 'Wed', date: '11 Jun', status: 'upcoming', sessions: 2 },
    { day: 'Thu', date: '12 Jun', status: 'upcoming', sessions: 2 },
    { day: 'Fri', date: '13 Jun', status: 'upcoming', sessions: 1 },
  ]},
];

export const OTJH_WEEKLY_BREAKDOWN = [
  { week: 'Week 1', planned: 5.0, actual: 4.5, status: 'Behind', sessions: [
    { type: 'Live Session', hours: 2.0, status: 'completed' },
    { type: 'Self-Paced', hours: 1.5, status: 'completed' },
    { type: 'Workplace', hours: 1.0, status: 'completed' },
    { type: 'Reflection', hours: 0.5, status: 'missed' },
  ]},
  { week: 'Week 2', planned: 5.0, actual: 5.0, status: 'On Track', sessions: [
    { type: 'Live Session', hours: 2.0, status: 'completed' },
    { type: 'Self-Paced', hours: 1.5, status: 'completed' },
    { type: 'Workplace', hours: 1.0, status: 'completed' },
    { type: 'Reflection', hours: 0.5, status: 'completed' },
  ]},
  { week: 'Week 3', planned: 5.0, actual: 3.5, status: 'Behind', sessions: [
    { type: 'Live Session', hours: 2.0, status: 'completed' },
    { type: 'Self-Paced', hours: 1.0, status: 'completed' },
    { type: 'Workplace', hours: 0.5, status: 'completed' },
    { type: 'Reflection', hours: 0, status: 'missed' },
  ]},
  { week: 'Week 4', planned: 6.0, actual: 2.5, status: 'Behind', sessions: [
    { type: 'Live Session', hours: 2.0, status: 'scheduled' },
    { type: 'Self-Paced', hours: 0.5, status: 'completed' },
    { type: 'Workplace', hours: 2.5, status: 'scheduled' },
    { type: 'Reflection', hours: 0.5, status: 'scheduled' },
  ]},
];

export const OTJH_CUMULATIVE = [
  { week: 'Week 1', target: 5.0, actual: 4.5 },
  { week: 'Week 2', target: 10.0, actual: 9.5 },
  { week: 'Week 3', target: 15.0, actual: 13.0 },
  { week: 'Week 4', target: 21.0, actual: 15.5 },
  { week: 'Week 5', target: 26.0, actual: null },
  { week: 'Week 6', target: 31.0, actual: null },
  { week: 'Week 7', target: 36.0, actual: null },
  { week: 'Week 8', target: 41.0, actual: null },
];

export const KSB_ENDORSEMENTS: Record<string, { name: string; role: string; initials: string; color: string; date: string }[]> = {
  'K1': [
    { name: 'Med Maher', role: 'Coach', initials: 'M', color: 'bg-primary-500', date: '28 May' },
    { name: 'Crispin Jones', role: 'Tutor', initials: 'C', color: 'bg-accent-500', date: '25 May' },
    { name: 'Lauren Mitchell', role: 'Line Manager', initials: 'L', color: 'bg-secondary-500', date: '22 May' },
  ],
  'K2': [
    { name: 'Crispin Jones', role: 'Tutor', initials: 'C', color: 'bg-accent-500', date: '6 Jun' },
  ],
  'K3': [
    { name: 'Med Maher', role: 'Coach', initials: 'M', color: 'bg-primary-500', date: '30 May' },
    { name: 'Crispin Jones', role: 'Tutor', initials: 'C', color: 'bg-accent-500', date: '25 May' },
  ],
  'K4': [],
  'K5': [
    { name: 'Crispin Jones', role: 'Tutor', initials: 'C', color: 'bg-accent-500', date: '8 Jun' },
  ],
  'K6': [],
  'S1': [
    { name: 'Med Maher', role: 'Coach', initials: 'M', color: 'bg-primary-500', date: '28 May' },
  ],
  'S2': [
    { name: 'Med Maher', role: 'Coach', initials: 'M', color: 'bg-primary-500', date: '30 May' },
    { name: 'Crispin Jones', role: 'Tutor', initials: 'C', color: 'bg-accent-500', date: '25 May' },
    { name: 'Lauren Mitchell', role: 'Line Manager', initials: 'L', color: 'bg-secondary-500', date: '23 May' },
  ],
  'S3': [],
  'S4': [
    { name: 'Crispin Jones', role: 'Tutor', initials: 'C', color: 'bg-accent-500', date: '6 Jun' },
  ],
  'B1': [
    { name: 'Med Maher', role: 'Coach', initials: 'M', color: 'bg-primary-500', date: '28 May' },
    { name: 'Lauren Mitchell', role: 'Line Manager', initials: 'L', color: 'bg-secondary-500', date: '3 Jun' },
  ],
  'B2': [
    { name: 'Lauren Mitchell', role: 'Line Manager', initials: 'L', color: 'bg-secondary-500', date: '23 May' },
    { name: 'Med Maher', role: 'Coach', initials: 'M', color: 'bg-primary-500', date: '28 May' },
  ],
  'B3': [],
};

export const KSB_HEATMAP_MATRIX = [
  { id: 'K1', category: 'Knowledge', label: 'Marketing principles', progress: 100, evidence: 3 },
  { id: 'K2', category: 'Knowledge', label: 'Customer segmentation', progress: 65, evidence: 2 },
  { id: 'K3', category: 'Knowledge', label: 'Marketing environment', progress: 100, evidence: 2 },
  { id: 'K4', category: 'Knowledge', label: 'Consumer behaviour', progress: 10, evidence: 0 },
  { id: 'K5', category: 'Knowledge', label: 'Marketing mix & campaign', progress: 45, evidence: 1 },
  { id: 'K6', category: 'Knowledge', label: 'Brand management', progress: 5, evidence: 0 },
  { id: 'S1', category: 'Skills', label: 'Marketing plans', progress: 40, evidence: 2 },
  { id: 'S2', category: 'Skills', label: 'Market research', progress: 100, evidence: 2 },
  { id: 'S3', category: 'Skills', label: 'Digital marketing tools', progress: 5, evidence: 0 },
  { id: 'S4', category: 'Skills', label: 'Marketing content', progress: 35, evidence: 1 },
  { id: 'B1', category: 'Behaviours', label: 'Professional communication', progress: 100, evidence: 3 },
  { id: 'B2', category: 'Behaviours', label: 'Teamwork', progress: 100, evidence: 2 },
  { id: 'B3', category: 'Behaviours', label: 'Initiative', progress: 30, evidence: 1 },
];