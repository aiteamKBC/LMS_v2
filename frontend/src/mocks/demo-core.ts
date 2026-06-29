// ============================================================================
// KBC LearningOS — Shared Demo Data: Core Entities
// Single source of truth — all learner IDs, employer IDs, staff IDs
// used consistently across every page/mock in the platform.
// ============================================================================

// ---- PROGRAMMES ----
export const DEMO_PROGRAMMES = [
  { id: 'prog-001', title: 'Marketing Executive', level: 'Level 4', code: 'ST0803', standard: 'CMI', durationMonths: 18, otjhTarget: 120, fundingBand: 9000 },
  { id: 'prog-002', title: 'Business Administrator', level: 'Level 3', code: 'ST0070', standard: 'CMI', durationMonths: 15, otjhTarget: 100, fundingBand: 5000 },
  { id: 'prog-003', title: 'Data Analyst', level: 'Level 4', code: 'ST0118', standard: 'BCS', durationMonths: 18, otjhTarget: 120, fundingBand: 11000 },
  { id: 'prog-004', title: 'Operations Manager', level: 'Level 5', code: 'ST0385', standard: 'CMI', durationMonths: 24, otjhTarget: 160, fundingBand: 7000 },
  { id: 'prog-005', title: 'HR Consultant Partner', level: 'Level 5', code: 'ST0238', standard: 'CIPD', durationMonths: 24, otjhTarget: 160, fundingBand: 7000 },
  { id: 'prog-006', title: 'Project Manager', level: 'Level 4', code: 'ST0386', standard: 'APM', durationMonths: 20, otjhTarget: 140, fundingBand: 7000 },
  { id: 'prog-007', title: 'Software Developer', level: 'Level 4', code: 'ST0116', standard: 'BCS', durationMonths: 18, otjhTarget: 120, fundingBand: 21000 },
];

// ---- COHORTS ----
export const DEMO_COHORTS = [
  { id: 'coh-001', name: 'ME-L4 May 2026', programmeId: 'prog-001', startDate: '19 May 2026', endDate: '18 Nov 2027', learnerCount: 8, status: 'Active' },
  { id: 'coh-002', name: 'BA-L3 June 2026', programmeId: 'prog-002', startDate: '02 Jun 2026', endDate: '01 Sep 2027', learnerCount: 6, status: 'Active' },
  { id: 'coh-003', name: 'DA-L4 April 2026', programmeId: 'prog-003', startDate: '14 Apr 2026', endDate: '13 Oct 2027', learnerCount: 5, status: 'Active' },
  { id: 'coh-004', name: 'OM-L5 Jan 2025', programmeId: 'prog-004', startDate: '06 Jan 2025', endDate: '05 Jan 2027', learnerCount: 4, status: 'Active' },
  { id: 'coh-005', name: 'HR-L5 March 2025', programmeId: 'prog-005', startDate: '10 Mar 2025', endDate: '09 Mar 2027', learnerCount: 3, status: 'Active' },
  { id: 'coh-006', name: 'PM-L4 Feb 2026', programmeId: 'prog-006', startDate: '03 Feb 2026', endDate: '02 Oct 2027', learnerCount: 5, status: 'Active' },
  { id: 'coh-007', name: 'SD-L4 Sep 2024', programmeId: 'prog-007', startDate: '09 Sep 2024', endDate: '08 Mar 2026', learnerCount: 6, status: 'Completed' },
];

// ---- EMPLOYERS ----
export const DEMO_EMPLOYERS = [
  { id: 'emp-001', name: 'Tim Hortons UK', sector: 'Hospitality & Retail', contact: 'James Thompson', email: 'james.thompson@timhortons.co.uk', city: 'London', learnersActive: 3, learnersTotal: 5 },
  { id: 'emp-002', name: "Pret A Manger", sector: 'Food & Beverage', contact: 'Sarah Mitchell', email: 's.mitchell@pret.com', city: 'London', learnersActive: 2, learnersTotal: 2 },
  { id: 'emp-003', name: 'Boots UK', sector: 'Retail & Health', contact: 'Kevin Marsh', email: 'k.marsh@boots.co.uk', city: 'Nottingham', learnersActive: 2, learnersTotal: 3 },
  { id: 'emp-004', name: 'Costa Coffee', sector: 'Hospitality', contact: 'Diana Holloway', email: 'd.holloway@costa.co.uk', city: 'Dunstable', learnersActive: 1, learnersTotal: 1 },
  { id: 'emp-005', name: "Marks & Spencer", sector: 'Retail', contact: 'Andrew Davies', email: 'a.davies@marksandspencer.com', city: 'London', learnersActive: 2, learnersTotal: 2 },
  { id: 'emp-006', name: 'Next PLC', sector: 'Retail', contact: 'Claire Watson', email: 'c.watson@next.co.uk', city: 'Leicester', learnersActive: 1, learnersTotal: 1 },
  { id: 'emp-007', name: 'Tesco', sector: 'Retail & Grocery', contact: 'Brendan O\'Connor', email: 'b.oconnor@tesco.com', city: 'Welwyn Garden City', learnersActive: 2, learnersTotal: 2 },
  { id: 'emp-008', name: 'Barclays Bank PLC', sector: 'Financial Services', contact: 'Natasha Singh', email: 'n.singh@barclays.com', city: 'London', learnersActive: 1, learnersTotal: 2 },
  { id: 'emp-009', name: 'NatWest Group', sector: 'Financial Services', contact: 'Paul Turner', email: 'p.turner@natwest.com', city: 'Edinburgh', learnersActive: 1, learnersTotal: 1 },
  { id: 'emp-010', name: "Sainsbury's", sector: 'Retail & Grocery', contact: 'Fiona Hargreaves', email: 'f.hargreaves@sainsburys.co.uk', city: 'London', learnersActive: 1, learnersTotal: 1 },
];

// ---- STAFF ----
export const DEMO_COACHES = [
  { id: 'coach-001', name: 'Martin Reeves', email: 'martin.reeves@kbc.ac.uk', phone: '01227 811 401', caseload: 9, maxCaseload: 12, avatar: 'MR' },
  { id: 'coach-002', name: 'Sarah Collins', email: 'sarah.collins@kbc.ac.uk', phone: '01227 811 402', caseload: 7, maxCaseload: 12, avatar: 'SC' },
  { id: 'coach-003', name: 'Daniel Foster', email: 'daniel.foster@kbc.ac.uk', phone: '01227 811 403', caseload: 8, maxCaseload: 12, avatar: 'DF' },
];

export const DEMO_TUTORS = [
  { id: 'tutor-001', name: 'Helen Curtis', email: 'helen.curtis@kbc.ac.uk', phone: '01227 811 501', subjects: ['Marketing', 'Business'], avatar: 'HC' },
  { id: 'tutor-002', name: 'Crispin Jones', email: 'crispin.jones@kbc.ac.uk', phone: '01227 811 502', subjects: ['Business Admin', 'HR'], avatar: 'CJ' },
  { id: 'tutor-003', name: 'Rachel Oduya', email: 'rachel.oduya@kbc.ac.uk', phone: '01227 811 503', subjects: ['Data', 'Software'], avatar: 'RO' },
];

// ---- LEARNERS ----
export type LearnerStatus = 'Active' | 'Pre-Active' | 'Gateway' | 'EPA' | 'Completed' | 'Withdrawn' | 'Break in Learning';
export type RiskStatus = 'Green' | 'Amber' | 'Red';

export interface DemoLearner {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  uln: string;
  dob: string;
  programmeId: string;
  programme: string;
  programmeLevel: string;
  cohortId: string;
  cohort: string;
  employerId: string;
  employer: string;
  lineManager: string;
  lineManagerEmail: string;
  coachId: string;
  coach: string;
  tutorId: string;
  tutor: string;
  status: LearnerStatus;
  riskStatus: RiskStatus;
  riskReason: string;
  startDate: string;
  plannedEndDate: string;
  weekOnProgramme: number;
  overallProgress: number;
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  evidenceCount: number;
  avatar: string;
  // Compliance flags
  eligibilityStatus: 'Eligible' | 'Ineligible' | 'Pending' | 'N/A';
  rplApplied: boolean;
  dasConfirmed: boolean;
  ilrReady: boolean;
  signaturesComplete: boolean;
  qaStatus: 'Approved' | 'Rejected' | 'Pending' | 'Not Required';
}

export const DEMO_LEARNERS: DemoLearner[] = [
  // 1 — Sophie Williams (the logged-in learner demo account)
  {
    id: 'lrn-001', firstName: 'Sophie', lastName: 'Williams',
    fullName: 'Sophie Williams', email: 'sophie.williams@timhortons.co.uk',
    phone: '07700 900 824', uln: '3847291056', dob: '14 Mar 2000',
    programmeId: 'prog-001', programme: 'Marketing Executive', programmeLevel: 'Level 4',
    cohortId: 'coh-001', cohort: 'ME-L4 May 2026',
    employerId: 'emp-001', employer: 'Tim Hortons UK',
    lineManager: 'James Thompson', lineManagerEmail: 'james.thompson@timhortons.co.uk',
    coachId: 'coach-001', coach: 'Martin Reeves',
    tutorId: 'tutor-001', tutor: 'Helen Curtis',
    status: 'Active', riskStatus: 'Amber', riskReason: 'Attendance 86%, OTJH behind pace',
    startDate: '19 May 2026', plannedEndDate: '18 Nov 2027', weekOnProgramme: 4,
    overallProgress: 42, attendanceRate: 86, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 38,
    evidenceCount: 12, avatar: 'SW',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 2 — James Okafor
  {
    id: 'lrn-002', firstName: 'James', lastName: 'Okafor',
    fullName: 'James Okafor', email: 'james.okafor@pret.com',
    phone: '07811 234 567', uln: '2938471605', dob: '22 Jul 1998',
    programmeId: 'prog-001', programme: 'Marketing Executive', programmeLevel: 'Level 4',
    cohortId: 'coh-001', cohort: 'ME-L4 May 2026',
    employerId: 'emp-002', employer: 'Pret A Manger',
    lineManager: 'Sarah Mitchell', lineManagerEmail: 's.mitchell@pret.com',
    coachId: 'coach-001', coach: 'Martin Reeves',
    tutorId: 'tutor-001', tutor: 'Helen Curtis',
    status: 'Active', riskStatus: 'Green', riskReason: '',
    startDate: '19 May 2026', plannedEndDate: '18 Nov 2027', weekOnProgramme: 4,
    overallProgress: 48, attendanceRate: 94, otjhCompleted: 82, otjhTarget: 120, ksbProgress: 44,
    evidenceCount: 15, avatar: 'JO',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 3 — Emily Chen
  {
    id: 'lrn-003', firstName: 'Emily', lastName: 'Chen',
    fullName: 'Emily Chen', email: 'emily.chen@boots.co.uk',
    phone: '07922 345 678', uln: '1928374650', dob: '05 Nov 1999',
    programmeId: 'prog-002', programme: 'Business Administrator', programmeLevel: 'Level 3',
    cohortId: 'coh-002', cohort: 'BA-L3 June 2026',
    employerId: 'emp-003', employer: 'Boots UK',
    lineManager: 'Kevin Marsh', lineManagerEmail: 'k.marsh@boots.co.uk',
    coachId: 'coach-002', coach: 'Sarah Collins',
    tutorId: 'tutor-002', tutor: 'Crispin Jones',
    status: 'Active', riskStatus: 'Amber', riskReason: 'Evidence submissions below target',
    startDate: '02 Jun 2026', plannedEndDate: '01 Sep 2027', weekOnProgramme: 2,
    overallProgress: 12, attendanceRate: 91, otjhCompleted: 18, otjhTarget: 100, ksbProgress: 15,
    evidenceCount: 4, avatar: 'EC',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 4 — Liam Patel — QA REJECTED in Pre-Active (shows across Compliance, QA, Admin, Leadership)
  {
    id: 'lrn-004', firstName: 'Liam', lastName: 'Patel',
    fullName: 'Liam Patel', email: 'liam.patel@costa.co.uk',
    phone: '07633 456 789', uln: '8374659201', dob: '17 Aug 1997',
    programmeId: 'prog-003', programme: 'Data Analyst', programmeLevel: 'Level 4',
    cohortId: 'coh-003', cohort: 'DA-L4 April 2026',
    employerId: 'emp-004', employer: 'Costa Coffee',
    lineManager: 'Diana Holloway', lineManagerEmail: 'd.holloway@costa.co.uk',
    coachId: 'coach-001', coach: 'Martin Reeves',
    tutorId: 'tutor-003', tutor: 'Rachel Oduya',
    status: 'Pre-Active', riskStatus: 'Red', riskReason: 'QA Final Review rejected — eligibility query unresolved',
    startDate: '', plannedEndDate: '13 Oct 2027', weekOnProgramme: 0,
    overallProgress: 0, attendanceRate: 0, otjhCompleted: 0, otjhTarget: 120, ksbProgress: 0,
    evidenceCount: 0, avatar: 'LP',
    eligibilityStatus: 'Pending', rplApplied: false, dasConfirmed: false, ilrReady: false,
    signaturesComplete: true, qaStatus: 'Rejected',
  },
  // 5 — Ava Thompson — GATEWAY
  {
    id: 'lrn-005', firstName: 'Ava', lastName: 'Thompson',
    fullName: 'Ava Thompson', email: 'ava.thompson@marksandspencer.com',
    phone: '07744 567 890', uln: '5647382910', dob: '30 Jan 1993',
    programmeId: 'prog-004', programme: 'Operations Manager', programmeLevel: 'Level 5',
    cohortId: 'coh-004', cohort: 'OM-L5 Jan 2025',
    employerId: 'emp-005', employer: 'Marks & Spencer',
    lineManager: 'Andrew Davies', lineManagerEmail: 'a.davies@marksandspencer.com',
    coachId: 'coach-002', coach: 'Sarah Collins',
    tutorId: 'tutor-002', tutor: 'Crispin Jones',
    status: 'Gateway', riskStatus: 'Green', riskReason: '',
    startDate: '06 Jan 2025', plannedEndDate: '05 Jan 2027', weekOnProgramme: 74,
    overallProgress: 94, attendanceRate: 97, otjhCompleted: 156, otjhTarget: 160, ksbProgress: 96,
    evidenceCount: 48, avatar: 'AT',
    eligibilityStatus: 'Eligible', rplApplied: true, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 6 — Noah Williams
  {
    id: 'lrn-006', firstName: 'Noah', lastName: 'Williams',
    fullName: 'Noah Williams', email: 'noah.williams@next.co.uk',
    phone: '07855 678 901', uln: '3746281905', dob: '12 Apr 1996',
    programmeId: 'prog-005', programme: 'HR Consultant Partner', programmeLevel: 'Level 5',
    cohortId: 'coh-005', cohort: 'HR-L5 March 2025',
    employerId: 'emp-006', employer: 'Next PLC',
    lineManager: 'Claire Watson', lineManagerEmail: 'c.watson@next.co.uk',
    coachId: 'coach-003', coach: 'Daniel Foster',
    tutorId: 'tutor-002', tutor: 'Crispin Jones',
    status: 'Active', riskStatus: 'Green', riskReason: '',
    startDate: '10 Mar 2025', plannedEndDate: '09 Mar 2027', weekOnProgramme: 65,
    overallProgress: 71, attendanceRate: 93, otjhCompleted: 118, otjhTarget: 160, ksbProgress: 68,
    evidenceCount: 35, avatar: 'NW',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 7 — Mia Robinson — AT RISK (Red)
  {
    id: 'lrn-007', firstName: 'Mia', lastName: 'Robinson',
    fullName: 'Mia Robinson', email: 'mia.robinson@tesco.com',
    phone: '07966 789 012', uln: '9283746501', dob: '08 Sep 2001',
    programmeId: 'prog-006', programme: 'Project Manager', programmeLevel: 'Level 4',
    cohortId: 'coh-006', cohort: 'PM-L4 Feb 2026',
    employerId: 'emp-007', employer: 'Tesco',
    lineManager: "Brendan O'Connor", lineManagerEmail: 'b.oconnor@tesco.com',
    coachId: 'coach-001', coach: 'Martin Reeves',
    tutorId: 'tutor-002', tutor: 'Crispin Jones',
    status: 'Active', riskStatus: 'Red', riskReason: 'Attendance 71%, 4 missed sessions, 3 overdue assignments, OTJH severely behind',
    startDate: '03 Feb 2026', plannedEndDate: '02 Oct 2027', weekOnProgramme: 19,
    overallProgress: 22, attendanceRate: 71, otjhCompleted: 28, otjhTarget: 140, ksbProgress: 18,
    evidenceCount: 6, avatar: 'MR',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 8 — Oliver Davis — COMPLETED (EPA passed)
  {
    id: 'lrn-008', firstName: 'Oliver', lastName: 'Davis',
    fullName: 'Oliver Davis', email: 'oliver.davis@barclays.com',
    phone: '07477 890 123', uln: '6372819405', dob: '27 Mar 1995',
    programmeId: 'prog-007', programme: 'Software Developer', programmeLevel: 'Level 4',
    cohortId: 'coh-007', cohort: 'SD-L4 Sep 2024',
    employerId: 'emp-008', employer: 'Barclays Bank PLC',
    lineManager: 'Natasha Singh', lineManagerEmail: 'n.singh@barclays.com',
    coachId: 'coach-003', coach: 'Daniel Foster',
    tutorId: 'tutor-003', tutor: 'Rachel Oduya',
    status: 'Completed', riskStatus: 'Green', riskReason: '',
    startDate: '09 Sep 2024', plannedEndDate: '08 Mar 2026', weekOnProgramme: 78,
    overallProgress: 100, attendanceRate: 98, otjhCompleted: 124, otjhTarget: 120, ksbProgress: 100,
    evidenceCount: 62, avatar: 'OD',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 9 — Priya Sharma — New starter
  {
    id: 'lrn-009', firstName: 'Priya', lastName: 'Sharma',
    fullName: 'Priya Sharma', email: 'priya.sharma@natwest.com',
    phone: '07588 901 234', uln: '7483920165', dob: '19 Jun 2000',
    programmeId: 'prog-002', programme: 'Business Administrator', programmeLevel: 'Level 3',
    cohortId: 'coh-002', cohort: 'BA-L3 June 2026',
    employerId: 'emp-009', employer: 'NatWest Group',
    lineManager: 'Paul Turner', lineManagerEmail: 'p.turner@natwest.com',
    coachId: 'coach-002', coach: 'Sarah Collins',
    tutorId: 'tutor-002', tutor: 'Crispin Jones',
    status: 'Active', riskStatus: 'Green', riskReason: '',
    startDate: '02 Jun 2026', plannedEndDate: '01 Sep 2027', weekOnProgramme: 2,
    overallProgress: 10, attendanceRate: 100, otjhCompleted: 14, otjhTarget: 100, ksbProgress: 10,
    evidenceCount: 3, avatar: 'PS',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
  // 10 — Connor Walsh
  {
    id: 'lrn-010', firstName: 'Connor', lastName: 'Walsh',
    fullName: 'Connor Walsh', email: 'connor.walsh@sainsburys.co.uk',
    phone: '07699 012 345', uln: '2847392106', dob: '03 Feb 2002',
    programmeId: 'prog-001', programme: 'Marketing Executive', programmeLevel: 'Level 4',
    cohortId: 'coh-001', cohort: 'ME-L4 May 2026',
    employerId: 'emp-010', employer: "Sainsbury's",
    lineManager: 'Fiona Hargreaves', lineManagerEmail: 'f.hargreaves@sainsburys.co.uk',
    coachId: 'coach-003', coach: 'Daniel Foster',
    tutorId: 'tutor-001', tutor: 'Helen Curtis',
    status: 'Active', riskStatus: 'Amber', riskReason: 'English functional skills not yet complete',
    startDate: '19 May 2026', plannedEndDate: '18 Nov 2027', weekOnProgramme: 4,
    overallProgress: 38, attendanceRate: 89, otjhCompleted: 65, otjhTarget: 120, ksbProgress: 32,
    evidenceCount: 10, avatar: 'CW',
    eligibilityStatus: 'Eligible', rplApplied: false, dasConfirmed: true, ilrReady: true,
    signaturesComplete: true, qaStatus: 'Approved',
  },
];

// ---- QUICK LOOKUPS ----
export const getLearnerById = (id: string) => DEMO_LEARNERS.find(l => l.id === id);
export const getLearnersByCoach = (coachId: string) => DEMO_LEARNERS.filter(l => l.coachId === coachId);
export const getLearnersByStatus = (status: LearnerStatus) => DEMO_LEARNERS.filter(l => l.status === status);
export const getLearnersByRisk = (risk: RiskStatus) => DEMO_LEARNERS.filter(l => l.riskStatus === risk);
export const getActiveLearners = () => DEMO_LEARNERS.filter(l => ['Active', 'Gateway', 'EPA'].includes(l.status));

// ---- PLATFORM SUMMARY STATS ----
export const PLATFORM_STATS = {
  totalLearners: DEMO_LEARNERS.length,
  activeLearners: DEMO_LEARNERS.filter(l => l.status === 'Active').length,
  gatewayLearners: DEMO_LEARNERS.filter(l => l.status === 'Gateway').length,
  preActiveLearners: DEMO_LEARNERS.filter(l => l.status === 'Pre-Active').length,
  completedLearners: DEMO_LEARNERS.filter(l => l.status === 'Completed').length,
  redRiskLearners: DEMO_LEARNERS.filter(l => l.riskStatus === 'Red').length,
  amberRiskLearners: DEMO_LEARNERS.filter(l => l.riskStatus === 'Amber').length,
  avgAttendance: Math.round(DEMO_LEARNERS.filter(l => l.status === 'Active').reduce((s, l) => s + l.attendanceRate, 0) / DEMO_LEARNERS.filter(l => l.status === 'Active').length),
  avgProgress: Math.round(DEMO_LEARNERS.filter(l => l.status === 'Active').reduce((s, l) => s + l.overallProgress, 0) / DEMO_LEARNERS.filter(l => l.status === 'Active').length),
  totalEmployers: DEMO_EMPLOYERS.length,
  activeCoaches: DEMO_COACHES.length,
  activeTutors: DEMO_TUTORS.length,
};