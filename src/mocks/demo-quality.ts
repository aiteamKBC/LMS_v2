// ============================================================================
// KBC LearningOS — Connected Demo Data: Quality & Risk Layer
// QA sampling, audit logs, risks, tasks, findings
// ============================================================================

// ---- QA EVIDENCE SAMPLING ----
export const DEMO_QA_EVIDENCE_SAMPLES = [
  {
    id: 'qae-001', learnerId: 'lrn-002', learnerName: 'James Okafor',
    programme: 'Marketing Executive L4', evidence: 'Month 1 Assignment — Basics of Marketing',
    sampledDate: '06 Jun 2026', reviewer: 'Patricia Nkosi', status: 'Pass',
    score: 88, feedback: 'Strong assignment. KSBs clearly evidenced. Workplace application evident.',
    ksbsCovered: ['K3', 'K4', 'S1'],
  },
  {
    id: 'qae-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    programme: 'Marketing Executive L4', evidence: 'Customer Journey Map — October 2024',
    sampledDate: '04 Jun 2026', reviewer: 'Patricia Nkosi', status: 'Pass with Comments',
    score: 74, feedback: 'Good workplace application. KSB S3 needs stronger employer validation. Request line manager sign-off.',
    ksbsCovered: ['K5', 'K6', 'S3'],
  },
  {
    id: 'qae-003', learnerId: 'lrn-007', learnerName: 'Mia Robinson',
    programme: 'Project Manager L4', evidence: 'Project Kickoff Notes — June 2026',
    sampledDate: '07 Jun 2026', reviewer: 'Patricia Nkosi', status: 'Refer',
    score: 48, feedback: 'REFER: Evidence does not sufficiently demonstrate KSB K2. Only one activity logged. Employer validation missing. Coach to follow up urgently.',
    ksbsCovered: ['K1', 'S1'],
  },
  {
    id: 'qae-004', learnerId: 'lrn-005', learnerName: 'Ava Thompson',
    programme: 'Operations Manager L5', evidence: 'Portfolio Review — Full EPA Pack',
    sampledDate: '09 Jun 2026', reviewer: 'Patricia Nkosi', status: 'Pass',
    score: 96, feedback: 'Exceptional portfolio. All KSBs evidenced with multiple workplace examples. Highly recommend for distinction grade.',
    ksbsCovered: ['K1', 'K2', 'K3', 'S1', 'B1'],
  },
];

// ---- ACTIVE PLATFORM RISKS ----
export const DEMO_RISKS = [
  {
    id: 'risk-001', learnerId: 'lrn-007', learnerName: 'Mia Robinson',
    category: 'Attendance', severity: 'High', raisedDate: '08 Jun 2026',
    raisedBy: 'Martin Reeves', status: 'Open',
    description: 'Attendance has dropped to 71% — below 80% threshold. 4 missed sessions in 5 weeks. No contact for 6 days.',
    impactArea: 'Programme completion, OTJH target, evidence submission',
    actionRequired: 'Welfare call by coach within 24 hours. Employer to be notified. Consider formal intervention plan.',
    assignedTo: 'Martin Reeves',
  },
  {
    id: 'risk-002', learnerId: 'lrn-004', learnerName: 'Liam Patel',
    category: 'Compliance', severity: 'Critical', raisedDate: '09 Apr 2026',
    raisedBy: 'Patricia Nkosi (QA)', status: 'Open',
    description: 'QA rejected pre-active pack. Residency test fails — settled status share code unverifiable. DAS not confirmed. Start date blocked.',
    impactArea: 'Learner activation, funding confirmation, ILR return',
    actionRequired: 'Eleanor Hart to re-contact employer and learner for updated residency documents within 5 working days.',
    assignedTo: 'Eleanor Hart',
  },
  {
    id: 'risk-003', learnerId: 'lrn-001', learnerName: 'Sophie Williams',
    category: 'OTJH', severity: 'Medium', raisedDate: '05 Jun 2026',
    raisedBy: 'Martin Reeves', status: 'Monitoring',
    description: 'OTJH 74 hours vs 120 target. At week 4 expected pace is ~88 hours. Behind by ~14 hours.',
    impactArea: 'Programme compliance, ESFA audit risk',
    actionRequired: 'Sophie to log an additional 3 hours per week for next 4 weeks. Coach to review in June coaching session.',
    assignedTo: 'Martin Reeves',
  },
  {
    id: 'risk-004', learnerId: 'lrn-003', learnerName: 'Emily Chen',
    category: 'Evidence', severity: 'Medium', raisedDate: '09 Jun 2026',
    raisedBy: 'Sarah Collins', status: 'Monitoring',
    description: 'Only 4 evidence submissions at week 2. Target is 6. KSB mapping not yet complete.',
    impactArea: 'Portfolio readiness, EPA evidence sufficiency',
    actionRequired: 'Set specific evidence targets in June coaching session.',
    assignedTo: 'Sarah Collins',
  },
  {
    id: 'risk-005', learnerId: 'lrn-010', learnerName: 'Connor Walsh',
    category: 'Functional Skills', severity: 'Low', raisedDate: '06 Jun 2026',
    raisedBy: 'Daniel Foster', status: 'Monitoring',
    description: 'English functional skills assessment not yet passed. Required before EPA.',
    impactArea: 'Gateway eligibility',
    actionRequired: 'Enrol in next available English FS session. Target pass by Sept 2026.',
    assignedTo: 'Daniel Foster',
  },
];

// ---- AUDIT LOGS ----
export const DEMO_AUDIT_LOGS = [
  { id: 'aud-001', timestamp: '2026-06-10T14:32:00Z', user: 'Martin Reeves', userRole: 'Coach', action: 'Evidence validated', resourceType: 'Evidence', resourceId: 'otjh-002', learnerId: 'lrn-001', learnerName: 'Sophie Williams', detail: 'Validated OTJH claim: 2 hours — marketing team meeting', ipAddress: '192.168.1.42' },
  { id: 'aud-002', timestamp: '2026-06-10T09:15:00Z', user: 'Patricia Nkosi', userRole: 'QA Officer', action: 'QA sample completed', resourceType: 'QA Review', resourceId: 'qae-004', learnerId: 'lrn-005', learnerName: 'Ava Thompson', detail: 'QA evidence sample — Portfolio Review. Status: Pass (96)', ipAddress: '192.168.1.88' },
  { id: 'aud-003', timestamp: '2026-06-09T16:44:00Z', user: 'Eleanor Hart', userRole: 'Compliance Officer', action: 'Eligibility status updated', resourceType: 'Eligibility Review', resourceId: 'elig-004', learnerId: 'lrn-004', learnerName: 'Liam Patel', detail: 'Status set to Pending — awaiting updated residency evidence from learner', ipAddress: '192.168.1.55' },
  { id: 'aud-004', timestamp: '2026-06-09T11:30:00Z', user: 'Sarah Collins', userRole: 'Coach', action: 'Coaching session completed', resourceType: 'Coaching Meeting', resourceId: 'mtg-007', learnerId: 'lrn-003', learnerName: 'Emily Chen', detail: 'Week 2 coaching completed. Notes saved. 2 evidence targets set.', ipAddress: '192.168.1.60' },
  { id: 'aud-005', timestamp: '2026-06-08T08:22:00Z', user: 'Martin Reeves', userRole: 'Coach', action: 'Risk flag raised', resourceType: 'Risk', resourceId: 'risk-001', learnerId: 'lrn-007', learnerName: 'Mia Robinson', detail: 'High attendance risk raised. Learner has 71% attendance — 4 consecutive missed sessions.', ipAddress: '192.168.1.42' },
  { id: 'aud-006', timestamp: '2026-06-07T15:50:00Z', user: 'Helen Curtis', userRole: 'Tutor', action: 'OTJH rejected', resourceType: 'OTJH Claim', resourceId: 'otjh-006', learnerId: 'lrn-007', learnerName: 'Mia Robinson', detail: 'OTJH claim rejected: insufficient evidence. Learner notified.', ipAddress: '192.168.1.77' },
  { id: 'aud-007', timestamp: '2026-06-07T10:10:00Z', user: 'Patricia Nkosi', userRole: 'QA Officer', action: 'Pre-active QA rejected', resourceType: 'QA Pre-Active', resourceId: 'qa-pre-002', learnerId: 'lrn-004', learnerName: 'Liam Patel', detail: 'Pre-active QA rejected. 4 critical findings raised. Case returned to compliance.', ipAddress: '192.168.1.88' },
  { id: 'aud-008', timestamp: '2026-06-06T14:05:00Z', user: 'Sarah Collins', userRole: 'Coach', action: 'Progress review completed', resourceType: 'Progress Review', resourceId: 'rev-006', learnerId: 'lrn-006', learnerName: 'Noah Williams', detail: 'May progress review completed and signed. KSB gap actions noted.', ipAddress: '192.168.1.60' },
  { id: 'aud-009', timestamp: '2026-06-05T09:00:00Z', user: 'Alex Carter', userRole: 'Tenant Admin', action: 'User invited', resourceType: 'User', resourceId: 'u_learner', learnerId: '', learnerName: '', detail: 'New learner account invited: priya.sharma@natwest.com — BA Level 3', ipAddress: '192.168.1.10' },
  { id: 'aud-010', timestamp: '2026-06-04T16:30:00Z', user: 'Helen Curtis', userRole: 'Tutor', action: 'Assignment marked', resourceType: 'Assignment', resourceId: 'asn-003', learnerId: 'lrn-002', learnerName: 'James Okafor', detail: 'Market research assignment marked — Grade B+ (82%). Feedback submitted.', ipAddress: '192.168.1.77' },
  { id: 'aud-011', timestamp: '2026-06-03T13:00:00Z', user: 'Martin Reeves', userRole: 'Coach', action: 'Coaching no show logged', resourceType: 'Coaching Meeting', resourceId: 'mtg-009', learnerId: 'lrn-007', learnerName: 'Mia Robinson', detail: 'Coaching meeting no show. Second attempt scheduled. Employer notified.', ipAddress: '192.168.1.42' },
  { id: 'aud-012', timestamp: '2026-06-02T10:20:00Z', user: 'James Whitfield', userRole: 'Compliance', action: 'Eligibility approved', resourceType: 'Eligibility Review', resourceId: 'elig-001', learnerId: 'lrn-001', learnerName: 'Sophie Williams', detail: 'Eligibility confirmed — all criteria met. DAS ref: DAS-001-2026.', ipAddress: '192.168.1.55' },
];

// ---- TASKS (cross-platform action items) ----
export const DEMO_TASKS = [
  { id: 'task-001', title: 'Welfare call — Mia Robinson', assignedTo: 'Martin Reeves', role: 'Coach', learnerId: 'lrn-007', priority: 'Urgent', dueDate: '11 Jun 2026', status: 'Overdue', category: 'Learner Risk', relatedRiskId: 'risk-001' },
  { id: 'task-002', title: 'Re-submit eligibility documents — Liam Patel', assignedTo: 'Eleanor Hart', role: 'Compliance', learnerId: 'lrn-004', priority: 'High', dueDate: '14 Jun 2026', status: 'In Progress', category: 'Compliance', relatedRiskId: 'risk-002' },
  { id: 'task-003', title: 'Chase Mia Robinson catch-up submission', assignedTo: 'Martin Reeves', role: 'Coach', learnerId: 'lrn-007', priority: 'High', dueDate: '11 Jun 2026', status: 'Overdue', category: 'Catch-up', relatedRiskId: '' },
  { id: 'task-004', title: 'Finalise Sophie Williams June progress review', assignedTo: 'Martin Reeves', role: 'Coach', learnerId: 'lrn-001', priority: 'Normal', dueDate: '25 Jun 2026', status: 'Pending', category: 'Progress Review', relatedRiskId: '' },
  { id: 'task-005', title: 'QA sample — Emily Chen Week 1 evidence', assignedTo: 'Patricia Nkosi', role: 'QA', learnerId: 'lrn-003', priority: 'Normal', dueDate: '18 Jun 2026', status: 'Pending', category: 'QA', relatedRiskId: '' },
  { id: 'task-006', title: 'ILR readiness check — Priya Sharma', assignedTo: 'Lisa Nguyen', role: 'MIS', learnerId: 'lrn-009', priority: 'Normal', dueDate: '13 Jun 2026', status: 'Pending', category: 'ILR', relatedRiskId: '' },
  { id: 'task-007', title: 'Ava Thompson — EPA registration confirmation', assignedTo: 'Sarah Collins', role: 'Coach', learnerId: 'lrn-005', priority: 'High', dueDate: '20 Jun 2026', status: 'In Progress', category: 'EPA', relatedRiskId: '' },
  { id: 'task-008', title: 'Validate Connor Walsh OTJH backlog (3 claims)', assignedTo: 'Helen Curtis', role: 'Tutor', learnerId: 'lrn-010', priority: 'Normal', dueDate: '14 Jun 2026', status: 'Pending', category: 'OTJH', relatedRiskId: '' },
];

// ---- LEADERSHIP SUMMARY (aggregated view) ----
export const LEADERSHIP_SUMMARY = {
  activeLearners: 7,
  gatewayLearners: 1,
  preActiveLearners: 1,
  completedThisYear: 1,
  redRisk: 2,
  amberRisk: 3,
  greenRisk: 4,
  avgAttendance: 88,
  avgProgress: 55,
  otjhOnTrack: 6,
  otjhBehind: 3,
  qaIssuesOpen: 2,
  complianceRisks: 1,
  coachWorkload: [
    { coach: 'Martin Reeves', caseload: 5, avgAttendance: 82, redRisk: 2, tasksOverdue: 2 },
    { coach: 'Sarah Collins', caseload: 3, avgAttendance: 94, redRisk: 0, tasksOverdue: 0 },
    { coach: 'Daniel Foster', caseload: 2, avgAttendance: 91, redRisk: 0, tasksOverdue: 0 },
  ],
  monthlyEnrolments: [
    { month: 'Jan 2026', count: 0 }, { month: 'Feb 2026', count: 1 }, { month: 'Mar 2026', count: 0 },
    { month: 'Apr 2026', count: 1 }, { month: 'May 2026', count: 5 }, { month: 'Jun 2026', count: 2 },
  ],
  completionRateTarget: 85,
  completionRateCurrent: 100,
  ofstedReadiness: 'Good',
};