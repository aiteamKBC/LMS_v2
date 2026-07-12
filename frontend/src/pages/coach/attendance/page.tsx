<<<<<<< HEAD
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { COHORT_TREND_DATA } from '@/mocks/attendance';
import TrendChart from './components/TrendChart';
import RiskPieChart from './components/RiskPieChart';
import SparklineChart from '@/components/feature/SparklineChart';

const coachNav = roleNavMap.coach;
=======
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import SparklineChart from '@/components/feature/SparklineChart';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import TrendChart from './components/TrendChart';
import RiskPieChart from './components/RiskPieChart';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/api/coach/attendance';
const MISSING_VALUE = '--';

type RiskTone = 'red' | 'amber' | 'green' | null;
type TrendDirection = 'up' | 'down' | 'stable';
type TrendView = 'week' | 'month' | 'year';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

interface AttendanceLearner {
  id: string;
  learner: string;
  initials: string;
<<<<<<< HEAD
  programme: string;
  cohort: string;
  attendance: number;
  sessions: number;
  present: number;
  absent: number;
  late: number;
  catchup: number;
  trend: 'up' | 'down' | 'stable';
  risk: 'red' | 'amber' | 'green';
=======
  email?: string | null;
  programme: string;
  cohort: string;
  group: string;
  programStatus?: string;
  enrollmentStatus?: string;
  isOnBreak?: boolean;
  includedInAttendanceMetrics?: boolean;
  attendance: number | null;
  sessions: number | null;
  present: number | null;
  absent: number | null;
  late: number | null;
  catchup: number | null;
  trend: TrendDirection;
  risk: RiskTone;
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  employer: string;
  overallProgress: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  lastSession: string;
<<<<<<< HEAD
  nextSession: string;
  group: string;
  lastSessionDate?: string;
  consecutiveMissed: number;
=======
  lastSessionDate?: string | null;
  nextSession: string;
  consecutiveMissed: number | null;
  hasAttendance: boolean;
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
}

interface TrendPoint {
  label: string;
  value: number;
  week?: number;
  month?: string;
  sessionDate?: string;
  attended?: number;
  absent?: number;
  onBreak?: number;
}

<<<<<<< HEAD
const ATTENDANCE_DATA: AttendanceLearner[] = [
  { id: 'l1', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', cohort: 'Cohort A — Marketing', attendance: 86, sessions: 42, present: 36, absent: 3, late: 3, catchup: 2, trend: 'down', risk: 'amber', employer: 'Tim Hortons UK', overallProgress: 72, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 65, lastSession: '18 Jun 2026', nextSession: '25 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-18', consecutiveMissed: 2 },
  { id: 'l2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', attendance: 78, sessions: 38, present: 30, absent: 5, late: 3, catchup: 4, trend: 'down', risk: 'red', employer: 'Medway NHS Trust', overallProgress: 28, otjhCompleted: 22, otjhTarget: 100, ksbProgress: 25, lastSession: '12 Jun 2026', nextSession: '19 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-12', consecutiveMissed: 3 },
  { id: 'l3', learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', cohort: 'Cohort C — Finance', attendance: 83, sessions: 36, present: 30, absent: 4, late: 2, catchup: 3, trend: 'stable', risk: 'amber', employer: 'Ashford Accounting', overallProgress: 68, otjhCompleted: 30, otjhTarget: 100, ksbProgress: 62, lastSession: '17 Jun 2026', nextSession: '24 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-17', consecutiveMissed: 2 },
  { id: 'l4', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', cohort: 'Cohort A — Marketing', attendance: 94, sessions: 48, present: 45, absent: 1, late: 2, catchup: 0, trend: 'stable', risk: 'green', employer: 'Canterbury Creative', overallProgress: 88, otjhCompleted: 95, otjhTarget: 110, ksbProgress: 82, lastSession: '19 Jun 2026', nextSession: '26 Jun 2026', group: 'Group B', lastSessionDate: '2026-06-19', consecutiveMissed: 0 },
  { id: 'l5', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', cohort: 'Cohort A — Marketing', attendance: 100, sessions: 50, present: 50, absent: 0, late: 0, catchup: 0, trend: 'up', risk: 'green', employer: 'Kent Digital Agency', overallProgress: 92, otjhCompleted: 105, otjhTarget: 110, ksbProgress: 90, lastSession: '20 Jun 2026', nextSession: '27 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-20', consecutiveMissed: 0 },
  { id: 'l6', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', cohort: 'Cohort B — Data & Tech', attendance: 94, sessions: 44, present: 41, absent: 1, late: 2, catchup: 0, trend: 'stable', risk: 'green', employer: 'Tech Kent Ltd', overallProgress: 85, otjhCompleted: 88, otjhTarget: 100, ksbProgress: 78, lastSession: '19 Jun 2026', nextSession: '26 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-19', consecutiveMissed: 0 },
  { id: 'l7', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', cohort: 'Cohort C — Finance', attendance: 91, sessions: 46, present: 42, absent: 2, late: 2, catchup: 1, trend: 'stable', risk: 'green', employer: 'BAM Construction', overallProgress: 80, otjhCompleted: 82, otjhTarget: 100, ksbProgress: 76, lastSession: '18 Jun 2026', nextSession: '25 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-18', consecutiveMissed: 1 },
  { id: 'l8', learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', cohort: 'Cohort D — HR', attendance: 100, sessions: 12, present: 12, absent: 0, late: 0, catchup: 0, trend: 'up', risk: 'green', employer: 'Canterbury NHS', overallProgress: 95, otjhCompleted: 55, otjhTarget: 120, ksbProgress: 88, lastSession: '20 Jun 2026', nextSession: '27 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-20', consecutiveMissed: 0 },
  { id: 'l9', learner: 'Finn Murphy', initials: 'FM', programme: 'Project Manager L4', cohort: 'Cohort C — Finance', attendance: 76, sessions: 40, present: 30, absent: 7, late: 3, catchup: 5, trend: 'down', risk: 'red', employer: 'BAM Construction', overallProgress: 33, otjhCompleted: 34, otjhTarget: 100, ksbProgress: 28, lastSession: '10 Jun 2026', nextSession: '17 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-10', consecutiveMissed: 4 },
  { id: 'l10', learner: 'Zara Khan', initials: 'ZK', programme: 'Marketing Executive L4', cohort: 'Cohort A — Marketing', attendance: 88, sessions: 44, present: 39, absent: 3, late: 2, catchup: 2, trend: 'stable', risk: 'amber', employer: 'Tim Hortons UK', overallProgress: 75, otjhCompleted: 70, otjhTarget: 120, ksbProgress: 68, lastSession: '18 Jun 2026', nextSession: '25 Jun 2026', group: 'Group B', lastSessionDate: '2026-06-18', consecutiveMissed: 1 },
  { id: 'l11', learner: 'Omar Hassan', initials: 'OH', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', attendance: 82, sessions: 36, present: 29, absent: 4, late: 3, catchup: 3, trend: 'stable', risk: 'amber', employer: 'Medway NHS Trust', overallProgress: 60, otjhCompleted: 45, otjhTarget: 100, ksbProgress: 55, lastSession: '17 Jun 2026', nextSession: '24 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-17', consecutiveMissed: 2 },
  { id: 'l12', learner: 'Chloe Price', initials: 'CP', programme: 'Digital Marketer L3', cohort: 'Cohort A — Marketing', attendance: 96, sessions: 46, present: 44, absent: 1, late: 1, catchup: 0, trend: 'up', risk: 'green', employer: 'Kent Digital Agency', overallProgress: 90, otjhCompleted: 98, otjhTarget: 110, ksbProgress: 85, lastSession: '20 Jun 2026', nextSession: '27 Jun 2026', group: 'Group B', lastSessionDate: '2026-06-20', consecutiveMissed: 0 },
  { id: 'l13', learner: 'Noah Blake', initials: 'NB', programme: 'Data Analyst L4', cohort: 'Cohort B — Data & Tech', attendance: 72, sessions: 34, present: 25, absent: 6, late: 3, catchup: 4, trend: 'down', risk: 'red', employer: 'Medway NHS Trust', overallProgress: 22, otjhCompleted: 18, otjhTarget: 100, ksbProgress: 20, lastSession: '8 Jun 2026', nextSession: '15 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-08', consecutiveMissed: 5 },
  { id: 'l14', learner: 'Isla Morgan', initials: 'IM', programme: 'Business Administrator L3', cohort: 'Cohort A — Marketing', attendance: 97, sessions: 50, present: 48, absent: 1, late: 1, catchup: 0, trend: 'up', risk: 'green', employer: 'Canterbury Creative', overallProgress: 93, otjhCompleted: 102, otjhTarget: 110, ksbProgress: 88, lastSession: '20 Jun 2026', nextSession: '27 Jun 2026', group: 'Group B', lastSessionDate: '2026-06-20', consecutiveMissed: 0 },
  { id: 'l15', learner: 'Lucas Zhang', initials: 'LZ', programme: 'Software Developer L4', cohort: 'Cohort B — Data & Tech', attendance: 90, sessions: 40, present: 36, absent: 2, late: 2, catchup: 1, trend: 'stable', risk: 'green', employer: 'Tech Kent Ltd', overallProgress: 78, otjhCompleted: 72, otjhTarget: 100, ksbProgress: 70, lastSession: '18 Jun 2026', nextSession: '25 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-18', consecutiveMissed: 1 },
  { id: 'l16', learner: 'Eva Rossi', initials: 'ER', programme: 'Accountancy L3', cohort: 'Cohort C — Finance', attendance: 85, sessions: 38, present: 32, absent: 4, late: 2, catchup: 2, trend: 'stable', risk: 'amber', employer: 'Ashford Accounting', overallProgress: 65, otjhCompleted: 45, otjhTarget: 100, ksbProgress: 58, lastSession: '17 Jun 2026', nextSession: '24 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-17', consecutiveMissed: 2 },
  { id: 'l17', learner: 'Theo Bennett', initials: 'TB', programme: 'HR Consultant L5', cohort: 'Cohort D — HR', attendance: 98, sessions: 14, present: 14, absent: 0, late: 0, catchup: 0, trend: 'up', risk: 'green', employer: 'Canterbury NHS', overallProgress: 92, otjhCompleted: 60, otjhTarget: 120, ksbProgress: 85, lastSession: '20 Jun 2026', nextSession: '27 Jun 2026', group: 'Group A', lastSessionDate: '2026-06-20', consecutiveMissed: 0 },
];

const CATCHUP_QUEUE = [
  { id: 'cu1', learner: 'James Okonkwo', initials: 'JO', session: 'Data Visualisation', missedDate: '5 Jun 2026', catchupDate: '12 Jun 2026', deadline: '12 Jun 2026', tutor: 'Dr. Helen Park', status: 'scheduled' as const, priority: 'high' as const, cohort: 'Cohort B — Data & Tech' },
  { id: 'cu2', learner: 'James Okonkwo', initials: 'JO', session: 'Data Ethics', missedDate: '29 May 2026', catchupDate: '10 Jun 2026', deadline: '5 Jun 2026', tutor: 'Dr. Helen Park', status: 'overdue' as const, priority: 'high' as const, cohort: 'Cohort B — Data & Tech' },
  { id: 'cu3', learner: 'Sophie Williams', initials: 'SW', session: 'Marketing Environment', missedDate: '2 Jun 2026', catchupDate: '16 Jun 2026', deadline: '9 Jun 2026', tutor: 'Crispin Jones', status: 'scheduled' as const, priority: 'medium' as const, cohort: 'Cohort A — Marketing' },
  { id: 'cu4', learner: 'Aisha Patel', initials: 'AP', session: 'Taxation Module', missedDate: '1 Jun 2026', catchupDate: '15 Jun 2026', deadline: '8 Jun 2026', tutor: 'Rachel Myers', status: 'scheduled' as const, priority: 'medium' as const, cohort: 'Cohort C — Finance' },
  { id: 'cu5', learner: 'Finn Murphy', initials: 'FM', session: 'Risk Management', missedDate: '28 May 2026', catchupDate: '11 Jun 2026', deadline: '4 Jun 2026', tutor: 'Rachel Myers', status: 'overdue' as const, priority: 'high' as const, cohort: 'Cohort C — Finance' },
  { id: 'cu6', learner: 'Zara Khan', initials: 'ZK', session: 'Campaign Targeting', missedDate: '4 Jun 2026', catchupDate: '18 Jun 2026', deadline: '11 Jun 2026', tutor: 'Crispin Jones', status: 'scheduled' as const, priority: 'low' as const, cohort: 'Cohort A — Marketing' },
  { id: 'cu7', learner: 'Omar Hassan', initials: 'OH', session: 'SQL Fundamentals', missedDate: '1 Jun 2026', catchupDate: '14 Jun 2026', deadline: '8 Jun 2026', tutor: 'Dr. Helen Park', status: 'overdue' as const, priority: 'medium' as const, cohort: 'Cohort B — Data & Tech' },
  { id: 'cu8', learner: 'Finn Murphy', initials: 'FM', session: 'Stakeholder Analysis', missedDate: '22 May 2026', catchupDate: '5 Jun 2026', deadline: '29 May 2026', tutor: 'Rachel Myers', status: 'completed' as const, priority: 'medium' as const, cohort: 'Cohort C — Finance' },
  { id: 'cu9', learner: 'Noah Blake', initials: 'NB', session: 'Data Cleaning', missedDate: '2 Jun 2026', catchupDate: '16 Jun 2026', deadline: '9 Jun 2026', tutor: 'Dr. Helen Park', status: 'overdue' as const, priority: 'high' as const, cohort: 'Cohort B — Data & Tech' },
  { id: 'cu10', learner: 'Eva Rossi', initials: 'ER', session: 'Financial Reporting', missedDate: '5 Jun 2026', catchupDate: '19 Jun 2026', deadline: '12 Jun 2026', tutor: 'Rachel Myers', status: 'scheduled' as const, priority: 'medium' as const, cohort: 'Cohort C — Finance' },
];

const WEEKLY_TREND_DATA: TrendPoint[] = [
  { label: 'W19', value: 88, week: 19, month: 'May', sessionDate: '7 May 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W20', value: 87, week: 20, month: 'May', sessionDate: '14 May 2026', attended: 14, absent: 3, onBreak: 0 },
  { label: 'W21', value: 85, week: 21, month: 'May', sessionDate: '21 May 2026', attended: 14, absent: 3, onBreak: 0 },
  { label: 'W22', value: 84, week: 22, month: 'May', sessionDate: '28 May 2026', attended: 13, absent: 3, onBreak: 1 },
  { label: 'W23', value: 86, week: 23, month: 'Jun', sessionDate: '4 Jun 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W24', value: 85, week: 24, month: 'Jun', sessionDate: '11 Jun 2026', attended: 14, absent: 3, onBreak: 0 },
  { label: 'W25', value: 87, week: 25, month: 'Jun', sessionDate: '18 Jun 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W26', value: 88, week: 26, month: 'Jun', sessionDate: '25 Jun 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W27', value: 87, week: 27, month: 'Jun', sessionDate: '2 Jul 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W28', value: 86, week: 28, month: 'Jul', sessionDate: '9 Jul 2026', attended: 14, absent: 3, onBreak: 0 },
  { label: 'W29', value: 88, week: 29, month: 'Jul', sessionDate: '16 Jul 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W30', value: 87, week: 30, month: 'Jul', sessionDate: '23 Jul 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W31', value: 89, week: 31, month: 'Jul', sessionDate: '30 Jul 2026', attended: 15, absent: 1, onBreak: 1 },
  { label: 'W32', value: 88, week: 32, month: 'Aug', sessionDate: '6 Aug 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W33', value: 87, week: 33, month: 'Aug', sessionDate: '13 Aug 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W34', value: 88, week: 34, month: 'Aug', sessionDate: '20 Aug 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W35', value: 89, week: 35, month: 'Aug', sessionDate: '27 Aug 2026', attended: 15, absent: 1, onBreak: 1 },
  { label: 'W36', value: 88, week: 36, month: 'Sep', sessionDate: '3 Sep 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W37', value: 87, week: 37, month: 'Sep', sessionDate: '10 Sep 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W38', value: 86, week: 38, month: 'Sep', sessionDate: '17 Sep 2026', attended: 14, absent: 3, onBreak: 0 },
  { label: 'W39', value: 87, week: 39, month: 'Sep', sessionDate: '24 Sep 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W40', value: 88, week: 40, month: 'Oct', sessionDate: '1 Oct 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W41', value: 89, week: 41, month: 'Oct', sessionDate: '8 Oct 2026', attended: 15, absent: 1, onBreak: 1 },
  { label: 'W42', value: 88, week: 42, month: 'Oct', sessionDate: '15 Oct 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W43', value: 87, week: 43, month: 'Oct', sessionDate: '22 Oct 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W44', value: 88, week: 44, month: 'Oct', sessionDate: '29 Oct 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W45', value: 89, week: 45, month: 'Nov', sessionDate: '5 Nov 2026', attended: 15, absent: 1, onBreak: 1 },
  { label: 'W46', value: 88, week: 46, month: 'Nov', sessionDate: '12 Nov 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W47', value: 87, week: 47, month: 'Nov', sessionDate: '19 Nov 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W48', value: 88, week: 48, month: 'Nov', sessionDate: '26 Nov 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W49', value: 89, week: 49, month: 'Dec', sessionDate: '3 Dec 2026', attended: 15, absent: 1, onBreak: 1 },
  { label: 'W50', value: 88, week: 50, month: 'Dec', sessionDate: '10 Dec 2026', attended: 15, absent: 2, onBreak: 0 },
  { label: 'W51', value: 87, week: 51, month: 'Dec', sessionDate: '17 Dec 2026', attended: 14, absent: 2, onBreak: 1 },
  { label: 'W52', value: 88, week: 52, month: 'Dec', sessionDate: '24 Dec 2026', attended: 15, absent: 2, onBreak: 0 },
];

const MONTHLY_TREND_DATA: TrendPoint[] = [
  { label: 'Jan', value: 89, month: 'Jan', sessionDate: 'Jan 2026', attended: 62, absent: 8, onBreak: 2 },
  { label: 'Feb', value: 88, month: 'Feb', sessionDate: 'Feb 2026', attended: 60, absent: 9, onBreak: 3 },
  { label: 'Mar', value: 87, month: 'Mar', sessionDate: 'Mar 2026', attended: 59, absent: 10, onBreak: 2 },
  { label: 'Apr', value: 86, month: 'Apr', sessionDate: 'Apr 2026', attended: 58, absent: 10, onBreak: 3 },
  { label: 'May', value: 85, month: 'May', sessionDate: 'May 2026', attended: 57, absent: 11, onBreak: 2 },
  { label: 'Jun', value: 87, month: 'Jun', sessionDate: 'Jun 2026', attended: 59, absent: 9, onBreak: 2 },
  { label: 'Jul', value: 88, month: 'Jul', sessionDate: 'Jul 2026', attended: 60, absent: 8, onBreak: 3 },
  { label: 'Aug', value: 89, month: 'Aug', sessionDate: 'Aug 2026', attended: 62, absent: 7, onBreak: 3 },
  { label: 'Sep', value: 88, month: 'Sep', sessionDate: 'Sep 2026', attended: 61, absent: 8, onBreak: 2 },
  { label: 'Oct', value: 87, month: 'Oct', sessionDate: 'Oct 2026', attended: 59, absent: 10, onBreak: 2 },
  { label: 'Nov', value: 88, month: 'Nov', sessionDate: 'Nov 2026', attended: 61, absent: 8, onBreak: 3 },
  { label: 'Dec', value: 89, month: 'Dec', sessionDate: 'Dec 2026', attended: 62, absent: 7, onBreak: 3 },
];

const YEARLY_TREND_DATA: TrendPoint[] = [
  { label: '2023', value: 84, month: '2023', sessionDate: '2023', attended: 340, absent: 65, onBreak: 20 },
  { label: '2024', value: 86, month: '2024', sessionDate: '2024', attended: 365, absent: 58, onBreak: 22 },
  { label: '2025', value: 87, month: '2025', sessionDate: '2025', attended: 378, absent: 55, onBreak: 25 },
  { label: '2026', value: 88, month: '2026', sessionDate: '2026', attended: 385, absent: 52, onBreak: 28 },
];

type TrendView = 'week' | 'month' | 'year';
=======
interface AttendanceSummary {
  totalLearners: number;
  activeLearners?: number;
  onBreakLearners?: number;
  learnersWithAttendance: number;
  cohortCount: number;
  averageAttendance: number | null;
  totalSessions: number;
  totalPresent: number;
  totalAbsent: number;
  onTrack: number;
  needsAttention: number;
  atRisk: number;
  unknown: number;
  catchupsPending: number | null;
  scheduledCatchups: number | null;
  overdueCatchups: number | null;
}

interface AttendanceApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  summary?: AttendanceSummary;
  learners?: AttendanceLearner[];
  trends?: Record<TrendView, TrendPoint[]>;
}

const EMPTY_SUMMARY: AttendanceSummary = {
  totalLearners: 0,
  activeLearners: 0,
  onBreakLearners: 0,
  learnersWithAttendance: 0,
  cohortCount: 0,
  averageAttendance: null,
  totalSessions: 0,
  totalPresent: 0,
  totalAbsent: 0,
  onTrack: 0,
  needsAttention: 0,
  atRisk: 0,
  unknown: 0,
  catchupsPending: null,
  scheduledCatchups: null,
  overdueCatchups: null,
};

function displayText(value?: string | null): string {
  const trimmed = (value || '').trim();
  return trimmed || MISSING_VALUE;
}

function formatCount(value?: number | null): string {
  return value === null || value === undefined ? MISSING_VALUE : String(value);
}

function formatPercent(value?: number | null): string {
  return value === null || value === undefined ? MISSING_VALUE : `${value}%`;
}

function percentOf(count: number, total: number): string {
  if (!total) return MISSING_VALUE;
  return `${Math.round((count / total) * 100)}%`;
}

function getRiskLabel(risk: RiskTone): string {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return MISSING_VALUE;
}

function getDisplayRiskLabel(learner: AttendanceLearner): string {
  if (learner.isOnBreak) return 'On Break';
  return getRiskLabel(learner.risk);
}

function getRiskClasses(risk: RiskTone): string {
  if (risk === 'green') return 'bg-emerald-100 text-emerald-700 border-emerald-200/60';
  if (risk === 'amber') return 'bg-amber-100 text-amber-700 border-amber-200/60';
  if (risk === 'red') return 'bg-red-100 text-red-700 border-red-200/60';
  return 'bg-foreground-100 text-foreground-500 border-foreground-200/60';
}

function getDisplayRiskClasses(learner: AttendanceLearner): string {
  if (learner.isOnBreak) return 'bg-slate-100 text-slate-700 border-slate-200/70';
  return getRiskClasses(learner.risk);
}

function getAvatarClasses(risk: RiskTone): string {
  if (risk === 'green') return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
  if (risk === 'amber') return 'bg-amber-100 text-amber-700 ring-amber-200';
  if (risk === 'red') return 'bg-red-100 text-red-700 ring-red-200';
  return 'bg-foreground-100 text-foreground-500 ring-foreground-200';
}

function getAttendanceTone(value?: number | null): string {
  if (value === null || value === undefined) return 'text-foreground-400';
  if (value >= 90) return 'text-emerald-600';
  if (value >= 80) return 'text-amber-600';
  return 'text-red-600';
}

function getAttendanceBar(value?: number | null): string {
  if (value === null || value === undefined) return 'bg-foreground-300';
  if (value >= 90) return 'bg-emerald-500';
  if (value >= 80) return 'bg-amber-500';
  return 'bg-red-500';
}

function safePercentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

function DonutChart({ percentage, size = 72, strokeWidth = 6, color = 'primary' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const colorMap: Record<string, { stroke: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', text: 'text-red-700' },
<<<<<<< HEAD
    secondary: { stroke: 'stroke-secondary-500', text: 'text-secondary-700' },
  };

=======
  };
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-background-200" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={`${c.stroke} transition-all duration-700`} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
      </div>
    </div>
  );
}

<<<<<<< HEAD
function FilterDropdown({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className="appearance-none pl-3 pr-8 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 min-w-[140px]">
        <option value="all">{allLabel || `All ${label}s`}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
=======
function FilterDropdown({ value, onChange, options, allLabel }: { value: string; onChange: (v: string) => void; options: string[]; allLabel: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className="appearance-none pl-3 pr-8 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 min-w-[160px]">
        <option value="all">{allLabel}</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
      </select>
      <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs pointer-events-none"></i>
    </div>
  );
}

<<<<<<< HEAD
=======
function StatCard({ icon, label, value, hint, tone = 'primary' }: { icon: string; label: string; value: string; hint?: string; tone?: 'primary' | 'emerald' | 'red' | 'amber' }) {
  const toneMap: Record<'primary' | 'emerald' | 'red' | 'amber', string> = {
    primary: 'bg-primary-100 text-primary-600 border-primary-200/40',
    emerald: 'bg-emerald-100 text-emerald-600 border-emerald-200/40',
    red: 'bg-red-100 text-red-600 border-red-200/40',
    amber: 'bg-amber-100 text-amber-600 border-amber-200/40',
  };
  const borderMap: Record<'primary' | 'emerald' | 'red' | 'amber', string> = {
    primary: 'border-primary-200/40',
    emerald: 'border-emerald-200/40',
    red: 'border-red-200/40',
    amber: 'border-amber-200/40',
  };

  return (
    <div className={`bg-background-50 rounded-xl border p-4 flex flex-col gap-2 hover:shadow-sm transition-smooth ${borderMap[tone]}`}>
      <div className="flex items-center justify-between">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        {hint && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${toneMap[tone]}`}>{hint}</span>}
      </div>
      <div>
        <p className={`text-2xl font-heading font-bold ${tone === 'primary' ? 'text-foreground-900' : tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{value}</p>
        <p className="text-[10px] text-foreground-400">{label}</p>
      </div>
    </div>
  );
}

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
export default function CoachAttendance() {
  const navigate = useNavigate();
  const { success, info } = useToast();

<<<<<<< HEAD
  const [cohortFilter, setCohortFilter] = useState<string>('all');
  const [programmeFilter, setProgrammeFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [showEmployerDropdown, setShowEmployerDropdown] = useState(false);
  const [trendView, setTrendView] = useState<TrendView>('week');
  const [trendCount, setTrendCount] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);

  const cohorts = useMemo(() => [...new Set(ATTENDANCE_DATA.map(l => l.cohort))].sort(), []);
  const programmes = useMemo(() => [...new Set(ATTENDANCE_DATA.map(l => l.programme))].sort(), []);
  const groups = useMemo(() => [...new Set(ATTENDANCE_DATA.map(l => l.group))].sort(), []);

  const filteredData = useMemo(() => {
    let data = ATTENDANCE_DATA;
=======
  const [learners, setLearners] = useState<AttendanceLearner[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>(EMPTY_SUMMARY);
  const [trends, setTrends] = useState<Record<TrendView, TrendPoint[]>>({ week: [], month: [], year: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cohortFilter, setCohortFilter] = useState('all');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [trendView, setTrendView] = useState<TrendView>('week');
  const [trendCount, setTrendCount] = useState(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);

  useEffect(() => {
    let cancelled = false;

    async function loadAttendance() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(API_ENDPOINT);
        if (!response.ok) throw new Error(`Request failed with ${response.status}`);
        const data: AttendanceApiResponse = await response.json();
        if (cancelled) return;
        setLearners(data.learners || []);
        setSummary(data.summary || EMPTY_SUMMARY);
        setTrends({
          week: data.trends?.week || [],
          month: data.trends?.month || [],
          year: data.trends?.year || [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load attendance data');
          setLearners([]);
          setSummary(EMPTY_SUMMARY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAttendance();
    return () => {
      cancelled = true;
    };
  }, []);

  const cohorts = useMemo(() => [...new Set(learners.map(l => l.cohort).filter(Boolean))].sort(), [learners]);
  const programmes = useMemo(() => [...new Set(learners.map(l => l.programme).filter(Boolean))].sort(), [learners]);
  const groups = useMemo(() => [...new Set(learners.map(l => l.group).filter(Boolean))].sort(), [learners]);

  const filteredData = useMemo(() => {
    let data = learners;
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
    if (cohortFilter !== 'all') data = data.filter(l => l.cohort === cohortFilter);
    if (programmeFilter !== 'all') data = data.filter(l => l.programme === programmeFilter);
    if (groupFilter !== 'all') data = data.filter(l => l.group === groupFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
<<<<<<< HEAD
      data = data.filter(l => l.learner.toLowerCase().includes(q) || l.initials.toLowerCase().includes(q) || l.programme.toLowerCase().includes(q) || l.cohort.toLowerCase().includes(q));
    }
    if (dateFrom && dateTo) {
      data = data.filter(l => {
        if (!l.lastSessionDate) return true;
        const d = l.lastSessionDate;
        return d >= dateFrom && d <= dateTo;
      });
    }
    return data;
  }, [cohortFilter, programmeFilter, groupFilter, searchQuery, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const selectedLearner = ATTENDANCE_DATA.find(l => l.id === selectedLearnerId) || null;

  const overdueCatchup = CATCHUP_QUEUE.filter(c => c.status === 'overdue').length;
  const scheduledCatchup = CATCHUP_QUEUE.filter(c => c.status === 'scheduled').length;
  const totalCatchupPending = overdueCatchup + scheduledCatchup;

  const avgAttendance = Math.round(ATTENDANCE_DATA.reduce((a, b) => a + b.attendance, 0) / ATTENDANCE_DATA.length);
  const atRiskCount = ATTENDANCE_DATA.filter(l => l.risk === 'red').length;
  const amberCount = ATTENDANCE_DATA.filter(l => l.risk === 'amber').length;
  const greenCount = ATTENDANCE_DATA.filter(l => l.risk === 'green').length;
  const totalSessions = ATTENDANCE_DATA.reduce((a, b) => a + b.sessions, 0);
  const totalPresent = ATTENDANCE_DATA.reduce((a, b) => a + b.present, 0);
  const totalAbsent = ATTENDANCE_DATA.reduce((a, b) => a + b.absent, 0);

  // Trend data based on view and count — converted to absence rate
  const trendData = useMemo(() => {
    let base: TrendPoint[];
    switch (trendView) {
      case 'month':
        base = MONTHLY_TREND_DATA;
        break;
      case 'year':
        base = YEARLY_TREND_DATA;
        break;
      default:
        base = WEEKLY_TREND_DATA;
    }
    const count = Math.min(trendCount, base.length);
    return base.slice(-count).map(d => {
      const total = (d.attended || 0) + (d.absent || 0) + (d.onBreak || 0);
      return {
        ...d,
        value: total > 0 ? Math.round(((d.absent || 0) / total) * 100) : 0,
      };
    });
  }, [trendView, trendCount]);

  const sparkTrendAll = COHORT_TREND_DATA['Cohort A — Marketing'];
  const trendValues = sparkTrendAll;
  const trendUp = trendValues.length >= 2 && trendValues[trendValues.length - 1] > trendValues[0];

  const handleViewProfile = (learner: AttendanceLearner) => {
    navigate(`/coach/learner-case-file?id=${learner.id}`);
    success(`Opening profile`, learner.learner);
  };

  const handleSendMessage = (learner: AttendanceLearner) => {
    const threadId = `th-attendance-${learner.id}`;
    navigate(`/coach/messages?thread=${threadId}`);
  };

  const handleEmailEmployer = (learner: AttendanceLearner) => {
    window.open(`mailto:hr@${learner.employer.toLowerCase().replace(/\s+/g, '')}.co.uk`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleZoomCall = () => {
    window.open('https://zoom.us/start/videomeeting', '_blank');
    setShowEmployerDropdown(false);
  };

  const handleOutlookCall = () => {
    window.open('https://outlook.office.com/calendar/deeplink/compose', '_blank');
    setShowEmployerDropdown(false);
  };

  const maxCount = trendView === 'week' ? 52 : trendView === 'month' ? 12 : 4;
  const countLabel = trendView === 'week' ? 'Weeks' : trendView === 'month' ? 'Months' : 'Years';

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance Dashboard" pageSubtitle="Cohort-level attendance overview and bulk catch-up tracking" userName="Med Maher" userRole="Progress Coach">
      <div className="p-4 md:p-6 space-y-6">

        {/* ===== Hero Banner (clean - no notification badges) ===== */}
=======
      data = data.filter(l => [l.learner, l.initials, l.email || '', l.employer, l.programme, l.cohort, l.group].some(value => value.toLowerCase().includes(q)));
    }
    if (dateFrom || dateTo) {
      data = data.filter(l => {
        if (!l.lastSessionDate) return false;
        if (dateFrom && l.lastSessionDate < dateFrom) return false;
        if (dateTo && l.lastSessionDate > dateTo) return false;
        return true;
      });
    }
    return data;
  }, [learners, cohortFilter, programmeFilter, groupFilter, searchQuery, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const selectedLearner = learners.find(l => l.id === selectedLearnerId) || null;

  const trendData = useMemo(() => {
    const base = trends[trendView] || [];
    return base.slice(-Math.min(trendCount, base.length));
  }, [trends, trendView, trendCount]);

  const attendanceTrendValues = useMemo(() => {
    const values = trendData.map(point => Math.max(0, 100 - point.value));
    return values.length ? values : [summary.averageAttendance || 0];
  }, [trendData, summary.averageAttendance]);

  const trendUp = attendanceTrendValues.length >= 2 && attendanceTrendValues[attendanceTrendValues.length - 1] >= attendanceTrendValues[0];
  const knownLearnerCount = summary.learnersWithAttendance;
  const trendMax = Math.max(30, Math.min(100, Math.ceil((Math.max(...trendData.map(point => point.value), 0) + 5) / 10) * 10));
  const maxCount = trendView === 'week' ? Math.max(1, trends.week.length || 52) : trendView === 'month' ? Math.max(1, trends.month.length || 12) : Math.max(1, trends.year.length || 4);
  const countLabel = trendView === 'week' ? 'Weeks' : trendView === 'month' ? 'Months' : 'Years';

  const resetFilters = () => {
    setCohortFilter('all');
    setProgrammeFilter('all');
    setGroupFilter('all');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const handleViewProfile = (learner: AttendanceLearner) => {
    navigate(`/coach/learner-case-file?id=${learner.id}`);
    success('Opening profile', learner.learner);
  };

  const handleSendMessage = (learner: AttendanceLearner) => {
    navigate(`/coach/messages?thread=th-attendance-${learner.id}`);
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance Dashboard" pageSubtitle="Attendance overview from KBC attendance records" userName="Med Maher" userRole="Progress Coach">
      <div className="p-4 md:p-6 space-y-6">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-5">
              <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <i className="ri-calendar-2-line text-white text-2xl"></i>
              </span>
              <div className="flex-1">
                <h2 className="text-lg font-heading font-bold text-white mb-1">Attendance Dashboard</h2>
                <p className="text-[13px] text-white/80 leading-relaxed">
<<<<<<< HEAD
                  Average attendance: <strong>{avgAttendance}%</strong> across {ATTENDANCE_DATA.length} learners in {cohorts.length} cohorts.
                  {totalPresent} present out of {totalSessions} sessions, {totalAbsent} absences.
                  {atRiskCount} at risk, {totalCatchupPending} catch-ups pending ({overdueCatchup} overdue).
=======
                  Average attendance: <strong>{formatPercent(summary.averageAttendance)}</strong> across {summary.activeLearners ?? summary.totalLearners} active learners
                  {(summary.onBreakLearners || 0) > 0 ? ` + ${summary.onBreakLearners} on break` : ''} ({summary.learnersWithAttendance} with attendance records) in {summary.cohortCount} cohorts.
                  {' '}{summary.totalPresent} present out of {summary.totalSessions} sessions, {summary.totalAbsent} absences.
                  {' '}{summary.atRisk} at risk, {summary.needsAttention} need attention, {summary.onTrack} on track.
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                </p>
              </div>
            </div>
          </div>
        </div>

<<<<<<< HEAD
        {/* ===== 5 Stat Cards (clean - no pulse animations) ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Card 1: Average Attendance */}
=======
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col gap-2 hover:border-primary-300/40 transition-smooth">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center">
                <i className="ri-bar-chart-line text-primary-600 text-sm"></i>
              </span>
              <div className="w-20 h-8">
<<<<<<< HEAD
                <SparklineChart data={trendValues.slice(-6)} color={avgAttendance >= 90 ? 'emerald' : avgAttendance >= 80 ? 'amber' : 'red'} width={80} height={32} showDots={false} showFill={false} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-foreground-900">{avgAttendance}%</p>
              <p className="text-[10px] text-foreground-400">Average Attendance</p>
              <div className="flex items-center gap-1 mt-1">
                <i className={`${trendUp ? 'ri-arrow-up-line text-emerald-500' : 'ri-arrow-down-line text-red-500'} text-[10px]`}></i>
                <span className={`text-[10px] font-medium ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>{trendUp ? 'Improving' : 'Declining'}</span>
              </div>
            </div>
          </div>

          {/* Card 2: On Track */}
          <div className="bg-background-50 rounded-xl border border-emerald-200/40 p-4 flex flex-col gap-2 hover:border-emerald-300/60 transition-smooth">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                <i className="ri-check-double-line text-emerald-600 text-sm"></i>
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{Math.round((greenCount / ATTENDANCE_DATA.length) * 100)}%</span>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-emerald-600">{greenCount}</p>
              <p className="text-[10px] text-foreground-400">On Track (90%+)</p>
            </div>
          </div>

          {/* Card 3: At Risk - clean, no pulse */}
          <div className="bg-background-50 rounded-xl border border-red-200/40 p-4 flex flex-col gap-2 hover:border-red-300/60 transition-smooth">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
                <i className="ri-error-warning-line text-red-600 text-sm"></i>
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{Math.round((atRiskCount / ATTENDANCE_DATA.length) * 100)}%</span>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-red-600">{atRiskCount}</p>
              <p className="text-[10px] text-foreground-400">At Risk (&lt;80%)</p>
            </div>
          </div>

          {/* Card 4: Needs Attention */}
          <div className="bg-background-50 rounded-xl border border-amber-200/40 p-4 flex flex-col gap-2 hover:border-amber-300/60 transition-smooth">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                <i className="ri-alert-line text-amber-600 text-sm"></i>
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{Math.round((amberCount / ATTENDANCE_DATA.length) * 100)}%</span>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-amber-600">{amberCount}</p>
              <p className="text-[10px] text-foreground-400">Needs Attention (80–89%)</p>
            </div>
          </div>

          {/* Card 5: Catch-ups Pending - clean, no pulse */}
          <div className="bg-background-50 rounded-xl border border-amber-200/40 p-4 flex flex-col gap-2 hover:border-amber-300/60 transition-smooth">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                <i className="ri-timer-line text-amber-600 text-sm"></i>
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{overdueCatchup} overdue</span>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-amber-600">{totalCatchupPending}</p>
              <p className="text-[10px] text-foreground-400">Catch-ups Pending</p>
              <p className="text-[10px] text-amber-600 mt-0.5">{scheduledCatchup} scheduled</p>
            </div>
          </div>
        </div>

        {/* ===== Charts Row: Absence Trend + Risk Distribution ===== */}
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Absence Trend Chart — takes more width */}
=======
                <SparklineChart data={attendanceTrendValues.slice(-6)} color={(summary.averageAttendance || 0) >= 90 ? 'emerald' : (summary.averageAttendance || 0) >= 80 ? 'amber' : 'red'} width={80} height={32} showDots={false} showFill={false} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-foreground-900">{formatPercent(summary.averageAttendance)}</p>
              <p className="text-[10px] text-foreground-400">Average Attendance</p>
              <div className="flex items-center gap-1 mt-1">
                <i className={`${trendUp ? 'ri-arrow-up-line text-emerald-500' : 'ri-arrow-down-line text-red-500'} text-[10px]`}></i>
                <span className={`text-[10px] font-medium ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>{trendData.length ? (trendUp ? 'Improving' : 'Declining') : MISSING_VALUE}</span>
              </div>
            </div>
          </div>
          <StatCard icon="ri-check-double-line" label="On Track (90%+)" value={formatCount(summary.onTrack)} hint={percentOf(summary.onTrack, knownLearnerCount)} tone="emerald" />
          <StatCard icon="ri-error-warning-line" label="At Risk (<80%)" value={formatCount(summary.atRisk)} hint={percentOf(summary.atRisk, knownLearnerCount)} tone="red" />
          <StatCard icon="ri-alert-line" label="Needs Attention (80-89%)" value={formatCount(summary.needsAttention)} hint={percentOf(summary.needsAttention, knownLearnerCount)} tone="amber" />
          <StatCard icon="ri-timer-line" label="Catch-ups Pending" value={formatCount(summary.catchupsPending)} hint={summary.overdueCatchups === null ? MISSING_VALUE : `${summary.overdueCatchups} overdue`} tone="amber" />
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          <div className="flex-1 min-w-0 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
                    <i className="ri-line-chart-line text-accent-600 text-sm"></i>
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Absence Trend</h3>
<<<<<<< HEAD
                    <p className="text-[10px] text-foreground-400">Overall cohort absence rate over time</p>
                  </div>
                </div>
                {/* View toggle + Period count */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-background-100 rounded-lg p-1">
                    <button
                      onClick={() => setTrendView('week')}
                      className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === 'week' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
                    >
                      Week
                    </button>
                    <button
                      onClick={() => setTrendView('month')}
                      className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === 'month' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
                    >
                      Month
                    </button>
                    <button
                      onClick={() => setTrendView('year')}
                      className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === 'year' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
                    >
                      Year
                    </button>
                  </div>
                  {/* Period count at the very end */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground-400">Show</span>
                    <input
                      type="number"
                      min={1}
                      max={maxCount}
                      value={trendCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (val >= 1 && val <= maxCount) setTrendCount(val);
                      }}
                      className="w-12 px-2 py-1 bg-background-100 border border-foreground-200 rounded-md text-[11px] text-center text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50"
                    />
=======
                    <p className="text-[10px] text-foreground-400">Absence rate from kbc_attendance over time</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-background-100 rounded-lg p-1">
                    {(['week', 'month', 'year'] as TrendView[]).map(view => (
                      <button key={view} onClick={() => setTrendView(view)} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === view ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                        {view === 'week' ? 'Week' : view === 'month' ? 'Month' : 'Year'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground-400">Show</span>
                    <input type="number" min={1} max={maxCount} value={trendCount} onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val >= 1 && val <= maxCount) setTrendCount(val);
                    }} className="w-12 px-2 py-1 bg-background-100 border border-foreground-200 rounded-md text-[11px] text-center text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50" />
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                    <span className="text-[10px] text-foreground-400">{countLabel}</span>
                  </div>
                </div>
              </div>

<<<<<<< HEAD
              <TrendChart
                data={trendData}
                height={260}
                color="red"
                yAxisMax={30}
                yAxisMin={0}
              />
            </div>
          </div>

          {/* Risk Distribution Pie Chart */}
=======
              {trendData.length ? (
                <TrendChart data={trendData} height={260} color="red" yAxisMax={trendMax} yAxisMin={0} />
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-foreground-400">No attendance trend records yet.</div>
              )}
            </div>
          </div>

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          <div className="lg:w-[280px] shrink-0 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="p-5 flex flex-col items-center h-full">
              <div className="flex items-center gap-2.5 mb-4 self-start">
                <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <i className="ri-pie-chart-line text-red-600 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Risk Distribution</h3>
<<<<<<< HEAD
                  <p className="text-[10px] text-foreground-400">Learner risk breakdown</p>
                </div>
              </div>
              <RiskPieChart
                slices={[
                  { label: 'On Track', value: greenCount, color: '#10b981', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700' },
                  { label: 'Needs Attention', value: amberCount, color: '#f59e0b', bgColor: 'bg-amber-100', textColor: 'text-amber-700' },
                  { label: 'At Risk', value: atRiskCount, color: '#ef4444', bgColor: 'bg-red-100', textColor: 'text-red-700' },
                ]}
                total={ATTENDANCE_DATA.length}
                size={180}
                innerRadius={48}
              />
=======
                  <p className="text-[10px] text-foreground-400">{knownLearnerCount} matched learners</p>
                </div>
              </div>
              {knownLearnerCount ? (
                <RiskPieChart
                  slices={[
                    { label: 'On Track', value: summary.onTrack, color: '#10b981', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700' },
                    { label: 'Needs Attention', value: summary.needsAttention, color: '#f59e0b', bgColor: 'bg-amber-100', textColor: 'text-amber-700' },
                    { label: 'At Risk', value: summary.atRisk, color: '#ef4444', bgColor: 'bg-red-100', textColor: 'text-red-700' },
                  ]}
                  total={knownLearnerCount}
                  size={180}
                  innerRadius={48}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-foreground-400">No matched attendance records.</div>
              )}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            </div>
          </div>
        </div>

<<<<<<< HEAD
        {/* ===== Search + Filters Bar ===== */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 w-full">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                placeholder="Search learners, programmes, cohorts..."
                className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50"
              />
=======
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
            <div className="relative flex-1 w-full">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
              <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} placeholder="Search learners, programmes, cohorts..." className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50" />
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setCurrentPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 cursor-pointer">
                  <i className="ri-close-line text-xs"></i>
                </button>
              )}
            </div>
<<<<<<< HEAD
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown
                label="Cohort"
                allLabel="All Cohorts"
                value={cohortFilter}
                onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }}
                options={cohorts.map(c => ({ value: c, label: c }))}
              />
              <FilterDropdown
                label="Programme"
                allLabel="All Programmes"
                value={programmeFilter}
                onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }}
                options={programmes.map(c => ({ value: c, label: c }))}
              />
              <FilterDropdown
                label="Group"
                allLabel="All Groups"
                value={groupFilter}
                onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }}
                options={groups.map(c => ({ value: c, label: c }))}
              />
              {/* Date Range */}
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
                  className="px-2 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[10px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 w-[115px]"
                />
                <span className="text-[10px] text-foreground-400">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
                  className="px-2 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[10px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 w-[115px]"
                />
              </div>
              {(cohortFilter !== 'all' || programmeFilter !== 'all' || groupFilter !== 'all' || dateFrom || dateTo || searchQuery) && (
                <button
                  onClick={() => {
                    setCohortFilter('all');
                    setProgrammeFilter('all');
                    setGroupFilter('all');
                    setSearchQuery('');
                    setDateFrom('');
                    setDateTo('');
                    setCurrentPage(1);
                  }}
                  className="px-2 py-2 rounded-lg text-[11px] text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                >
=======
            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown allLabel="All Cohorts" value={cohortFilter} onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }} options={cohorts} />
              <FilterDropdown allLabel="All Programmes" value={programmeFilter} onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }} options={programmes} />
              <FilterDropdown allLabel="All Groups" value={groupFilter} onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }} options={groups} />
              <div className="flex items-center gap-1">
                <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }} className="px-2 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[10px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 w-[115px]" />
                <span className="text-[10px] text-foreground-400">to</span>
                <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }} className="px-2 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[10px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 w-[115px]" />
              </div>
              {(cohortFilter !== 'all' || programmeFilter !== 'all' || groupFilter !== 'all' || dateFrom || dateTo || searchQuery) && (
                <button onClick={resetFilters} className="px-2 py-2 rounded-lg text-[11px] text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                  <i className="ri-close-line mr-1"></i>Clear
                </button>
              )}
            </div>
          </div>
<<<<<<< HEAD
          {/* Active filter tags */}
          {(cohortFilter !== 'all' || programmeFilter !== 'all' || groupFilter !== 'all' || dateFrom || dateTo) && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span className="text-[10px] text-foreground-400">Active filters:</span>
              {cohortFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {cohortFilter}
                  <button onClick={() => { setCohortFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
              {programmeFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {programmeFilter}
                  <button onClick={() => { setProgrammeFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
              {groupFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {groupFilter}
                  <button onClick={() => { setGroupFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
              {dateFrom && dateTo && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {dateFrom} to {dateTo}
                  <button onClick={() => { setDateFrom(''); setDateTo(''); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* ===== Professional Table with Pagination ===== */}
=======
        </div>

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60">
                  <th className="pl-4 pr-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Learner</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Attendance</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Present/Absent</th>
<<<<<<< HEAD
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Late</th>
=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Catch-up</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Trend</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Risk</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Last Session</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Missed in a Row</th>
                  <th className="pr-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
<<<<<<< HEAD
                {paginatedData.map(row => {
                  const isSel = selectedLearnerId === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedLearnerId(isSel ? null : row.id)}
                      className={`transition-smooth cursor-pointer ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}
                    >
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1.5 ${row.risk === 'red' ? 'bg-red-100 text-red-700 ring-red-200' : row.risk === 'amber' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                            <span className="text-[11px] font-bold">{row.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-foreground-900 truncate">{row.learner}</p>
                            <p className="text-[10px] text-foreground-400 truncate">{row.programme}</p>
                            <p className="text-[10px] text-foreground-300 truncate">{row.cohort}</p>
=======
                {loading && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-sm text-foreground-400">Loading live attendance data...</td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <div className="inline-flex flex-col items-center gap-2 text-red-600">
                        <i className="ri-error-warning-line text-2xl"></i>
                        <span className="text-sm font-semibold">Unable to load live attendance data.</span>
                        <span className="text-xs text-foreground-400">{error}</span>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && !error && paginatedData.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-sm text-foreground-400">No learners match the current filters.</td>
                  </tr>
                )}
                {!loading && !error && paginatedData.map(row => {
                  const isSel = selectedLearnerId === row.id;
                  return (
                    <tr key={row.id} onClick={() => setSelectedLearnerId(isSel ? null : row.id)} className={`transition-smooth cursor-pointer ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1.5 ${getAvatarClasses(row.risk)}`}>
                            <span className="text-[11px] font-bold">{row.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-[12px] font-semibold text-foreground-900 truncate">{row.learner}</p>
                              {row.isOnBreak && <span className="shrink-0 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/70">On Break</span>}
                            </div>
                            <p className="text-[10px] text-foreground-400 truncate">{displayText(row.employer)}</p>
                            <p className="text-[10px] text-foreground-300 truncate">{displayText(row.cohort)}</p>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
<<<<<<< HEAD
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-background-200">
                            <div className={`h-full rounded-full ${row.attendance >= 90 ? 'bg-emerald-500' : row.attendance >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${row.attendance}%` }}></div>
                          </div>
                          <span className={`text-[11px] font-semibold ${row.attendance >= 90 ? 'text-emerald-600' : row.attendance >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{row.attendance}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-[11px]">
                          <span className="text-emerald-600 font-medium">{row.present}</span>
                          <span className="text-foreground-300">/</span>
                          <span className="text-red-600 font-medium">{row.absent}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[11px] ${row.late > 0 ? 'text-amber-600' : 'text-foreground-300'}`}>{row.late > 0 ? row.late : '—'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.catchup > 0 ? (
                          <span className={`text-[11px] font-semibold ${row.catchup > 2 ? 'text-red-600' : 'text-amber-600'}`}>{row.catchup}</span>
                        ) : (
                          <span className="text-[11px] text-foreground-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <i className={`${row.trend === 'up' ? 'ri-arrow-up-line text-emerald-500' : row.trend === 'down' ? 'ri-arrow-down-line text-red-500' : 'ri-subtract-line text-foreground-400'} text-sm`}></i>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${row.risk === 'green' ? 'bg-emerald-100 text-emerald-700' : row.risk === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {row.risk === 'green' ? 'On Track' : row.risk === 'amber' ? 'Watch' : 'At Risk'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-[11px] text-foreground-500">{row.lastSession}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.consecutiveMissed > 0 ? (
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${row.consecutiveMissed >= 3 ? 'bg-red-100 text-red-700' : row.consecutiveMissed >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-600'}`}>
                            {row.consecutiveMissed}
                          </span>
                        ) : (
                          <span className="text-[11px] text-foreground-300">—</span>
                        )}
                      </td>
                      <td className="pr-4 py-2.5 text-center">
                        <i className={`text-foreground-300 text-sm transition-transform duration-300 ${isSel ? 'ri-arrow-up-s-line rotate-180' : 'ri-arrow-down-s-line'}`}></i>
                      </td>
=======
                        {row.attendance === null ? (
                          <span className="text-[11px] text-foreground-300">{MISSING_VALUE}</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-12 h-1.5 rounded-full bg-background-200">
                              <div className={`h-full rounded-full ${getAttendanceBar(row.attendance)}`} style={{ width: `${row.attendance}%` }}></div>
                            </div>
                            <span className={`text-[11px] font-semibold ${getAttendanceTone(row.attendance)}`}>{row.attendance}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.present === null || row.absent === null ? (
                          <span className="text-[11px] text-foreground-300">{MISSING_VALUE}</span>
                        ) : (
                          <span className="text-[11px]">
                            <span className="text-emerald-600 font-medium">{row.present}</span>
                            <span className="text-foreground-300">/</span>
                            <span className="text-red-600 font-medium">{row.absent}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center"><span className="text-[11px] text-foreground-300">{formatCount(row.catchup)}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        <i className={`${row.trend === 'up' ? 'ri-arrow-up-line text-emerald-500' : row.trend === 'down' ? 'ri-arrow-down-line text-red-500' : 'ri-subtract-line text-foreground-400'} text-sm`}></i>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${getDisplayRiskClasses(row)}`}>{getDisplayRiskLabel(row)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center"><span className="text-[11px] text-foreground-500">{displayText(row.lastSession)}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        {row.consecutiveMissed ? (
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${row.consecutiveMissed >= 3 ? 'bg-red-100 text-red-700' : row.consecutiveMissed >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-600'}`}>{row.consecutiveMissed}</span>
                        ) : (
                          <span className="text-[11px] text-foreground-300">{MISSING_VALUE}</span>
                        )}
                      </td>
                      <td className="pr-4 py-2.5 text-center"><i className={`text-foreground-300 text-sm transition-transform duration-300 ${isSel ? 'ri-arrow-up-s-line rotate-180' : 'ri-arrow-down-s-line'}`}></i></td>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

<<<<<<< HEAD
          {/* Pagination bar */}
          <div className="px-4 py-3 bg-background-100/30 border-t border-background-200/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-foreground-400">
              <span>Showing {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} learners</span>
=======
          <div className="px-4 py-3 bg-background-100/30 border-t border-background-200/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-foreground-400">
              <span>Showing {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}-{Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} learners</span>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
              <span className="text-foreground-300">|</span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
<<<<<<< HEAD
              {/* Items per page */}
              <select
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="px-2 py-1 bg-background-100 border border-foreground-200 rounded-lg text-[11px] text-foreground-700 cursor-pointer focus:outline-none"
              >
=======
              <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="px-2 py-1 bg-background-100 border border-foreground-200 rounded-lg text-[11px] text-foreground-700 cursor-pointer focus:outline-none">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
<<<<<<< HEAD
              {/* Page buttons */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="ri-skip-back-line"></i>
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="ri-arrow-left-s-line"></i>
              </button>
              {/* Page numbers */}
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-smooth cursor-pointer ${currentPage === pageNum ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200'}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="ri-arrow-right-s-line"></i>
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="ri-skip-forward-line"></i>
              </button>
=======
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-skip-back-line"></i></button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-arrow-left-s-line"></i></button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;
                  return (
                    <button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-7 h-7 rounded-lg text-[11px] font-medium transition-smooth cursor-pointer ${currentPage === pageNum ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>{pageNum}</button>
                  );
                })}
              </div>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-arrow-right-s-line"></i></button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-skip-forward-line"></i></button>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            </div>
          </div>
        </div>
      </div>

<<<<<<< HEAD
      {/* ═══════ Right Slide Panel ═══════ */}
      <RightSlidePanel
        isOpen={selectedLearner !== null}
        onClose={() => { setSelectedLearnerId(null); setShowEmployerDropdown(false); }}
        title={selectedLearner?.learner || 'Learner Detail'}
        width="w-[520px]"
      >
        {selectedLearner && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${selectedLearner.risk === 'red' ? 'bg-red-100 text-red-700 ring-red-200' : selectedLearner.risk === 'amber' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
=======
      <RightSlidePanel isOpen={selectedLearner !== null} onClose={() => setSelectedLearnerId(null)} title={selectedLearner?.learner || 'Learner Detail'} width="w-[520px]">
        {selectedLearner && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${getAvatarClasses(selectedLearner.risk)}`}>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                <span className="text-lg font-bold">{selectedLearner.initials}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
<<<<<<< HEAD
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${selectedLearner.risk === 'green' ? 'bg-emerald-100 text-emerald-700' : selectedLearner.risk === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {selectedLearner.risk === 'green' ? 'On Track' : selectedLearner.risk === 'amber' ? 'Needs Attention' : 'At Risk'}
                  </span>
                  <span className="text-[10px] text-foreground-400">{selectedLearner.programme}</span>
                </div>
                <p className="text-[12px] text-foreground-400">{selectedLearner.employer} · {selectedLearner.cohort}</p>
                <p className="text-[11px] text-foreground-300 mt-0.5">{selectedLearner.group} · Last session: {selectedLearner.lastSession}</p>
              </div>
            </div>

            {/* Attendance Alert for at-risk */}
=======
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getDisplayRiskClasses(selectedLearner)}`}>{getDisplayRiskLabel(selectedLearner)}</span>
                  {selectedLearner.isOnBreak && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/70">Excluded from attendance metrics</span>}
                  <span className="text-[10px] text-foreground-400">{displayText(selectedLearner.programme)}</span>
                </div>
                <p className="text-[12px] text-foreground-400">{displayText(selectedLearner.employer)} - {displayText(selectedLearner.cohort)}</p>
                <p className="text-[11px] text-foreground-300 mt-0.5">{displayText(selectedLearner.group)} - Last session: {displayText(selectedLearner.lastSession)}</p>
              </div>
            </div>

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            {selectedLearner.risk === 'red' && (
              <div className="bg-red-50/50 rounded-xl border border-red-200/30 p-4">
                <h4 className="text-[11px] font-semibold text-red-700 mb-2 flex items-center gap-1.5"><i className="ri-alert-line"></i> Attendance Alert</h4>
                <div className="flex flex-wrap gap-1.5">
<<<<<<< HEAD
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">Attendance {selectedLearner.attendance}%</span>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{selectedLearner.absent} sessions missed</span>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{selectedLearner.catchup} catch-ups pending</span>
                </div>
                <p className="text-[11px] text-red-500 mt-2">Next session: {selectedLearner.nextSession}</p>
              </div>
            )}

            {/* ═══════ Donut Charts Grid ═══════ */}
=======
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">Attendance {formatPercent(selectedLearner.attendance)}</span>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{formatCount(selectedLearner.absent)} sessions missed</span>
                </div>
              </div>
            )}

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedLearner.overallProgress} size={64} color="primary" />
                <div>
                  <p className="text-[10px] text-foreground-400">Overall Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.overallProgress}%</p>
<<<<<<< HEAD
                  <p className="text-[9px] text-foreground-300">{selectedLearner.overallProgress >= 70 ? 'On Track' : 'Needs Support'}</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedLearner.attendance} size={64} color={selectedLearner.attendance >= 90 ? 'emerald' : selectedLearner.attendance >= 80 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">Attendance</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.attendance}%</p>
                  <p className="text-[9px] text-foreground-300">{selectedLearner.attendance >= 90 ? 'Excellent' : selectedLearner.attendance >= 80 ? 'Good' : 'At Risk'}</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} size={64} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">OTJH</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
                  <p className="text-[9px] text-foreground-300">{Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)}% of target</p>
=======
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                {selectedLearner.attendance === null ? (
                  <div className="w-16 h-16 rounded-full bg-background-100 flex items-center justify-center text-foreground-300 font-bold">{MISSING_VALUE}</div>
                ) : (
                  <DonutChart percentage={selectedLearner.attendance} size={64} color={selectedLearner.attendance >= 90 ? 'emerald' : selectedLearner.attendance >= 80 ? 'amber' : 'red'} />
                )}
                <div>
                  <p className="text-[10px] text-foreground-400">Attendance</p>
                  <p className="text-lg font-bold text-foreground-900">{formatPercent(selectedLearner.attendance)}</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={safePercentage(selectedLearner.otjhCompleted, selectedLearner.otjhTarget)} size={64} color={safePercentage(selectedLearner.otjhCompleted, selectedLearner.otjhTarget) >= 70 ? 'emerald' : safePercentage(selectedLearner.otjhCompleted, selectedLearner.otjhTarget) >= 40 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">OTJH</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedLearner.ksbProgress} size={64} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">KSB Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.ksbProgress}%</p>
<<<<<<< HEAD
                  <p className="text-[9px] text-foreground-300">{selectedLearner.ksbProgress >= 70 ? 'On pace' : 'Needs Support'}</p>
=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                </div>
              </div>
            </div>

<<<<<<< HEAD
            {/* Session Stats */}
            <div className="space-y-2.5">
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Sessions</span>
                <span className="text-foreground-900 font-medium">{selectedLearner.present}/{selectedLearner.sessions}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Absent</span>
                <span className="text-red-600 font-medium">{selectedLearner.absent}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Late</span>
                <span className={`font-medium ${selectedLearner.late > 2 ? 'text-amber-600' : 'text-foreground-900'}`}>{selectedLearner.late}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Catch-ups</span>
                <span className={`font-medium ${selectedLearner.catchup > 2 ? 'text-red-600' : 'text-foreground-900'}`}>{selectedLearner.catchup}</span>
              </div>
              <div className="flex justify-between py-2 text-[12px]">
                <span className="text-foreground-400">Last Session</span>
                <span className="text-foreground-900 font-medium">{selectedLearner.lastSession}</span>
              </div>
              <div className="flex justify-between py-2 text-[12px]">
                <span className="text-foreground-400">Next Session</span>
                <span className="text-foreground-900 font-medium">{selectedLearner.nextSession}</span>
              </div>
            </div>

            {/* ═══════ Actions ═══════ */}
=======
            <div className="space-y-2.5">
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Sessions</span><span className="text-foreground-900 font-medium">{selectedLearner.present === null || selectedLearner.sessions === null ? MISSING_VALUE : `${selectedLearner.present}/${selectedLearner.sessions}`}</span></div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Absent</span><span className="text-red-600 font-medium">{formatCount(selectedLearner.absent)}</span></div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Catch-ups</span><span className="text-foreground-900 font-medium">{formatCount(selectedLearner.catchup)}</span></div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Consecutive missed</span><span className="text-foreground-900 font-medium">{formatCount(selectedLearner.consecutiveMissed)}</span></div>
              <div className="flex justify-between py-2 text-[12px]"><span className="text-foreground-400">Last Session</span><span className="text-foreground-900 font-medium">{displayText(selectedLearner.lastSession)}</span></div>
            </div>

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            <div className="flex flex-col gap-2 pt-2">
              <button onClick={() => handleSendMessage(selectedLearner)} className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
                <i className="ri-mail-line"></i> Send Message
              </button>
<<<<<<< HEAD
              <button onClick={() => { info(`Catch-up scheduled for ${selectedLearner.learner}`, 'Session booking initiated'); }} className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
=======
              <button onClick={() => info(`Catch-up source is not connected yet`, 'No catch-up table is mapped to this page')} className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                <i className="ri-timer-line"></i> Schedule Catch-up
              </button>
              <button onClick={() => handleViewProfile(selectedLearner)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
                <i className="ri-file-chart-line"></i> View Full Profile
              </button>
<<<<<<< HEAD
              <div className="relative">
                <button onClick={() => setShowEmployerDropdown(!showEmployerDropdown)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1">
                  <i className="ri-building-2-line mr-1.5"></i> Contact Employer
                  <i className={`ri-arrow-down-s-line text-xs transition-transform ${showEmployerDropdown ? 'rotate-180' : ''}`}></i>
                </button>
                {showEmployerDropdown && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-background-50 rounded-xl border border-background-200 shadow-xl overflow-hidden z-50">
                    <button onClick={() => handleSendMessage(selectedLearner)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer">
                      <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600"><i className="ri-message-3-line text-xs"></i></span>
                      <div>
                        <p className="font-medium">Send Message</p>
                        <p className="text-[10px] text-foreground-400">Open in-app chat</p>
                      </div>
                    </button>
                    <button onClick={() => handleEmailEmployer(selectedLearner)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                      <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center text-accent-600"><i className="ri-mail-send-line text-xs"></i></span>
                      <div>
                        <p className="font-medium">Email</p>
                        <p className="text-[10px] text-foreground-400">hr@{selectedLearner.employer.toLowerCase().replace(/\s+/g, '')}.co.uk</p>
                      </div>
                    </button>
                    <button onClick={handleZoomCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                      <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><i className="ri-video-line text-xs"></i></span>
                      <div>
                        <p className="font-medium">Call via Zoom</p>
                        <p className="text-[10px] text-foreground-400">Start video meeting</p>
                      </div>
                    </button>
                    <button onClick={handleOutlookCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                      <span className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600"><i className="ri-calendar-event-line text-xs"></i></span>
                      <div>
                        <p className="font-medium">Schedule via Outlook</p>
                        <p className="text-[10px] text-foreground-400">Book calendar meeting</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            </div>
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
