// ============================================================================
// KBC LearningOS — Engagement Section: Shared Data (single source of truth)
// ----------------------------------------------------------------------------
// Every engagement page (dashboard + sub-pages) reads learners, absences,
// recognitions, voucher claims and catch-up items from here so a given learner
// carries the SAME programme and identity everywhere. Programme filtering keys
// off `programmeCode` on each record.
// ============================================================================

// ---- PROGRAMMES ----
export type ProgrammeCode = 'PCP' | 'APM' | 'MM' | 'ME';

export const ENGAGEMENT_PROGRAMMES: { code: ProgrammeCode; name: string; level: string }[] = [
  { code: 'PCP', name: 'Project Control Program', level: 'L4' },
  { code: 'APM', name: 'Acc. Project Manager', level: 'L4' },
  { code: 'MM', name: 'Marketing Management', level: 'L5' },
  { code: 'ME', name: 'Marketing Execution', level: 'L4' },
];

const PROGRAMME_NAME: Record<ProgrammeCode, string> = ENGAGEMENT_PROGRAMMES.reduce(
  (acc, p) => ({ ...acc, [p.code]: p.name }),
  {} as Record<ProgrammeCode, string>,
);

export function programmeName(code: ProgrammeCode): string {
  return PROGRAMME_NAME[code];
}

// ---- LEARNER ROSTER ----
// Canonical attribute record. Superset of the fields rendered by the dashboard,
// Learner Engagement, Attendance Risk and Catch-up pages.
export interface EngagementLearner {
  id: string;
  name: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode;
  programme: string; // full programme name (denormalised for convenience)
  cohort: string;
  coach: string;
  // contact / delivery defaults — stands in for a real "users table" until one exists
  email: string;
  homeAddress: string;
  // engagement / activity
  engagementScore: number;
  attendanceRate: number;
  sessionsAttended: number;
  totalSessions: number;
  sessionsMissed: number;
  consecutiveMissed: number;
  lastAttendance: string;
  lastActive: string; // used as "last login" / "last active"
  evidenceSubmitted: number;
  evidenceTarget: number;
  otjhHours: number;
  otjhTarget: number;
  clubActivity: number;
  messageResponse: number;
  quizAverage: number;
  ksbProgress: number;
  overallPoints: number;
  pointsThisMonth: number;
  // status
  trend: 'up' | 'down' | 'stable';
  attendanceTrend: 'deteriorating' | 'declining' | 'stable' | 'improving';
  riskLevel: 'green' | 'amber' | 'red';
  overallStatus: 'on-track' | 'monitor' | 'at-risk';
  monthlyStatus: 'rising' | 'falling' | 'stable';
  badgesCount: number;
  topBadge: string;
  flags: string[];
  // attendance intervention
  attendanceAction: string;
  employerNotified: boolean;
  interventionDate: string | null;
}

function learner(
  id: string,
  name: string,
  programmeCode: ProgrammeCode,
  cohort: string,
  coach: string,
  rest: Omit<EngagementLearner, 'id' | 'name' | 'programmeCode' | 'programme' | 'cohort' | 'coach'>,
): EngagementLearner {
  return { id, name, programmeCode, programme: PROGRAMME_NAME[programmeCode], cohort, coach, ...rest };
}

export const ENGAGEMENT_LEARNERS: EngagementLearner[] = [
  // ---- PCP — Project Control Program ----
  learner('en-01', 'James Okonkwo', 'PCP', 'PCP-L4 Cohort A', 'Med Maher', {
    avatarImg: 'https://randomuser.me/api/portraits/men/32.jpg',
    email: 'james.okonkwo@example.com', homeAddress: '14 Elm Street, Manchester, M1 2AB',
    engagementScore: 28, attendanceRate: 68, sessionsAttended: 8, totalSessions: 20, sessionsMissed: 12, consecutiveMissed: 4,
    lastAttendance: 'Missed 5 Jun', lastActive: '5 days ago', evidenceSubmitted: 3, evidenceTarget: 14, otjhHours: 58, otjhTarget: 180,
    clubActivity: 0, messageResponse: 15, quizAverage: 32, ksbProgress: 21, overallPoints: 640, pointsThisMonth: 20,
    trend: 'down', attendanceTrend: 'deteriorating', riskLevel: 'red', overallStatus: 'at-risk', monthlyStatus: 'falling',
    badgesCount: 0, topBadge: 'No badges yet', flags: ['Attendance', 'Overdue evidence', 'No Teams login'],
    attendanceAction: 'Immediate intervention call + employer notification', employerNotified: true, interventionDate: '9 Jun 2026',
  }),
  learner('en-02', 'Daniel Walsh', 'PCP', 'PCP-L4 Cohort A', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/men/45.jpg',
    email: 'daniel.walsh@example.com', homeAddress: '22 Oak Avenue, Manchester, M2 3CD',
    engagementScore: 41, attendanceRate: 72, sessionsAttended: 11, totalSessions: 20, sessionsMissed: 10, consecutiveMissed: 3,
    lastAttendance: 'Missed 9 Jun', lastActive: '4 days ago', evidenceSubmitted: 5, evidenceTarget: 14, otjhHours: 88, otjhTarget: 180,
    clubActivity: 2, messageResponse: 40, quizAverage: 44, ksbProgress: 36, overallPoints: 980, pointsThisMonth: 35,
    trend: 'down', attendanceTrend: 'deteriorating', riskLevel: 'amber', overallStatus: 'at-risk', monthlyStatus: 'falling',
    badgesCount: 1, topBadge: 'First Catch-up', flags: ['Attendance', 'Evidence pace slow'],
    attendanceAction: 'Schedule catch-up session + wellbeing check', employerNotified: true, interventionDate: '10 Jun 2026',
  }),
  learner('en-03', 'Oliver Grant', 'PCP', 'PCP-L4 Cohort B', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/men/11.jpg',
    email: 'oliver.grant@example.com', homeAddress: '8 Birch Road, Manchester, M3 4EF',
    engagementScore: 70, attendanceRate: 85, sessionsAttended: 15, totalSessions: 20, sessionsMissed: 5, consecutiveMissed: 2,
    lastAttendance: 'Attended 3 Jun', lastActive: 'Yesterday', evidenceSubmitted: 9, evidenceTarget: 14, otjhHours: 128, otjhTarget: 180,
    clubActivity: 4, messageResponse: 78, quizAverage: 72, ksbProgress: 68, overallPoints: 2200, pointsThisMonth: 180,
    trend: 'stable', attendanceTrend: 'stable', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'stable',
    badgesCount: 5, topBadge: 'Steady Progress', flags: [],
    attendanceAction: 'Send reminder about next session', employerNotified: false, interventionDate: null,
  }),
  learner('en-04', 'Nadia Hussain', 'PCP', 'PCP-L4 Cohort B', 'Med Maher', {
    avatarImg: 'https://randomuser.me/api/portraits/women/68.jpg',
    email: 'nadia.hussain@example.com', homeAddress: '45 Cedar Lane, Manchester, M4 5GH',
    engagementScore: 84, attendanceRate: 95, sessionsAttended: 19, totalSessions: 20, sessionsMissed: 1, consecutiveMissed: 0,
    lastAttendance: 'Attended 6 Jun', lastActive: 'Today', evidenceSubmitted: 12, evidenceTarget: 14, otjhHours: 150, otjhTarget: 180,
    clubActivity: 6, messageResponse: 92, quizAverage: 86, ksbProgress: 82, overallPoints: 3260, pointsThisMonth: 340,
    trend: 'up', attendanceTrend: 'improving', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'rising',
    badgesCount: 7, topBadge: 'Evidence Master', flags: [],
    attendanceAction: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null,
  }),

  // ---- APM — Acc. Project Manager ----
  learner('en-05', 'Liam Foster', 'APM', 'APM-L4 Cohort A', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/men/8.jpg',
    email: 'liam.foster@example.com', homeAddress: '3 Maple Close, Birmingham, B1 2AB',
    engagementScore: 72, attendanceRate: 91, sessionsAttended: 16, totalSessions: 20, sessionsMissed: 4, consecutiveMissed: 1,
    lastAttendance: 'Attended 5 Jun', lastActive: '1 day ago', evidenceSubmitted: 8, evidenceTarget: 14, otjhHours: 115, otjhTarget: 180,
    clubActivity: 3, messageResponse: 75, quizAverage: 74, ksbProgress: 70, overallPoints: 3405, pointsThisMonth: 260,
    trend: 'stable', attendanceTrend: 'stable', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'stable',
    badgesCount: 5, topBadge: '50% Programme Complete', flags: [],
    attendanceAction: 'Send reminder about next session', employerNotified: false, interventionDate: null,
  }),
  learner('en-06', 'Priya Sharma', 'APM', 'APM-L4 Cohort B', 'Med Maher', {
    avatarImg: 'https://randomuser.me/api/portraits/women/50.jpg',
    email: 'priya.sharma@example.com', homeAddress: '19 Willow Way, Birmingham, B2 3CD',
    engagementScore: 55, attendanceRate: 81, sessionsAttended: 13, totalSessions: 20, sessionsMissed: 7, consecutiveMissed: 3,
    lastAttendance: 'Missed 8 Jun', lastActive: '3 days ago', evidenceSubmitted: 7, evidenceTarget: 14, otjhHours: 104, otjhTarget: 180,
    clubActivity: 3, messageResponse: 55, quizAverage: 60, ksbProgress: 50, overallPoints: 1400, pointsThisMonth: 70,
    trend: 'down', attendanceTrend: 'declining', riskLevel: 'amber', overallStatus: 'monitor', monthlyStatus: 'falling',
    badgesCount: 3, topBadge: 'Content Creator', flags: ['Attendance pattern'],
    attendanceAction: 'Contact learner and employer — check barriers', employerNotified: true, interventionDate: '10 Jun 2026',
  }),
  learner('en-07', 'Marcus Bell', 'APM', 'APM-L4 Cohort A', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/men/76.jpg',
    email: 'marcus.bell@example.com', homeAddress: '27 Ash Grove, Birmingham, B3 4EF',
    engagementScore: 79, attendanceRate: 93, sessionsAttended: 18, totalSessions: 20, sessionsMissed: 2, consecutiveMissed: 0,
    lastAttendance: 'Attended 6 Jun', lastActive: 'Today', evidenceSubmitted: 11, evidenceTarget: 14, otjhHours: 140, otjhTarget: 180,
    clubActivity: 5, messageResponse: 88, quizAverage: 80, ksbProgress: 76, overallPoints: 2980, pointsThisMonth: 300,
    trend: 'up', attendanceTrend: 'improving', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'rising',
    badgesCount: 6, topBadge: 'Steady Progress', flags: [],
    attendanceAction: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null,
  }),
  learner('en-08', 'Emma Clarke', 'APM', 'APM-L4 Cohort B', 'James Harrington', {
    avatarImg: 'https://randomuser.me/api/portraits/women/23.jpg',
    email: 'emma.clarke@example.com', homeAddress: '11 Poplar Street, Birmingham, B4 5GH',
    engagementScore: 30, attendanceRate: 70, sessionsAttended: 9, totalSessions: 20, sessionsMissed: 11, consecutiveMissed: 4,
    lastAttendance: 'Missed 4 Jun', lastActive: '6 days ago', evidenceSubmitted: 3, evidenceTarget: 14, otjhHours: 62, otjhTarget: 180,
    clubActivity: 0, messageResponse: 20, quizAverage: 35, ksbProgress: 25, overallPoints: 700, pointsThisMonth: 15,
    trend: 'down', attendanceTrend: 'deteriorating', riskLevel: 'red', overallStatus: 'at-risk', monthlyStatus: 'falling',
    badgesCount: 0, topBadge: 'No badges yet', flags: ['Attendance', 'No show', 'Overdue evidence'],
    attendanceAction: 'Immediate intervention call + employer notification', employerNotified: true, interventionDate: '11 Jun 2026',
  }),

  // ---- MM — Marketing Management ----
  learner('en-09', 'Maya Kapoor', 'MM', 'MM-L5 Cohort A', 'James Harrington', {
    avatarImg: 'https://randomuser.me/api/portraits/women/33.jpg',
    email: 'maya.kapoor@example.com', homeAddress: '6 Chestnut Drive, London, E1 2AB',
    engagementScore: 45, attendanceRate: 78, sessionsAttended: 12, totalSessions: 20, sessionsMissed: 8, consecutiveMissed: 2,
    lastAttendance: 'Missed 7 Jun', lastActive: 'Today', evidenceSubmitted: 5, evidenceTarget: 14, otjhHours: 98, otjhTarget: 180,
    clubActivity: 2, messageResponse: 45, quizAverage: 58, ksbProgress: 48, overallPoints: 1120, pointsThisMonth: 150,
    trend: 'stable', attendanceTrend: 'declining', riskLevel: 'amber', overallStatus: 'monitor', monthlyStatus: 'rising',
    badgesCount: 2, topBadge: 'First Catch-up', flags: ['New starter', 'Evidence pace slow'],
    attendanceAction: 'Call learner — check for barriers to attendance', employerNotified: false, interventionDate: '11 Jun 2026',
  }),
  learner('en-10', 'Sarah Mitchell', 'MM', 'MM-L5 Cohort A', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/women/65.jpg',
    email: 'sarah.mitchell@example.com', homeAddress: '31 Sycamore Court, London, E2 3CD',
    engagementScore: 88, attendanceRate: 94, sessionsAttended: 17, totalSessions: 20, sessionsMissed: 3, consecutiveMissed: 0,
    lastAttendance: 'Attended 6 Jun', lastActive: '1 day ago', evidenceSubmitted: 11, evidenceTarget: 14, otjhHours: 142, otjhTarget: 180,
    clubActivity: 6, messageResponse: 95, quizAverage: 85, ksbProgress: 80, overallPoints: 3120, pointsThisMonth: 380,
    trend: 'up', attendanceTrend: 'improving', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'rising',
    badgesCount: 7, topBadge: 'Peer Mentor', flags: [],
    attendanceAction: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null,
  }),
  learner('en-11', 'Tobias Lang', 'MM', 'MM-L5 Cohort B', 'James Harrington', {
    avatarImg: 'https://randomuser.me/api/portraits/men/22.jpg',
    email: 'tobias.lang@example.com', homeAddress: '17 Hazel Mews, London, E3 4EF',
    engagementScore: 66, attendanceRate: 88, sessionsAttended: 15, totalSessions: 20, sessionsMissed: 5, consecutiveMissed: 1,
    lastAttendance: 'Attended 4 Jun', lastActive: '2 days ago', evidenceSubmitted: 9, evidenceTarget: 14, otjhHours: 120, otjhTarget: 180,
    clubActivity: 4, messageResponse: 70, quizAverage: 68, ksbProgress: 62, overallPoints: 2050, pointsThisMonth: 190,
    trend: 'stable', attendanceTrend: 'stable', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'stable',
    badgesCount: 4, topBadge: 'Quick Responder', flags: [],
    attendanceAction: 'Send reminder about next session', employerNotified: false, interventionDate: null,
  }),
  learner('en-12', 'Aisha Patel', 'MM', 'MM-L5 Cohort B', 'Med Maher', {
    avatarImg: 'https://randomuser.me/api/portraits/women/12.jpg',
    email: 'aisha.patel@example.com', homeAddress: '9 Rowan Place, London, E4 5GH',
    engagementScore: 35, attendanceRate: 83, sessionsAttended: 10, totalSessions: 20, sessionsMissed: 6, consecutiveMissed: 2,
    lastAttendance: 'Attended 6 Jun', lastActive: '3 days ago', evidenceSubmitted: 4, evidenceTarget: 14, otjhHours: 72, otjhTarget: 180,
    clubActivity: 1, messageResponse: 30, quizAverage: 48, ksbProgress: 33, overallPoints: 890, pointsThisMonth: 40,
    trend: 'down', attendanceTrend: 'declining', riskLevel: 'amber', overallStatus: 'monitor', monthlyStatus: 'stable',
    badgesCount: 1, topBadge: 'Quick Responder', flags: ['Low engagement', '3 weeks no evidence'],
    attendanceAction: 'Monitor pattern — possible work commitment clash', employerNotified: false, interventionDate: null,
  }),

  // ---- ME — Marketing Execution ----
  learner('en-13', 'Emily Watson', 'ME', 'ME-L4 Cohort A', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/women/26.jpg',
    email: 'emily.watson@example.com', homeAddress: '24 Beech Terrace, Leeds, LS1 2AB',
    engagementScore: 94, attendanceRate: 100, sessionsAttended: 18, totalSessions: 20, sessionsMissed: 0, consecutiveMissed: 0,
    lastAttendance: 'Attended 6 Jun', lastActive: 'Today', evidenceSubmitted: 12, evidenceTarget: 14, otjhHours: 156, otjhTarget: 180,
    clubActivity: 8, messageResponse: 100, quizAverage: 91, ksbProgress: 88, overallPoints: 4285, pointsThisMonth: 520,
    trend: 'up', attendanceTrend: 'improving', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'rising',
    badgesCount: 9, topBadge: 'Perfect Attendance', flags: [],
    attendanceAction: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null,
  }),
  learner('en-14', 'Sophie Williams', 'ME', 'ME-L4 Cohort A', 'Med Maher', {
    avatarImg: 'https://randomuser.me/api/portraits/women/56.jpg',
    email: 'sophie.williams@example.com', homeAddress: '5 Larch End, Leeds, LS2 3CD',
    engagementScore: 62, attendanceRate: 86, sessionsAttended: 14, totalSessions: 20, sessionsMissed: 5, consecutiveMissed: 1,
    lastAttendance: 'Attended 4 Jun', lastActive: '2 days ago', evidenceSubmitted: 7, evidenceTarget: 14, otjhHours: 105, otjhTarget: 180,
    clubActivity: 5, messageResponse: 60, quizAverage: 54, ksbProgress: 42, overallPoints: 2140, pointsThisMonth: 90,
    trend: 'down', attendanceTrend: 'stable', riskLevel: 'amber', overallStatus: 'monitor', monthlyStatus: 'falling',
    badgesCount: 4, topBadge: 'Evidence Master', flags: ['OTJH pace', 'KSB stagnant'],
    attendanceAction: 'Check work commitment clashes with session times', employerNotified: false, interventionDate: null,
  }),
  learner('en-15', 'Olivia Park', 'ME', 'ME-L4 Cohort B', 'Sarah Chen', {
    avatarImg: 'https://randomuser.me/api/portraits/women/59.jpg',
    email: 'olivia.park@example.com', homeAddress: '38 Fir Crescent, Leeds, LS3 4EF',
    engagementScore: 81, attendanceRate: 92, sessionsAttended: 16, totalSessions: 20, sessionsMissed: 4, consecutiveMissed: 0,
    lastAttendance: 'Attended 5 Jun', lastActive: '1 day ago', evidenceSubmitted: 10, evidenceTarget: 14, otjhHours: 138, otjhTarget: 180,
    clubActivity: 7, messageResponse: 88, quizAverage: 82, ksbProgress: 76, overallPoints: 2640, pointsThisMonth: 300,
    trend: 'up', attendanceTrend: 'improving', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'rising',
    badgesCount: 6, topBadge: 'Top Club Contributor', flags: [],
    attendanceAction: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null,
  }),
  learner('en-16', 'David Chen', 'ME', 'ME-L4 Cohort B', 'James Harrington', {
    avatarImg: 'https://randomuser.me/api/portraits/men/78.jpg',
    email: 'david.chen@example.com', homeAddress: '12 Pine Gardens, Leeds, LS4 5GH',
    engagementScore: 76, attendanceRate: 94, sessionsAttended: 15, totalSessions: 20, sessionsMissed: 4, consecutiveMissed: 1,
    lastAttendance: 'Attended 5 Jun', lastActive: '2 days ago', evidenceSubmitted: 9, evidenceTarget: 14, otjhHours: 128, otjhTarget: 180,
    clubActivity: 4, messageResponse: 80, quizAverage: 78, ksbProgress: 74, overallPoints: 2870, pointsThisMonth: 210,
    trend: 'stable', attendanceTrend: 'improving', riskLevel: 'green', overallStatus: 'on-track', monthlyStatus: 'stable',
    badgesCount: 6, topBadge: 'Coding Excellence', flags: [],
    attendanceAction: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null,
  }),
];

// Quick lookup by learner id.
const LEARNER_BY_ID: Record<string, EngagementLearner> = ENGAGEMENT_LEARNERS.reduce(
  (acc, l) => ({ ...acc, [l.id]: l }),
  {} as Record<string, EngagementLearner>,
);

// ---- EVENT DATASETS ----
// Each event denormalises learner identity + programmeCode so pages can filter
// directly without a join.

export interface Recognition {
  id: string;
  learnerId: string;
  learner: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode;
  programme: string;
  cohort: string;
  type: 'badge' | 'certificate' | 'spotlight' | 'milestone' | 'achievement';
  title: string;
  description: string;
  awardedBy: string;
  awardedAt: string;
  category: string;
  points: number;
  public: boolean;
}

function recognition(
  id: string, learnerId: string, type: Recognition['type'], title: string, description: string,
  awardedBy: string, awardedAt: string, category: string, points: number, isPublic: boolean,
): Recognition {
  const l = LEARNER_BY_ID[learnerId];
  return { id, learnerId, learner: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort, type, title, description, awardedBy, awardedAt, category, points, public: isPublic };
}

export const RECOGNITIONS: Recognition[] = [
  recognition('rec-01', 'en-13', 'badge', 'Perfect Attendance', 'Attended all sessions for 4 consecutive weeks', 'Sarah Chen', 'Today', 'Attendance', 50, true),
  recognition('rec-02', 'en-15', 'spotlight', 'Top Club Contributor', 'Led 3 successful Marketing Club activities this month', 'Rebecca Okonkwo', 'Yesterday', 'Clubs', 100, true),
  recognition('rec-03', 'en-16', 'certificate', 'Coding Excellence', 'Completed advanced content challenge with 98% score', 'James Harrington', '8 Jun 2026', 'Assessment', 150, true),
  recognition('rec-04', 'en-05', 'milestone', '50% Programme Complete', 'Reached the halfway point of the programme with strong performance', 'Sarah Chen', '7 Jun 2026', 'Progress', 200, true),
  recognition('rec-05', 'en-14', 'achievement', 'Evidence Master', 'Submitted 15 pieces of evidence with 100% first-time approval', 'Med Maher', '6 Jun 2026', 'Evidence', 100, true),
  recognition('rec-06', 'en-09', 'badge', 'First Catch-up', 'Successfully completed first catch-up session after absence', 'James Harrington', '5 Jun 2026', 'Attendance', 25, false),
  recognition('rec-07', 'en-10', 'spotlight', 'Peer Mentor', 'Helped 3 fellow learners with evidence submissions', 'Sarah Chen', '4 Jun 2026', 'Support', 75, true),
  recognition('rec-08', 'en-07', 'badge', 'Quick Responder', 'Responded to all coach messages within 2 hours for 2 weeks', 'Sarah Chen', '3 Jun 2026', 'Communication', 30, false),
  recognition('rec-09', 'en-04', 'achievement', 'Evidence Master', 'Consistently ahead of evidence submission pace', 'Med Maher', '2 Jun 2026', 'Evidence', 100, true),
  recognition('rec-10', 'en-11', 'milestone', 'Steady Progress', 'Maintained on-track status for 6 consecutive weeks', 'James Harrington', '1 Jun 2026', 'Progress', 120, true),
];

// ---- REWARDS CATALOGUE ----
// Single source of truth for the rewards shop catalogue. `deliveryType`
// determines what the fulfilment flow on a claim needs: a shipping address
// for 'physical', an email address for 'digital'.
export interface RewardItem {
  id: string;
  name: string;
  description: string;
  points: number;
  category: string;
  deliveryType: 'physical' | 'digital';
  stock: number;
  totalClaimed: number;
  image: string;
  popular: boolean;
  active: boolean;
}

export const ENGAGEMENT_REWARDS: RewardItem[] = [
  { id: 'rw-01', name: 'Amazon Gift Card', description: '£10 Amazon gift card for online purchases', points: 500, category: 'Voucher', deliveryType: 'digital', stock: 24, totalClaimed: 156, image: 'https://readdy.ai/api/search-image?query=Amazon%20gift%20card%20voucher%20online%20shopping%20modern%20clean&width=200&height=200&seq=reward-amazon&orientation=squarish', popular: true, active: true },
  { id: 'rw-02', name: 'Coffee Shop Voucher', description: '£5 voucher for major coffee chains', points: 250, category: 'Voucher', deliveryType: 'digital', stock: 45, totalClaimed: 89, image: 'https://readdy.ai/api/search-image?query=professional%20coffee%20shop%20voucher%20warm%20modern%20design&width=200&height=200&seq=reward-coffee&orientation=squarish', popular: true, active: true },
  { id: 'rw-03', name: 'Stationery Kit', description: 'Premium notebook, pens, and highlighters', points: 300, category: 'Merchandise', deliveryType: 'physical', stock: 18, totalClaimed: 42, image: 'https://readdy.ai/api/search-image?query=premium%20stationery%20kit%20notebook%20pen%20highlighter%20modern%20professional&width=200&height=200&seq=reward-stationery&orientation=squarish', popular: false, active: true },
  { id: 'rw-04', name: 'Book Voucher', description: '£15 voucher for any book retailer', points: 750, category: 'Voucher', deliveryType: 'digital', stock: 12, totalClaimed: 67, image: 'https://readdy.ai/api/search-image?query=book%20voucher%20reading%20education%20modern%20design&width=200&height=200&seq=reward-book&orientation=squarish', popular: false, active: true },
  { id: 'rw-05', name: 'Laptop Bag', description: 'Professional laptop bag with KBC branding', points: 1000, category: 'Merchandise', deliveryType: 'physical', stock: 8, totalClaimed: 23, image: 'https://readdy.ai/api/search-image?query=professional%20laptop%20bag%20modern%20design%20clean%20aesthetic&width=200&height=200&seq=reward-bag&orientation=squarish', popular: true, active: true },
  { id: 'rw-06', name: 'Water Bottle', description: 'Insulated stainless steel water bottle', points: 200, category: 'Merchandise', deliveryType: 'physical', stock: 32, totalClaimed: 78, image: 'https://readdy.ai/api/search-image?query=insulated%20stainless%20steel%20water%20bottle%20modern%20minimalist%20design&width=200&height=200&seq=reward-bottle&orientation=squarish', popular: false, active: true },
  { id: 'rw-07', name: 'Netflix Subscription', description: '1 month Netflix subscription', points: 600, category: 'Subscription', deliveryType: 'digital', stock: 15, totalClaimed: 34, image: 'https://readdy.ai/api/search-image?query=streaming%20subscription%20service%20modern%20digital%20design&width=200&height=200&seq=reward-netflix&orientation=squarish', popular: false, active: true },
  { id: 'rw-08', name: 'Team Lunch Voucher', description: '£20 team lunch voucher for your cohort', points: 1200, category: 'Voucher', deliveryType: 'digital', stock: 5, totalClaimed: 12, image: 'https://readdy.ai/api/search-image?query=team%20lunch%20voucher%20professional%20food%20modern%20design&width=200&height=200&seq=reward-lunch&orientation=squarish', popular: true, active: true },
  { id: 'rw-09', name: 'Headphones', description: 'Wireless over-ear headphones with noise cancellation', points: 900, category: 'Electronics', deliveryType: 'physical', stock: 10, totalClaimed: 1, image: 'https://m.media-amazon.com/images/I/51f7KKP25PL._AC_UF894,1000_QL80_.jpg', popular: false, active: true },
];

const REWARD_BY_ID: Record<string, RewardItem> = ENGAGEMENT_REWARDS.reduce(
  (acc, r) => ({ ...acc, [r.id]: r }),
  {} as Record<string, RewardItem>,
);

export interface VoucherClaim {
  id: string;
  learnerId: string;
  learner: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode | '';
  programme: string;
  cohort: string;
  rewardId: string;
  reward: string;
  points: number;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  reviewedBy: string | null;
  reviewedAt: string | null;
  deliveryType: 'physical' | 'digital';
  deliveryMethod: string;
  // The address/email actually used for this claim — defaults to the
  // learner's homeAddress/email, but can be overridden per claim on review.
  deliveryDetail: string | null;
  // Physical claims only — free-text delivery notes captured on the
  // fulfilment form (e.g. "leave with reception", access codes, etc).
  deliveryInstructions: string | null;
}

function voucher(
  id: string, learnerId: string, rewardId: string, requestedAt: string,
  status: VoucherClaim['status'], reviewedBy: string | null, reviewedAt: string | null, deliveryDetail: string | null,
  deliveryInstructions: string | null = null,
): VoucherClaim {
  const r = REWARD_BY_ID[rewardId];
  const l = LEARNER_BY_ID[learnerId];
  const deliveryMethod = r.deliveryType === 'digital' ? 'Email' : 'Post';
  return {
    id, learnerId, learner: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort,
    rewardId, reward: r.name, points: r.points, requestedAt, status, reviewedBy, reviewedAt,
    deliveryType: r.deliveryType, deliveryMethod, deliveryDetail, deliveryInstructions,
  };
}

export const VOUCHER_CLAIMS: VoucherClaim[] = [
  voucher('vc-01', 'en-13', 'rw-01', 'Today, 09:00', 'pending', null, null, null),
  voucher('vc-02', 'en-10', 'rw-02', 'Today, 08:30', 'pending', null, null, null),
  voucher('vc-03', 'en-16', 'rw-05', 'Yesterday, 15:00', 'pending', null, null, null),
  voucher('vc-04', 'en-05', 'rw-04', 'Yesterday, 11:00', 'approved', 'Tom Harrington', 'Today, 08:00', 'liam.foster@example.com'),
  voucher('vc-05', 'en-09', 'rw-07', '8 Jun, 14:00', 'approved', 'Tom Harrington', '9 Jun, 09:00', 'maya.kapoor@example.com'),
  voucher('vc-06', 'en-14', 'rw-08', '8 Jun, 10:00', 'fulfilled', 'Tom Harrington', '8 Jun, 16:00', 'sophie.williams@example.com'),
  voucher('vc-07', 'en-01', 'rw-02', '7 Jun, 09:00', 'rejected', 'Tom Harrington', '8 Jun, 10:00', null),
  voucher('vc-08', 'en-12', 'rw-06', '7 Jun, 08:00', 'pending', null, null, null),
  voucher('vc-09', 'en-15', 'rw-03', '6 Jun, 16:00', 'fulfilled', 'Tom Harrington', '7 Jun, 09:00', '38 Fir Crescent, Leeds, LS3 4EF', 'Leave with reception if no answer — flat 2B, second floor.'),
  voucher('vc-10', 'en-04', 'rw-01', '6 Jun, 10:00', 'approved', 'Tom Harrington', '7 Jun, 08:00', 'nadia.hussain@example.com'),
  voucher('vc-11', 'en-07', 'rw-09', '5 Jun, 13:00', 'pending', null, null, null),
  voucher('vc-12', 'en-11', 'rw-02', '5 Jun, 09:30', 'approved', 'Tom Harrington', '6 Jun, 08:30', 'tobias.lang@example.com'),
];

export interface CatchupItem {
  id: string;
  learnerId: string;
  learner: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode;
  programme: string;
  cohort: string;
  coach: string;
  missedSessions: string[];
  totalHours: number;
  overdueDays: number;
  reason: string;
  scheduledDate: string | null;
  status: 'overdue' | 'scheduled' | 'completed';
  lastContact: string;
  engagementScore: number;
  quizAverage: number;
  ksbProgress: number;
  overallPoints: number;
  monthlyStatus: 'rising' | 'falling' | 'stable';
  badgesCount: number;
  topBadge: string;
}

function catchup(
  id: string, learnerId: string, missedSessions: string[], totalHours: number, overdueDays: number,
  reason: string, scheduledDate: string | null, status: CatchupItem['status'], lastContact: string,
): CatchupItem {
  const l = LEARNER_BY_ID[learnerId];
  return {
    id, learnerId, learner: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort, coach: l.coach,
    missedSessions, totalHours, overdueDays, reason, scheduledDate, status, lastContact,
    engagementScore: l.engagementScore, quizAverage: l.quizAverage, ksbProgress: l.ksbProgress,
    overallPoints: l.overallPoints, monthlyStatus: l.monthlyStatus, badgesCount: l.badgesCount, topBadge: l.topBadge,
  };
}

export const CATCHUP_ITEMS: CatchupItem[] = [
  catchup('cu-01', 'en-01', ['Project Scheduling', 'Earned Value', 'Analytics Workshop'], 6, 12, 'Multiple absences', null, 'overdue', '5 days ago'),
  catchup('cu-02', 'en-02', ['Risk Management', 'Cost Control'], 4, 8, 'Attendance issues', null, 'overdue', '3 days ago'),
  catchup('cu-03', 'en-08', ['Cost Control Workshop'], 2, 10, 'No show', null, 'overdue', '6 days ago'),
  catchup('cu-04', 'en-09', ['Brand Strategy'], 2, 5, 'IT issues', '14 Jun 2026', 'scheduled', '1 day ago'),
  catchup('cu-05', 'en-12', ['Market Research', 'Consumer Insight'], 5, 7, 'Annual leave', '15 Jun 2026', 'scheduled', '2 days ago'),
  catchup('cu-06', 'en-06', ['Financial Analysis', 'Reporting'], 4, 6, 'Missed sessions', null, 'overdue', '4 days ago'),
  catchup('cu-07', 'en-14', ['Campaign Planning'], 2, 2, 'Work commitment', '11 Jun 2026', 'scheduled', 'Today'),
  catchup('cu-08', 'en-16', ['Content Review', 'Agile Workshop'], 3, 4, 'Sick leave', '13 Jun 2026', 'scheduled', '1 day ago'),
  catchup('cu-09', 'en-05', ['Stakeholder Management'], 2, 3, 'Car breakdown', '12 Jun 2026', 'scheduled', 'Yesterday'),
  catchup('cu-10', 'en-10', ['Brand Strategy'], 2, 0, 'Medical appointment', '2 Jun 2026', 'completed', '5 days ago'),
  catchup('cu-11', 'en-11', ['Digital Strategy'], 2, 0, 'IT issues', '3 Jun 2026', 'completed', '4 days ago'),
];

// ---- FILTER HELPERS ----
export type ProgrammeFilterValue = 'all' | ProgrammeCode;

export function filterByProgramme<T extends { programmeCode: ProgrammeCode | '' }>(items: T[], active: ProgrammeFilterValue): T[] {
  return active === 'all' ? items : items.filter(i => i.programmeCode === active);
}

export function countByProgramme<T extends { programmeCode: ProgrammeCode | '' }>(items: T[]): Record<ProgrammeFilterValue, number> {
  const counts = { all: items.length, PCP: 0, APM: 0, MM: 0, ME: 0 } as Record<ProgrammeFilterValue, number>;
  for (const item of items) {
    if (item.programmeCode) counts[item.programmeCode]++;
  }
  return counts;
}
