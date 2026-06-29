// ============================================================================
// KBC LearningOS — Connected Demo Data: Evidence & Learning Layer
// Evidence submissions, assignments, quizzes, messages
// ============================================================================

// ---- EVIDENCE SUBMISSIONS ----
export const DEMO_EVIDENCE = [
  // Sophie Williams
  { id: 'ev-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Customer Segmentation Analysis — Tim Hortons', type: 'Workplace Task', status: 'Validated', submittedDate: '05 Jun 2026', validatedDate: '07 Jun 2026', ksbsMapped: ['K2', 'K3', 'S1'], validatedBy: 'Helen Curtis', grade: 'Pass', feedbackGiven: true },
  { id: 'ev-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Marketing Principles Reflective Journal', type: 'Reflection', status: 'Validated', submittedDate: '28 May 2026', validatedDate: '01 Jun 2026', ksbsMapped: ['K1', 'B1'], validatedBy: 'Helen Curtis', grade: 'Merit', feedbackGiven: true },
  { id: 'ev-003', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'STP Model Application — Breakfast Campaign', type: 'Assignment', status: 'Pending', submittedDate: '10 Jun 2026', validatedDate: '', ksbsMapped: ['K3', 'S1', 'S2'], validatedBy: '', grade: '', feedbackGiven: false },
  { id: 'ev-004', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Week 4 Session Recording Reflection', type: 'Reflection', status: 'Draft', submittedDate: '', validatedDate: '', ksbsMapped: ['K4'], validatedBy: '', grade: '', feedbackGiven: false },

  // James Okafor
  { id: 'ev-005', learnerId: 'lrn-002', learnerName: 'James Okafor', title: 'Market Research Report — Pret A Manger Salad Line', type: 'Assignment', status: 'Validated', submittedDate: '29 Oct 2024', validatedDate: '01 Nov 2024', ksbsMapped: ['K5', 'K6', 'S2', 'B1'], validatedBy: 'Helen Curtis', grade: 'Distinction', feedbackGiven: true },
  { id: 'ev-006', learnerId: 'lrn-002', learnerName: 'James Okafor', title: 'Consumer Behaviour Case Study', type: 'Case Study', status: 'Validated', submittedDate: '26 Nov 2024', validatedDate: '02 Dec 2024', ksbsMapped: ['K6', 'S3', 'B2'], validatedBy: 'Helen Curtis', grade: 'Merit', feedbackGiven: true },
  { id: 'ev-007', learnerId: 'lrn-002', learnerName: 'James Okafor', title: 'Campaign Planning — Autumn Product Launch', type: 'Assignment', status: 'Pending', submittedDate: '08 Jun 2026', validatedDate: '', ksbsMapped: ['K9', 'K10', 'S4'], validatedBy: '', grade: '', feedbackGiven: false },

  // Mia Robinson — limited evidence, behind target
  { id: 'ev-008', learnerId: 'lrn-007', learnerName: 'Mia Robinson', title: 'Project Initiation Document — Store Renovation', type: 'Workplace Document', status: 'Pending', submittedDate: '03 Jun 2026', validatedDate: '', ksbsMapped: ['K1', 'S1'], validatedBy: '', grade: '', feedbackGiven: false },
  { id: 'ev-009', learnerId: 'lrn-007', learnerName: 'Mia Robinson', title: 'Stakeholder Register', type: 'Workplace Document', status: 'Validated', submittedDate: '15 Apr 2026', validatedDate: '20 Apr 2026', ksbsMapped: ['K1'], validatedBy: 'Crispin Jones', grade: 'Pass', feedbackGiven: true },

  // Ava Thompson — full portfolio
  { id: 'ev-010', learnerId: 'lrn-005', learnerName: 'Ava Thompson', title: 'Operations Strategy Report — M&S Food Hall', type: 'Major Project', status: 'Validated', submittedDate: '02 May 2026', validatedDate: '05 May 2026', ksbsMapped: ['K1', 'K2', 'S1', 'B1'], validatedBy: 'Crispin Jones', grade: 'Distinction', feedbackGiven: true },
  { id: 'ev-011', learnerId: 'lrn-005', learnerName: 'Ava Thompson', title: 'Leadership in Practice — 360 Feedback Portfolio', type: 'Portfolio', status: 'Validated', submittedDate: '20 May 2026', validatedDate: '22 May 2026', ksbsMapped: ['K3', 'S1', 'B1'], validatedBy: 'Crispin Jones', grade: 'Distinction', feedbackGiven: true },

  // Emily Chen — early stage
  { id: 'ev-012', learnerId: 'lrn-003', learnerName: 'Emily Chen', title: 'Admin Induction Reflection', type: 'Reflection', status: 'Validated', submittedDate: '06 Jun 2026', validatedDate: '09 Jun 2026', ksbsMapped: ['K1'], validatedBy: 'Crispin Jones', grade: 'Pass', feedbackGiven: true },
  { id: 'ev-013', learnerId: 'lrn-003', learnerName: 'Emily Chen', title: 'Document Management Process Map', type: 'Workplace Task', status: 'Pending', submittedDate: '09 Jun 2026', validatedDate: '', ksbsMapped: ['K2', 'S1'], validatedBy: '', grade: '', feedbackGiven: false },
];

// ---- ASSIGNMENTS ----
export const DEMO_ASSIGNMENTS = [
  { id: 'asn-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Week 4 Assignment — Campaign Brief', dueDate: '14 Jun 2026', status: 'Pending Submission', module: 'Marketing Planning', ksbsMapped: ['K9', 'S4'] },
  { id: 'asn-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Week 3 Assignment — Audience Persona', dueDate: '07 Jun 2026', status: 'Submitted — Pending Mark', module: 'Consumer Insight', ksbsMapped: ['K3', 'K6'] },
  { id: 'asn-003', learnerId: 'lrn-002', learnerName: 'James Okafor', title: 'Month 1 — Market Research Report', dueDate: '31 Oct 2024', status: 'Marked — Grade B+', module: 'Market Research', ksbsMapped: ['K5', 'K6', 'S2'] },
  { id: 'asn-004', learnerId: 'lrn-007', learnerName: 'Mia Robinson', title: 'Week 15 Assignment — Project Charter', dueDate: '22 May 2026', status: 'Overdue — Not Submitted', module: 'Project Initiation', ksbsMapped: ['K1', 'K2'] },
  { id: 'asn-005', learnerId: 'lrn-007', learnerName: 'Mia Robinson', title: 'Week 18 Assignment — Stakeholder Analysis', dueDate: '05 Jun 2026', status: 'Overdue — Not Submitted', module: 'Stakeholder Management', ksbsMapped: ['K2', 'S2'] },
  { id: 'asn-006', learnerId: 'lrn-003', learnerName: 'Emily Chen', title: 'Week 1 Assignment — Admin Role Overview', dueDate: '11 Jun 2026', status: 'Submitted — Pending Mark', module: 'Admin Fundamentals', ksbsMapped: ['K1', 'K2'] },
  { id: 'asn-007', learnerId: 'lrn-005', learnerName: 'Ava Thompson', title: 'EPA Synoptic Project', dueDate: '28 May 2026', status: 'Marked — Distinction', module: 'EPA Preparation', ksbsMapped: ['K1', 'K2', 'K3', 'S1', 'B1'] },
];

// ---- QUIZZES ----
export const DEMO_QUIZZES = [
  { id: 'qz-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Quiz — Marketing Basics', module: 'Induction', dueDate: '25 May 2026', score: 88, passed: true, attempts: 1 },
  { id: 'qz-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Quiz — Consumer Behaviour', module: 'Consumer Insight', dueDate: '02 Jun 2026', score: 76, passed: true, attempts: 2 },
  { id: 'qz-003', learnerId: 'lrn-001', learnerName: 'Sophie Williams', title: 'Quiz — Segmentation', module: 'Consumer Insight', dueDate: '13 Jun 2026', score: null, passed: false, attempts: 0 },
  { id: 'qz-004', learnerId: 'lrn-002', learnerName: 'James Okafor', title: 'Quiz — Marketing Basics', module: 'Induction', dueDate: '25 May 2026', score: 94, passed: true, attempts: 1 },
  { id: 'qz-005', learnerId: 'lrn-007', learnerName: 'Mia Robinson', title: 'Quiz — Project Context', module: 'Project Initiation', dueDate: '20 Feb 2026', score: 58, passed: false, attempts: 2 },
  { id: 'qz-006', learnerId: 'lrn-007', learnerName: 'Mia Robinson', title: 'Quiz — Risk Management', module: 'Risk Management', dueDate: '10 Jun 2026', score: null, passed: false, attempts: 0 },
  { id: 'qz-007', learnerId: 'lrn-005', learnerName: 'Ava Thompson', title: 'Gateway Readiness Self-Check', module: 'EPA Preparation', dueDate: '01 Jun 2026', score: 96, passed: true, attempts: 1 },
];

// ---- MESSAGES ----
export const DEMO_MESSAGES = [
  { id: 'msg-001', from: 'Martin Reeves', fromRole: 'Coach', fromId: 'coach-001', toId: 'lrn-001', toLearner: 'Sophie Williams', date: '08 Jun 2026', subject: 'Coaching Prep — 18 June', message: 'Hi Sophie, looking forward to our session on the 18th. Please prepare your reflection on how the segmentation learning has impacted your day-to-day work at Tim Hortons. Bring 2 examples.', read: false },
  { id: 'msg-002', from: 'Helen Curtis', fromRole: 'Tutor', fromId: 'tutor-001', toId: 'lrn-001', toLearner: 'Sophie Williams', date: '06 Jun 2026', subject: 'Week 3 Session Recording', message: 'I have uploaded the recording of last week\'s session on the marketing environment. Please watch before Wednesday if you missed any part of it.', read: true },
  { id: 'msg-003', from: 'Martin Reeves', fromRole: 'Coach', fromId: 'coach-001', toId: 'lrn-007', toLearner: 'Mia Robinson', date: '09 Jun 2026', subject: 'URGENT — Attendance & Missed Sessions', message: 'Mia, I have tried to contact you twice this week. I am concerned about your attendance and 2 overdue assignments. Please call me urgently on 01227 811 401 or reply to this message. I want to help.', read: false },
  { id: 'msg-004', from: 'Eleanor Hart', fromRole: 'Compliance', fromId: 'u_compliance', toId: 'lrn-004', toLearner: 'Liam Patel', date: '09 Jun 2026', subject: 'Important: Documents Required to Resume Enrolment', message: 'Dear Liam, we need updated residency evidence to progress your apprenticeship enrolment. Please provide your settled status share code (valid) and a utility bill dated within the last 3 months. Without this, we cannot confirm your start date.', read: false },
  { id: 'msg-005', from: 'Sarah Collins', fromRole: 'Coach', fromId: 'coach-002', toId: 'lrn-005', toLearner: 'Ava Thompson', date: '10 Jun 2026', subject: 'Congratulations — Gateway Approved!', message: 'Ava, I am delighted to confirm that your gateway review has been approved. Your portfolio is exceptional and you are fully ready for EPA. Your EPA registration will be confirmed within 5 working days.', read: true },
  { id: 'msg-006', from: 'Daniel Foster', fromRole: 'Coach', fromId: 'coach-003', toId: 'lrn-010', toLearner: 'Connor Walsh', date: '07 Jun 2026', subject: 'English Functional Skills — Next Steps', message: 'Hi Connor, just a reminder that we need to get your English FS sorted before gateway. I have enrolled you in the next available cohort starting 15 July. Please confirm you can attend.', read: false },
];

// ---- PLATFORM EVIDENCE STATS ----
export const EVIDENCE_PLATFORM_STATS = {
  totalSubmissions: DEMO_EVIDENCE.length,
  validated: DEMO_EVIDENCE.filter(e => e.status === 'Validated').length,
  pending: DEMO_EVIDENCE.filter(e => e.status === 'Pending').length,
  draft: DEMO_EVIDENCE.filter(e => e.status === 'Draft').length,
  totalOtjhPendingHours: 10.5,
  totalOtjhValidatedHours: 687,
  assignmentsOverdue: DEMO_ASSIGNMENTS.filter(a => a.status.includes('Overdue')).length,
  quizzesPending: DEMO_QUIZZES.filter(q => q.attempts === 0).length,
};