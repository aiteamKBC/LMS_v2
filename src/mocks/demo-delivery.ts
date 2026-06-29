// ============================================================================
// KBC LearningOS — Connected Demo Data: Delivery Layer
// Attendance, coaching meetings, progress reviews, OTJH, KSB
// ============================================================================

// ---- COACHING MEETINGS ----
export const DEMO_COACHING_MEETINGS = [
  // Sophie Williams (lrn-001)
  { id: 'mtg-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '18 Jun 2026', time: '14:00–15:00', status: 'Scheduled', notes: '' },
  { id: 'mtg-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '21 May 2026', time: '14:00–15:00', status: 'Completed', notes: 'Good session. Discussed segmentation assignment. Action: log 3 more OTJH hours this week.' },
  { id: 'mtg-003', learnerId: 'lrn-001', learnerName: 'Sophie Williams', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '23 Apr 2026', time: '14:00–15:00', status: 'Completed', notes: 'Initial coaching — set SMART goals, agreed on attendance target.' },

  // James Okafor (lrn-002)
  { id: 'mtg-004', learnerId: 'lrn-002', learnerName: 'James Okafor', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '19 Jun 2026', time: '10:00–11:00', status: 'Scheduled', notes: '' },
  { id: 'mtg-005', learnerId: 'lrn-002', learnerName: 'James Okafor', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '22 May 2026', time: '10:00–11:00', status: 'Completed', notes: 'On track. Encourage to submit 3 more KSB evidence pieces before June review.' },

  // Emily Chen (lrn-003)
  { id: 'mtg-006', learnerId: 'lrn-003', learnerName: 'Emily Chen', coachId: 'coach-002', coach: 'Sarah Collins', type: 'Monthly Coaching', date: '17 Jun 2026', time: '11:00–12:00', status: 'Scheduled', notes: '' },
  { id: 'mtg-007', learnerId: 'lrn-003', learnerName: 'Emily Chen', coachId: 'coach-002', coach: 'Sarah Collins', type: 'Monthly Coaching', date: '05 Jun 2026', time: '11:00–12:00', status: 'Completed', notes: 'Week 2 review. Evidence behind but learner engaged. Set 2 evidence targets for June.' },

  // Mia Robinson (lrn-007) — Red risk, urgent
  { id: 'mtg-008', learnerId: 'lrn-007', learnerName: 'Mia Robinson', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Welfare & Risk Review', date: '11 Jun 2026', time: '15:00–16:00', status: 'Urgent — Booked', notes: '' },
  { id: 'mtg-009', learnerId: 'lrn-007', learnerName: 'Mia Robinson', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '15 May 2026', time: '15:00–15:30', status: 'No Show', notes: 'Learner did not attend. Second attempt booked. Employer informed.' },
  { id: 'mtg-010', learnerId: 'lrn-007', learnerName: 'Mia Robinson', coachId: 'coach-001', coach: 'Martin Reeves', type: 'Monthly Coaching', date: '10 Apr 2026', time: '15:00–16:00', status: 'Completed', notes: 'First coaching. Learner started well.' },

  // Noah Williams (lrn-006)
  { id: 'mtg-011', learnerId: 'lrn-006', learnerName: 'Noah Williams', coachId: 'coach-003', coach: 'Daniel Foster', type: 'Monthly Coaching', date: '20 Jun 2026', time: '13:00–14:00', status: 'Scheduled', notes: '' },
  { id: 'mtg-012', learnerId: 'lrn-006', learnerName: 'Noah Williams', coachId: 'coach-003', coach: 'Daniel Foster', type: 'Monthly Coaching', date: '23 May 2026', time: '13:00–14:00', status: 'Completed', notes: 'Gateway preparation discussed. KSB gaps identified for K14, K15.' },

  // Ava Thompson (lrn-005)
  { id: 'mtg-013', learnerId: 'lrn-005', learnerName: 'Ava Thompson', coachId: 'coach-002', coach: 'Sarah Collins', type: 'Gateway Coaching', date: '13 Jun 2026', time: '09:00–10:00', status: 'Completed', notes: 'Mock professional discussion prep. All KSBs covered. Ava ready for gateway.' },
  { id: 'mtg-014', learnerId: 'lrn-005', learnerName: 'Ava Thompson', coachId: 'coach-002', coach: 'Sarah Collins', type: 'Monthly Coaching', date: '16 May 2026', time: '09:00–10:00', status: 'Completed', notes: 'Excellent. Portfolio complete. Submitted for QA approval.' },

  // Connor Walsh (lrn-010)
  { id: 'mtg-015', learnerId: 'lrn-010', learnerName: 'Connor Walsh', coachId: 'coach-003', coach: 'Daniel Foster', type: 'Monthly Coaching', date: '16 Jun 2026', time: '14:00–15:00', status: 'Scheduled', notes: '' },
];

// ---- PROGRESS REVIEWS ----
export const DEMO_PROGRESS_REVIEWS = [
  {
    id: 'rev-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    reviewDate: '25 Jun 2026', type: 'Progress Review', coachId: 'coach-001', coach: 'Martin Reeves',
    status: 'Scheduled', period: 'June 2026',
    overallProgress: 42, attendanceRate: 86, otjhHours: 74, ksbProgress: 38,
    learnerSigned: false, employerSigned: false, coachSigned: false, qaSampled: false,
  },
  {
    id: 'rev-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    reviewDate: '21 May 2026', type: 'Progress Review', coachId: 'coach-001', coach: 'Martin Reeves',
    status: 'Completed', period: 'May 2026',
    overallProgress: 32, attendanceRate: 88, otjhHours: 56, ksbProgress: 28,
    learnerSigned: true, employerSigned: true, coachSigned: true, qaSampled: false,
    notes: 'Good start to programme. Attendance slightly below target. OTJH behind 4 hours. Action: log overtime on Friday.',
  },
  {
    id: 'rev-003', learnerId: 'lrn-002', learnerName: 'James Okafor',
    reviewDate: '22 May 2026', type: 'Progress Review', coachId: 'coach-001', coach: 'Martin Reeves',
    status: 'Completed', period: 'May 2026',
    overallProgress: 38, attendanceRate: 92, otjhHours: 68, ksbProgress: 36,
    learnerSigned: true, employerSigned: true, coachSigned: true, qaSampled: true,
    notes: 'Excellent progress. KSB evidence strong. Employer very engaged.',
  },
  {
    id: 'rev-004', learnerId: 'lrn-007', learnerName: 'Mia Robinson',
    reviewDate: '15 May 2026', type: 'Progress Review', coachId: 'coach-001', coach: 'Martin Reeves',
    status: 'Overdue — No Show', period: 'May 2026',
    overallProgress: 18, attendanceRate: 68, otjhHours: 22, ksbProgress: 14,
    learnerSigned: false, employerSigned: false, coachSigned: false, qaSampled: false,
    notes: 'Learner did not attend. At-risk escalation raised.',
  },
  {
    id: 'rev-005', learnerId: 'lrn-005', learnerName: 'Ava Thompson',
    reviewDate: '10 Jun 2026', type: 'Gateway Review', coachId: 'coach-002', coach: 'Sarah Collins',
    status: 'Completed', period: 'June 2026',
    overallProgress: 94, attendanceRate: 97, otjhHours: 156, ksbProgress: 96,
    learnerSigned: true, employerSigned: true, coachSigned: true, qaSampled: true,
    notes: 'Gateway criteria all met. Ava approved to proceed to EPA. Excellent programme.',
  },
  {
    id: 'rev-006', learnerId: 'lrn-006', learnerName: 'Noah Williams',
    reviewDate: '20 May 2026', type: 'Progress Review', coachId: 'coach-003', coach: 'Daniel Foster',
    status: 'Completed', period: 'May 2026',
    overallProgress: 68, attendanceRate: 92, otjhHours: 112, ksbProgress: 64,
    learnerSigned: true, employerSigned: true, coachSigned: true, qaSampled: false,
    notes: 'Strong progress. Some KSB gaps at K14/K15 — targeted actions set.',
  },
];

// ---- ATTENDANCE RECORDS ----
export const DEMO_ATTENDANCE = [
  { id: 'att-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', sessionDate: '11 Jun 2026', session: 'Week 4 — Marketing Planning', type: 'Live Session', status: 'Present', tutorId: 'tutor-001', tutor: 'Helen Curtis' },
  { id: 'att-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', sessionDate: '04 Jun 2026', session: 'Week 3 — Audience Segmentation', type: 'Live Session', status: 'Present', tutorId: 'tutor-001', tutor: 'Helen Curtis' },
  { id: 'att-003', learnerId: 'lrn-001', learnerName: 'Sophie Williams', sessionDate: '28 May 2026', session: 'Week 2 — Consumer Behaviour', type: 'Live Session', status: 'Absent', tutorId: 'tutor-001', tutor: 'Helen Curtis', absenceReason: 'Work commitment — employer confirmed' },
  { id: 'att-004', learnerId: 'lrn-002', learnerName: 'James Okafor', sessionDate: '11 Jun 2026', session: 'Week 4 — Marketing Planning', type: 'Live Session', status: 'Present', tutorId: 'tutor-001', tutor: 'Helen Curtis' },
  { id: 'att-005', learnerId: 'lrn-007', learnerName: 'Mia Robinson', sessionDate: '11 Jun 2026', session: 'Week 19 — Risk Management', type: 'Live Session', status: 'Absent', tutorId: 'tutor-002', tutor: 'Crispin Jones', absenceReason: 'No contact — escalated to coach' },
  { id: 'att-006', learnerId: 'lrn-007', learnerName: 'Mia Robinson', sessionDate: '04 Jun 2026', session: 'Week 18 — Project Governance', type: 'Live Session', status: 'Absent', tutorId: 'tutor-002', tutor: 'Crispin Jones', absenceReason: 'No contact' },
  { id: 'att-007', learnerId: 'lrn-005', learnerName: 'Ava Thompson', sessionDate: '05 Jun 2026', session: 'Week 74 — EPA Preparation', type: 'Live Session', status: 'Present', tutorId: 'tutor-002', tutor: 'Crispin Jones' },
  { id: 'att-008', learnerId: 'lrn-003', learnerName: 'Emily Chen', sessionDate: '11 Jun 2026', session: 'Week 2 — Admin Fundamentals', type: 'Live Session', status: 'Present', tutorId: 'tutor-002', tutor: 'Crispin Jones' },
];

// ---- CATCH-UP TASKS ----
export const DEMO_CATCHUP_TASKS = [
  { id: 'cu-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', session: 'Week 2 — Consumer Behaviour', missedDate: '28 May 2026', catchupDeadline: '18 Jun 2026', status: 'Pending', coachId: 'coach-001', coach: 'Martin Reeves', notes: 'Recording available. Learner to watch and submit 200-word reflection.' },
  { id: 'cu-002', learnerId: 'lrn-007', learnerName: 'Mia Robinson', session: 'Week 18 — Project Governance', missedDate: '04 Jun 2026', catchupDeadline: '11 Jun 2026', status: 'Overdue', coachId: 'coach-001', coach: 'Martin Reeves', notes: 'OVERDUE. No contact from learner. Coach must escalate.' },
  { id: 'cu-003', learnerId: 'lrn-007', learnerName: 'Mia Robinson', session: 'Week 19 — Risk Management', missedDate: '11 Jun 2026', catchupDeadline: '18 Jun 2026', status: 'Pending', coachId: 'coach-001', coach: 'Martin Reeves', notes: 'New catch-up assigned.' },
  { id: 'cu-004', learnerId: 'lrn-010', learnerName: 'Connor Walsh', session: 'Week 3 — Audience Segmentation', missedDate: '28 May 2026', catchupDeadline: '11 Jun 2026', status: 'Completed', coachId: 'coach-003', coach: 'Daniel Foster', notes: 'Learner submitted reflection on time.' },
];

// ---- OTJH CLAIMS ----
export const DEMO_OTJH_CLAIMS = [
  { id: 'otjh-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', date: '10 Jun 2026', activity: 'Customer segmentation research for campaign project', hours: 3.5, status: 'Pending Validation', tutorId: 'tutor-001' },
  { id: 'otjh-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', date: '05 Jun 2026', activity: 'Attended marketing team meeting — applied learning to brief', hours: 2, status: 'Validated', tutorId: 'tutor-001', validatedDate: '08 Jun 2026' },
  { id: 'otjh-003', learnerId: 'lrn-001', learnerName: 'Sophie Williams', date: '03 Jun 2026', activity: 'Week 3 live session', hours: 3, status: 'Validated', tutorId: 'tutor-001', validatedDate: '05 Jun 2026' },
  { id: 'otjh-004', learnerId: 'lrn-002', learnerName: 'James Okafor', date: '10 Jun 2026', activity: 'Brand analysis project for Pret A Manger menu redesign', hours: 4, status: 'Pending Validation', tutorId: 'tutor-001' },
  { id: 'otjh-005', learnerId: 'lrn-007', learnerName: 'Mia Robinson', date: '01 Jun 2026', activity: 'Project kickoff meeting', hours: 2, status: 'Validated', tutorId: 'tutor-002', validatedDate: '03 Jun 2026' },
  { id: 'otjh-006', learnerId: 'lrn-007', learnerName: 'Mia Robinson', date: '05 Jun 2026', activity: 'Stakeholder interview for project brief', hours: 1.5, status: 'Rejected', tutorId: 'tutor-002', rejectionReason: 'Insufficient evidence provided — please resubmit with employer confirmation.' },
  { id: 'otjh-007', learnerId: 'lrn-005', learnerName: 'Ava Thompson', date: '08 Jun 2026', activity: 'Final portfolio review with line manager', hours: 2, status: 'Validated', tutorId: 'tutor-002', validatedDate: '09 Jun 2026' },
  { id: 'otjh-008', learnerId: 'lrn-006', learnerName: 'Noah Williams', date: '09 Jun 2026', activity: 'HR policy review — applied CIPD framework', hours: 3, status: 'Pending Validation', tutorId: 'tutor-002' },
];

// ---- KSB PROGRESS ----
export const DEMO_KSB_PROGRESS = [
  { learnerId: 'lrn-001', learnerName: 'Sophie Williams', ksbs: [
    { id: 'K1', label: 'Marketing context', status: 'Validated', evidenceCount: 3 },
    { id: 'K2', label: 'Customer & consumer insight', status: 'Validated', evidenceCount: 2 },
    { id: 'K3', label: 'Segmentation & targeting', status: 'Pending', evidenceCount: 1 },
    { id: 'K4', label: 'Brand & positioning', status: 'Not Started', evidenceCount: 0 },
    { id: 'S1', label: 'Research & analysis', status: 'Validated', evidenceCount: 2 },
    { id: 'S2', label: 'Insight presentation', status: 'Not Started', evidenceCount: 0 },
    { id: 'B1', label: 'Commercial awareness', status: 'Validated', evidenceCount: 1 },
  ]},
  { learnerId: 'lrn-007', learnerName: 'Mia Robinson', ksbs: [
    { id: 'K1', label: 'Project context', status: 'Validated', evidenceCount: 1 },
    { id: 'K2', label: 'Stakeholder management', status: 'Not Started', evidenceCount: 0 },
    { id: 'K3', label: 'Risk identification', status: 'Not Started', evidenceCount: 0 },
    { id: 'S1', label: 'Planning tools', status: 'Pending', evidenceCount: 1 },
    { id: 'B1', label: 'Professional attitude', status: 'Not Started', evidenceCount: 0 },
  ]},
  { learnerId: 'lrn-005', learnerName: 'Ava Thompson', ksbs: [
    { id: 'K1', label: 'Operations strategy', status: 'Validated', evidenceCount: 6 },
    { id: 'K2', label: 'Resource management', status: 'Validated', evidenceCount: 5 },
    { id: 'K3', label: 'Financial awareness', status: 'Validated', evidenceCount: 4 },
    { id: 'S1', label: 'Leadership in context', status: 'Validated', evidenceCount: 7 },
    { id: 'B1', label: 'Inclusive leadership', status: 'Validated', evidenceCount: 3 },
  ]},
];