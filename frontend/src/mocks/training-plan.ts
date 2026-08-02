/* ═══════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════ */
export type ActivityStatus = 'Completed' | 'In Progress' | 'Not Started' | 'overdue' | 'Referred' | 'Evidence Submitted' | 'Evidence Required';

export type ActivityType = 'Video' | 'Quiz' | 'Reading' | 'Podcast' | 'Evidence' | 'Reflection' | 'Activity' | 'monthly-coaching' | 'quarterly-review';

export interface TrainingActivity {
  id: string;
  title: string;
  type: ActivityType;
  status: ActivityStatus;
  typeIcon: string;
  duration: string;
  dueDate: string;
  plannedOTJH: number;
  actualOTJH: number;
  points: number;
  weekNumber: number;
  globalWeek: number;
  month: string;
  monthKey: string;
  weekLabel: string | null;
  isSpecial: boolean;
  isLive: boolean;
  ksbs: string[] | null;
  ksbCodes: string[];
  ksbLabels: string | null;
  assessmentMethod: string;
  primaryAction: string;
  primaryIcon: string;
  dateDueFormatted: string;
  teamsMeetingUrl: string | null;
  instructions: string | null;
  completeWhen: string | null;
  completedDate: string | null;
  evidenceSubmittedDate: string | null;
  coachApprovedDate: string | null;
  qaApprovedDate: string | null;
  otjhAwarded: number | null;
  pointsEarned: number | null;
  ksbsAchieved: string[];
  referralReason: string | null;
  referralSource: string | null;
  requiredActions: string | null;
  score?: number | null;
  coachFeedback: { text: string; from: string; date: string } | null;
  qaFeedback: { text: string; from: string; date: string } | null;
  aiFeedback: { score: number; summary: string; date?: string } | null;
}

export interface WeekGroup {
  weekNumber: number;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  completed: number;
  overdue: number;
  total: number;
  activities: TrainingActivity[];
}

export interface MonthGroup {
  monthKey: string;
  label: string;
  hasQuarterlyReview: boolean;
  weekGroups: WeekGroup[];
  activities: TrainingActivity[];
  completed: number;
  overdue: number;
  total: number;
}

/* ═══════════════════════════════════════════════════════
   ACTIVITY TYPE META
   ═══════════════════════════════════════════════════════ */
export const ACTIVITY_TYPE_META: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  Video: { label: 'Video', icon: 'ri-play-circle-line', bg: 'bg-red-50', color: 'text-red-600' },
  Quiz: { label: 'Quiz', icon: 'ri-questionnaire-line', bg: 'bg-amber-50', color: 'text-amber-600' },
  Reading: { label: 'Reading', icon: 'ri-book-open-line', bg: 'bg-blue-50', color: 'text-blue-600' },
  Podcast: { label: 'Podcast', icon: 'ri-headphone-line', bg: 'bg-violet-50', color: 'text-violet-600' },
  Evidence: { label: 'Evidence', icon: 'ri-file-add-line', bg: 'bg-emerald-50', color: 'text-emerald-600' },
  Reflection: { label: 'Reflection', icon: 'ri-brain-line', bg: 'bg-purple-50', color: 'text-purple-600' },
  Activity: { label: 'Activity', icon: 'ri-tools-line', bg: 'bg-orange-50', color: 'text-orange-600' },
  'monthly-coaching': { label: 'Coaching', icon: 'ri-user-voice-line', bg: 'bg-indigo-50', color: 'text-indigo-600' },
  'quarterly-review': { label: 'Review', icon: 'ri-dashboard-line', bg: 'bg-cyan-50', color: 'text-cyan-600' },
};

/* ═══════════════════════════════════════════════════════
   STATUS META
   ═══════════════════════════════════════════════════════ */
export const STATUS_META: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  Completed: { label: 'Done', bg: 'bg-emerald-100', color: 'text-emerald-700', dot: 'bg-emerald-500' },
  'In Progress': { label: 'Active', bg: 'bg-accent-100', color: 'text-accent-700', dot: 'bg-accent-500' },
  'Not Started': { label: 'Pending', bg: 'bg-background-100', color: 'text-foreground-500', dot: 'bg-foreground-300' },
  overdue: { label: 'Overdue', bg: 'bg-red-100', color: 'text-red-700', dot: 'bg-red-500' },
  Referred: { label: 'Referred', bg: 'bg-red-100', color: 'text-red-700', dot: 'bg-red-500' },
  'Evidence Submitted': { label: 'Submitted', bg: 'bg-amber-100', color: 'text-amber-700', dot: 'bg-amber-500' },
  'Evidence Required': { label: 'Evidence', bg: 'bg-amber-100', color: 'text-amber-700', dot: 'bg-amber-500' },
};

/* ═══════════════════════════════════════════════════════
   HELPER — build activity
   ═══════════════════════════════════════════════════════ */
const a = (
  id: string, title: string, type: ActivityType, status: ActivityStatus,
  typeIcon: string, duration: string, dueDate: string, plannedOTJH: number,
  actualOTJH: number, points: number, weekNumber: number, globalWeek: number,
  month: string, monthKey: string, weekLabel: string | null,
  isSpecial: boolean, isLive: boolean, ksbs: string[] | null, ksbLabels: string | null,
  assessmentMethod = 'standard', instructions: string | null = null,
  completeWhen: string | null = null,
  overrides: Partial<TrainingActivity> = {},
): TrainingActivity => ({
  id, title, type, status, typeIcon, duration, dueDate, plannedOTJH, actualOTJH, points,
  weekNumber, globalWeek, month, monthKey, weekLabel, isSpecial, isLive, ksbs, ksbCodes: ksbs || [], ksbLabels,
  assessmentMethod, instructions, completeWhen,
  primaryAction: defaultPrimaryAction(type, status),
  primaryIcon: defaultPrimaryIcon(type, status),
  dateDueFormatted: dueDate,
  teamsMeetingUrl: null,
  completedDate: null,
  evidenceSubmittedDate: null,
  coachApprovedDate: null,
  qaApprovedDate: null,
  otjhAwarded: null,
  pointsEarned: null,
  ksbsAchieved: [],
  referralReason: null,
  referralSource: null,
  requiredActions: null,
  score: null,
  coachFeedback: null,
  qaFeedback: null,
  aiFeedback: null,
  ...overrides,
});

/* ═══════════════════════════════════════════════════════
   TRAINING ACTIVITIES — all weeks
   ═══════════════════════════════════════════════════════ */
export const TRAINING_ACTIVITIES: TrainingActivity[] = [
  // ===== Month 1: Weeks 1-4 =====
  a('m1w1-v1', 'Introduction to Apprenticeship Standards', 'Video', 'Completed', 'ri-play-circle-line', '25 min', '26 May 2026', 0.5, 0.5, 10, 1, 1, 'Month 1', 'month-1', 'Week 1', false, false, ['K1', 'K2'], 'Knowledge of apprenticeship standards and professional conduct', 'standard'),
  a('m1w1-q1', 'Foundation Knowledge Check', 'Quiz', 'Completed', 'ri-questionnaire-line', '15 min', '26 May 2026', 0.25, 0.25, 5, 1, 1, 'Month 1', 'month-1', 'Week 1', false, false, ['K1'], null, 'standard'),
  a('m1w1-r1', 'Professional Practice Guide', 'Reading', 'Completed', 'ri-book-open-line', '40 min', '28 May 2026', 0.75, 0.75, 15, 1, 1, 'Month 1', 'month-1', 'Week 1', false, false, ['K3', 'B1'], 'Professional practice and conduct', 'standard'),
  a('m1w1-v2', 'KBC Platform Walkthrough', 'Video', 'Completed', 'ri-play-circle-line', '18 min', '28 May 2026', 0.5, 0.5, 10, 1, 1, 'Month 1', 'month-1', 'Week 1', false, false, ['K4'], null, 'standard'),
  a('m1w1-e1', 'Baseline Self-Assessment', 'Evidence', 'Completed', 'ri-file-add-line', '30 min', '30 May 2026', 0.5, 0.5, 20, 1, 1, 'Month 1', 'month-1', 'Week 1', false, false, ['K1', 'K2', 'S1'], 'Self-assessment of baseline knowledge', 'standard'),
  a('m1w2-v1', 'Marketing Fundamentals Overview', 'Video', 'Completed', 'ri-play-circle-line', '35 min', '02 Jun 2026', 0.75, 0.75, 15, 2, 2, 'Month 1', 'month-1', 'Week 2', false, false, ['K5', 'K6'], 'Marketing principles and fundamentals', 'standard'),
  a('m1w2-q1', 'Marketing Basics Quiz', 'Quiz', 'Completed', 'ri-questionnaire-line', '20 min', '02 Jun 2026', 0.5, 0.5, 5, 2, 2, 'Month 1', 'month-1', 'Week 2', false, false, ['K5'], null, 'standard'),
  a('m1w2-r1', 'The 7Ps Framework', 'Reading', 'Completed', 'ri-book-open-line', '45 min', '04 Jun 2026', 1, 1, 20, 2, 2, 'Month 1', 'month-1', 'Week 2', false, false, ['K7', 'K8'], 'Marketing mix application', 'standard'),
  a('m1w3-v1', 'Consumer Behaviour Models', 'Video', 'Completed', 'ri-play-circle-line', '28 min', '08 Jun 2026', 0.5, 0.5, 15, 3, 3, 'Month 1', 'month-1', 'Week 3', false, false, ['K9', 'K10'], 'Understanding consumer decision-making', 'standard'),
  a('m1w3-r1', 'Segmentation & Targeting Deep Dive', 'Reading', 'Completed', 'ri-book-open-line', '50 min', '10 Jun 2026', 1, 1, 20, 3, 3, 'Month 1', 'month-1', 'Week 3', false, false, ['K11', 'S2'], 'Market segmentation strategies', 'standard'),
  a('m1w3-p1', 'STP Framework Podcast', 'Podcast', 'Completed', 'ri-headphone-line', '22 min', '10 Jun 2026', 0.5, 0.5, 10, 3, 3, 'Month 1', 'month-1', 'Week 3', false, false, ['K11'], null, 'standard'),
  a('m1w4-v1', 'Week 4 Wrap-Up & Reflection', 'Video', 'Completed', 'ri-play-circle-line', '20 min', '15 Jun 2026', 0.5, 0.5, 10, 4, 4, 'Month 1', 'month-1', 'Week 4', false, false, ['K1', 'K2', 'B1', 'B2'], 'Reflection on month progress', 'standard'),
  a('m1w4-e1', 'Month 1 Evidence Portfolio', 'Evidence', 'Completed', 'ri-file-add-line', '60 min', '15 Jun 2026', 1, 1, 30, 4, 4, 'Month 1', 'month-1', 'Week 4', false, false, null, null, 'standard'),
  a('m1w4-q1', 'Month 1 Consolidation Quiz', 'Quiz', 'Completed', 'ri-questionnaire-line', '25 min', '15 Jun 2026', 0.5, 0.5, 10, 4, 4, 'Month 1', 'month-1', 'Week 4', false, false, null, null, 'standard'),
  // Month 1 special
  a('m1-coaching', 'Monthly 1-to-1 Coaching', 'monthly-coaching', 'Completed', 'ri-user-voice-line', '1 hr', '15 Jun 2026', 1, 1, 0, 4, 4, 'Month 1', 'month-1', 'Week 4', true, false, null, null, 'standard', null, null, { completedDate: '15 Jun 2026', pointsEarned: 25, otjhAwarded: 1 }),

  // ===== Month 2: Weeks 5-8 =====
  a('m2w5-v1', 'Market Research Methods', 'Video', 'Completed', 'ri-play-circle-line', '30 min', '20 Jun 2026', 0.75, 0.75, 15, 5, 5, 'Month 2', 'month-2', 'Week 5', false, false, ['K12', 'S3'], 'Quantitative and qualitative research', 'standard'),
  a('m2w5-r1', 'Survey Design Best Practices', 'Reading', 'Completed', 'ri-book-open-line', '40 min', '22 Jun 2026', 0.75, 0.75, 15, 5, 5, 'Month 2', 'month-2', 'Week 5', false, false, ['S4'], null, 'standard'),
  a('m2w5-q1', 'Research Methods Quiz', 'Quiz', 'Completed', 'ri-questionnaire-line', '15 min', '22 Jun 2026', 0.25, 0.25, 5, 5, 5, 'Month 2', 'month-2', 'Week 5', false, false, ['K12'], null, 'standard'),
  a('m2w6-v1', 'Data Collection & Analysis', 'Video', 'Completed', 'ri-play-circle-line', '35 min', '25 Jun 2026', 0.75, 0.75, 15, 6, 6, 'Month 2', 'month-2', 'Week 6', false, false, ['K13', 'S5'], 'Analysing market research data', 'standard'),
  a('m2w6-r1', 'Excel for Marketing Analysis', 'Activity', 'Completed', 'ri-tools-line', '60 min', '27 Jun 2026', 1, 1, 25, 6, 6, 'Month 2', 'month-2', 'Week 6', false, false, ['S6', 'S7'], null, 'standard'),
  a('m2w7-v1', 'Competitor Analysis Framework', 'Video', 'Completed', 'ri-play-circle-line', '25 min', '30 Jun 2026', 0.5, 0.5, 10, 7, 7, 'Month 2', 'month-2', 'Week 7', false, false, ['K14', 'K15'], 'SWOT, PESTLE and Porter\'s Five Forces', 'standard'),
  a('m2w7-p1', 'Industry Analysis Podcast', 'Podcast', 'Completed', 'ri-headphone-line', '20 min', '01 Jul 2026', 0.5, 0.5, 5, 7, 7, 'Month 2', 'month-2', 'Week 7', false, false, ['K14'], null, 'standard'),
  a('m2w8-e1', 'Market Research Report', 'Evidence', 'Completed', 'ri-file-add-line', '90 min', '07 Jul 2026', 2, 2, 40, 8, 8, 'Month 2', 'month-2', 'Week 8', false, false, ['K12', 'S3', 'S4', 'S5'], 'Written market research report', 'standard'),
  a('m2w8-q1', 'Month 2 Assessment', 'Quiz', 'Completed', 'ri-questionnaire-line', '25 min', '07 Jul 2026', 0.5, 0.5, 10, 8, 8, 'Month 2', 'month-2', 'Week 8', false, false, null, null, 'standard'),
  a('m2w8-r1', 'Reflective Practice: Market Research', 'Reflection', 'Completed', 'ri-brain-line', '30 min', '07 Jul 2026', 0.5, 0.5, 15, 8, 8, 'Month 2', 'month-2', 'Week 8', false, false, ['B2', 'B3'], 'Reflective practice on learning', 'standard'),
  a('m2-coaching', 'Monthly 1-to-1 Coaching', 'monthly-coaching', 'Completed', 'ri-user-voice-line', '1 hr', '07 Jul 2026', 1, 1, 0, 8, 8, 'Month 2', 'month-2', 'Week 8', true, false, null, null, 'standard'),

  // ===== Month 3: Weeks 9-12 =====
  a('m3w9-v1', 'Digital Marketing Landscape', 'Video', 'Completed', 'ri-play-circle-line', '35 min', '11 Jul 2026', 0.75, 0.75, 15, 9, 9, 'Month 3', 'month-3', 'Week 9', false, false, ['K16', 'K17'], 'Overview of digital marketing channels', 'standard'),
  a('m3w9-q1', 'Digital Channels Quiz', 'Quiz', 'Completed', 'ri-questionnaire-line', '15 min', '13 Jul 2026', 0.25, 0.25, 5, 9, 9, 'Month 3', 'month-3', 'Week 9', false, false, ['K16'], null, 'standard'),
  a('m3w9-r1', 'SEO Fundamentals Guide', 'Reading', 'Completed', 'ri-book-open-line', '45 min', '13 Jul 2026', 0.75, 0.75, 15, 9, 9, 'Month 3', 'month-3', 'Week 9', false, false, ['K18', 'S8'], 'Search engine optimisation basics', 'standard'),
  a('m3w10-v1', 'Content Marketing Strategy', 'Video', 'Completed', 'ri-play-circle-line', '30 min', '17 Jul 2026', 0.75, 0.75, 15, 10, 10, 'Month 3', 'month-3', 'Week 10', false, false, ['K19', 'S9'], 'Content strategy and planning', 'standard'),
  a('m3w10-r1', 'Social Media Best Practices', 'Reading', 'Completed', 'ri-book-open-line', '40 min', '19 Jul 2026', 0.75, 0.75, 15, 10, 10, 'Month 3', 'month-3', 'Week 10', false, false, ['K20', 'S10'], null, 'standard'),
  a('m3w11-v1', 'Email Marketing Essentials', 'Video', 'In Progress', 'ri-play-circle-line', '25 min', '23 Jul 2026', 0.5, 0, 10, 11, 11, 'Month 3', 'month-3', 'Week 11', false, false, ['K21', 'S11'], 'Email campaigns and automation', 'standard'),
  a('m3w11-e1', 'Email Campaign Draft', 'Evidence', 'In Progress', 'ri-file-add-line', '60 min', '25 Jul 2026', 1, 0, 25, 11, 11, 'Month 3', 'month-3', 'Week 11', false, false, ['S11'], null, 'standard'),
  a('m3w12-q1', 'Quarter 1 Final Assessment', 'Quiz', 'Not Started', 'ri-questionnaire-line', '30 min', '31 Jul 2026', 0.5, 0, 15, 12, 12, 'Month 3', 'month-3', 'Week 12', false, false, null, null, 'standard'),
  a('m3w12-e2', 'Q1 Evidence Compilation', 'Evidence', 'Evidence Required', 'ri-file-add-line', '90 min', '31 Jul 2026', 2, 0, 40, 12, 12, 'Month 3', 'month-3', 'Week 12', false, false, null, null, 'standard'),
  a('m3w12-r1', 'Q1 Reflective Summary', 'Reflection', 'Not Started', 'ri-brain-line', '40 min', '31 Jul 2026', 0.75, 0, 20, 12, 12, 'Month 3', 'month-3', 'Week 12', false, false, ['B2', 'B4'], null, 'standard'),
  a('m3-coaching', 'Monthly 1-to-1 Coaching', 'monthly-coaching', 'In Progress', 'ri-user-voice-line', '1 hr', '31 Jul 2026', 1, 0, 0, 12, 12, 'Month 3', 'month-3', 'Week 12', true, false, null, null, 'standard'),
  a('m3-review', 'Quarterly Progress Review', 'quarterly-review', 'In Progress', 'ri-dashboard-line', '1.5 hrs', '31 Jul 2026', 1.5, 0, 0, 12, 12, 'Month 3', 'month-3', 'Week 12', true, false, null, null, 'standard'),

  // ===== Month 4: Weeks 13-16 =====
  a('m4w13-v1', 'Campaign Planning Fundamentals', 'Video', 'In Progress', 'ri-play-circle-line', '30 min', '04 Aug 2026', 0.75, 0, 15, 13, 13, 'Month 4', 'month-4', 'Week 13', false, false, ['K22', 'K23'], 'Campaign planning cycle', 'standard'),
  a('m4w13-r1', 'Marketing Campaign Case Studies', 'Reading', 'In Progress', 'ri-book-open-line', '45 min', '06 Aug 2026', 0.75, 0, 15, 13, 13, 'Month 4', 'month-4', 'Week 13', false, false, ['K22'], null, 'standard'),
  a('m4w13-q1', 'Campaign Planning Quiz', 'Quiz', 'Not Started', 'ri-questionnaire-line', '15 min', '06 Aug 2026', 0.25, 0, 5, 13, 13, 'Month 4', 'month-4', 'Week 13', false, false, ['K22', 'K23'], null, 'standard'),
  a('m4w14-v1', 'Budget Planning for Campaigns', 'Video', 'Not Started', 'ri-play-circle-line', '28 min', '10 Aug 2026', 0.5, 0, 10, 14, 14, 'Month 4', 'month-4', 'Week 14', false, false, ['K24', 'S12'], 'Marketing budget allocation', 'standard'),
  a('m4w14-e1', 'Campaign Budget Exercise', 'Activity', 'Not Started', 'ri-tools-line', '50 min', '12 Aug 2026', 1, 0, 20, 14, 14, 'Month 4', 'month-4', 'Week 14', false, false, ['S12'], null, 'standard'),
  a('m4w15-v1', 'Creative Brief Development', 'Video', 'Not Started', 'ri-play-circle-line', '35 min', '17 Aug 2026', 0.75, 0, 15, 15, 15, 'Month 4', 'month-4', 'Week 15', false, false, ['K25', 'S13'], 'Writing effective creative briefs', 'standard'),
  a('m4w15-e2', 'Draft Creative Brief', 'Evidence', 'Not Started', 'ri-file-add-line', '60 min', '19 Aug 2026', 1, 0, 25, 15, 15, 'Month 4', 'month-4', 'Week 15', false, false, ['S13'], null, 'standard'),
  a('m4w16-v1', 'Marketing Mix Application', 'Video', 'Not Started', 'ri-play-circle-line', '30 min', '24 Aug 2026', 0.5, 0, 10, 16, 16, 'Month 4', 'month-4', 'Week 16', false, false, ['K26', 'K27'], 'Practical application of the 7Ps', 'standard'),
  a('m4w16-q1', 'Month 4 Assessment', 'Quiz', 'Not Started', 'ri-questionnaire-line', '20 min', '26 Aug 2026', 0.5, 0, 10, 16, 16, 'Month 4', 'month-4', 'Week 16', false, false, null, null, 'standard'),
  a('m4-coaching', 'Monthly 1-to-1 Coaching', 'monthly-coaching', 'Not Started', 'ri-user-voice-line', '1 hr', '26 Aug 2026', 1, 0, 0, 16, 16, 'Month 4', 'month-4', 'Week 16', true, false, null, null, 'standard'),

  // ===== Month 5: Weeks 17-20 =====
  a('m5w17-v1', 'Digital Analytics Introduction', 'Video', 'Not Started', 'ri-play-circle-line', '35 min', '31 Aug 2026', 0.75, 0, 15, 17, 17, 'Month 5', 'month-5', 'Week 17', false, false, ['K28', 'S14'], 'Web analytics and reporting', 'standard'),
  a('m5w17-r1', 'Google Analytics 4 Guide', 'Reading', 'Not Started', 'ri-book-open-line', '50 min', '02 Sep 2026', 1, 0, 20, 17, 17, 'Month 5', 'month-5', 'Week 17', false, false, ['S14', 'S15'], null, 'standard'),
  a('m5w18-v1', 'Paid Advertising Overview', 'Video', 'In Progress', 'ri-play-circle-line', '30 min', '07 Sep 2026', 0.5, 0, 10, 18, 18, 'Month 5', 'month-5', 'Week 18', false, false, ['K29', 'K30'], 'PPC, display and social ads', 'standard'),
  a('m5w18-q1', 'Paid Media Quiz', 'Quiz', 'Not Started', 'ri-questionnaire-line', '15 min', '09 Sep 2026', 0.25, 0, 5, 18, 18, 'Month 5', 'month-5', 'Week 18', false, false, ['K29'], null, 'standard'),
  a('m5w19-v1', 'Marketing Metrics & KPIs', 'Video', 'Not Started', 'ri-play-circle-line', '28 min', '14 Sep 2026', 0.5, 0, 10, 19, 19, 'Month 5', 'month-5', 'Week 19', false, false, ['K31', 'S16'], 'Measuring marketing effectiveness', 'standard'),
  a('m5w19-e1', 'KPI Dashboard Exercise', 'Activity', 'Not Started', 'ri-tools-line', '60 min', '16 Sep 2026', 1, 0, 25, 19, 19, 'Month 5', 'month-5', 'Week 19', false, false, ['S16'], null, 'standard'),
  a('m5w20-v1', 'Campaign Measurement Frameworks', 'Video', 'Not Started', 'ri-play-circle-line', '25 min', '21 Sep 2026', 0.5, 0, 10, 20, 20, 'Month 5', 'month-5', 'Week 20', false, false, ['K32', 'S17'], 'ROI and attribution models', 'standard'),
  a('m5w20-r1', 'Campaign Case Study Analysis', 'Reading', 'Not Started', 'ri-book-open-line', '45 min', '23 Sep 2026', 0.75, 0, 15, 20, 20, 'Month 5', 'month-5', 'Week 20', false, false, ['K31', 'K32'], null, 'standard'),
  a('m5w20-e2', 'Draft Campaign Measurement Plan', 'Evidence', 'Not Started', 'ri-file-add-line', '75 min', '23 Sep 2026', 1.5, 0, 30, 20, 20, 'Month 5', 'month-5', 'Week 20', false, false, null, null, 'standard'),
  a('m5-coaching', 'Monthly 1-to-1 Coaching', 'monthly-coaching', 'Not Started', 'ri-user-voice-line', '1 hr', '23 Sep 2026', 1, 0, 0, 20, 20, 'Month 5', 'month-5', 'Week 20', true, false, null, null, 'standard'),
];

/* ═══════════════════════════════════════════════════════
   BUILD WEEK GROUPS + MONTH GROUPS
   ═══════════════════════════════════════════════════════ */
interface WeekGroupStats {
  completed: number;
  overdue: number;
  total: number;
}

function defaultPrimaryAction(type: ActivityType, status: ActivityStatus): string {
  if (status === 'Completed') return 'View Summary';
  if (status === 'Evidence Submitted') return 'View Submission';
  if (status === 'Referred') return 'Update Submission';
  if (status === 'Evidence Required') return 'Log Evidence';
  if (status === 'In Progress') {
    if (type === 'Quiz') return 'Continue Quiz';
    if (type === 'Reading') return 'Continue Reading';
    if (type === 'Podcast') return 'Continue Listening';
    if (type === 'Video') return 'Continue Watching';
    return 'Continue Learning';
  }
  if (type === 'Quiz') return 'Take Quiz';
  if (type === 'Reading') return 'Read';
  if (type === 'Podcast') return 'Listen';
  if (type === 'Video') return 'Watch Video';
  if (type === 'Evidence') return 'Log Evidence';
  if (type === 'Reflection') return 'Start Reflection';
  return 'Start Activity';
}

function defaultPrimaryIcon(type: ActivityType, status: ActivityStatus): string {
  if (status === 'Completed' || status === 'Evidence Submitted') return 'ri-file-list-line';
  if (status === 'Referred') return 'ri-edit-line';
  if (status === 'Evidence Required') return 'ri-file-add-line';
  if (type === 'Quiz') return 'ri-questionnaire-line';
  if (type === 'Reading') return 'ri-book-open-line';
  if (type === 'Podcast') return 'ri-headphone-line';
  if (type === 'Video') return 'ri-play-circle-line';
  if (type === 'Reflection') return 'ri-chat-quote-line';
  return 'ri-task-line';
}

function calculateWeekGroup(acts: TrainingActivity[]): WeekGroupStats {
  const nonSpecial = acts.filter(x => !x.isSpecial);
  return {
    completed: nonSpecial.filter(x => x.status === 'Completed').length,
    overdue: nonSpecial.filter(x => x.status === 'overdue' || x.status === 'Referred').length,
    total: nonSpecial.length,
  };
}

function weekLabelFor(w: number, monthWeeks: number[]): string | null {
  return `Week ${w}`;
}

const MONTH_DEFS: { monthKey: string; label: string; hasQuarterlyReview: boolean; weekStart: number; weekEnd: number; weekStarts: string[]; weekEnds: string[] }[] = [
  { monthKey: 'month-1', label: 'Month 1', hasQuarterlyReview: false, weekStart: 1, weekEnd: 4, weekStarts: ['22 May', '30 May', '06 Jun', '12 Jun'], weekEnds: ['29 May', '05 Jun', '11 Jun', '15 Jun'] },
  { monthKey: 'month-2', label: 'Month 2', hasQuarterlyReview: false, weekStart: 5, weekEnd: 8, weekStarts: ['18 Jun', '24 Jun', '29 Jun', '04 Jul'], weekEnds: ['23 Jun', '28 Jun', '03 Jul', '07 Jul'] },
  { monthKey: 'month-3', label: 'Month 3', hasQuarterlyReview: true, weekStart: 9, weekEnd: 12, weekStarts: ['10 Jul', '15 Jul', '22 Jul', '28 Jul'], weekEnds: ['14 Jul', '21 Jul', '27 Jul', '31 Jul'] },
  { monthKey: 'month-4', label: 'Month 4', hasQuarterlyReview: false, weekStart: 13, weekEnd: 16, weekStarts: ['03 Aug', '09 Aug', '16 Aug', '23 Aug'], weekEnds: ['08 Aug', '15 Aug', '22 Aug', '26 Aug'] },
  { monthKey: 'month-5', label: 'Month 5', hasQuarterlyReview: false, weekStart: 17, weekEnd: 20, weekStarts: ['30 Aug', '06 Sep', '13 Sep', '20 Sep'], weekEnds: ['05 Sep', '12 Sep', '19 Sep', '23 Sep'] },
];

export const TRAINING_MONTH_GROUPS: MonthGroup[] = MONTH_DEFS.map(mdef => {
  const wgList: WeekGroup[] = [];
  const allActivities: TrainingActivity[] = [];

  for (let wk = mdef.weekStart; wk <= mdef.weekEnd; wk++) {
    const weekActs = TRAINING_ACTIVITIES.filter(x => x.globalWeek === wk);
    const stats = calculateWeekGroup(weekActs);
    const wsIdx = wk - mdef.weekStart;
    wgList.push({
      weekNumber: wk,
      weekLabel: `Week ${wk}`,
      weekStart: mdef.weekStarts[wsIdx] || `Week ${wk} Start`,
      weekEnd: mdef.weekEnds[wsIdx] || `Week ${wk} End`,
      completed: stats.completed,
      overdue: stats.overdue,
      total: stats.total,
      activities: weekActs,
    });
    allActivities.push(...weekActs);
  }

  const stats = calculateWeekGroup(allActivities);

  return {
    monthKey: mdef.monthKey,
    label: mdef.label,
    hasQuarterlyReview: mdef.hasQuarterlyReview,
    weekGroups: wgList,
    activities: allActivities,
    completed: stats.completed,
    overdue: stats.overdue,
    total: stats.total,
  };
});

export const CURRENT_GLOBAL_WEEK = 20;
export const TOTAL_WEEKS = 20;

type WeekDetailKsbType = 'Knowledge' | 'Skill' | 'Behaviour';
type WeekDetailDeadlinePriority = 'completed' | 'today' | 'due-this-week' | 'upcoming';

interface WeekDetailKsb {
  code: string;
  type: WeekDetailKsbType;
  desc: string;
  progress: number;
  components: string[];
}

interface WeekDetailDeadline {
  title: string;
  date: string;
  priority: WeekDetailDeadlinePriority;
}

interface WeekDetailResource {
  title: string;
  type: 'Video' | 'Reading' | 'Podcast' | 'Template' | 'Download' | 'Recording';
  description: string;
  href: string;
  icon: string;
}

interface WeekDetailGuidance {
  notes: string;
  suggestedFocus: string;
  supportAvailable: string;
}

interface WeekDetailData {
  activities: TrainingActivity[];
  stats: WeekGroupStats;
  components: TrainingActivity[];
  modulePeriod: {
    label: string;
    liveTitle: string;
  };
  dateRange: {
    start: string;
    end: string;
  };
  ksbs: WeekDetailKsb[];
  deadlines: WeekDetailDeadline[];
  resources: WeekDetailResource[];
  tutorGuidance: WeekDetailGuidance;
  coachGuidance: WeekDetailGuidance;
}

function ksbTypeFromCode(code: string): WeekDetailKsbType {
  if (code.startsWith('S')) return 'Skill';
  if (code.startsWith('B')) return 'Behaviour';
  return 'Knowledge';
}

function ksbDescription(code: string, type: WeekDetailKsbType) {
  if (type === 'Skill') return `${code} is developed through this week's applied learning activities.`;
  if (type === 'Behaviour') return `${code} is reinforced through reflection, practice, and evidence building this week.`;
  return `${code} is covered through this week's knowledge and understanding activities.`;
}

function resourceTypeForActivity(activity: TrainingActivity): WeekDetailResource['type'] {
  if (activity.type === 'Video') return 'Video';
  if (activity.type === 'Reading') return 'Reading';
  if (activity.type === 'Podcast') return 'Podcast';
  if (activity.type === 'Quiz') return 'Download';
  if (activity.type === 'Evidence' || activity.type === 'Activity' || activity.type === 'Reflection') return 'Template';
  return 'Recording';
}

function weekGroupForNumber(weekNum: number) {
  return TRAINING_MONTH_GROUPS
    .flatMap((month) => month.weekGroups)
    .find((week) => week.weekNumber === weekNum) || null;
}

function deadlinePriorityForActivity(activity: TrainingActivity, index: number): WeekDetailDeadlinePriority {
  if (activity.status === 'Completed') return 'completed';
  if (activity.status === 'overdue' || activity.status === 'Referred') return 'due-this-week';
  if (index === 0 || activity.status === 'In Progress' || activity.status === 'Evidence Required' || activity.status === 'Evidence Submitted') {
    return 'today';
  }
  return 'upcoming';
}

export function getWeekData(weekNum: number): WeekDetailData {
  const acts = TRAINING_ACTIVITIES.filter((x) => x.globalWeek === weekNum);
  const stats = calculateWeekGroup(acts);
  const weekGroup = weekGroupForNumber(weekNum);
  const modulePeriodMatch = MODULE_PERIODS.find((period) => weekNum >= period.weeksStart && weekNum <= period.weeksEnd);
  const moduleLabel = modulePeriodMatch?.label || `Week ${weekNum} Learning`;
  const dateRange = {
    start: weekGroup?.weekStart || `Week ${weekNum} Start`,
    end: weekGroup?.weekEnd || `Week ${weekNum} End`,
  };
  const nonSpecialActivities = acts.filter((activity) => !activity.isSpecial);
  const ksbCodes = Array.from(new Set(nonSpecialActivities.flatMap((activity) => activity.ksbs || [])));
  const completedStates = new Set(['Completed', 'Evidence Submitted']);

  const ksbs: WeekDetailKsb[] = ksbCodes.map((code) => {
    const mappedActivities = nonSpecialActivities.filter((activity) => (activity.ksbs || []).includes(code));
    const completedActivities = mappedActivities.filter((activity) => completedStates.has(activity.status)).length;
    const type = ksbTypeFromCode(code);
    return {
      code,
      type,
      desc: ksbDescription(code, type),
      progress: mappedActivities.length > 0 ? Math.round((completedActivities / mappedActivities.length) * 100) : 0,
      components: mappedActivities.map((activity) => activity.title),
    };
  });

  const deadlines: WeekDetailDeadline[] = nonSpecialActivities.map((activity, index) => ({
    title: activity.title,
    date: activity.dueDate,
    priority: deadlinePriorityForActivity(activity, index),
  }));

  const resources: WeekDetailResource[] = nonSpecialActivities.slice(0, 6).map((activity) => ({
    title: activity.title,
    type: resourceTypeForActivity(activity),
    description: activity.ksbLabels || activity.instructions || `${activity.type} resource linked to ${moduleLabel}.`,
    href: '#',
    icon: activity.typeIcon,
  }));

  return {
    activities: acts,
    stats,
    components: acts,
    modulePeriod: {
      label: moduleLabel,
      liveTitle: `${moduleLabel} - Week ${weekNum}`,
    },
    dateRange,
    ksbs,
    deadlines,
    resources,
    tutorGuidance: {
      notes: `Focus on the key outcomes for ${moduleLabel} and use the weekly activities to build confidence before the next review.`,
      suggestedFocus: nonSpecialActivities[0]?.title || `Complete the priority activities scheduled for Week ${weekNum}.`,
      supportAvailable: 'Use the learning resources, bring blockers to your tutor, and ask for clarification on any technical concepts.',
    },
    coachGuidance: {
      notes: `Keep your OTJH up to date and link your evidence clearly to the skills and knowledge covered in ${moduleLabel}.`,
      suggestedFocus: nonSpecialActivities.find((activity) => activity.status !== 'Completed')?.title || `Reflect on what you completed in Week ${weekNum}.`,
      supportAvailable: 'Your coach can help with planning, pacing, evidence strategy, and any barriers affecting progress this week.',
    },
  };
}

/* ═══════════════════════════════════════════════════════
   MODULE PERIODS — for evidence mapping
   ═══════════════════════════════════════════════════════ */
export const MODULE_PERIODS = [
  { label: 'Induction', weeksStart: 1, weeksEnd: 4, ksbCodes: ['K1', 'K2', 'K3', 'K4', 'S1', 'B1', 'B2'] },
  { label: 'Marketing Fundamentals', weeksStart: 5, weeksEnd: 8, ksbCodes: ['K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11', 'S2', 'S3'] },
  { label: 'Marketing Environment', weeksStart: 9, weeksEnd: 12, ksbCodes: ['K12', 'K13', 'K14', 'K15', 'K16', 'S4', 'S5', 'S6', 'S7'] },
  { label: 'Consumer Behaviour', weeksStart: 13, weeksEnd: 16, ksbCodes: ['K17', 'K18', 'K19', 'K20', 'S8', 'S9', 'S10', 'B3'] },
  { label: 'Digital Marketing', weeksStart: 17, weeksEnd: 20, ksbCodes: ['K21', 'K22', 'K23', 'K24', 'S11', 'S12', 'S13', 'B4'] },
  { label: 'Campaign Planning', weeksStart: 21, weeksEnd: 28, ksbCodes: ['K25', 'K26', 'K27', 'S14', 'S15', 'B5'] },
  { label: 'Content & Creative', weeksStart: 29, weeksEnd: 36, ksbCodes: ['K28', 'K29', 'S16', 'S17', 'B6', 'B7'] },
  { label: 'Analytics & Data', weeksStart: 37, weeksEnd: 44, ksbCodes: ['K30', 'K31', 'K32', 'S18', 'S19', 'B8'] },
  { label: 'Strategy & Leadership', weeksStart: 45, weeksEnd: 52, ksbCodes: ['K33', 'K34', 'S20', 'S21', 'B9', 'B10'] },
  { label: 'Gateway Prep', weeksStart: 53, weeksEnd: 60, ksbCodes: ['K35', 'K36', 'S22', 'B11', 'B12'] },
];
