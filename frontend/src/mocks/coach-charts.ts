export interface AttendanceTrend {
  month: string;
  attendanceRate: number;
}

export interface KSBTrend {
  month: string;
  knowledge: number;
  skills: number;
  behaviours: number;
}

export interface CohortInfo {
  id: string;
  name: string;
  programme: string;
  startDate: string;
  group: string;
}

export const ATTENDANCE_TRENDS_6M: AttendanceTrend[] = [
  { month: 'Jan', attendanceRate: 94 },
  { month: 'Feb', attendanceRate: 92 },
  { month: 'Mar', attendanceRate: 90 },
  { month: 'Apr', attendanceRate: 88 },
  { month: 'May', attendanceRate: 91 },
  { month: 'Jun', attendanceRate: 93 },
];

export const KSB_PROGRESS_TRENDS_6M: KSBTrend[] = [
  { month: 'Jan', knowledge: 28, skills: 24, behaviours: 20 },
  { month: 'Feb', knowledge: 34, skills: 30, behaviours: 25 },
  { month: 'Mar', knowledge: 40, skills: 36, behaviours: 30 },
  { month: 'Apr', knowledge: 46, skills: 42, behaviours: 36 },
  { month: 'May', knowledge: 52, skills: 48, behaviours: 42 },
  { month: 'Jun', knowledge: 58, skills: 54, behaviours: 48 },
];

export const PER_LEARNER_ATTENDANCE: Record<string, number[]> = {
  'lrn-001': [90, 88, 85, 83, 87, 86],
  'lrn-002': [95, 93, 94, 92, 96, 94],
  'lrn-004': [0, 0, 0, 0, 0, 0],
  'lrn-007': [80, 78, 74, 72, 70, 71],
  'lrn-009': [100, 100, 100, 100, 100, 100],
  'lrn-010': [92, 90, 88, 87, 90, 89],
};

export const PER_LEARNER_KSB: Record<string, number[]> = {
  'lrn-001': [35, 36, 37, 37, 38, 38],
  'lrn-002': [40, 41, 42, 43, 44, 44],
  'lrn-004': [0, 0, 0, 0, 0, 0],
  'lrn-007': [20, 19, 18, 18, 18, 18],
  'lrn-009': [6, 8, 9, 10, 10, 10],
  'lrn-010': [28, 29, 30, 31, 32, 32],
};

export const ATTENDANCE_SPARKLINE = [94, 92, 90, 88, 89, 91, 93, 92, 94, 95, 93, 91];
export const KSB_SPARKLINE = [28, 34, 40, 46, 52, 58, 62, 68, 74, 76, 80, 82];

export const COHORTS: CohortInfo[] = [
  { id: 'coh-001', name: 'MKT-L4-2025A', programme: 'Marketing Executive L4', startDate: 'Jan 2025', group: 'Group A' },
  { id: 'coh-002', name: 'MKT-L4-2025B', programme: 'Marketing Executive L4', startDate: 'Mar 2025', group: 'Group B' },
  { id: 'coh-003', name: 'DA-L4-2025A', programme: 'Data Analyst L4', startDate: 'Jan 2025', group: 'Group A' },
  { id: 'coh-004', name: 'PM-L4-2025A', programme: 'Project Manager L4', startDate: 'Feb 2025', group: 'Group A' },
  { id: 'coh-005', name: 'BA-L3-2025A', programme: 'Business Admin L3', startDate: 'Apr 2025', group: 'Group A' },
  { id: 'coh-006', name: 'BA-L3-2025B', programme: 'Business Admin L3', startDate: 'May 2025', group: 'Group B' },
  { id: 'coh-007', name: 'DM-L3-2025A', programme: 'Digital Marketer L3', startDate: 'Feb 2025', group: 'Group A' },
  { id: 'coh-008', name: 'SD-L4-2025A', programme: 'Software Developer L4', startDate: 'Jan 2025', group: 'Group A' },
  { id: 'coh-009', name: 'HR-L5-2025A', programme: 'HR Consultant L5', startDate: 'Mar 2025', group: 'Group A' },
  { id: 'coh-010', name: 'ACC-L3-2025A', programme: 'Accountancy L3', startDate: 'Apr 2025', group: 'Group A' },
];