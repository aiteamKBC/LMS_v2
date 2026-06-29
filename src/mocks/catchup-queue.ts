// ── Catch-up Queue: Rich Mock Data ──

export interface CatchUpItem {
  id: string;
  learner: string;
  initials: string;
  programme: string;
  cohort: string;
  missedSession: string;
  missedDate: string;
  missedDateIso: string;
  catchupDate: string;
  catchupDateIso: string;
  tutor: string;
  status: 'scheduled' | 'overdue' | 'completed';
  priority: 'high' | 'medium' | 'low';
  notes: string;
  overallProgress: number;
  attendance: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  employer: string;
  group: string;
  evidenceSubmitted: boolean;
  evidenceApproved: boolean;
  reason: string;
  catchupRoute: string;
  daysOverdue: number;
  completedDate: string;
  completedDateIso: string;
}

export const CATCHUP_QUEUE: CatchUpItem[] = [
  { id: 'cu-1', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', missedSession: 'Data Visualisation', missedDate: '5 Jun 2026', missedDateIso: '2026-06-05', catchupDate: '12 Jun 2026', catchupDateIso: '2026-06-12', tutor: 'Dr. Helen Park', status: 'scheduled', priority: 'high', notes: 'Second absence this month', overallProgress: 28, attendance: 78, otjhCompleted: 22, otjhTarget: 100, ksbProgress: 25, employer: 'Medway NHS Trust', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Employer meeting conflict', catchupRoute: 'Coach-Supported Activity', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', missedSession: 'Data Ethics', missedDate: '29 May 2026', missedDateIso: '2026-05-29', catchupDate: '10 Jun 2026', catchupDateIso: '2026-06-10', tutor: 'Dr. Helen Park', status: 'overdue', priority: 'high', notes: 'Overdue by 4 days', overallProgress: 28, attendance: 78, otjhCompleted: 22, otjhTarget: 100, ksbProgress: 25, employer: 'Medway NHS Trust', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Illness — now recovered', catchupRoute: 'Recording + Reflection', daysOverdue: 4, completedDate: '', completedDateIso: '' },
  { id: 'cu-3', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', cohort: 'Cohort A — Marketing', missedSession: 'Marketing Environment', missedDate: '2 Jun 2026', missedDateIso: '2026-06-02', catchupDate: '16 Jun 2026', catchupDateIso: '2026-06-16', tutor: 'Crispin Jones', status: 'scheduled', priority: 'medium', notes: 'Employer meeting conflict', overallProgress: 72, attendance: 86, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 65, employer: 'Tim Hortons UK', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Employer meeting conflict', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-4', learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', cohort: 'Cohort C — Finance', missedSession: 'Taxation Module', missedDate: '1 Jun 2026', missedDateIso: '2026-06-01', catchupDate: '15 Jun 2026', catchupDateIso: '2026-06-15', tutor: 'Rachel Myers', status: 'scheduled', priority: 'medium', notes: 'Annual leave', overallProgress: 68, attendance: 83, otjhCompleted: 30, otjhTarget: 100, ksbProgress: 62, employer: 'Ashford Accounting', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Annual leave', catchupRoute: 'Coach-Supported Activity', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-5', learner: 'Finn Murphy', initials: 'FM', programme: 'Project Manager L4', cohort: 'Cohort C — Finance', missedSession: 'Risk Management', missedDate: '28 May 2026', missedDateIso: '2026-05-28', catchupDate: '11 Jun 2026', catchupDateIso: '2026-06-11', tutor: 'Rachel Myers', status: 'overdue', priority: 'high', notes: 'Illness — now recovered', overallProgress: 33, attendance: 76, otjhCompleted: 34, otjhTarget: 100, ksbProgress: 28, employer: 'BAM Construction', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Illness — now recovered', catchupRoute: 'Recording + Reflection', daysOverdue: 5, completedDate: '', completedDateIso: '' },
  { id: 'cu-6', learner: 'Zara Khan', initials: 'ZK', programme: 'Marketing Executive L4', cohort: 'Cohort A — Marketing', missedSession: 'Campaign Targeting', missedDate: '4 Jun 2026', missedDateIso: '2026-06-04', catchupDate: '18 Jun 2026', catchupDateIso: '2026-06-18', tutor: 'Crispin Jones', status: 'scheduled', priority: 'low', notes: 'Scheduling conflict', overallProgress: 75, attendance: 88, otjhCompleted: 70, otjhTarget: 120, ksbProgress: 68, employer: 'Tim Hortons UK', group: 'Group B', evidenceSubmitted: false, evidenceApproved: false, reason: 'Scheduling conflict', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-7', learner: 'Omar Hassan', initials: 'OH', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', missedSession: 'SQL Fundamentals', missedDate: '1 Jun 2026', missedDateIso: '2026-06-01', catchupDate: '14 Jun 2026', catchupDateIso: '2026-06-14', tutor: 'Dr. Helen Park', status: 'overdue', priority: 'medium', notes: 'Family emergency', overallProgress: 60, attendance: 82, otjhCompleted: 45, otjhTarget: 100, ksbProgress: 55, employer: 'Medway NHS Trust', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Family emergency', catchupRoute: 'Coach-Supported Activity', daysOverdue: 3, completedDate: '', completedDateIso: '' },
  { id: 'cu-8', learner: 'Finn Murphy', initials: 'FM', programme: 'Project Manager L4', cohort: 'Cohort C — Finance', missedSession: 'Stakeholder Analysis', missedDate: '22 May 2026', missedDateIso: '2026-05-22', catchupDate: '5 Jun 2026', catchupDateIso: '2026-06-05', tutor: 'Rachel Myers', status: 'completed', priority: 'medium', notes: 'Completed catch-up', overallProgress: 33, attendance: 76, otjhCompleted: 34, otjhTarget: 100, ksbProgress: 28, employer: 'BAM Construction', group: 'Group A', evidenceSubmitted: true, evidenceApproved: true, reason: 'Illness — now recovered', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '5 Jun 2026', completedDateIso: '2026-06-05' },
  { id: 'cu-9', learner: 'Noah Blake', initials: 'NB', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', missedSession: 'Data Cleaning', missedDate: '2 Jun 2026', missedDateIso: '2026-06-02', catchupDate: '16 Jun 2026', catchupDateIso: '2026-06-16', tutor: 'Dr. Helen Park', status: 'overdue', priority: 'high', notes: 'Third missed session this month', overallProgress: 22, attendance: 72, otjhCompleted: 18, otjhTarget: 100, ksbProgress: 20, employer: 'Medway NHS Trust', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Personal emergency', catchupRoute: 'Recording + Reflection', daysOverdue: 2, completedDate: '', completedDateIso: '' },
  { id: 'cu-10', learner: 'Eva Rossi', initials: 'ER', programme: 'Accountancy L3', cohort: 'Cohort C — Finance', missedSession: 'Financial Reporting', missedDate: '5 Jun 2026', missedDateIso: '2026-06-05', catchupDate: '19 Jun 2026', catchupDateIso: '2026-06-19', tutor: 'Rachel Myers', status: 'scheduled', priority: 'medium', notes: 'Bank holiday', overallProgress: 65, attendance: 85, otjhCompleted: 45, otjhTarget: 100, ksbProgress: 58, employer: 'Ashford Accounting', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Bank holiday', catchupRoute: 'Coach-Supported Activity', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-11', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', cohort: 'Cohort A — Marketing', missedSession: 'Office Systems', missedDate: '10 Jun 2026', missedDateIso: '2026-06-10', catchupDate: '17 Jun 2026', catchupDateIso: '2026-06-17', tutor: 'Crispin Jones', status: 'scheduled', priority: 'low', notes: 'Dental appointment', overallProgress: 88, attendance: 94, otjhCompleted: 95, otjhTarget: 110, ksbProgress: 82, employer: 'Canterbury Creative', group: 'Group B', evidenceSubmitted: false, evidenceApproved: false, reason: 'Dental appointment', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-12', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', cohort: 'Cohort C — Finance', missedSession: 'Project Planning', missedDate: '3 Jun 2026', missedDateIso: '2026-06-03', catchupDate: '17 Jun 2026', catchupDateIso: '2026-06-17', tutor: 'Rachel Myers', status: 'overdue', priority: 'medium', notes: 'Car breakdown', overallProgress: 80, attendance: 91, otjhCompleted: 82, otjhTarget: 100, ksbProgress: 76, employer: 'BAM Construction', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Car breakdown', catchupRoute: 'Coach-Supported Activity', daysOverdue: 1, completedDate: '', completedDateIso: '' },
  { id: 'cu-13', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', cohort: 'Cohort B — Data & Tech', missedSession: 'API Development', missedDate: '8 Jun 2026', missedDateIso: '2026-06-08', catchupDate: '22 Jun 2026', catchupDateIso: '2026-06-22', tutor: 'Dr. Helen Park', status: 'scheduled', priority: 'low', notes: 'Jury duty', overallProgress: 85, attendance: 94, otjhCompleted: 88, otjhTarget: 100, ksbProgress: 78, employer: 'Tech Kent Ltd', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Jury duty', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-14', learner: 'Chloe Price', initials: 'CP', programme: 'Digital Marketer L3', cohort: 'Cohort A — Marketing', missedSession: 'SEO Fundamentals', missedDate: '6 Jun 2026', missedDateIso: '2026-06-06', catchupDate: '20 Jun 2026', catchupDateIso: '2026-06-20', tutor: 'Crispin Jones', status: 'scheduled', priority: 'medium', notes: 'Family event', overallProgress: 90, attendance: 96, otjhCompleted: 98, otjhTarget: 110, ksbProgress: 85, employer: 'Kent Digital Agency', group: 'Group B', evidenceSubmitted: false, evidenceApproved: false, reason: 'Family event', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-15', learner: 'Lucas Zhang', initials: 'LZ', programme: 'Software Developer L4', cohort: 'Cohort B — Data & Tech', missedSession: 'Testing & QA', missedDate: '5 Jun 2026', missedDateIso: '2026-06-05', catchupDate: '19 Jun 2026', catchupDateIso: '2026-06-19', tutor: 'Dr. Helen Park', status: 'overdue', priority: 'high', notes: 'Repeated absence — needs review', overallProgress: 78, attendance: 90, otjhCompleted: 72, otjhTarget: 100, ksbProgress: 70, employer: 'Tech Kent Ltd', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Personal emergency', catchupRoute: 'Coach-Supported Activity', daysOverdue: 2, completedDate: '', completedDateIso: '' },
  { id: 'cu-16', learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', cohort: 'Cohort D — HR', missedSession: 'Employment Law', missedDate: '1 Jun 2026', missedDateIso: '2026-06-01', catchupDate: '15 Jun 2026', catchupDateIso: '2026-06-15', tutor: 'Rachel Myers', status: 'completed', priority: 'low', notes: 'Completed ahead of deadline', overallProgress: 95, attendance: 100, otjhCompleted: 55, otjhTarget: 120, ksbProgress: 88, employer: 'Canterbury NHS', group: 'Group A', evidenceSubmitted: true, evidenceApproved: true, reason: 'Annual leave', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '10 Jun 2026', completedDateIso: '2026-06-10' },
  { id: 'cu-17', learner: 'Isla Morgan', initials: 'IM', programme: 'Business Administrator L3', cohort: 'Cohort A — Marketing', missedSession: 'Communication Skills', missedDate: '9 Jun 2026', missedDateIso: '2026-06-09', catchupDate: '23 Jun 2026', catchupDateIso: '2026-06-23', tutor: 'Crispin Jones', status: 'scheduled', priority: 'low', notes: 'Workplace project deadline', overallProgress: 93, attendance: 97, otjhCompleted: 102, otjhTarget: 110, ksbProgress: 88, employer: 'Canterbury Creative', group: 'Group B', evidenceSubmitted: false, evidenceApproved: false, reason: 'Workplace project deadline', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-18', learner: 'Theo Bennett', initials: 'TB', programme: 'HR Consultant L5', cohort: 'Cohort D — HR', missedSession: 'Conflict Resolution', missedDate: '7 Jun 2026', missedDateIso: '2026-06-07', catchupDate: '21 Jun 2026', catchupDateIso: '2026-06-21', tutor: 'Rachel Myers', status: 'scheduled', priority: 'medium', notes: 'Conference attendance', overallProgress: 92, attendance: 98, otjhCompleted: 60, otjhTarget: 120, ksbProgress: 85, employer: 'Canterbury NHS', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Conference attendance', catchupRoute: 'Coach-Supported Activity', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-19', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', cohort: 'Cohort A — Marketing', missedSession: 'Analytics Dashboard', missedDate: '12 Jun 2026', missedDateIso: '2026-06-12', catchupDate: '26 Jun 2026', catchupDateIso: '2026-06-26', tutor: 'Crispin Jones', status: 'scheduled', priority: 'low', notes: 'Moving house', overallProgress: 92, attendance: 100, otjhCompleted: 105, otjhTarget: 110, ksbProgress: 90, employer: 'Kent Digital Agency', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Moving house', catchupRoute: 'Recording + Reflection', daysOverdue: 0, completedDate: '', completedDateIso: '' },
  { id: 'cu-20', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', missedSession: 'Machine Learning Intro', missedDate: '12 Jun 2026', missedDateIso: '2026-06-12', catchupDate: '26 Jun 2026', catchupDateIso: '2026-06-26', tutor: 'Dr. Helen Park', status: 'scheduled', priority: 'high', notes: 'Fourth absence this month — escalation triggered', overallProgress: 28, attendance: 78, otjhCompleted: 22, otjhTarget: 100, ksbProgress: 25, employer: 'Medway NHS Trust', group: 'Group A', evidenceSubmitted: false, evidenceApproved: false, reason: 'Employer meeting conflict', catchupRoute: 'Coach-Supported Activity', daysOverdue: 0, completedDate: '', completedDateIso: '' },
];

export interface WeeklyTrendPoint {
  week: string;
  month: string;
  scheduled: number;
  overdue: number;
  completed: number;
}

export const WEEKLY_CATCHUP_TREND: WeeklyTrendPoint[] = [
  { week: 'W19', month: 'May', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W20', month: 'May', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W21', month: 'May', scheduled: 2, overdue: 1, completed: 4 },
  { week: 'W22', month: 'May', scheduled: 3, overdue: 3, completed: 2 },
  { week: 'W23', month: 'Jun', scheduled: 4, overdue: 2, completed: 3 },
  { week: 'W24', month: 'Jun', scheduled: 3, overdue: 4, completed: 2 },
  { week: 'W25', month: 'Jun', scheduled: 5, overdue: 3, completed: 1 },
  { week: 'W26', month: 'Jun', scheduled: 4, overdue: 2, completed: 3 },
  { week: 'W27', month: 'Jun', scheduled: 3, overdue: 1, completed: 4 },
  { week: 'W28', month: 'Jul', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W29', month: 'Jul', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W30', month: 'Jul', scheduled: 4, overdue: 1, completed: 3 },
  { week: 'W31', month: 'Jul', scheduled: 3, overdue: 2, completed: 4 },
  { week: 'W32', month: 'Aug', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W33', month: 'Aug', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W34', month: 'Aug', scheduled: 4, overdue: 1, completed: 3 },
  { week: 'W35', month: 'Aug', scheduled: 3, overdue: 2, completed: 4 },
  { week: 'W36', month: 'Sep', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W37', month: 'Sep', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W38', month: 'Sep', scheduled: 4, overdue: 1, completed: 3 },
  { week: 'W39', month: 'Sep', scheduled: 3, overdue: 2, completed: 4 },
  { week: 'W40', month: 'Oct', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W41', month: 'Oct', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W42', month: 'Oct', scheduled: 4, overdue: 1, completed: 3 },
  { week: 'W43', month: 'Oct', scheduled: 3, overdue: 2, completed: 4 },
  { week: 'W44', month: 'Oct', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W45', month: 'Nov', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W46', month: 'Nov', scheduled: 4, overdue: 1, completed: 3 },
  { week: 'W47', month: 'Nov', scheduled: 3, overdue: 2, completed: 4 },
  { week: 'W48', month: 'Nov', scheduled: 2, overdue: 1, completed: 3 },
  { week: 'W49', month: 'Dec', scheduled: 3, overdue: 2, completed: 2 },
  { week: 'W50', month: 'Dec', scheduled: 4, overdue: 1, completed: 3 },
  { week: 'W51', month: 'Dec', scheduled: 3, overdue: 2, completed: 4 },
  { week: 'W52', month: 'Dec', scheduled: 2, overdue: 1, completed: 3 },
];

export const MONTHLY_CATCHUP_TREND: WeeklyTrendPoint[] = [
  { week: 'Jan', month: 'Jan', scheduled: 8, overdue: 4, completed: 12 },
  { week: 'Feb', month: 'Feb', scheduled: 10, overdue: 5, completed: 14 },
  { week: 'Mar', month: 'Mar', scheduled: 9, overdue: 6, completed: 13 },
  { week: 'Apr', month: 'Apr', scheduled: 11, overdue: 4, completed: 15 },
  { week: 'May', month: 'May', scheduled: 12, overdue: 7, completed: 14 },
  { week: 'Jun', month: 'Jun', scheduled: 14, overdue: 8, completed: 12 },
  { week: 'Jul', month: 'Jul', scheduled: 10, overdue: 5, completed: 16 },
  { week: 'Aug', month: 'Aug', scheduled: 9, overdue: 4, completed: 14 },
  { week: 'Sep', month: 'Sep', scheduled: 11, overdue: 6, completed: 15 },
  { week: 'Oct', month: 'Oct', scheduled: 10, overdue: 5, completed: 13 },
  { week: 'Nov', month: 'Nov', scheduled: 9, overdue: 4, completed: 14 },
  { week: 'Dec', month: 'Dec', scheduled: 8, overdue: 3, completed: 12 },
];

export const COHORT_CATCHUP_TREND: Record<string, number[]> = {
  'Cohort A — Marketing': [2, 3, 1, 2, 3, 4, 2, 3, 1, 2, 3, 4],
  'Cohort B — Data & Tech': [4, 5, 3, 4, 5, 6, 4, 5, 3, 4, 5, 6],
  'Cohort C — Finance': [3, 2, 2, 3, 2, 3, 2, 2, 3, 2, 3, 2],
  'Cohort D — HR': [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
};