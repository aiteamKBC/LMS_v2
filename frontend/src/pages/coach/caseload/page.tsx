import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import SparklineChart from '@/components/feature/SparklineChart';
import { roleNavMap } from '@/mocks/navigation';
import { COHORTS, PER_LEARNER_ATTENDANCE, PER_LEARNER_KSB } from '@/mocks/coach-charts';

const coachNav = roleNavMap.coach;

const CURRENT_DATE = new Date('2026-06-20');

function getDaysSince(dateStr: string): number {
  const d = new Date(dateStr + ' 2026');
  return Math.floor((CURRENT_DATE.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function dateSeverity(days: number, thresholds: { amber: number; red: number }): 'normal' | 'amber' | 'red' {
  if (days >= thresholds.red) return 'red';
  if (days >= thresholds.amber) return 'amber';
  return 'normal';
}

const DATE_THRESHOLDS = {
  lastAttendance: { amber: 5, red: 10 },
  lastCoaching: { amber: 21, red: 35 },
  lastReview: { amber: 45, red: 75 },
  lastEvidence: { amber: 14, red: 28 },
};

const DATE_COLORS = {
  normal: 'text-foreground-900',
  amber: 'text-amber-600',
  red: 'text-red-600',
};

const DATE_BG = {
  normal: '',
  amber: 'bg-amber-50/50 rounded px-1.5 py-0.5',
  red: 'bg-red-50/50 rounded px-1.5 py-0.5',
};

type PerformanceStatus = 'at-risk' | 'on-track' | 'high' | 'new-starter';
type EnrollmentStatus = 'all' | 'active' | 'break' | 'withdrawn';

interface Learner {
  id: string;
  name: string;
  initials: string;
  programme: string;
  employer: string;
  cohortId: string;
  cohortName: string;
  group: string;
  status: PerformanceStatus;
  enrollmentStatus: EnrollmentStatus;
  riskFlags: string[];
  overallProgress: number;
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  evidenceCount: number;
  nextCoaching: string;
  nextReview: string;
  lastContact: string;
  lastAttendanceDate: string;
  lastProgressReview: string;
  lastReview: string;
  lastCoachingSession: string;
  lastSubmittedEvidence: string;
  recentFlag: string | null;
  attendanceHistory: number[];
  ksbHistory: number[];
  email?: string;
  employerEmail?: string;
  employerPhone?: string;
}

const LEARNERS: Learner[] = [
  { id: '1', name: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', cohortId: 'coh-001', cohortName: 'MKT-L4-2025A', group: 'Group A', status: 'at-risk', enrollmentStatus: 'active', riskFlags: ['Attendance 86%', 'OTJH behind pace', 'KSB Amber'], overallProgress: 42, attendanceRate: 86, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 38, evidenceCount: 12, nextCoaching: '18 Jun 2026', nextReview: '25 Jun 2026', lastContact: '7 Jun 2026', lastAttendanceDate: '4 Jun 2026', lastProgressReview: '18 Apr 2026', lastReview: '18 Apr 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '2 Jun 2026', recentFlag: 'OTJH pace concern', attendanceHistory: PER_LEARNER_ATTENDANCE['lrn-001'] || [86, 86, 86, 86, 86, 86], ksbHistory: PER_LEARNER_KSB['lrn-001'] || [38, 38, 38, 38, 38, 38], email: 'sophie.williams@example.com', employerEmail: 'hr@timhortons.co.uk', employerPhone: '+44 20 7946 0958' },
  { id: '2', name: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', employer: 'Medway NHS Trust', cohortId: 'coh-003', cohortName: 'DA-L4-2025A', group: 'Group A', status: 'at-risk', enrollmentStatus: 'active', riskFlags: ['Attendance 78%', 'Evidence overdue', 'OTJH Red'], overallProgress: 28, attendanceRate: 78, otjhCompleted: 22, otjhTarget: 100, ksbProgress: 25, evidenceCount: 5, nextCoaching: '12 Jun 2026', nextReview: '19 Jun 2026', lastContact: '5 Jun 2026', lastAttendanceDate: '3 Jun 2026', lastProgressReview: '15 Mar 2026', lastReview: '15 Mar 2026', lastCoachingSession: '2 Jun 2026', lastSubmittedEvidence: '28 May 2026', recentFlag: 'Missed last 2 sessions', attendanceHistory: [85, 82, 80, 79, 78, 78], ksbHistory: [20, 21, 22, 23, 24, 25], email: 'james.okonkwo@example.com', employerEmail: 'workforce@medway.nhs.uk', employerPhone: '+44 1634 825000' },
  { id: '3', name: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', employer: 'Ashford Accounting', cohortId: 'coh-010', cohortName: 'ACC-L3-2025A', group: 'Group A', status: 'at-risk', enrollmentStatus: 'active', riskFlags: ['KSB stagnant', 'Low engagement'], overallProgress: 31, attendanceRate: 83, otjhCompleted: 30, otjhTarget: 100, ksbProgress: 22, evidenceCount: 4, nextCoaching: '14 Jun 2026', nextReview: '21 Jun 2026', lastContact: '8 Jun 2026', lastAttendanceDate: '5 Jun 2026', lastProgressReview: '20 Apr 2026', lastReview: '20 Apr 2026', lastCoachingSession: '6 Jun 2026', lastSubmittedEvidence: '15 May 2026', recentFlag: '3 weeks no evidence', attendanceHistory: [88, 86, 85, 84, 83, 83], ksbHistory: [18, 19, 20, 21, 21, 22], email: 'aisha.patel@example.com', employerEmail: 'contact@ashfordaccounting.co.uk', employerPhone: '+44 1233 610000' },
  { id: '4', name: 'Sarah Mitchell', initials: 'SM', programme: 'Business Admin L3', employer: 'Kent County Council', cohortId: 'coh-005', cohortName: 'BA-L3-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 68, attendanceRate: 94, otjhCompleted: 88, otjhTarget: 120, ksbProgress: 72, evidenceCount: 22, nextCoaching: '13 Jun 2026', nextReview: '20 Jun 2026', lastContact: '6 Jun 2026', lastAttendanceDate: '5 Jun 2026', lastProgressReview: '15 May 2026', lastReview: '15 May 2026', lastCoachingSession: '4 Jun 2026', lastSubmittedEvidence: '30 May 2026', recentFlag: null, attendanceHistory: [92, 93, 94, 94, 95, 94], ksbHistory: [62, 64, 66, 68, 70, 72], email: 'sarah.mitchell@example.com', employerEmail: 'apprenticeships@kent.gov.uk', employerPhone: '+44 300 041 4141' },
  { id: '5', name: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', cohortId: 'coh-007', cohortName: 'DM-L3-2025A', group: 'Group A', status: 'high', enrollmentStatus: 'active', riskFlags: [], overallProgress: 85, attendanceRate: 100, otjhCompleted: 110, otjhTarget: 120, ksbProgress: 92, evidenceCount: 28, nextCoaching: '11 Jun 2026', nextReview: '18 Jun 2026', lastContact: '7 Jun 2026', lastAttendanceDate: '7 Jun 2026', lastProgressReview: '12 May 2026', lastReview: '12 May 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '1 Jun 2026', recentFlag: null, attendanceHistory: [100, 100, 100, 100, 100, 100], ksbHistory: [78, 82, 85, 88, 90, 92], email: 'emily.watson@example.com', employerEmail: 'team@canterburycreative.co.uk', employerPhone: '+44 1227 788000' },
  { id: '6', name: 'David Chen', initials: 'DC', programme: 'Software Developer L4', employer: 'Tech Kent Ltd', cohortId: 'coh-008', cohortName: 'SD-L4-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 55, attendanceRate: 94, otjhCompleted: 62, otjhTarget: 110, ksbProgress: 58, evidenceCount: 16, nextCoaching: '16 Jun 2026', nextReview: '23 Jun 2026', lastContact: '4 Jun 2026', lastAttendanceDate: '3 Jun 2026', lastProgressReview: '10 May 2026', lastReview: '10 May 2026', lastCoachingSession: '2 Jun 2026', lastSubmittedEvidence: '29 May 2026', recentFlag: null, attendanceHistory: [93, 94, 94, 95, 94, 94], ksbHistory: [48, 50, 52, 54, 56, 58], email: 'david.chen@example.com', employerEmail: 'hello@techkent.co.uk', employerPhone: '+44 20 7946 0123' },
  { id: '7', name: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', employer: 'BAM Construction', cohortId: 'coh-004', cohortName: 'PM-L4-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 60, attendanceRate: 91, otjhCompleted: 72, otjhTarget: 120, ksbProgress: 64, evidenceCount: 18, nextCoaching: '15 Jun 2026', nextReview: '22 Jun 2026', lastContact: '7 Jun 2026', lastAttendanceDate: '6 Jun 2026', lastProgressReview: '15 May 2026', lastReview: '15 May 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '30 May 2026', recentFlag: null, attendanceHistory: [90, 91, 91, 92, 91, 91], ksbHistory: [54, 56, 58, 60, 62, 64], email: 'liam.foster@example.com', employerEmail: 'hr@bam.co.uk', employerPhone: '+44 20 7636 1000' },
  { id: '8', name: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', employer: 'Southend Council', cohortId: 'coh-009', cohortName: 'HR-L5-2025A', group: 'Group A', status: 'new-starter', enrollmentStatus: 'active', riskFlags: [], overallProgress: 12, attendanceRate: 100, otjhCompleted: 8, otjhTarget: 80, ksbProgress: 10, evidenceCount: 2, nextCoaching: '17 Jun 2026', nextReview: '24 Jun 2026', lastContact: '9 Jun 2026', lastAttendanceDate: '9 Jun 2026', lastProgressReview: '5 Jun 2026', lastReview: '5 Jun 2026', lastCoachingSession: '8 Jun 2026', lastSubmittedEvidence: '7 Jun 2026', recentFlag: 'Onboarding week 2', attendanceHistory: [100, 100, 100, 100, 100, 100], ksbHistory: [4, 6, 7, 8, 9, 10], email: 'maya.kapoor@example.com', employerEmail: 'workforce@southend.gov.uk', employerPhone: '+44 1702 215000' },
  { id: '9', name: 'Oliver Thompson', initials: 'OT', programme: 'Business Admin L3', employer: 'Dartford Council', cohortId: 'coh-006', cohortName: 'BA-L3-2025B', group: 'Group B', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 45, attendanceRate: 96, otjhCompleted: 52, otjhTarget: 110, ksbProgress: 48, evidenceCount: 14, nextCoaching: '20 Jun 2026', nextReview: '27 Jun 2026', lastContact: '10 Jun 2026', lastAttendanceDate: '9 Jun 2026', lastProgressReview: '10 May 2026', lastReview: '10 May 2026', lastCoachingSession: '8 Jun 2026', lastSubmittedEvidence: '1 Jun 2026', recentFlag: null, attendanceHistory: [95, 95, 96, 96, 96, 96], ksbHistory: [38, 40, 42, 44, 46, 48], email: 'oliver.thompson@example.com', employerEmail: 'apprentices@dartford.gov.uk', employerPhone: '+44 1322 343000' },
  { id: '10', name: 'Grace Liu', initials: 'GL', programme: 'Data Analyst L4', employer: 'Invicta Health', cohortId: 'coh-003', cohortName: 'DA-L4-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 52, attendanceRate: 92, otjhCompleted: 58, otjhTarget: 110, ksbProgress: 54, evidenceCount: 17, nextCoaching: '19 Jun 2026', nextReview: '26 Jun 2026', lastContact: '9 Jun 2026', lastAttendanceDate: '8 Jun 2026', lastProgressReview: '12 May 2026', lastReview: '12 May 2026', lastCoachingSession: '7 Jun 2026', lastSubmittedEvidence: '25 May 2026', recentFlag: null, attendanceHistory: [91, 92, 92, 93, 92, 92], ksbHistory: [44, 46, 48, 50, 52, 54], email: 'grace.liu@example.com', employerEmail: 'talent@invicta.health', employerPhone: '+44 1622 721000' },
  { id: '11', name: 'Noah Bennett', initials: 'NB', programme: 'Marketing Executive L4', employer: 'Canterbury Creative', cohortId: 'coh-002', cohortName: 'MKT-L4-2025B', group: 'Group B', status: 'at-risk', enrollmentStatus: 'active', riskFlags: ['Attendance 82%'], overallProgress: 35, attendanceRate: 82, otjhCompleted: 38, otjhTarget: 120, ksbProgress: 32, evidenceCount: 7, nextCoaching: '21 Jun 2026', nextReview: '28 Jun 2026', lastContact: '8 Jun 2026', lastAttendanceDate: '5 Jun 2026', lastProgressReview: '10 Apr 2026', lastReview: '10 Apr 2026', lastCoachingSession: '6 Jun 2026', lastSubmittedEvidence: '20 May 2026', recentFlag: 'Attendance dropping', attendanceHistory: [88, 86, 84, 83, 82, 82], ksbHistory: [26, 27, 28, 30, 31, 32], email: 'noah.bennett@example.com', employerEmail: 'team@canterburycreative.co.uk', employerPhone: '+44 1227 788000' },
  { id: '12', name: 'Isla Morgan', initials: 'IM', programme: 'Business Admin L3', employer: 'Tonbridge Council', cohortId: 'coh-006', cohortName: 'BA-L3-2025B', group: 'Group B', status: 'high', enrollmentStatus: 'active', riskFlags: [], overallProgress: 78, attendanceRate: 100, otjhCompleted: 92, otjhTarget: 110, ksbProgress: 82, evidenceCount: 25, nextCoaching: '15 Jun 2026', nextReview: '22 Jun 2026', lastContact: '7 Jun 2026', lastAttendanceDate: '7 Jun 2026', lastProgressReview: '15 May 2026', lastReview: '15 May 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '31 May 2026', recentFlag: null, attendanceHistory: [98, 99, 100, 100, 100, 100], ksbHistory: [68, 72, 74, 76, 80, 82], email: 'isla.morgan@example.com', employerEmail: 'apprentices@tonbridge.gov.uk', employerPhone: '+44 1732 844522' },
  { id: '13', name: 'Jacob Hayes', initials: 'JH', programme: 'Digital Marketer L3', employer: 'Gravesham Ltd', cohortId: 'coh-007', cohortName: 'DM-L3-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 50, attendanceRate: 93, otjhCompleted: 55, otjhTarget: 120, ksbProgress: 46, evidenceCount: 13, nextCoaching: '18 Jun 2026', nextReview: '25 Jun 2026', lastContact: '6 Jun 2026', lastAttendanceDate: '5 Jun 2026', lastProgressReview: '10 May 2026', lastReview: '10 May 2026', lastCoachingSession: '4 Jun 2026', lastSubmittedEvidence: '28 May 2026', recentFlag: null, attendanceHistory: [92, 92, 93, 93, 93, 93], ksbHistory: [36, 38, 40, 42, 44, 46], email: 'jacob.hayes@example.com', employerEmail: 'hr@gravesham.co.uk', employerPhone: '+44 1474 337000' },
  { id: '14', name: 'Amara Osei', initials: 'AO', programme: 'Software Developer L4', employer: 'Medway Tech', cohortId: 'coh-008', cohortName: 'SD-L4-2025A', group: 'Group A', status: 'new-starter', enrollmentStatus: 'active', riskFlags: [], overallProgress: 15, attendanceRate: 100, otjhCompleted: 10, otjhTarget: 80, ksbProgress: 12, evidenceCount: 3, nextCoaching: '22 Jun 2026', nextReview: '29 Jun 2026', lastContact: '10 Jun 2026', lastAttendanceDate: '10 Jun 2026', lastProgressReview: '5 Jun 2026', lastReview: '5 Jun 2026', lastCoachingSession: '9 Jun 2026', lastSubmittedEvidence: '8 Jun 2026', recentFlag: 'Just started week 1', attendanceHistory: [100, 100, 100, 100, 100, 100], ksbHistory: [4, 6, 8, 10, 11, 12], email: 'amara.osei@example.com', employerEmail: 'careers@medwaytech.co.uk', employerPhone: '+44 1634 791000' },
  { id: '15', name: 'Harper Singh', initials: 'HS', programme: 'Accountancy L3', employer: 'Kent Accountants', cohortId: 'coh-010', cohortName: 'ACC-L3-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'break', riskFlags: [], overallProgress: 58, attendanceRate: 95, otjhCompleted: 66, otjhTarget: 110, ksbProgress: 56, evidenceCount: 19, nextCoaching: '17 Jun 2026', nextReview: '24 Jun 2026', lastContact: '8 Jun 2026', lastAttendanceDate: '7 Jun 2026', lastProgressReview: '15 Apr 2026', lastReview: '15 Apr 2026', lastCoachingSession: '6 Jun 2026', lastSubmittedEvidence: '25 May 2026', recentFlag: null, attendanceHistory: [94, 94, 95, 95, 96, 95], ksbHistory: [46, 48, 50, 52, 54, 56], email: 'harper.singh@example.com', employerEmail: 'info@kentaccountants.co.uk', employerPhone: '+44 1622 678000' },
  { id: '16', name: 'Finn Murphy', initials: 'FM', programme: 'Project Manager L4', employer: 'BAM Construction', cohortId: 'coh-004', cohortName: 'PM-L4-2025A', group: 'Group A', status: 'at-risk', enrollmentStatus: 'active', riskFlags: ['OTJH behind', 'Low evidence'], overallProgress: 33, attendanceRate: 85, otjhCompleted: 34, otjhTarget: 100, ksbProgress: 28, evidenceCount: 6, nextCoaching: '16 Jun 2026', nextReview: '23 Jun 2026', lastContact: '5 Jun 2026', lastAttendanceDate: '3 Jun 2026', lastProgressReview: '20 Apr 2026', lastReview: '20 Apr 2026', lastCoachingSession: '2 Jun 2026', lastSubmittedEvidence: '15 May 2026', recentFlag: '2 months behind', attendanceHistory: [90, 88, 86, 85, 85, 85], ksbHistory: [22, 23, 24, 26, 27, 28], email: 'finn.murphy@example.com', employerEmail: 'hr@bam.co.uk', employerPhone: '+44 20 7636 1000' },
  { id: '17', name: 'Zara Ahmed', initials: 'ZA', programme: 'HR Consultant L5', employer: 'Canterbury NHS', cohortId: 'coh-009', cohortName: 'HR-L5-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 62, attendanceRate: 97, otjhCompleted: 70, otjhTarget: 120, ksbProgress: 60, evidenceCount: 20, nextCoaching: '19 Jun 2026', nextReview: '26 Jun 2026', lastContact: '9 Jun 2026', lastAttendanceDate: '8 Jun 2026', lastProgressReview: '15 May 2026', lastReview: '15 May 2026', lastCoachingSession: '7 Jun 2026', lastSubmittedEvidence: '30 May 2026', recentFlag: null, attendanceHistory: [96, 96, 97, 97, 97, 97], ksbHistory: [50, 52, 54, 56, 58, 60], email: 'zara.ahmed@example.com', employerEmail: 'workforce@canterbury.nhs.uk', employerPhone: '+44 1227 766877' },
  { id: '18', name: 'Elias Wright', initials: 'EW', programme: 'Data Analyst L4', employer: 'Ashford Data', cohortId: 'coh-003', cohortName: 'DA-L4-2025A', group: 'Group A', status: 'high', enrollmentStatus: 'active', riskFlags: [], overallProgress: 90, attendanceRate: 100, otjhCompleted: 102, otjhTarget: 110, ksbProgress: 88, evidenceCount: 30, nextCoaching: '12 Jun 2026', nextReview: '19 Jun 2026', lastContact: '8 Jun 2026', lastAttendanceDate: '8 Jun 2026', lastProgressReview: '10 May 2026', lastReview: '10 May 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '1 Jun 2026', recentFlag: null, attendanceHistory: [100, 100, 100, 100, 100, 100], ksbHistory: [74, 78, 80, 83, 86, 88], email: 'elias.wright@example.com', employerEmail: 'team@ashforddata.co.uk', employerPhone: '+44 1233 610000' },
  { id: '19', name: 'Luna Rivera', initials: 'LR', programme: 'Marketing Executive L4', employer: 'Southend Media', cohortId: 'coh-002', cohortName: 'MKT-L4-2025B', group: 'Group B', status: 'on-track', enrollmentStatus: 'break', riskFlags: [], overallProgress: 48, attendanceRate: 91, otjhCompleted: 54, otjhTarget: 120, ksbProgress: 44, evidenceCount: 15, nextCoaching: '21 Jun 2026', nextReview: '28 Jun 2026', lastContact: '7 Jun 2026', lastAttendanceDate: '6 Jun 2026', lastProgressReview: '10 Apr 2026', lastReview: '10 Apr 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '20 May 2026', recentFlag: null, attendanceHistory: [90, 91, 91, 91, 92, 91], ksbHistory: [34, 36, 38, 40, 42, 44], email: 'luna.rivera@example.com', employerEmail: 'careers@southendmedia.co.uk', employerPhone: '+44 1702 215000' },
  { id: '20', name: 'Theo Park', initials: 'TP', programme: 'Business Admin L3', employer: 'Dartford Council', cohortId: 'coh-006', cohortName: 'BA-L3-2025B', group: 'Group B', status: 'new-starter', enrollmentStatus: 'active', riskFlags: [], overallProgress: 18, attendanceRate: 100, otjhCompleted: 14, otjhTarget: 80, ksbProgress: 16, evidenceCount: 4, nextCoaching: '20 Jun 2026', nextReview: '27 Jun 2026', lastContact: '10 Jun 2026', lastAttendanceDate: '10 Jun 2026', lastProgressReview: '5 Jun 2026', lastReview: '5 Jun 2026', lastCoachingSession: '9 Jun 2026', lastSubmittedEvidence: '8 Jun 2026', recentFlag: 'Onboarding week 3', attendanceHistory: [100, 100, 100, 100, 100, 100], ksbHistory: [6, 8, 10, 12, 14, 16], email: 'theo.park@example.com', employerEmail: 'apprentices@dartford.gov.uk', employerPhone: '+44 1322 343000' },
  { id: '21', name: 'Mia Duncan', initials: 'MD', programme: 'Digital Marketer L3', employer: 'Kent Digital', cohortId: 'coh-007', cohortName: 'DM-L3-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 54, attendanceRate: 93, otjhCompleted: 60, otjhTarget: 120, ksbProgress: 50, evidenceCount: 16, nextCoaching: '18 Jun 2026', nextReview: '25 Jun 2026', lastContact: '6 Jun 2026', lastAttendanceDate: '5 Jun 2026', lastProgressReview: '15 May 2026', lastReview: '15 May 2026', lastCoachingSession: '4 Jun 2026', lastSubmittedEvidence: '28 May 2026', recentFlag: null, attendanceHistory: [92, 93, 93, 94, 93, 93], ksbHistory: [40, 42, 44, 46, 48, 50], email: 'mia.duncan@example.com', employerEmail: 'hello@kentdigital.co.uk', employerPhone: '+44 1622 678000' },
  { id: '22', name: 'Lucas Graham', initials: 'LG', programme: 'Software Developer L4', employer: 'Tech Kent Ltd', cohortId: 'coh-008', cohortName: 'SD-L4-2025A', group: 'Group A', status: 'at-risk', enrollmentStatus: 'active', riskFlags: ['Attendance 80%'], overallProgress: 30, attendanceRate: 80, otjhCompleted: 28, otjhTarget: 110, ksbProgress: 26, evidenceCount: 8, nextCoaching: '14 Jun 2026', nextReview: '21 Jun 2026', lastContact: '5 Jun 2026', lastAttendanceDate: '3 Jun 2026', lastProgressReview: '20 Apr 2026', lastReview: '20 Apr 2026', lastCoachingSession: '2 Jun 2026', lastSubmittedEvidence: '15 May 2026', recentFlag: 'Attendance concern', attendanceHistory: [86, 84, 82, 81, 80, 80], ksbHistory: [20, 21, 22, 23, 24, 26], email: 'lucas.graham@example.com', employerEmail: 'hello@techkent.co.uk', employerPhone: '+44 20 7946 0123' },
  { id: '23', name: 'Chloe Adams', initials: 'CA', programme: 'Accountancy L3', employer: 'Canterbury Accounting', cohortId: 'coh-010', cohortName: 'ACC-L3-2025A', group: 'Group A', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 65, attendanceRate: 96, otjhCompleted: 72, otjhTarget: 110, ksbProgress: 62, evidenceCount: 21, nextCoaching: '17 Jun 2026', nextReview: '24 Jun 2026', lastContact: '9 Jun 2026', lastAttendanceDate: '8 Jun 2026', lastProgressReview: '10 May 2026', lastReview: '10 May 2026', lastCoachingSession: '7 Jun 2026', lastSubmittedEvidence: '30 May 2026', recentFlag: null, attendanceHistory: [95, 95, 96, 96, 97, 96], ksbHistory: [52, 54, 56, 58, 60, 62], email: 'chloe.adams@example.com', employerEmail: 'contact@canterburyaccounting.co.uk', employerPhone: '+44 1227 788000' },
  { id: '24', name: 'Ryan Cooper', initials: 'RC', programme: 'Project Manager L4', employer: 'BAM Construction', cohortId: 'coh-004', cohortName: 'PM-L4-2025A', group: 'Group A', status: 'high', enrollmentStatus: 'withdrawn', riskFlags: [], overallProgress: 82, attendanceRate: 98, otjhCompleted: 96, otjhTarget: 120, ksbProgress: 86, evidenceCount: 27, nextCoaching: '13 Jun 2026', nextReview: '20 Jun 2026', lastContact: '7 Jun 2026', lastAttendanceDate: '7 Jun 2026', lastProgressReview: '15 May 2026', lastReview: '15 May 2026', lastCoachingSession: '5 Jun 2026', lastSubmittedEvidence: '25 May 2026', recentFlag: null, attendanceHistory: [97, 98, 98, 98, 99, 98], ksbHistory: [72, 76, 78, 80, 84, 86], email: 'ryan.cooper@example.com', employerEmail: 'hr@bam.co.uk', employerPhone: '+44 20 7636 1000' },
];

const THREAD_MAP: Record<string, string> = {
  'Sophie Williams': 'th-01',
  'Tom Richards': 'th-02',
  'James Okonkwo': 'th-11',
  'Aisha Patel': 'th-12',
  'Sarah Mitchell': 'th-13',
  'Emily Watson': 'th-07',
  'David Chen': 'th-04',
  'Liam Foster': 'th-10',
  'Maya Kapoor': 'th-09',
  'Oliver Thompson': 'th-14',
  'Grace Liu': 'th-15',
  'Noah Bennett': 'th-16',
  'Isla Morgan': 'th-17',
  'Jacob Hayes': 'th-18',
  'Amara Osei': 'th-19',
  'Harper Singh': 'th-20',
  'Finn Murphy': 'th-21',
  'Zara Ahmed': 'th-22',
  'Elias Wright': 'th-23',
  'Luna Rivera': 'th-24',
  'Theo Park': 'th-25',
  'Mia Duncan': 'th-26',
  'Lucas Graham': 'th-27',
  'Chloe Adams': 'th-28',
  'Ryan Cooper': 'th-29',
};

const EMPLOYER_THREAD_MAP: Record<string, string> = {
  'Tim Hortons UK': 'th-03',
  'Medway NHS Trust': 'th-31',
  'Ashford Accounting': 'th-30',
  'Kent County Council': 'th-32',
  'Canterbury Creative': 'th-33',
  'Tech Kent Ltd': 'th-34',
  'BAM Construction': 'th-08',
  'Southend Council': 'th-35',
  'Dartford Council': 'th-36',
  'Tonbridge Council': 'th-37',
  'Gravesham Ltd': 'th-38',
  'Medway Tech': 'th-39',
  'Kent Accountants': 'th-40',
  'Invicta Health': 'th-50',
  'Kent Digital': 'th-46',
  'Canterbury Accounting': 'th-48',
  'Southend Media': 'th-52',
  'Ashford Data': 'th-51',
  'Canterbury NHS': 'th-53',
};

const PROGRAMMES = [...new Set(LEARNERS.map(l => l.programme))].sort();
const GROUPS = [...new Set(LEARNERS.map(l => l.group))].sort();

const PAGE_SIZE = 10;

function DonutChart({ percentage, size = 72, strokeWidth = 6, color = 'primary', label }: { percentage: number; size?: number; strokeWidth?: number; color?: string; label?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const colorMap: Record<string, { stroke: string; bg: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', bg: 'bg-primary-50', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', bg: 'bg-accent-50', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', bg: 'bg-amber-50', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', bg: 'bg-red-50', text: 'text-red-700' },
    secondary: { stroke: 'stroke-secondary-500', bg: 'bg-secondary-50', text: 'text-secondary-700' },
  };

  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-background-200"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={`${c.stroke} transition-all duration-700`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
        </div>
      </div>
      {label && <span className="text-[10px] font-medium text-foreground-400">{label}</span>}
    </div>
  );
}

export default function CoachCaseload() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [enrollmentStatusFilter, setEnrollmentStatusFilter] = useState<EnrollmentStatus>('all');
  const [ragFilter, setRagFilter] = useState<PerformanceStatus | 'all'>('all');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'progress' | 'attendance' | 'ksb' | 'otjh'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [showProgressReport, setShowProgressReport] = useState(false);
  const [showEmployerDropdown, setShowEmployerDropdown] = useState(false);

  const filtered = useMemo(() => {
    let list = [...LEARNERS];
    if (enrollmentStatusFilter !== 'all') list = list.filter(l => l.enrollmentStatus === enrollmentStatusFilter);
    if (ragFilter !== 'all') list = list.filter(l => l.status === ragFilter);
    if (cohortFilter !== 'all') list = list.filter(l => l.cohortId === cohortFilter);
    if (programmeFilter !== 'all') list = list.filter(l => l.programme === programmeFilter);
    if (groupFilter !== 'all') list = list.filter(l => l.group === groupFilter);
    if (search) list = list.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || l.programme.toLowerCase().includes(search.toLowerCase()) || l.employer.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'progress': va = a.overallProgress; vb = b.overallProgress; break;
        case 'attendance': va = a.attendanceRate; vb = b.attendanceRate; break;
        case 'ksb': va = a.ksbProgress; vb = b.ksbProgress; break;
        case 'otjh': va = a.otjhCompleted / a.otjhTarget; vb = b.otjhCompleted / b.otjhTarget; break;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [enrollmentStatusFilter, ragFilter, cohortFilter, programmeFilter, groupFilter, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const selectedLearner = LEARNERS.find(l => l.id === selectedLearnerId) || null;

  const activeCount = LEARNERS.filter(l => l.enrollmentStatus === 'active').length;
  const breakCount = LEARNERS.filter(l => l.enrollmentStatus === 'break').length;
  const withdrawnCount = LEARNERS.filter(l => l.enrollmentStatus === 'withdrawn').length;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); } else { setSortKey(key); setSortDir('asc'); }
  };

  const handleSendMessage = () => {
    if (!selectedLearner) return;
    const threadId = THREAD_MAP[selectedLearner.name];
    if (threadId) {
      navigate(`/coach/messages?thread=${threadId}`);
    } else {
      navigate('/coach/messages');
    }
  };

  const handleViewProgressReport = () => {
    setShowProgressReport(true);
  };

  const handleContactEmployerMessage = () => {
    if (!selectedLearner) return;
    const threadId = EMPLOYER_THREAD_MAP[selectedLearner.employer];
    if (threadId) {
      navigate(`/coach/messages?thread=${threadId}`);
    } else {
      navigate('/coach/messages');
    }
    setShowEmployerDropdown(false);
  };

  const handleEmailEmployer = () => {
    if (!selectedLearner?.employerEmail) return;
    window.open(`mailto:${selectedLearner.employerEmail}`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleZoomCall = () => {
    if (!selectedLearner?.employerEmail) return;
    window.open(`https://zoom.us/start/videomeeting?email=${encodeURIComponent(selectedLearner.employerEmail)}`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleOutlookCall = () => {
    if (!selectedLearner?.employerEmail) return;
    window.open(`https://outlook.office.com/calendar/deeplink/compose?to=${encodeURIComponent(selectedLearner.employerEmail)}`, '_blank');
    setShowEmployerDropdown(false);
  };

  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    'on-track': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'On Track' },
    'at-risk': { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700', label: 'At Risk' },
    'high': { bg: 'bg-accent-50 border-accent-200/50', text: 'text-accent-700', label: 'High Performer' },
    'new-starter': { bg: 'bg-primary-50 border-primary-200/50', text: 'text-primary-700', label: 'New Starter' },
  };

  const enrollmentConfig: Record<string, { bg: string; text: string; label: string }> = {
    'active': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'Active' },
    'break': { bg: 'bg-amber-50 border-amber-200/50', text: 'text-amber-700', label: 'Break' },
    'withdrawn': { bg: 'bg-foreground-100 border-foreground-200/50', text: 'text-foreground-500', label: 'Withdrawn' },
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Overview" pageSubtitle="Complete caseload with filters by cohort, programme, and group" userName="Med Maher" userRole="Progress Coach">
      <div className="p-3 md:p-6 space-y-4 md:space-y-5">

        {/* Hero Banner — Professional */}
        <section className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          {/* Subtle top highlight */}
          <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
          
          {/* Right side image */}
          <div className="absolute right-8 bottom-0 top-0 w-1/2 hidden md:flex items-end justify-end pointer-events-none">
            <img
              src="https://public.readdy.ai/ai/img_res/a2a00f53-9475-4f34-8fa2-a5787da489ce.png"
              alt="Learners"
              className="h-full w-auto object-contain object-bottom"
              style={{ maxHeight: '115%', transform: 'translateY(8%)' }}
            />
          </div>
          
          <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6">
              {/* Left: Title & subtitle */}
              <div className="flex-1 min-w-0 max-w-xl">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center">
                    <i className="ri-folder-user-line text-white text-sm"></i>
                  </span>
                  <span className="text-[10px] font-semibold text-white/50 uppercase tracking-widest">Learner Overview</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">My Learners</h1>
                <p className="text-[13px] text-white/50 max-w-lg">
                  Manage your complete caseload. Filter by cohort, programme, group, and enrollment status to track progress.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          <MiniStatCard label="Total" value={String(LEARNERS.length)} icon="ri-group-line" color="primary" />
          <MiniStatCard label="Active" value={String(activeCount)} icon="ri-check-double-line" color="emerald" />
          <MiniStatCard label="At Risk" value={String(LEARNERS.filter(l => l.status === 'at-risk').length)} icon="ri-alarm-warning-line" color="red" />
          <MiniStatCard label="On Track" value={String(LEARNERS.filter(l => l.status === 'on-track').length)} icon="ri-thumb-up-line" color="emerald" />
          <MiniStatCard label="High Perf." value={String(LEARNERS.filter(l => l.status === 'high').length)} icon="ri-star-line" color="accent" />
          <MiniStatCard label="New Starters" value={String(LEARNERS.filter(l => l.status === 'new-starter').length)} icon="ri-user-add-line" color="primary" />
        </div>

        {/* Filters Bar */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3 flex-wrap">
            <div className="w-full lg:w-auto lg:min-w-[240px] lg:max-w-[280px]">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
                <input type="text" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Search learners..." className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[12px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
              </div>
            </div>

            <div className="w-px h-6 bg-background-200/70 hidden lg:block"></div>

            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown
                label="Cohort"
                value={cohortFilter}
                onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }}
                options={COHORTS.map(c => ({ value: c.id, label: c.name }))}
              />
              <FilterDropdown
                label="Programme"
                value={programmeFilter}
                onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }}
                options={PROGRAMMES.map(p => ({ value: p, label: p }))}
              />
              <FilterDropdown
                label="Group"
                value={groupFilter}
                onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }}
                options={GROUPS.map(g => ({ value: g, label: g }))}
              />
              <FilterDropdown
                label="Status"
                value={enrollmentStatusFilter}
                onChange={(v) => { setEnrollmentStatusFilter(v as EnrollmentStatus); setCurrentPage(1); }}
                options={[
                  { value: 'active', label: `Active (${activeCount})` },
                  { value: 'break', label: `Break (${breakCount})` },
                  { value: 'withdrawn', label: `Withdrawn (${withdrawnCount})` },
                ]}
              />
              <div className="w-px h-5 bg-background-200/70"></div>
              {/* RAG Filter Dropdown */}
              <FilterDropdown
                label="RAG"
                value={ragFilter}
                onChange={(v) => { setRagFilter(v as PerformanceStatus | 'all'); setCurrentPage(1); }}
                options={[
                  { value: 'at-risk', label: `At Risk (${LEARNERS.filter(l => l.status === 'at-risk').length})` },
                  { value: 'on-track', label: `On Track (${LEARNERS.filter(l => l.status === 'on-track').length})` },
                  { value: 'high', label: `High Perf. (${LEARNERS.filter(l => l.status === 'high').length})` },
                  { value: 'new-starter', label: `New Starters (${LEARNERS.filter(l => l.status === 'new-starter').length})` },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60">
                  <ThSort label="Learner" sortKey="name" current={sortKey} dir={sortDir} onClick={() => handleSort('name')} className="pl-4 pr-3 py-3" />
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Programme</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Cohort</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Group</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Enrol. Status</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Perf. Status</th>
                  <ThSort label="Progress" sortKey="progress" current={sortKey} dir={sortDir} onClick={() => handleSort('progress')} />
                  <ThSort label="KSB" sortKey="ksb" current={sortKey} dir={sortDir} onClick={() => handleSort('ksb')} />
                  <ThSort label="Att." sortKey="attendance" current={sortKey} dir={sortDir} onClick={() => handleSort('attendance')} />
                  <ThSort label="OTJH" sortKey="otjh" current={sortKey} dir={sortDir} onClick={() => handleSort('otjh')} />
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Last Attendance</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Last Progress Review</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Trend</th>
                  <th className="pr-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {paginated.map(learner => {
                  const sc = statusConfig[learner.status] || statusConfig['on-track'];
                  const ec = enrollmentConfig[learner.enrollmentStatus] || enrollmentConfig['active'];
                  const isSel = selectedLearnerId === learner.id;
                  const lastAttDays = getDaysSince(learner.lastAttendanceDate);
                  const lastAttSev = dateSeverity(lastAttDays, DATE_THRESHOLDS.lastAttendance);
                  const lastAttBg = lastAttDays >= DATE_THRESHOLDS.lastAttendance.amber ? DATE_BG[lastAttSev] : '';
                  const lastAttColor = lastAttDays >= DATE_THRESHOLDS.lastAttendance.amber ? DATE_COLORS[lastAttSev] : '';
                  const lastAttDotColor = lastAttDays >= DATE_THRESHOLDS.lastAttendance.amber ? (lastAttDays >= DATE_THRESHOLDS.lastAttendance.red ? 'bg-red-500' : 'bg-amber-500') : '';
                  const lastReviewDays = getDaysSince(learner.lastProgressReview || learner.lastReview);
                  const lastReviewSev = dateSeverity(lastReviewDays, DATE_THRESHOLDS.lastReview);
                  const lastReviewBg = lastReviewSev !== 'normal' ? DATE_BG[lastReviewSev] : '';
                  const lastReviewColor = lastReviewSev !== 'normal' ? DATE_COLORS[lastReviewSev] : '';
                  const lastReviewDot = lastReviewSev !== 'normal' ? (lastReviewSev === 'red' ? 'bg-red-500' : 'bg-amber-500') : '';
                  return (
                    <tr
                      key={learner.id}
                      onClick={() => setSelectedLearnerId(isSel ? null : learner.id)}
                      className={`transition-smooth cursor-pointer ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}
                    >
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div
                            onClick={(e) => { e.stopPropagation(); navigate('/coach/learner-case-file', { state: { learnerId: learner.id, learnerName: learner.name } }); }}
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1.5 cursor-pointer hover:scale-110 transition-transform ${learner.status === 'at-risk' ? 'bg-red-100 text-red-700 ring-red-200' : learner.status === 'high' ? 'bg-accent-100 text-accent-700 ring-accent-200' : learner.status === 'new-starter' ? 'bg-primary-100 text-primary-700 ring-primary-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}
                            title="View profile"
                          >
                            <span className="text-[11px] font-bold">{learner.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p
                              onClick={(e) => { e.stopPropagation(); navigate('/coach/learner-case-file', { state: { learnerId: learner.id, learnerName: learner.name } }); }}
                              className="text-[12px] font-semibold text-foreground-900 truncate cursor-pointer hover:text-primary-600 hover:underline transition-colors"
                              title="View profile"
                            >
                              {learner.name}
                            </p>
                            <p className="text-[10px] text-foreground-400 truncate">{learner.employer}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-600 whitespace-nowrap max-w-[140px] truncate">{learner.programme}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500 whitespace-nowrap">{learner.cohortName}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{learner.group}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${ec.bg} ${ec.text} whitespace-nowrap`}>{ec.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.text} whitespace-nowrap`}>{sc.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-10 bg-background-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${learner.status === 'at-risk' ? 'bg-red-500' : learner.status === 'high' ? 'bg-accent-500' : 'bg-primary-500'}`} style={{ width: `${learner.overallProgress}%` }}></div>
                          </div>
                          <span className="text-[11px] font-semibold text-foreground-700 w-7 text-right">{learner.overallProgress}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[11px] font-semibold ${learner.ksbProgress >= 70 ? 'text-emerald-600' : learner.ksbProgress >= 40 ? 'text-foreground-700' : 'text-red-600'}`}>{learner.ksbProgress}%</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[11px] font-semibold ${learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{learner.attendanceRate}%</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[11px] font-medium text-foreground-600 whitespace-nowrap">{learner.otjhCompleted}/{learner.otjhTarget}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 ${lastAttBg}`}>
                          {lastAttDays >= DATE_THRESHOLDS.lastAttendance.amber && <span className={`inline-block w-1.5 h-1.5 rounded-full ${lastAttDotColor}`}></span>}
                          <span className={`font-medium ${lastAttColor}`}>{learner.lastAttendanceDate}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">
                        {(() => {
                          const sev = dateSeverity(getDaysSince(learner.lastProgressReview || learner.lastReview), DATE_THRESHOLDS.lastReview);
                          const val = learner.lastProgressReview || learner.lastReview;
                          return (
                            <span className={`inline-flex items-center gap-1 ${sev !== 'normal' ? DATE_BG[sev] : ''}`}>
                              {sev !== 'normal' && <span className={`inline-block w-1.5 h-1.5 rounded-full ${sev === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>}
                              <span className={`font-medium ${sev !== 'normal' ? DATE_COLORS[sev] : ''}`}>{val}</span>
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5">
                        <SparklineChart data={learner.attendanceHistory} width={60} height={22} color={learner.attendanceRate >= 90 ? 'emerald' : learner.attendanceRate >= 80 ? 'amber' : 'red'} strokeWidth={1.2} showDots={false} showFill />
                      </td>
                      <td className="pr-4 py-2.5">
                        <i className={`text-foreground-300 text-sm ${isSel ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <i className="ri-search-line text-foreground-300 text-3xl mb-2 block"></i>
              <p className="text-sm text-foreground-400">No learners match your filters</p>
              <button onClick={() => { setEnrollmentStatusFilter('all'); setCohortFilter('all'); setProgrammeFilter('all'); setGroupFilter('all'); setSearch(''); setCurrentPage(1); }} className="mt-2 text-[11px] font-medium text-primary-600 hover:text-primary-700 cursor-pointer">
                Clear all filters
              </button>
            </div>
          )}

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-foreground-200/60 bg-background-100/30">
              <span className="text-[11px] text-foreground-400">
                Showing <strong className="text-foreground-700">{Math.min((safePage - 1) * PAGE_SIZE + 1, filtered.length)}&ndash;{Math.min(safePage * PAGE_SIZE, filtered.length)}</strong> of <strong className="text-foreground-700">{filtered.length}</strong> learners
              </span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-500 hover:bg-background-200/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-smooth"
                >
                  <i className="ri-arrow-left-s-line text-sm"></i>
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold cursor-pointer transition-smooth ${safePage === page ? 'bg-primary-500 text-white' : 'text-foreground-500 hover:bg-background-200/50'}`}
                  >
                    {page}
                  </button>
                ))}

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-500 hover:bg-background-200/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-smooth"
                >
                  <i className="ri-arrow-right-s-line text-sm"></i>
                </button>
              </div>

              <span className="text-[11px] text-foreground-400">
                Page {safePage} of {totalPages}
              </span>
            </div>
          )}
        </div>

        {/* Right Slide Panel — Learner Detail */}
        <RightSlidePanel
          isOpen={selectedLearner !== null}
          onClose={() => { setSelectedLearnerId(null); setShowEmployerDropdown(false); }}
          title={selectedLearner?.name || 'Learner Detail'}
          width="w-[520px]"
        >
          {selectedLearner && (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${selectedLearner.status === 'at-risk' ? 'bg-red-100 text-red-700 ring-red-200' : selectedLearner.status === 'high' ? 'bg-accent-100 text-accent-700 ring-accent-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                  <span className="text-lg font-bold">{selectedLearner.initials}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${enrollmentConfig[selectedLearner.enrollmentStatus].bg} ${enrollmentConfig[selectedLearner.enrollmentStatus].text}`}>
                      {enrollmentConfig[selectedLearner.enrollmentStatus].label}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[selectedLearner.status].bg} ${statusConfig[selectedLearner.status].text}`}>
                      {statusConfig[selectedLearner.status].label}
                    </span>
                    {selectedLearner.recentFlag && (
                      <span className="text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{selectedLearner.recentFlag}</span>
                    )}
                  </div>
                  <p className="text-[12px] text-foreground-400">{selectedLearner.programme}</p>
                  <p className="text-[12px] text-foreground-400">{selectedLearner.employer}</p>
                  <p className="text-[11px] text-foreground-300 mt-0.5">{selectedLearner.cohortName} &middot; {selectedLearner.group}</p>
                </div>
              </div>

              {/* Risk Flags */}
              {selectedLearner.riskFlags.length > 0 && (
                <div className="bg-red-50/50 rounded-xl border border-red-200/30 p-4">
                  <h4 className="text-[11px] font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                    <i className="ri-alert-line"></i> Risk Flags
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLearner.riskFlags.map(flag => (
                      <span key={flag} className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{flag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Modern Stats Grid with Donut Charts */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.overallProgress} size={64} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">Overall Progress</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.overallProgress}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.overallProgress >= 70 ? 'Excellent' : selectedLearner.overallProgress >= 40 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.attendanceRate} size={64} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">Attendance</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.attendanceRate}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.attendanceRate >= 90 ? 'Excellent' : selectedLearner.attendanceRate >= 80 ? 'Good' : 'At Risk'}</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} size={64} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">OTJH</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
                    <p className="text-[9px] text-foreground-300">{Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)}% of target</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.ksbProgress} size={64} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">KSB Progress</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.ksbProgress}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.ksbProgress >= 70 ? 'Excellent' : selectedLearner.ksbProgress >= 40 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                </div>
              </div>

              {/* Dates */}
              <div className="space-y-2.5">
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Evidence Count</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.evidenceCount} items</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Next Coaching</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.nextCoaching}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Next Review</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.nextReview}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Last Contact</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.lastContact}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Last Progress Review</span>
                  <span className={`font-medium inline-flex items-center gap-1 ${DATE_BG[dateSeverity(getDaysSince(selectedLearner.lastProgressReview || selectedLearner.lastReview), DATE_THRESHOLDS.lastReview)]}`}>
                    {dateSeverity(getDaysSince(selectedLearner.lastProgressReview || selectedLearner.lastReview), DATE_THRESHOLDS.lastReview) !== 'normal' && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dateSeverity(getDaysSince(selectedLearner.lastProgressReview || selectedLearner.lastReview), DATE_THRESHOLDS.lastReview) === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>}
                    <span className={DATE_COLORS[dateSeverity(getDaysSince(selectedLearner.lastProgressReview || selectedLearner.lastReview), DATE_THRESHOLDS.lastReview)]}>{selectedLearner.lastProgressReview || selectedLearner.lastReview}</span>
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Last Attendance Date</span>
                  <span className={`font-medium inline-flex items-center gap-1 ${DATE_BG[dateSeverity(getDaysSince(selectedLearner.lastAttendanceDate), DATE_THRESHOLDS.lastAttendance)]}`}>
                    {dateSeverity(getDaysSince(selectedLearner.lastAttendanceDate), DATE_THRESHOLDS.lastAttendance) !== 'normal' && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dateSeverity(getDaysSince(selectedLearner.lastAttendanceDate), DATE_THRESHOLDS.lastAttendance) === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>}
                    <span className={DATE_COLORS[dateSeverity(getDaysSince(selectedLearner.lastAttendanceDate), DATE_THRESHOLDS.lastAttendance)]}>{selectedLearner.lastAttendanceDate}</span>
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Last Review</span>
                  <span className={`font-medium inline-flex items-center gap-1 ${DATE_BG[dateSeverity(getDaysSince(selectedLearner.lastReview), DATE_THRESHOLDS.lastReview)]}`}>
                    {dateSeverity(getDaysSince(selectedLearner.lastReview), DATE_THRESHOLDS.lastReview) !== 'normal' && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dateSeverity(getDaysSince(selectedLearner.lastReview), DATE_THRESHOLDS.lastReview) === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>}
                    <span className={DATE_COLORS[dateSeverity(getDaysSince(selectedLearner.lastReview), DATE_THRESHOLDS.lastReview)]}>{selectedLearner.lastReview}</span>
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Last Coaching Session</span>
                  <span className={`font-medium inline-flex items-center gap-1 ${DATE_BG[dateSeverity(getDaysSince(selectedLearner.lastCoachingSession), DATE_THRESHOLDS.lastCoaching)]}`}>
                    {dateSeverity(getDaysSince(selectedLearner.lastCoachingSession), DATE_THRESHOLDS.lastCoaching) !== 'normal' && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dateSeverity(getDaysSince(selectedLearner.lastCoachingSession), DATE_THRESHOLDS.lastCoaching) === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>}
                    <span className={DATE_COLORS[dateSeverity(getDaysSince(selectedLearner.lastCoachingSession), DATE_THRESHOLDS.lastCoaching)]}>{selectedLearner.lastCoachingSession}</span>
                  </span>
                </div>
                <div className="flex justify-between py-2 text-[12px]">
                  <span className="text-foreground-400">Last Submitted Evidence</span>
                  <span className={`font-medium inline-flex items-center gap-1 ${DATE_BG[dateSeverity(getDaysSince(selectedLearner.lastSubmittedEvidence), DATE_THRESHOLDS.lastEvidence)]}`}>
                    {dateSeverity(getDaysSince(selectedLearner.lastSubmittedEvidence), DATE_THRESHOLDS.lastEvidence) !== 'normal' && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dateSeverity(getDaysSince(selectedLearner.lastSubmittedEvidence), DATE_THRESHOLDS.lastEvidence) === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>}
                    <span className={DATE_COLORS[dateSeverity(getDaysSince(selectedLearner.lastSubmittedEvidence), DATE_THRESHOLDS.lastEvidence)]}>{selectedLearner.lastSubmittedEvidence}</span>
                  </span>
                </div>
              </div>

              {/* Contact Info */}
              <div className="bg-background-100/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Contact Info</p>
                <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                  <i className="ri-mail-line text-foreground-300 text-xs"></i>
                  <span>{selectedLearner.email || 'sophie.williams@example.com'}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                  <i className="ri-building-line text-foreground-300 text-xs"></i>
                  <span>{selectedLearner.employer}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                  <i className="ri-mail-send-line text-foreground-300 text-xs"></i>
                  <span>{selectedLearner.employerEmail || 'hr@employer.co.uk'}</span>
                </div>
                {selectedLearner.employerPhone && (
                  <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                    <i className="ri-phone-line text-foreground-300 text-xs"></i>
                    <span>{selectedLearner.employerPhone}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <button className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-chat-smile-2-line mr-1.5"></i> Start Coaching Session
                </button>
                <button onClick={handleViewProgressReport} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap text-center">
                  <i className="ri-file-chart-line mr-1.5"></i> View Full Progress Report
                </button>
                <button onClick={handleSendMessage} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap text-center">
                  <i className="ri-mail-line mr-1.5"></i> Send Message
                </button>
                <div className="relative">
                  <button onClick={() => setShowEmployerDropdown(!showEmployerDropdown)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap text-center flex items-center justify-center gap-1">
                    <i className="ri-building-2-line mr-1.5"></i> Contact Employer
                    <i className={`ri-arrow-down-s-line text-xs transition-transform ${showEmployerDropdown ? 'rotate-180' : ''}`}></i>
                  </button>
                  {showEmployerDropdown && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-background-50 rounded-xl border border-background-200 shadow-xl overflow-hidden z-50">
                      <button onClick={handleContactEmployerMessage} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer">
                        <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600"><i className="ri-message-3-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Send Message</p>
                          <p className="text-[10px] text-foreground-400">Open in-app chat</p>
                        </div>
                      </button>
                      <button onClick={handleEmailEmployer} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center text-accent-600"><i className="ri-mail-send-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Email</p>
                          <p className="text-[10px] text-foreground-400">{selectedLearner.employerEmail || 'hr@employer.co.uk'}</p>
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
              </div>
            </div>
          )}
        </RightSlidePanel>

        {/* Full Progress Report — Centered Modal */}
        {showProgressReport && selectedLearner && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-foreground-950/50" onClick={() => setShowProgressReport(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-[900px] max-h-[90vh] overflow-y-auto shadow-2xl border border-background-200 animate-in fade-in zoom-in-95 duration-200">

              {/* Modal Header */}
              <div className="sticky top-0 z-10 bg-background-50 rounded-t-2xl border-b border-foreground-200/60 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${selectedLearner.status === 'at-risk' ? 'bg-red-100 text-red-700' : selectedLearner.status === 'high' ? 'bg-accent-100 text-accent-700' : 'bg-primary-100 text-primary-700'}`}>
                    {selectedLearner.initials}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground-900">Learner Progress Report</h3>
                    <p className="text-[11px] text-foreground-400">{selectedLearner.name} &middot; {selectedLearner.programme} &middot; Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { window.print(); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-medium hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-download-line text-xs"></i> Download PDF
                  </button>
                  <button
                    onClick={() => setShowProgressReport(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
                  >
                    <i className="ri-close-line text-sm"></i>
                  </button>
                </div>
              </div>

              {/* Report Content */}
              <div className="px-6 py-5 space-y-6">

                {/* Top Summary Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SummaryPill label="Overall Progress" value={`${selectedLearner.overallProgress}%`} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} />
                  <SummaryPill label="Attendance" value={`${selectedLearner.attendanceRate}%`} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                  <SummaryPill label="KSB Progress" value={`${selectedLearner.ksbProgress}%`} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                  <SummaryPill label="OTJH" value={`${selectedLearner.otjhCompleted}/${selectedLearner.otjhTarget}`} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                </div>

                {/* Executive Summary */}
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h4 className="text-[13px] font-semibold text-foreground-900 mb-3 flex items-center gap-2">
                    <i className="ri-file-list-3-line text-primary-500"></i> Executive Summary
                  </h4>
                  <p className="text-[12px] text-foreground-600 leading-relaxed">
                    {selectedLearner.name} is currently enrolled on the <strong>{selectedLearner.programme}</strong> programme
                    with {selectedLearner.employer} ({selectedLearner.cohortName}, {selectedLearner.group}).
                    {selectedLearner.status === 'at-risk' && (
                      <> They are currently flagged as <strong className="text-red-600">At Risk</strong> due to {selectedLearner.riskFlags.join(', ')}. Immediate coaching intervention is recommended within 48 hours.</>
                    )}
                    {selectedLearner.status === 'on-track' && (
                      <> They are currently <strong className="text-emerald-600">On Track</strong> with consistent progress across all key metrics. Continue with current coaching schedule.</>
                    )}
                    {selectedLearner.status === 'high' && (
                      <> They are a <strong className="text-accent-600">High Performer</strong> with excellent progress across all areas. Consider discussing gateway readiness and EPA timeline.</>
                    )}
                    {selectedLearner.status === 'new-starter' && (
                      <> They are a <strong className="text-primary-600">New Starter</strong> currently in onboarding. Focus on checklist completion and community integration.</>
                    )}
                  </p>
                </div>

                {/* Progress Overview with Donuts */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={selectedLearner.overallProgress} size={80} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} label="Overall" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.overallProgress >= 70 ? 'Excellent' : selectedLearner.overallProgress >= 40 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={selectedLearner.attendanceRate} size={80} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} label="Attendance" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.attendanceRate >= 90 ? 'Excellent' : selectedLearner.attendanceRate >= 80 ? 'Good' : 'At Risk'}</p>
                  </div>
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} size={80} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} label="OTJH" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.otjhCompleted} of {selectedLearner.otjhTarget} hours</p>
                  </div>
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={selectedLearner.ksbProgress} size={80} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} label="KSBs" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.ksbProgress >= 70 ? 'On pace for gateway' : 'Needs acceleration'}</p>
                  </div>
                </div>

                {/* Key Metrics Table */}
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h4 className="text-[13px] font-semibold text-foreground-900 mb-4 flex items-center gap-2">
                    <i className="ri-bar-chart-box-line text-primary-500"></i> Key Metrics
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <MetricRow label="Overall Progress" value={`${selectedLearner.overallProgress}%`} bar={selectedLearner.overallProgress} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} />
                    <MetricRow label="Attendance Rate" value={`${selectedLearner.attendanceRate}%`} bar={selectedLearner.attendanceRate} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                    <MetricRow label="KSB Progress" value={`${selectedLearner.ksbProgress}%`} bar={selectedLearner.ksbProgress} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                    <MetricRow label="OTJH Completion" value={`${Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)}%`} bar={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                    <MetricRow label="Evidence Submitted" value={`${selectedLearner.evidenceCount} items`} bar={Math.min(100, (selectedLearner.evidenceCount / 25) * 100)} color={selectedLearner.evidenceCount >= 15 ? 'emerald' : selectedLearner.evidenceCount >= 8 ? 'amber' : 'red'} />
                    <MetricRow label="Enrollment Status" value={selectedLearner.enrollmentStatus.charAt(0).toUpperCase() + selectedLearner.enrollmentStatus.slice(1)} bar={selectedLearner.enrollmentStatus === 'active' ? 100 : selectedLearner.enrollmentStatus === 'break' ? 50 : 20} color={selectedLearner.enrollmentStatus === 'active' ? 'emerald' : selectedLearner.enrollmentStatus === 'break' ? 'amber' : 'foreground'} />
                  </div>
                </div>

                {/* Issues & Concerns */}
                <div className="bg-red-50 rounded-xl border border-red-200/30 p-5">
                  <h4 className="text-[13px] font-semibold text-red-800 mb-3 flex items-center gap-2">
                    <i className="ri-error-warning-line text-red-500"></i> Issues & Concerns
                  </h4>
                  {selectedLearner.riskFlags.length > 0 ? (
                    <div className="space-y-3">
                      {selectedLearner.riskFlags.map((flag, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white rounded-lg p-3 border border-red-100">
                          <span className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                            <i className="ri-alert-line text-red-500 text-xs"></i>
                          </span>
                          <div>
                            <p className="text-[12px] font-semibold text-red-700">{flag}</p>
                            <p className="text-[11px] text-red-500/70 mt-0.5">
                              {flag.includes('Attendance') && 'Attendance rate is below the 90% target. This may impact progression and gateway readiness. Consider scheduling a catch-up plan.'}
                              {flag.includes('OTJH') && 'On-the-job hours are behind the expected pace. Coordinate with the employer to identify additional workplace opportunities.'}
                              {flag.includes('KSB') && 'Knowledge, Skills & Behaviours progress is stagnant. Review evidence mapping and provide targeted coaching support.'}
                              {flag.includes('Evidence') && 'Evidence submissions are overdue or insufficient. Set weekly evidence targets and provide clear guidance on requirements.'}
                              {flag.includes('engagement') && 'Learner engagement levels have dropped. Reach out to understand barriers and re-establish motivation.'}
                              {!flag.includes('Attendance') && !flag.includes('OTJH') && !flag.includes('KSB') && !flag.includes('Evidence') && !flag.includes('engagement') && 'This area requires attention. Review with the learner and employer to create an improvement plan.'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 bg-white rounded-lg p-3 border border-red-100">
                      <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                        <i className="ri-check-line text-emerald-500 text-xs"></i>
                      </span>
                      <p className="text-[12px] text-emerald-700">No current risk flags. Learner is progressing well across all monitored areas.</p>
                    </div>
                  )}
                </div>

                {/* Strengths & Highlights */}
                <div className="bg-emerald-50 rounded-xl border border-emerald-200/30 p-5">
                  <h4 className="text-[13px] font-semibold text-emerald-800 mb-3 flex items-center gap-2">
                    <i className="ri-shining-line text-emerald-500"></i> Strengths & Highlights
                  </h4>
                  <div className="space-y-2">
                    {selectedLearner.status === 'high' && (
                      <>
                        <StrengthItem icon="ri-star-line" text="Consistently high performance across all key metrics" subtext="Overall progress at 85%+ with excellent attendance and evidence quality" />
                        <StrengthItem icon="ri-rocket-line" text="Gateway-ready KSB coverage" subtext={`${selectedLearner.ksbProgress}% completion — on track for EPA`} />
                        <StrengthItem icon="ri-trophy-line" text="Strong employer engagement" subtext="Workplace supervision and OTJH hours are well supported" />
                        <StrengthItem icon="ri-medal-line" text="Self-directed learner" subtext="Proactively submits evidence and attends all sessions without prompting" />
                      </>
                    )}
                    {selectedLearner.status === 'on-track' && (
                      <>
                        <StrengthItem icon="ri-check-double-line" text="Steady and consistent progress" subtext={`Maintaining ${selectedLearner.overallProgress}% overall with regular submissions`} />
                        <StrengthItem icon="ri-group-line" text="Good attendance record" subtext={`${selectedLearner.attendanceRate}% attendance — meets programme expectations`} />
                        <StrengthItem icon="ri-hand-heart-line" text="Responsive to coaching support" subtext="Engages well in 1:1 sessions and implements feedback" />
                      </>
                    )}
                    {selectedLearner.status === 'at-risk' && (
                      <>
                        <StrengthItem icon="ri-heart-pulse-line" text="Still actively engaged" subtext="Learner continues to attend sessions and communicate with coach" />
                        <StrengthItem icon="ri-award-line" text="Evidence quality is good when submitted" subtext="Submitted work meets standards — issue is volume, not quality" />
                        <StrengthItem icon="ri-user-heart-line" text="Employer is supportive" subtext="Employer has confirmed willingness to provide additional workplace support" />
                      </>
                    )}
                    {selectedLearner.status === 'new-starter' && (
                      <>
                        <StrengthItem icon="ri-emotion-happy-line" text="Positive onboarding attitude" subtext="Learner is enthusiastic and engaged with induction materials" />
                        <StrengthItem icon="ri-shield-check-line" text="100% attendance so far" subtext="Perfect attendance record in first weeks of programme" />
                        <StrengthItem icon="ri-lightbulb-line" text="Quick learner" subtext="Demonstrates good understanding of early module content" />
                      </>
                    )}
                  </div>
                </div>

                {/* Recent Activity Timeline */}
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h4 className="text-[13px] font-semibold text-foreground-900 mb-4 flex items-center gap-2">
                    <i className="ri-time-line text-primary-500"></i> Recent Activity Timeline
                  </h4>
                  <div className="space-y-3">
                    <TimelineItem icon="ri-calendar-check-line" color="emerald" date={selectedLearner.nextCoaching} title="Next Coaching Session" desc="Scheduled 1:1 progress coaching" />
                    <TimelineItem icon="ri-file-chart-line" color="primary" date={selectedLearner.nextReview} title="Next Progress Review" desc="Monthly formal review meeting" />
                    <TimelineItem icon="ri-mail-line" color="secondary" date={selectedLearner.lastContact} title="Last Contact" desc="Most recent communication with learner" />
                    <TimelineItem icon="ri-folder-upload-line" color="accent" date="Recent" title={`${selectedLearner.evidenceCount} Evidence Items`} desc={`${selectedLearner.status === 'at-risk' ? 'Some overdue — catch-up plan needed' : 'On track with programme requirements'}`} />
                  </div>
                </div>

                {/* Action Plan / Recommendations */}
                <div className="bg-primary-50 rounded-xl border border-primary-200/30 p-5">
                  <h4 className="text-[13px] font-semibold text-primary-800 mb-3 flex items-center gap-2">
                    <i className="ri-lightbulb-flash-line text-primary-500"></i> Coach Action Plan
                  </h4>
                  <div className="space-y-2">
                    {selectedLearner.status === 'at-risk' && (
                      <>
                        <ActionItem icon="ri-alarm-warning-line" color="red" text="Schedule urgent coaching intervention within 48 hours" />
                        <ActionItem icon="ri-phone-line" color="primary" text="Contact employer to discuss workplace support plan" />
                        <ActionItem icon="ri-file-list-line" color="amber" text="Review evidence backlog and set weekly submission targets" />
                        <ActionItem icon="ri-user-search-line" color="secondary" text="Conduct barrier assessment to identify root causes" />
                        <ActionItem icon="ri-calendar-event-line" color="emerald" text="Arrange follow-up check-in within 7 days" />
                      </>
                    )}
                    {selectedLearner.status === 'on-track' && (
                      <>
                        <ActionItem icon="ri-check-line" color="emerald" text="Continue with current coaching schedule" />
                        <ActionItem icon="ri-trophy-line" color="accent" text="Consider stretch assignments to maintain engagement" />
                        <ActionItem icon="ri-share-forward-line" color="primary" text="Connect with peer mentors for knowledge sharing" />
                        <ActionItem icon="ri-calendar-event-line" color="secondary" text="Schedule mid-term review to maintain momentum" />
                      </>
                    )}
                    {selectedLearner.status === 'high' && (
                      <>
                        <ActionItem icon="ri-star-line" color="accent" text="Discuss gateway readiness and EPA timeline" />
                        <ActionItem icon="ri-share-forward-line" color="primary" text="Connect with peer mentors for leadership development" />
                        <ActionItem icon="ri-award-line" color="emerald" text="Nominate for recognition or ambassador programme" />
                        <ActionItem icon="ri-file-chart-line" color="secondary" text="Begin EPA preparation and mock assessment planning" />
                      </>
                    )}
                    {selectedLearner.status === 'new-starter' && (
                      <>
                        <ActionItem icon="ri-hand-heart-line" color="primary" text="Focus on onboarding checklist completion" />
                        <ActionItem icon="ri-group-line" color="accent" text="Introduce to cohort community and assign peer buddy" />
                        <ActionItem icon="ri-shield-check-line" color="emerald" text="Set initial KSB and evidence expectations" />
                        <ActionItem icon="ri-calendar-event-line" color="secondary" text="Schedule first 1:1 coaching within 2 weeks" />
                      </>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-foreground-200/60">
                  <p className="text-[10px] text-foreground-400">
                    Report generated by Med Maher, Progress Coach &middot; {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <button
                    onClick={() => { window.print(); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-medium hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-download-line text-xs"></i> Download PDF
                  </button>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>
    </WorkspaceShell>
  );
}

/* Sub-components */

function MiniStatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    primary: { bg: 'bg-primary-100', text: 'text-primary-600' },
    accent: { bg: 'bg-accent-50', text: 'text-accent-700' },
    secondary: { bg: 'bg-secondary-100', text: 'text-secondary-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
    foreground: { bg: 'bg-foreground-100', text: 'text-foreground-500' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 card-premium cursor-pointer">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-foreground-400 font-medium">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.bg} ${c.text}`}>
          <i className={`${icon} text-xs`}></i>
        </span>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900 mt-1">{value}</p>
    </div>
  );
}

function FilterDropdown({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const allLabel = label === 'Status' ? 'All Status' : `All ${label}s`;
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-2.5 pr-7 py-1.5 bg-background-100 border border-foreground-200 rounded-lg text-[11px] font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300"
      >
        <option value="all">{allLabel}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <i className="ri-arrow-down-s-line absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground-400 text-[10px] pointer-events-none"></i>
    </div>
  );
}

function ThSort({ label, sortKey, current, dir, onClick, className = '' }: { label: string; sortKey: string; current: string; dir: string; onClick: () => void; className?: string }) {
  return (
    <th className={`px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground-600 transition-smooth ${className}`} onClick={onClick}>
      <span className="flex items-center gap-1">
        {label}
        <i className={`text-[8px] ${current === sortKey ? (dir === 'asc' ? 'ri-arrow-up-line text-primary-500' : 'ri-arrow-down-line text-primary-500') : 'ri-arrow-up-down-line text-foreground-300'}`}></i>
      </span>
    </th>
  );
}

function RiskRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-background-100/50">
      <span className={`w-2.5 h-2.5 rounded-full ${status === 'Green' ? 'bg-emerald-500' : status === 'Amber' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
      <div>
        <p className="text-[12px] font-medium text-foreground-900">{label}</p>
        <p className="text-[10px] text-foreground-400">{detail}</p>
      </div>
    </div>
  );
}

function ActivityRow({ icon, color, text, subtext }: { icon: string; color: string; text: string; subtext: string }) {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-100 text-emerald-600', primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background-100/50">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${c}`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <div>
        <p className="text-[12px] font-medium text-foreground-900">{text}</p>
        <p className="text-[10px] text-foreground-400">{subtext}</p>
      </div>
    </div>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    primary: { bg: 'bg-primary-50', text: 'text-primary-700', border: 'border-primary-200/50' },
    accent: { bg: 'bg-accent-50', text: 'text-accent-700', border: 'border-accent-200/50' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200/50' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/50' },
    red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200/50' },
    secondary: { bg: 'bg-secondary-50', text: 'text-secondary-700', border: 'border-secondary-200/50' },
    foreground: { bg: 'bg-foreground-100', text: 'text-foreground-500', border: 'border-foreground-200/50' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className={`${c.bg} ${c.border} border rounded-xl p-3 text-center`}>
      <p className={`text-lg font-bold ${c.text}`}>{value}</p>
      <p className="text-[9px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}

function MetricRow({ label, value, bar, color }: { label: string; value: string; bar: number; color: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-500',
    accent: 'bg-accent-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    secondary: 'bg-secondary-500',
    foreground: 'bg-foreground-500',
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-100/50 rounded-lg p-3">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[11px] text-foreground-500">{label}</span>
        <span className="text-[11px] font-semibold text-foreground-700">{value}</span>
      </div>
      <div className="w-full bg-background-200 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-700 ${c}`} style={{ width: `${Math.min(100, bar)}%` }}></div>
      </div>
    </div>
  );
}

function StrengthItem({ icon, text, subtext }: { icon: string; text: string; subtext: string }) {
  return (
    <div className="flex items-start gap-3 bg-white rounded-lg p-3 border border-emerald-100">
      <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
        <i className={`${icon} text-emerald-500 text-xs`}></i>
      </span>
      <div>
        <p className="text-[12px] font-semibold text-emerald-800">{text}</p>
        <p className="text-[11px] text-emerald-600/70 mt-0.5">{subtext}</p>
      </div>
    </div>
  );
}

function TimelineItem({ icon, color, date, title, desc }: { icon: string; color: string; date: string; title: string; desc: string }) {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-100 text-emerald-600', primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-center gap-3">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c}`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-foreground-900">{title}</p>
          <span className="text-[10px] text-foreground-400 shrink-0 ml-2">{date}</span>
        </div>
        <p className="text-[10px] text-foreground-400">{desc}</p>
      </div>
    </div>
  );
}

function ActionItem({ icon, color, text }: { icon: string; color: string; text: string }) {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-100 text-emerald-600', primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-start gap-3 bg-white rounded-lg p-3 border border-primary-100">
      <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${c}`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <p className="text-[12px] text-foreground-700 pt-0.5">{text}</p>
    </div>
  );
}