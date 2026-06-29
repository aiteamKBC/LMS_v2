// Safeguarding mock data — restricted, secure, DSL-only
// Concern types, risk statuses, full case records

export const CONCERN_TYPES = [
  'Wellbeing Concern',
  'Safeguarding Concern',
  'Prevent Concern',
  'Mental Health Concern',
  'Domestic Abuse Concern',
  'Harassment or Bullying',
  'Discrimination Concern',
  'Employer/Workplace Concern',
  'Attendance-related Welfare Concern',
  'Disclosure from Learner',
  'Concern Raised by Coach/Tutor',
  'Concern Raised by Employer',
  'Other',
] as const;

export const RISK_STATUSES = [
  'New Concern',
  'Triage Required',
  'Low Risk',
  'Medium Risk',
  'High Risk',
  'Immediate Action Required',
  'Referred',
  'Monitoring',
  'Closed',
  'Archived',
] as const;

export const SAFEGUARDING_OFFICERS = [
  { id: 'dso-001', name: 'Dr. Eleanor Vance', role: 'Designated Safeguarding Lead (DSL)', initials: 'EV', colour: 'bg-red-100 text-red-700' },
  { id: 'dso-002', name: 'Marcus Adewale', role: 'Deputy DSL — Learner Welfare', initials: 'MA', colour: 'bg-amber-100 text-amber-700' },
  { id: 'dso-003', name: 'Priya Kapoor', role: 'Safeguarding Officer — Mental Health Lead', initials: 'PK', colour: 'bg-emerald-100 text-emerald-700' },
  { id: 'dso-004', name: 'Sarah Okonkwo', role: 'Safeguarding Officer — Prevent Lead', initials: 'SO', colour: 'bg-secondary-100 text-secondary-700' },
];

export interface SafeguardingFollowUp {
  id: string;
  action: string;
  owner: string;
  deadline: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Overdue';
  completedDate?: string;
}

export interface SafeguardingAuditEntry {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  action: string;
  detail: string;
  visibility: 'restricted' | 'internal';
}

export interface SafeguardingCase {
  id: string;
  caseRef: string;
  learnerName: string;
  learnerId: string;
  programme: string;
  employer: string;
  tenant: string;
  concernType: string;
  concernSummary: string;
  sourceOfConcern: string;
  dateReported: string;
  reportedBy: string;
  reportedByRole: string;
  riskLevel: string;
  immediateActionRequired: boolean;
  immediateActionDetail: string;
  safeguardingOfficerAssigned: string;
  safeguardingOfficerId: string;
  dslReviewRequired: boolean;
  dslReviewStatus: 'Pending' | 'Reviewed' | 'Escalated';
  followUpActions: SafeguardingFollowUp[];
  status: string;
  referralStatus: 'None' | 'Internal Pending' | 'Internal Complete' | 'External Pending' | 'External Complete' | 'Multi-agency';
  secureNotes: string;
  attachments: { name: string; type: string; uploadedBy: string; date: string }[];
  auditTrail: SafeguardingAuditEntry[];
  escalationHistory: { date: string; from: string; to: string; reason: string }[];
  referralHistory: { date: string; type: string; organisation: string; outcome: string }[];
  caseClosureReason?: string;
  reviewDate?: string;
  restrictedVisibility: string[];
}

export const SAFEGUARDING_CASES: SafeguardingCase[] = [
  {
    id: 'sg-c001',
    caseRef: 'SG-2026-0042',
    learnerName: 'Mia Robinson',
    learnerId: 'LRN-0182',
    programme: 'Business Administration L3',
    employer: 'Kent County Council',
    tenant: 'KBC',
    concernType: 'Safeguarding Concern',
    concernSummary: 'Learner disclosed during monthly coaching session that she is experiencing controlling behaviour from a family member affecting her ability to attend sessions and complete coursework. Learner appeared distressed and tearful during disclosure.',
    sourceOfConcern: 'Coaching Session — Monthly Review',
    dateReported: '2026-06-08',
    reportedBy: 'James Okonkwo (Coach)',
    reportedByRole: 'Coach',
    riskLevel: 'High Risk',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL contacted learner same day. Safety assessment completed. Referral to local safeguarding board initiated. Learner provided with emergency contact numbers and safe-word protocol for coaching sessions.',
    safeguardingOfficerAssigned: 'Dr. Eleanor Vance',
    safeguardingOfficerId: 'dso-001',
    dslReviewRequired: true,
    dslReviewStatus: 'Reviewed',
    followUpActions: [
      { id: 'fu-001', action: 'Conduct full safeguarding risk assessment', owner: 'Dr. Eleanor Vance', deadline: '2026-06-10', status: 'Completed', completedDate: '2026-06-09' },
      { id: 'fu-002', action: 'Liaise with local authority safeguarding team', owner: 'Dr. Eleanor Vance', deadline: '2026-06-12', status: 'Completed', completedDate: '2026-06-11' },
      { id: 'fu-003', action: 'Arrange weekly wellbeing check-ins with learner', owner: 'Priya Kapoor', deadline: '2026-06-15', status: 'In Progress' },
      { id: 'fu-004', action: 'Review safety plan with learner and coach', owner: 'Marcus Adewale', deadline: '2026-06-20', status: 'Pending' },
    ],
    status: 'High Risk',
    referralStatus: 'External Pending',
    secureNotes: 'Learner has been provided with a dedicated safe-word ("amber") for use during coaching sessions. If used, coach to immediately end session and contact DSL. Local authority reference: LA-2026-7843. Police have been notified under Operation Encompass protocols.',
    attachments: [
      { name: 'Risk Assessment — SG-2026-0042.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-06-09' },
      { name: 'Local Authority Referral Form — LA-2026-7843.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-06-10' },
      { name: 'Safety Plan v1.docx', type: 'Document', uploadedBy: 'Marcus Adewale', date: '2026-06-10' },
    ],
    auditTrail: [
      { id: 'at-001', timestamp: '2026-06-08 14:35', user: 'James Okonkwo', role: 'Coach', action: 'Concern Raised', detail: 'Disclosure received during monthly coaching session. Learner reported controlling behaviour from family member.', visibility: 'restricted' },
      { id: 'at-002', timestamp: '2026-06-08 14:50', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Case Opened', detail: 'Safeguarding case SG-2026-0042 opened. Risk level set to High. Immediate contact with learner initiated.', visibility: 'internal' },
      { id: 'at-003', timestamp: '2026-06-09 10:15', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Risk Assessment Completed', detail: 'Full safeguarding risk assessment conducted. Multiple risk factors identified. Local authority referral recommended.', visibility: 'internal' },
      { id: 'at-004', timestamp: '2026-06-10 13:20', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'External Referral Made', detail: 'Referral submitted to local authority safeguarding team. Reference: LA-2026-7843.', visibility: 'restricted' },
      { id: 'at-005', timestamp: '2026-06-10 16:45', user: 'Priya Kapoor', role: 'Safeguarding Officer', action: 'Wellbeing Support Initiated', detail: 'Weekly wellbeing check-ins scheduled with learner. Mental health support resources provided.', visibility: 'internal' },
    ],
    escalationHistory: [
      { date: '2026-06-08', from: 'Coach', to: 'DSL', reason: 'Learner disclosure of abuse/control — mandatory safeguarding escalation' },
    ],
    referralHistory: [
      { date: '2026-06-10', type: 'External — Local Authority', organisation: 'Kent Safeguarding Board', outcome: 'Awaiting response' },
    ],
    reviewDate: '2026-06-22',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer', 'senior-leadership'],
  },
  {
    id: 'sg-c002',
    caseRef: 'SG-2026-0041',
    learnerName: 'Daniel Okonkwo',
    learnerId: 'LRN-0195',
    programme: 'Digital Marketing L3',
    employer: 'Medway Council',
    tenant: 'KBC',
    concernType: 'Mental Health Concern',
    concernSummary: 'Learner has missed 3 consecutive sessions. Attendance team flagged pattern. Coach outreach call revealed learner is experiencing severe anxiety and depression. Learner expressed feelings of hopelessness and is struggling to leave home.',
    sourceOfConcern: 'Attendance Monitoring — Absence Pattern',
    dateReported: '2026-06-05',
    reportedBy: 'Engagement Team (Automated Flag)',
    reportedByRole: 'Engagement Manager',
    riskLevel: 'High Risk',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL contacted learner within 2 hours. Mental health first aid assessment conducted. GP appointment arranged. Temporary study pause agreed with employer. Weekly mental health check-ins scheduled.',
    safeguardingOfficerAssigned: 'Priya Kapoor',
    safeguardingOfficerId: 'dso-003',
    dslReviewRequired: true,
    dslReviewStatus: 'Reviewed',
    followUpActions: [
      { id: 'fu-005', action: 'Mental health risk assessment', owner: 'Priya Kapoor', deadline: '2026-06-07', status: 'Completed', completedDate: '2026-06-06' },
      { id: 'fu-006', action: 'Arrange GP appointment', owner: 'Priya Kapoor', deadline: '2026-06-08', status: 'Completed', completedDate: '2026-06-07' },
      { id: 'fu-007', action: 'Discuss reasonable adjustments with employer', owner: 'Marcus Adewale', deadline: '2026-06-14', status: 'In Progress' },
      { id: 'fu-008', action: 'Weekly mental health check-ins (4 weeks)', owner: 'Priya Kapoor', deadline: '2026-07-03', status: 'In Progress' },
    ],
    status: 'High Risk',
    referralStatus: 'Internal Complete',
    secureNotes: 'Learner has history of anxiety but no previous safeguarding concerns. GP has prescribed medication and referred to IAPT (Improving Access to Psychological Therapies). Employer (Medway Council) has been supportive — agreed to 4-week study pause with no detriment. Learner consented to information sharing with coach and employer HR.',
    attachments: [
      { name: 'Mental Health Assessment — SG-2026-0041.pdf', type: 'PDF', uploadedBy: 'Priya Kapoor', date: '2026-06-06' },
      { name: 'GP Referral Letter.pdf', type: 'PDF', uploadedBy: 'Priya Kapoor', date: '2026-06-07' },
      { name: 'Reasonable Adjustments Plan.docx', type: 'Document', uploadedBy: 'Marcus Adewale', date: '2026-06-10' },
    ],
    auditTrail: [
      { id: 'at-006', timestamp: '2026-06-05 09:00', user: 'System', role: 'Automation', action: 'Absence Alert Triggered', detail: '3 consecutive session absences detected for Daniel Okonkwo.', visibility: 'internal' },
      { id: 'at-007', timestamp: '2026-06-05 10:30', user: 'Engagement Team', role: 'Engagement Manager', action: 'Outreach Attempt', detail: 'Phone call to learner — learner disclosed mental health struggles.', visibility: 'restricted' },
      { id: 'at-008', timestamp: '2026-06-05 11:00', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Case Opened', detail: 'Safeguarding case opened. Mental health concern escalated. Priya Kapoor assigned as lead.', visibility: 'internal' },
      { id: 'at-009', timestamp: '2026-06-07 14:00', user: 'Priya Kapoor', role: 'Safeguarding Officer', action: 'GP Referral Completed', detail: 'Learner attended GP. Medication prescribed. IAPT referral made.', visibility: 'internal' },
    ],
    escalationHistory: [
      { date: '2026-06-05', from: 'Engagement Team', to: 'DSL', reason: 'Mental health disclosure with concerning indicators — potential self-harm risk' },
    ],
    referralHistory: [
      { date: '2026-06-07', type: 'Internal — Mental Health Support', organisation: 'KBC Wellbeing Service', outcome: 'Accepted — weekly sessions commenced' },
    ],
    reviewDate: '2026-06-19',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer', 'senior-leadership'],
  },
  {
    id: 'sg-c003',
    caseRef: 'SG-2026-0040',
    learnerName: 'Aisha Patel',
    learnerId: 'LRN-0201',
    programme: 'Accounting L3',
    employer: 'Deloitte UK',
    tenant: 'MAN',
    concernType: 'Harassment or Bullying',
    concernSummary: 'Learner reported ongoing bullying behaviour from a senior colleague at her workplace. Colleague is making derogatory comments about her apprenticeship status, excluding her from team meetings, and questioning her competence publicly. Learner reports this has been going on for approximately 6 weeks.',
    sourceOfConcern: 'Learner Self-Report (via Support Portal)',
    dateReported: '2026-06-03',
    reportedBy: 'Aisha Patel (Learner)',
    reportedByRole: 'Learner',
    riskLevel: 'Medium Risk',
    immediateActionRequired: false,
    immediateActionDetail: '',
    safeguardingOfficerAssigned: 'Marcus Adewale',
    safeguardingOfficerId: 'dso-002',
    dslReviewRequired: true,
    dslReviewStatus: 'Reviewed',
    followUpActions: [
      { id: 'fu-009', action: 'Meet with learner to document full account', owner: 'Marcus Adewale', deadline: '2026-06-06', status: 'Completed', completedDate: '2026-06-05' },
      { id: 'fu-010', action: 'Contact employer HR to raise formal concern', owner: 'Marcus Adewale', deadline: '2026-06-10', status: 'Completed', completedDate: '2026-06-09' },
      { id: 'fu-011', action: 'Arrange mediation between learner and workplace', owner: 'Marcus Adewale', deadline: '2026-06-17', status: 'Pending' },
      { id: 'fu-012', action: 'Review workplace wellbeing with learner (2-week follow-up)', owner: 'Priya Kapoor', deadline: '2026-06-24', status: 'Pending' },
    ],
    status: 'Medium Risk',
    referralStatus: 'Internal Pending',
    secureNotes: 'Employer HR (Deloitte) has acknowledged the concern and launched an internal investigation under their Dignity at Work policy. Learner has been offered temporary alternative line management while investigation proceeds. No immediate physical safety risk identified. Learner is anxious but coping.',
    attachments: [
      { name: 'Learner Statement — SG-2026-0040.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-06-05' },
      { name: 'Employer HR Correspondence.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-06-09' },
    ],
    auditTrail: [
      { id: 'at-010', timestamp: '2026-06-03 15:20', user: 'Aisha Patel', role: 'Learner', action: 'Concern Reported', detail: 'Self-reported workplace bullying via Support Portal.', visibility: 'restricted' },
      { id: 'at-011', timestamp: '2026-06-04 09:00', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Case Opened', detail: 'Case triaged as Medium Risk — workplace bullying. Marcus Adewale assigned.', visibility: 'internal' },
      { id: 'at-012', timestamp: '2026-06-09 11:30', user: 'Marcus Adewale', role: 'Deputy DSL', action: 'Employer Notified', detail: 'Formal concern raised with Deloitte HR. Investigation launched.', visibility: 'internal' },
    ],
    escalationHistory: [
      { date: '2026-06-04', from: 'Support Triage', to: 'Safeguarding', reason: 'Workplace bullying with potential mental health impact' },
    ],
    referralHistory: [
      { date: '2026-06-09', type: 'Internal — Employer HR', organisation: 'Deloitte UK HR', outcome: 'Investigation in progress' },
    ],
    reviewDate: '2026-06-24',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer'],
  },
  {
    id: 'sg-c004',
    caseRef: 'SG-2026-0039',
    learnerName: 'Thomas Wright',
    learnerId: 'LRN-0178',
    programme: 'Software Development L4',
    employer: 'BAE Systems',
    tenant: 'LSA',
    concernType: 'Prevent Concern',
    concernSummary: 'Tutor reported learner has been accessing extremist content during independent study periods on college-managed devices. IT monitoring flagged concerning search patterns. Learner has also expressed radical views in group discussions that have made other learners uncomfortable.',
    sourceOfConcern: 'IT Monitoring Alert + Tutor Report',
    dateReported: '2026-06-01',
    reportedBy: 'David Chen (Tutor) + IT Admin',
    reportedByRole: 'Tutor',
    riskLevel: 'Immediate Action Required',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL immediately notified Prevent lead. Channel referral submitted to local Prevent team. IT access restricted pending investigation. Learner interviewed by DSL and Prevent lead. Parents informed (learner is 17).',
    safeguardingOfficerAssigned: 'Sarah Okonkwo',
    safeguardingOfficerId: 'dso-004',
    dslReviewRequired: true,
    dslReviewStatus: 'Escalated',
    followUpActions: [
      { id: 'fu-013', action: 'Submit Channel referral to Prevent team', owner: 'Sarah Okonkwo', deadline: '2026-06-02', status: 'Completed', completedDate: '2026-06-02' },
      { id: 'fu-014', action: 'Interview learner with DSL', owner: 'Dr. Eleanor Vance', deadline: '2026-06-03', status: 'Completed', completedDate: '2026-06-03' },
      { id: 'fu-015', action: 'Inform parents/guardians', owner: 'Dr. Eleanor Vance', deadline: '2026-06-03', status: 'Completed', completedDate: '2026-06-03' },
      { id: 'fu-016', action: 'Channel panel attendance', owner: 'Sarah Okonkwo', deadline: '2026-06-14', status: 'Pending' },
      { id: 'fu-017', action: 'Review IT access and monitoring plan', owner: 'Sarah Okonkwo', deadline: '2026-06-18', status: 'Pending' },
    ],
    status: 'Immediate Action Required',
    referralStatus: 'Multi-agency',
    secureNotes: 'Channel referral reference: CH-2026-0158. Prevent coordinator has accepted referral. Learner is under 18 — parents informed as per statutory guidance. IT access restricted to supervised sessions only. No evidence of direct contact with extremist groups identified yet. Monitoring ongoing.',
    attachments: [
      { name: 'Channel Referral Form — CH-2026-0158.pdf', type: 'PDF', uploadedBy: 'Sarah Okonkwo', date: '2026-06-02' },
      { name: 'IT Monitoring Report.pdf', type: 'PDF', uploadedBy: 'IT Admin', date: '2026-06-01' },
      { name: 'Learner Interview Notes — Restricted.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-06-03' },
    ],
    auditTrail: [
      { id: 'at-013', timestamp: '2026-06-01 10:15', user: 'IT Admin', role: 'IT Support', action: 'Alert Generated', detail: 'Concerning search patterns detected on learner device. Automated flag triggered.', visibility: 'restricted' },
      { id: 'at-014', timestamp: '2026-06-01 10:45', user: 'David Chen', role: 'Tutor', action: 'Concern Raised', detail: 'Tutor corroborated IT alert with observations of learner behaviour in group discussions.', visibility: 'restricted' },
      { id: 'at-015', timestamp: '2026-06-01 11:30', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Prevent Protocol Activated', detail: 'Case escalated to Prevent lead. Channel referral process initiated.', visibility: 'internal' },
      { id: 'at-016', timestamp: '2026-06-02 09:00', user: 'Sarah Okonkwo', role: 'Safeguarding Officer', action: 'Channel Referral Submitted', detail: 'Full Channel referral submitted. Reference: CH-2026-0158.', visibility: 'restricted' },
    ],
    escalationHistory: [
      { date: '2026-06-01', from: 'Tutor', to: 'DSL', reason: 'Prevent concern — extremist content access and radical views expressed' },
      { date: '2026-06-01', from: 'DSL', to: 'Prevent Lead', reason: 'Channel referral required — statutory duty' },
    ],
    referralHistory: [
      { date: '2026-06-02', type: 'External — Prevent', organisation: 'Local Prevent Team / Channel Panel', outcome: 'Accepted — panel scheduled' },
    ],
    reviewDate: '2026-06-15',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer', 'prevent-lead', 'senior-leadership'],
  },
  {
    id: 'sg-c005',
    caseRef: 'SG-2026-0038',
    learnerName: 'Emily Watson',
    learnerId: 'LRN-0156',
    programme: 'Business Administration L3',
    employer: 'NHS Trust — Kent',
    tenant: 'KBC',
    concernType: 'Wellbeing Concern',
    concernSummary: 'Learner is a young carer for her mother who has a chronic illness. She is struggling to balance apprenticeship requirements with caring responsibilities. Recently missed 2 coursework deadlines and appears exhausted in sessions. Coach noted decline in quality of submitted work.',
    sourceOfConcern: 'Coach Wellbeing Check',
    dateReported: '2026-05-28',
    reportedBy: 'Sarah Thompson (Coach)',
    reportedByRole: 'Coach',
    riskLevel: 'Low Risk',
    immediateActionRequired: false,
    immediateActionDetail: '',
    safeguardingOfficerAssigned: 'Priya Kapoor',
    safeguardingOfficerId: 'dso-003',
    dslReviewRequired: false,
    dslReviewStatus: 'Pending',
    followUpActions: [
      { id: 'fu-018', action: 'Arrange learner welfare meeting', owner: 'Priya Kapoor', deadline: '2026-05-30', status: 'Completed', completedDate: '2026-05-30' },
      { id: 'fu-019', action: 'Develop flexible study plan', owner: 'Coach (Sarah Thompson)', deadline: '2026-06-05', status: 'Completed', completedDate: '2026-06-04' },
      { id: 'fu-020', action: 'Signpost to young carers support services', owner: 'Priya Kapoor', deadline: '2026-06-05', status: 'Completed', completedDate: '2026-06-03' },
      { id: 'fu-021', action: 'Monthly wellbeing review (3 months)', owner: 'Priya Kapoor', deadline: '2026-08-28', status: 'In Progress' },
    ],
    status: 'Monitoring',
    referralStatus: 'Internal Complete',
    secureNotes: 'Learner has been connected with Kent Young Carers service. NHS Trust employer has agreed to flexible working arrangement — reduced hours on caring-heavy days. No safeguarding concerns — case is wellbeing/support only. Learner is engaged and appreciative of support.',
    attachments: [
      { name: 'Wellbeing Assessment — SG-2026-0038.pdf', type: 'PDF', uploadedBy: 'Priya Kapoor', date: '2026-05-30' },
      { name: 'Flexible Study Plan.pdf', type: 'PDF', uploadedBy: 'Sarah Thompson', date: '2026-06-04' },
    ],
    auditTrail: [
      { id: 'at-017', timestamp: '2026-05-28 15:10', user: 'Sarah Thompson', role: 'Coach', action: 'Concern Raised', detail: 'Wellbeing concern identified during routine coaching check-in. Learner disclosed caring responsibilities.', visibility: 'internal' },
      { id: 'at-018', timestamp: '2026-05-29 09:30', user: 'Marcus Adewale', role: 'Deputy DSL', action: 'Case Opened', detail: 'Triaged as Low Risk — wellbeing/support case. Priya Kapoor assigned.', visibility: 'internal' },
    ],
    escalationHistory: [],
    referralHistory: [
      { date: '2026-06-03', type: 'Internal — Carers Support', organisation: 'Kent Young Carers', outcome: 'Accepted — ongoing support' },
    ],
    reviewDate: '2026-07-28',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer', 'coach'],
  },
  {
    id: 'sg-c006',
    caseRef: 'SG-2026-0037',
    learnerName: 'James Okonkwo Jr.',
    learnerId: 'LRN-0210',
    programme: 'Digital Marketing L3',
    employer: 'Sky UK',
    tenant: 'KBC',
    concernType: 'Discrimination Concern',
    concernSummary: 'Learner reported experiencing racial micro-aggressions from a workplace mentor. Mentor has made repeated comments about learner\'s accent, questioned their qualifications, and excluded them from client-facing opportunities despite meeting all performance targets.',
    sourceOfConcern: 'Learner Self-Report (via Coach)',
    dateReported: '2026-05-25',
    reportedBy: 'James Okonkwo Jr. (Learner) via Coach referral',
    reportedByRole: 'Learner',
    riskLevel: 'Medium Risk',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL contacted learner directly. Employer HR notified immediately under Equality Act obligations. Alternative mentor assigned within 48 hours. Formal grievance process initiated.',
    safeguardingOfficerAssigned: 'Marcus Adewale',
    safeguardingOfficerId: 'dso-002',
    dslReviewRequired: true,
    dslReviewStatus: 'Reviewed',
    followUpActions: [
      { id: 'fu-022', action: 'Take full statement from learner', owner: 'Marcus Adewale', deadline: '2026-05-27', status: 'Completed', completedDate: '2026-05-27' },
      { id: 'fu-023', action: 'Notify employer HR and initiate grievance', owner: 'Marcus Adewale', deadline: '2026-05-28', status: 'Completed', completedDate: '2026-05-28' },
      { id: 'fu-024', action: 'Assign alternative workplace mentor', owner: 'Employer HR', deadline: '2026-06-01', status: 'Completed', completedDate: '2026-05-30' },
      { id: 'fu-025', action: 'Monitor learner wellbeing (weekly for 4 weeks)', owner: 'Priya Kapoor', deadline: '2026-06-26', status: 'In Progress' },
    ],
    status: 'Medium Risk',
    referralStatus: 'Internal Complete',
    secureNotes: 'Sky UK HR has confirmed formal grievance investigation underway. Alleged perpetrator has been suspended pending investigation outcome — standard corporate protocol. Learner reports improved wellbeing since mentor change. Equality Act 2010 compliance being monitored.',
    attachments: [
      { name: 'Learner Formal Statement — SG-2026-0037.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-05-27' },
      { name: 'Employer Grievance Acknowledgement.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-05-28' },
    ],
    auditTrail: [
      { id: 'at-019', timestamp: '2026-05-25 14:00', user: 'Coach', role: 'Coach', action: 'Concern Received', detail: 'Learner reported racial discrimination from workplace mentor during coaching session.', visibility: 'restricted' },
      { id: 'at-020', timestamp: '2026-05-25 16:00', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Case Opened', detail: 'Discrimination case opened at Medium Risk. Immediate employer notification required under Equality Act.', visibility: 'internal' },
      { id: 'at-021', timestamp: '2026-05-30', user: 'Employer HR', role: 'Sky UK HR', action: 'Mentor Replaced', detail: 'Alternative mentor assigned. Investigation of original mentor commenced.', visibility: 'internal' },
    ],
    escalationHistory: [
      { date: '2026-05-25', from: 'Coach', to: 'DSL', reason: 'Racial discrimination disclosure — potential Equality Act breach' },
    ],
    referralHistory: [
      { date: '2026-05-28', type: 'Internal — Employer HR', organisation: 'Sky UK HR', outcome: 'Grievance investigation in progress' },
    ],
    reviewDate: '2026-06-26',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer'],
  },
  {
    id: 'sg-c007',
    caseRef: 'SG-2026-0036',
    learnerName: 'Oliver Grant',
    learnerId: 'LRN-0190',
    programme: 'Engineering Technician L3',
    employer: 'Network Rail',
    tenant: 'MAN',
    concernType: 'Employer/Workplace Concern',
    concernSummary: 'Learner reported unsafe working conditions — being asked to operate machinery without proper PPE or training. Learner feels pressured by supervisor to skip safety protocols to meet productivity targets. Has witnessed two near-miss incidents in the last month.',
    sourceOfConcern: 'Learner Self-Report',
    dateReported: '2026-05-20',
    reportedBy: 'Oliver Grant (Learner)',
    reportedByRole: 'Learner',
    riskLevel: 'Medium Risk',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL contacted learner immediately. Employer Health & Safety team notified. Learner removed from unsafe duties pending H&S investigation. HSE referral considered.',
    safeguardingOfficerAssigned: 'Sarah Okonkwo',
    safeguardingOfficerId: 'dso-004',
    dslReviewRequired: true,
    dslReviewStatus: 'Reviewed',
    followUpActions: [
      { id: 'fu-026', action: 'Take detailed account of unsafe practices', owner: 'Sarah Okonkwo', deadline: '2026-05-22', status: 'Completed', completedDate: '2026-05-22' },
      { id: 'fu-027', action: 'Notify employer H&S and request investigation', owner: 'Sarah Okonkwo', deadline: '2026-05-23', status: 'Completed', completedDate: '2026-05-23' },
      { id: 'fu-028', action: 'Confirm alternative safe duties for learner', owner: 'Employer HR', deadline: '2026-05-27', status: 'Completed', completedDate: '2026-05-26' },
      { id: 'fu-029', action: 'Review H&S investigation outcome', owner: 'Sarah Okonkwo', deadline: '2026-06-13', status: 'Pending' },
      { id: 'fu-030', action: 'HSE referral decision', owner: 'Dr. Eleanor Vance', deadline: '2026-06-20', status: 'Pending' },
    ],
    status: 'Medium Risk',
    referralStatus: 'External Pending',
    secureNotes: 'Network Rail H&S team has confirmed investigation is underway. Supervisor alleged to have pressured learners has been reassigned pending outcome. Two near-miss incidents confirmed by other apprentices. HSE referral being considered — legal advice being sought. Learner is safe and on alternative duties.',
    attachments: [
      { name: 'Learner Safety Account — SG-2026-0036.pdf', type: 'PDF', uploadedBy: 'Sarah Okonkwo', date: '2026-05-22' },
      { name: 'Near-Miss Incident Reports (2).pdf', type: 'PDF', uploadedBy: 'Employer H&S', date: '2026-05-24' },
      { name: 'H&S Investigation Terms of Reference.pdf', type: 'PDF', uploadedBy: 'Sarah Okonkwo', date: '2026-05-25' },
    ],
    auditTrail: [
      { id: 'at-022', timestamp: '2026-05-20 11:30', user: 'Oliver Grant', role: 'Learner', action: 'Concern Reported', detail: 'Self-reported unsafe working conditions and pressure to bypass safety protocols.', visibility: 'restricted' },
      { id: 'at-023', timestamp: '2026-05-20 13:00', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Case Opened', detail: 'Workplace safety case opened. Immediate action to protect learner initiated.', visibility: 'internal' },
    ],
    escalationHistory: [
      { date: '2026-05-20', from: 'Learner', to: 'DSL', reason: 'Unsafe working conditions — duty of care obligation' },
    ],
    referralHistory: [
      { date: '2026-05-23', type: 'Internal — Employer H&S', organisation: 'Network Rail Safety Team', outcome: 'Investigation in progress' },
    ],
    reviewDate: '2026-06-20',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer', 'senior-leadership'],
  },
  {
    id: 'sg-c008',
    caseRef: 'SG-2026-0035',
    learnerName: 'Fatima Hassan',
    learnerId: 'LRN-0205',
    programme: 'Healthcare Support L3',
    employer: 'Barts Health NHS Trust',
    tenant: 'LSA',
    concernType: 'Domestic Abuse Concern',
    concernSummary: 'Learner attended session with visible bruising on forearms. When gently asked by tutor, learner became visibly distressed and disclosed partner has been physically abusive over the past 2 months. Learner has two young children at home. Feels trapped and unable to leave.',
    sourceOfConcern: 'Tutor Observation + Disclosure',
    dateReported: '2026-05-18',
    reportedBy: 'Rebecca Mills (Tutor)',
    reportedByRole: 'Tutor',
    riskLevel: 'Immediate Action Required',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL met learner same day in private. MARAC referral submitted. Domestic abuse support service contacted. Safe accommodation options discussed. Police informed with learner consent. Children\'s social care notified due to children at risk.',
    safeguardingOfficerAssigned: 'Dr. Eleanor Vance',
    safeguardingOfficerId: 'dso-001',
    dslReviewRequired: true,
    dslReviewStatus: 'Escalated',
    followUpActions: [
      { id: 'fu-031', action: 'Conduct DASH risk assessment', owner: 'Dr. Eleanor Vance', deadline: '2026-05-18', status: 'Completed', completedDate: '2026-05-18' },
      { id: 'fu-032', action: 'Submit MARAC referral', owner: 'Dr. Eleanor Vance', deadline: '2026-05-19', status: 'Completed', completedDate: '2026-05-19' },
      { id: 'fu-033', action: 'Arrange safe accommodation options', owner: 'Domestic Abuse Service', deadline: '2026-05-21', status: 'Completed', completedDate: '2026-05-20' },
      { id: 'fu-034', action: 'Children social care referral', owner: 'Dr. Eleanor Vance', deadline: '2026-05-19', status: 'Completed', completedDate: '2026-05-19' },
      { id: 'fu-035', action: 'Ongoing safety planning — weekly review', owner: 'Dr. Eleanor Vance', deadline: '2026-06-18', status: 'In Progress' },
    ],
    status: 'Immediate Action Required',
    referralStatus: 'Multi-agency',
    secureNotes: 'This is a MARAC (Multi-Agency Risk Assessment Conference) level case. DASH score: 18 (high risk). Learner and children now in temporary safe accommodation. Police investigation ongoing — suspect identified but not yet located. Non-molestation order application in progress. Employer (Barts Health) providing full support — paid leave granted. Case is highly sensitive — all information strictly restricted.',
    attachments: [
      { name: 'DASH Risk Assessment — CONFIDENTIAL.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-05-18' },
      { name: 'MARAC Referral — CONFIDENTIAL.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-05-19' },
      { name: 'Police Incident Report.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-05-20' },
      { name: 'Safety Plan v3 — CONFIDENTIAL.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-05-21' },
    ],
    auditTrail: [
      { id: 'at-024', timestamp: '2026-05-18 09:45', user: 'Rebecca Mills', role: 'Tutor', action: 'Concern Raised', detail: 'Observed visible injuries on learner. Learner disclosed domestic abuse during private conversation.', visibility: 'restricted' },
      { id: 'at-025', timestamp: '2026-05-18 10:30', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Emergency Response', detail: 'DSL met learner. DASH assessment completed. Immediate safety actions initiated.', visibility: 'internal' },
      { id: 'at-026', timestamp: '2026-05-19', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'Multi-agency Referrals', detail: 'MARAC, police, and children social care referrals submitted.', visibility: 'restricted' },
    ],
    escalationHistory: [
      { date: '2026-05-18', from: 'Tutor', to: 'DSL', reason: 'Visible injuries + domestic abuse disclosure — immediate safeguarding' },
    ],
    referralHistory: [
      { date: '2026-05-19', type: 'External — MARAC', organisation: 'Local MARAC Panel', outcome: 'Accepted — next panel 12 Jun 2026' },
      { date: '2026-05-19', type: 'External — Police', organisation: 'Metropolitan Police', outcome: 'Investigation active' },
      { date: '2026-05-19', type: 'External — Social Care', organisation: 'Children\'s Services', outcome: 'Assessment in progress' },
    ],
    reviewDate: '2026-06-12',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer'],
  },
  {
    id: 'sg-c009',
    caseRef: 'SG-2026-0034',
    learnerName: 'Liam Hughes',
    learnerId: 'LRN-0188',
    programme: 'Construction Management L4',
    employer: 'Balfour Beatty',
    tenant: 'BHX',
    concernType: 'Attendance-related Welfare Concern',
    concernSummary: 'Learner attendance dropped to 42% over last 6 weeks. No response to multiple contact attempts (phone, email, WhatsApp). Employer reports learner has not been on site for 3 weeks. Home address visit planned. Concerns about potential homelessness or severe personal crisis.',
    sourceOfConcern: 'Attendance System + Employer Report',
    dateReported: '2026-05-15',
    reportedBy: 'Attendance Monitoring System + Employer HR',
    reportedByRole: 'Employer',
    riskLevel: 'High Risk',
    immediateActionRequired: true,
    immediateActionDetail: 'Welfare check visit conducted at last known address. Learner located — experiencing housing crisis after eviction. Temporary accommodation arranged via local authority. Emergency hardship fund accessed.',
    safeguardingOfficerAssigned: 'Marcus Adewale',
    safeguardingOfficerId: 'dso-002',
    dslReviewRequired: true,
    dslReviewStatus: 'Reviewed',
    followUpActions: [
      { id: 'fu-036', action: 'Conduct welfare home visit', owner: 'Marcus Adewale', deadline: '2026-05-17', status: 'Completed', completedDate: '2026-05-17' },
      { id: 'fu-037', action: 'Arrange emergency accommodation', owner: 'Marcus Adewale', deadline: '2026-05-18', status: 'Completed', completedDate: '2026-05-18' },
      { id: 'fu-038', action: 'Access learner hardship fund', owner: 'Marcus Adewale', deadline: '2026-05-20', status: 'Completed', completedDate: '2026-05-19' },
      { id: 'fu-039', action: 'Develop return-to-learning plan', owner: 'Coach', deadline: '2026-06-01', status: 'Completed', completedDate: '2026-05-30' },
      { id: 'fu-040', action: 'Weekly welfare check-ins (6 weeks)', owner: 'Marcus Adewale', deadline: '2026-06-26', status: 'In Progress' },
    ],
    status: 'High Risk',
    referralStatus: 'Internal Complete',
    secureNotes: 'Learner was sofa-surfing for 3 weeks before being located. No mobile phone — device was lost during eviction. Replacement device provided via learner support fund. Local authority housing application submitted — priority band B. Employer Balfour Beatty has been supportive and is holding placement open. Learner is now in temporary B&B accommodation.',
    attachments: [
      { name: 'Welfare Visit Report — SG-2026-0034.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-05-17' },
      { name: 'Hardship Fund Application.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-05-19' },
    ],
    auditTrail: [
      { id: 'at-027', timestamp: '2026-05-15 08:00', user: 'System', role: 'Automation', action: 'Critical Absence Alert', detail: 'Attendance dropped below 50%. Automated safeguarding trigger activated.', visibility: 'internal' },
      { id: 'at-028', timestamp: '2026-05-16', user: 'Marcus Adewale', role: 'Deputy DSL', action: 'Case Opened', detail: 'Welfare concern escalated. Multiple contact attempts failed. Home visit authorised.', visibility: 'internal' },
      { id: 'at-029', timestamp: '2026-05-17', user: 'Marcus Adewale', role: 'Deputy DSL', action: 'Learner Located', detail: 'Welfare visit successful. Learner in housing crisis. Emergency support activated.', visibility: 'restricted' },
    ],
    escalationHistory: [
      { date: '2026-05-15', from: 'Attendance System', to: 'Safeguarding', reason: 'Critical attendance drop + no contact — welfare concern' },
    ],
    referralHistory: [
      { date: '2026-05-18', type: 'Internal — Hardship Fund', organisation: 'KBC Learner Support Fund', outcome: 'Approved — £500 emergency grant' },
      { date: '2026-05-18', type: 'External — Housing', organisation: 'Birmingham City Council', outcome: 'Priority band B — awaiting allocation' },
    ],
    reviewDate: '2026-06-26',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer', 'coach'],
  },
  {
    id: 'sg-c010',
    caseRef: 'SG-2026-0033',
    learnerName: 'Chloe Adams',
    learnerId: 'LRN-0212',
    programme: 'Early Years Educator L3',
    employer: 'Bright Horizons Nursery',
    tenant: 'KBC',
    concernType: 'Disclosure from Learner',
    concernSummary: 'During a routine progress review, learner disclosed that a colleague at the nursery has been inappropriately handling children during care routines. Learner witnessed rough handling of a toddler during nappy change and shouted at a child who was crying. Learner is distressed and unsure whether to formally report.',
    sourceOfConcern: 'Progress Review — Learner Disclosure',
    dateReported: '2026-05-12',
    reportedBy: 'Sarah Thompson (Coach)',
    reportedByRole: 'Coach',
    riskLevel: 'Immediate Action Required',
    immediateActionRequired: true,
    immediateActionDetail: 'DSL immediately notified. LADO (Local Authority Designated Officer) referral submitted same day — allegation concerns potential harm to children. Employer safeguarding lead notified. Learner supported through whistleblowing process.',
    safeguardingOfficerAssigned: 'Dr. Eleanor Vance',
    safeguardingOfficerId: 'dso-001',
    dslReviewRequired: true,
    dslReviewStatus: 'Escalated',
    followUpActions: [
      { id: 'fu-041', action: 'Submit LADO referral', owner: 'Dr. Eleanor Vance', deadline: '2026-05-12', status: 'Completed', completedDate: '2026-05-12' },
      { id: 'fu-042', action: 'Notify employer safeguarding lead', owner: 'Dr. Eleanor Vance', deadline: '2026-05-12', status: 'Completed', completedDate: '2026-05-12' },
      { id: 'fu-043', action: 'Support learner with statement for investigation', owner: 'Marcus Adewale', deadline: '2026-05-15', status: 'Completed', completedDate: '2026-05-14' },
      { id: 'fu-044', action: 'Await LADO investigation outcome', owner: 'Dr. Eleanor Vance', deadline: '2026-06-12', status: 'Pending' },
    ],
    status: 'Immediate Action Required',
    referralStatus: 'Multi-agency',
    secureNotes: 'LADO referral reference: LADO-2026-0291. Alleged perpetrator is a nursery practitioner with direct unsupervised access to children. Employer has suspended individual pending investigation. Ofsted notified by nursery management. Learner is protected under whistleblowing policy — no detriment to apprenticeship. Case is highly sensitive — involves potential harm to children.',
    attachments: [
      { name: 'LADO Referral Form — CONFIDENTIAL.pdf', type: 'PDF', uploadedBy: 'Dr. Eleanor Vance', date: '2026-05-12' },
      { name: 'Learner Witness Statement.pdf', type: 'PDF', uploadedBy: 'Marcus Adewale', date: '2026-05-14' },
      { name: 'Employer Suspension Confirmation.pdf', type: 'PDF', uploadedBy: 'Employer Safeguarding Lead', date: '2026-05-13' },
    ],
    auditTrail: [
      { id: 'at-030', timestamp: '2026-05-12 11:00', user: 'Sarah Thompson', role: 'Coach', action: 'Disclosure Received', detail: 'Learner disclosed witnessing inappropriate child handling at nursery placement.', visibility: 'restricted' },
      { id: 'at-031', timestamp: '2026-05-12 11:45', user: 'Dr. Eleanor Vance', role: 'DSL', action: 'LADO Referral', detail: 'Immediate LADO referral submitted — allegation concerns harm to children. Reference: LADO-2026-0291.', visibility: 'restricted' },
    ],
    escalationHistory: [
      { date: '2026-05-12', from: 'Coach', to: 'DSL', reason: 'Disclosure involving potential harm to children — LADO referral statutory requirement' },
    ],
    referralHistory: [
      { date: '2026-05-12', type: 'External — LADO', organisation: 'Local Authority Designated Officer', outcome: 'Investigation active' },
      { date: '2026-05-13', type: 'External — Ofsted', organisation: 'Ofsted', outcome: 'Notified by nursery' },
    ],
    reviewDate: '2026-06-12',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer'],
  },
  {
    id: 'sg-c011',
    caseRef: 'SG-2026-0032',
    learnerName: 'Ryan Mitchell',
    learnerId: 'LRN-0172',
    programme: 'Business Administration L3',
    employer: 'HSBC UK',
    tenant: 'KBC',
    concernType: 'Wellbeing Concern',
    concernSummary: 'Case closed. Learner was experiencing exam-related stress affecting sleep and concentration. Study skills support and wellbeing coaching provided. Learner completed programme successfully. No ongoing concerns.',
    sourceOfConcern: 'Learner Self-Report',
    dateReported: '2026-04-10',
    reportedBy: 'Ryan Mitchell (Learner)',
    reportedByRole: 'Learner',
    riskLevel: 'Low Risk',
    immediateActionRequired: false,
    immediateActionDetail: '',
    safeguardingOfficerAssigned: 'Priya Kapoor',
    safeguardingOfficerId: 'dso-003',
    dslReviewRequired: false,
    dslReviewStatus: 'Pending',
    followUpActions: [
      { id: 'fu-045', action: 'Study skills support sessions (4 weeks)', owner: 'Study Skills Tutor', deadline: '2026-05-08', status: 'Completed', completedDate: '2026-05-05' },
      { id: 'fu-046', action: 'Wellbeing coaching (3 sessions)', owner: 'Priya Kapoor', deadline: '2026-05-01', status: 'Completed', completedDate: '2026-04-28' },
    ],
    status: 'Closed',
    referralStatus: 'Internal Complete',
    secureNotes: 'Case closed 15 May 2026. Learner completed programme. Wellbeing restored. No further action required. Standard 6-month file retention before archiving.',
    attachments: [
      { name: 'Case Closure Report — SG-2026-0032.pdf', type: 'PDF', uploadedBy: 'Priya Kapoor', date: '2026-05-15' },
    ],
    auditTrail: [
      { id: 'at-032', timestamp: '2026-04-10', user: 'Priya Kapoor', role: 'Safeguarding Officer', action: 'Case Opened', detail: 'Low-risk wellbeing case — exam stress.', visibility: 'internal' },
      { id: 'at-033', timestamp: '2026-05-15', user: 'Priya Kapoor', role: 'Safeguarding Officer', action: 'Case Closed', detail: 'All support completed. Learner wellbeing restored. Case closed.', visibility: 'internal' },
    ],
    escalationHistory: [],
    referralHistory: [],
    caseClosureReason: 'Wellbeing restored — no ongoing concerns. Learner completed programme successfully.',
    reviewDate: '2026-05-15',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer'],
  },
  {
    id: 'sg-c012',
    caseRef: 'SG-2026-0031',
    learnerName: 'Zara Khan',
    learnerId: 'LRN-0198',
    programme: 'Data Analyst L4',
    employer: 'Lloyds Banking Group',
    tenant: 'MAN',
    concernType: 'Concern Raised by Employer',
    concernSummary: 'Case closed — archived. Employer raised concern about learner repeatedly falling asleep during workplace training sessions. Investigation revealed undiagnosed sleep apnoea. Learner received medical treatment and reasonable adjustments put in place. Case monitored for 3 months and closed.',
    sourceOfConcern: 'Employer Report',
    dateReported: '2026-03-05',
    reportedBy: 'Line Manager — Lloyds Banking Group',
    reportedByRole: 'Employer',
    riskLevel: 'Low Risk',
    immediateActionRequired: false,
    immediateActionDetail: '',
    safeguardingOfficerAssigned: 'Priya Kapoor',
    safeguardingOfficerId: 'dso-003',
    dslReviewRequired: false,
    dslReviewStatus: 'Pending',
    followUpActions: [
      { id: 'fu-047', action: 'Refer learner to occupational health', owner: 'Employer HR', deadline: '2026-03-10', status: 'Completed', completedDate: '2026-03-08' },
      { id: 'fu-048', action: 'Implement reasonable adjustments', owner: 'Coach', deadline: '2026-03-20', status: 'Completed', completedDate: '2026-03-18' },
      { id: 'fu-049', action: '3-month monitoring period', owner: 'Priya Kapoor', deadline: '2026-06-10', status: 'Completed', completedDate: '2026-06-05' },
    ],
    status: 'Archived',
    referralStatus: 'Internal Complete',
    secureNotes: 'Case archived 10 June 2026. Learner diagnosed with sleep apnoea — now receiving CPAP treatment. Significant improvement in alertness and performance. Employer fully supportive. Case demonstrates positive outcome from early employer concern reporting.',
    attachments: [
      { name: 'Case Closure and Archive Report — SG-2026-0031.pdf', type: 'PDF', uploadedBy: 'Priya Kapoor', date: '2026-06-10' },
    ],
    auditTrail: [
      { id: 'at-034', timestamp: '2026-03-05', user: 'Employer', role: 'Line Manager', action: 'Concern Raised', detail: 'Employer reported learner fatigue during training sessions.', visibility: 'internal' },
      { id: 'at-035', timestamp: '2026-06-10', user: 'Priya Kapoor', role: 'Safeguarding Officer', action: 'Case Archived', detail: 'Case closed and archived. Positive outcome. No further action.', visibility: 'internal' },
    ],
    escalationHistory: [],
    referralHistory: [
      { date: '2026-03-08', type: 'Internal — Occupational Health', organisation: 'Lloyds OH Service', outcome: 'Diagnosis: sleep apnoea. CPAP treatment commenced.' },
    ],
    caseClosureReason: 'Medical condition identified and treated. Learner performance restored. Monitoring period completed successfully.',
    reviewDate: '2026-06-10',
    restrictedVisibility: ['dsl', 'deputy-dsl', 'safeguarding-officer'],
  },
];

// Dashboard-level aggregates
export const DASHBOARD_STATS = {
  newConcernsAwaitingReview: 3,
  openSafeguardingCases: 9,
  highRiskCases: 3,
  immediateActionRequired: 3,
  overdueFollowUpActions: 4,
  internalEscalations: 7,
  externalReferrals: 5,
  preventConcerns: 1,
  vulnerableLearnersMonitoring: 4,
  casesRequiringDSLReview: 3,
  closedCasesAwaitingAudit: 2,
  totalActiveCases: 10,
  totalClosedThisMonth: 3,
  avgDaysToResolve: 18,
};

// Vulnerable learners for monitoring
export const VULNERABLE_LEARNERS = [
  { name: 'Fatima Hassan', programme: 'Healthcare Support L3', risk: 'Immediate Action Required', concern: 'Domestic Abuse — MARAC', officer: 'Dr. Eleanor Vance' },
  { name: 'Mia Robinson', programme: 'Business Admin L3', risk: 'High Risk', concern: 'Controlling behaviour — family', officer: 'Dr. Eleanor Vance' },
  { name: 'Daniel Okonkwo', programme: 'Digital Marketing L3', risk: 'High Risk', concern: 'Severe anxiety & depression', officer: 'Priya Kapoor' },
  { name: 'Thomas Wright', programme: 'Software Development L4', risk: 'Immediate Action Required', concern: 'Prevent referral — Channel', officer: 'Sarah Okonkwo' },
  { name: 'Liam Hughes', programme: 'Construction Mgmt L4', risk: 'High Risk', concern: 'Housing crisis — homeless', officer: 'Marcus Adewale' },
  { name: 'Emily Watson', programme: 'Business Admin L3', risk: 'Low Risk', concern: 'Young carer — monitoring', officer: 'Priya Kapoor' },
];

// Internal escalations
export const INTERNAL_ESCALATIONS = [
  { id: 'esc-001', from: 'Support Team', to: 'Safeguarding', caseRef: 'SG-2026-0040', learner: 'Aisha Patel', date: '2026-06-04', reason: 'Workplace bullying disclosed in support ticket', status: 'Accepted' },
  { id: 'esc-002', from: 'Coach', to: 'DSL', caseRef: 'SG-2026-0042', learner: 'Mia Robinson', date: '2026-06-08', reason: 'Learner disclosure of family control/abuse', status: 'Accepted' },
  { id: 'esc-003', from: 'Engagement Team', to: 'Safeguarding', caseRef: 'SG-2026-0041', learner: 'Daniel Okonkwo', date: '2026-06-05', reason: 'Mental health crisis identified', status: 'Accepted' },
  { id: 'esc-004', from: 'Tutor', to: 'Prevent Lead', caseRef: 'SG-2026-0039', learner: 'Thomas Wright', date: '2026-06-01', reason: 'Extremist content access — Prevent duty', status: 'Accepted' },
  { id: 'esc-005', from: 'Attendance System', to: 'Safeguarding', caseRef: 'SG-2026-0034', learner: 'Liam Hughes', date: '2026-05-15', reason: 'Critical absence — welfare concern', status: 'Resolved' },
  { id: 'esc-006', from: 'Employer HR', to: 'Safeguarding', caseRef: 'SG-2026-0031', learner: 'Zara Khan', date: '2026-03-05', reason: 'Learner fatigue — medical concern', status: 'Resolved' },
  { id: 'esc-007', from: 'Tutor', to: 'DSL', caseRef: 'SG-2026-0035', learner: 'Fatima Hassan', date: '2026-05-18', reason: 'Visible injuries — domestic abuse', status: 'Accepted' },
];

// External referrals
export const EXTERNAL_REFERRALS = [
  { id: 'ref-001', caseRef: 'SG-2026-0035', type: 'MARAC', organisation: 'Local MARAC Panel', date: '2026-05-19', status: 'Active', outcome: 'Next panel 12 Jun' },
  { id: 'ref-002', caseRef: 'SG-2026-0035', type: 'Police', organisation: 'Metropolitan Police', date: '2026-05-19', status: 'Active', outcome: 'Investigation ongoing' },
  { id: 'ref-003', caseRef: 'SG-2026-0035', type: 'Social Care', organisation: 'Children\'s Services', date: '2026-05-19', status: 'Active', outcome: 'Assessment in progress' },
  { id: 'ref-004', caseRef: 'SG-2026-0039', type: 'Prevent/Channel', organisation: 'Channel Panel', date: '2026-06-02', status: 'Active', outcome: 'Panel scheduled 14 Jun' },
  { id: 'ref-005', caseRef: 'SG-2026-0042', type: 'Safeguarding Board', organisation: 'Kent Safeguarding Board', date: '2026-06-10', status: 'Active', outcome: 'Awaiting response' },
  { id: 'ref-006', caseRef: 'SG-2026-0038', type: 'Carers Support', organisation: 'Kent Young Carers', date: '2026-06-03', status: 'Active', outcome: 'Ongoing support' },
  { id: 'ref-007', caseRef: 'SG-2026-0036', type: 'HSE', organisation: 'Health & Safety Executive', date: 'Pending', status: 'Under Review', outcome: 'Decision pending' },
  { id: 'ref-008', caseRef: 'SG-2026-0010', type: 'LADO', organisation: 'Local Authority Designated Officer', date: '2026-05-12', status: 'Active', outcome: 'Investigation active' },
];

// Prevent concerns
export const PREVENT_CONCERNS = [
  { id: 'prev-001', caseRef: 'SG-2026-0039', learner: 'Thomas Wright', risk: 'Immediate Action Required', channelRef: 'CH-2026-0158', date: '2026-06-01', status: 'Channel Panel Scheduled', officer: 'Sarah Okonkwo' },
];

// Risk assessments
export const RISK_ASSESSMENTS = [
  { id: 'ra-001', caseRef: 'SG-2026-0039', type: 'Prevent Risk Assessment', date: '2026-06-02', completedBy: 'Sarah Okonkwo', score: 'High', reviewDue: '2026-07-02' },
  { id: 'ra-002', caseRef: 'SG-2026-0042', type: 'Safeguarding Risk Assessment', date: '2026-06-09', completedBy: 'Dr. Eleanor Vance', score: 'High', reviewDue: '2026-07-09' },
  { id: 'ra-003', caseRef: 'SG-2026-0041', type: 'Mental Health Risk Assessment', date: '2026-06-06', completedBy: 'Priya Kapoor', score: 'Medium', reviewDue: '2026-07-06' },
  { id: 'ra-004', caseRef: 'SG-2026-0035', type: 'DASH Risk Assessment', date: '2026-05-18', completedBy: 'Dr. Eleanor Vance', score: 'High (18)', reviewDue: '2026-06-18' },
];

// Safety plans
export const SAFETY_PLANS = [
  { id: 'sp-001', caseRef: 'SG-2026-0042', learner: 'Mia Robinson', type: 'Personal Safety Plan', date: '2026-06-10', createdBy: 'Marcus Adewale', status: 'Active', reviewDue: '2026-07-10' },
  { id: 'sp-002', caseRef: 'SG-2026-0035', learner: 'Fatima Hassan', type: 'Domestic Abuse Safety Plan', date: '2026-05-21', createdBy: 'Dr. Eleanor Vance', status: 'Active', reviewDue: '2026-06-21' },
];

// Secure notes
export const SECURE_NOTES = [
  { id: 'note-001', caseRef: 'SG-2026-0035', author: 'Dr. Eleanor Vance', date: '2026-05-20', content: 'MARAC panel preparation notes. Key risk factors identified: physical violence escalating, children present, perpetrator access to address, financial control. Recommend high-priority panel placement.', visibility: 'DSL Only' },
  { id: 'note-002', caseRef: 'SG-2026-0039', author: 'Sarah Okonkwo', date: '2026-06-03', content: 'Channel panel submission drafted. Key concerns: vulnerability to radicalisation, peer influence, access to extremist material. Protective factors: family engagement, college support network.', visibility: 'DSL + Prevent Lead' },
  { id: 'note-003', caseRef: 'SG-2026-0042', author: 'Dr. Eleanor Vance', date: '2026-06-11', content: 'Local authority safeguarding team confirmed receipt of referral LA-2026-7843. Strategy discussion scheduled for 13 June. Police updated on safe-word protocol.', visibility: 'DSL Only' },
];

// Messages (safeguarding internal comms)
export const SAFEGUARDING_MESSAGES = [
  { id: 'msg-001', from: 'Dr. Eleanor Vance', to: 'All Safeguarding Team', subject: 'MARAC Panel — 12 June Preparation', date: '2026-06-10', priority: 'High', read: true },
  { id: 'msg-002', from: 'Sarah Okonkwo', to: 'Dr. Eleanor Vance', subject: 'Channel Panel Outcome Expected', date: '2026-06-09', priority: 'Medium', read: true },
  { id: 'msg-003', from: 'Priya Kapoor', to: 'Marcus Adewale', subject: 'Daniel Okonkwo — GP Update Received', date: '2026-06-08', priority: 'Medium', read: false },
  { id: 'msg-004', from: 'Marcus Adewale', to: 'Dr. Eleanor Vance', subject: 'Welfare Visit — Liam Hughes Follow-up', date: '2026-06-07', priority: 'High', read: true },
  { id: 'msg-005', from: 'Dr. Eleanor Vance', to: 'All Safeguarding Team', subject: 'Safeguarding Week Briefing — 9 June', date: '2026-06-06', priority: 'Low', read: true },
];

// Contact log
export const CONTACT_LOG = [
  { id: 'cl-001', caseRef: 'SG-2026-0042', type: 'Phone Call', contact: 'Mia Robinson (Learner)', date: '2026-06-11 10:30', duration: '25 min', officer: 'Dr. Eleanor Vance', summary: 'Weekly check-in. Learner reports improved situation. Safe-word protocol tested and confirmed understood.' },
  { id: 'cl-002', caseRef: 'SG-2026-0035', type: 'In-Person Meeting', contact: 'Fatima Hassan (Learner)', date: '2026-06-10 14:00', duration: '45 min', officer: 'Dr. Eleanor Vance', summary: 'Safety plan review. Learner settled in temporary accommodation. Children safe. Non-molestation order hearing date confirmed.' },
  { id: 'cl-003', caseRef: 'SG-2026-0041', type: 'Video Call', contact: 'Daniel Okonkwo (Learner)', date: '2026-06-09 11:00', duration: '30 min', officer: 'Priya Kapoor', summary: 'Mental health check-in. Learner reports improvement since starting medication. Engaging with IAPT therapy.' },
  { id: 'cl-004', caseRef: 'SG-2026-0034', type: 'Home Visit', contact: 'Liam Hughes (Learner)', date: '2026-06-08 15:30', duration: '40 min', officer: 'Marcus Adewale', summary: 'Welfare follow-up. Learner stable in B&B. Housing application progressing. Replacement device delivered.' },
  { id: 'cl-005', caseRef: 'SG-2026-0039', type: 'Multi-agency Meeting', contact: 'Channel Panel Coordinator', date: '2026-06-05 13:00', duration: '60 min', officer: 'Sarah Okonkwo', summary: 'Pre-Channel panel preparatory meeting. Evidence reviewed. Support plan drafted.' },
];

// Case reviews
export const CASE_REVIEWS = [
  { id: 'cr-001', caseRef: 'SG-2026-0038', reviewer: 'Dr. Eleanor Vance', date: '2026-06-05', type: 'Monthly Review', outcome: 'Satisfactory — continue monitoring', recommendations: 'Extend flexible study plan for further 2 months.' },
  { id: 'cr-002', caseRef: 'SG-2026-0036', reviewer: 'Dr. Eleanor Vance', date: '2026-06-01', type: 'DSL Review', outcome: 'Satisfactory — awaiting H&S outcome', recommendations: 'Review HSE referral decision by 20 June.' },
  { id: 'cr-003', caseRef: 'SG-2026-0037', reviewer: 'Marcus Adewale', date: '2026-05-30', type: 'Monthly Review', outcome: 'Satisfactory — investigation ongoing', recommendations: 'Continue weekly wellbeing monitoring.' },
];

// Safeguarding audit
export const SAFEGUARDING_AUDIT = [
  { id: 'sa-001', date: '2026-06-01', type: 'Monthly Case Audit', auditor: 'External — Safeguarding Consultant', casesReviewed: 8, findings: 'All cases compliant. Documentation standards high. Recommendation: improve DSL review turnaround for low-risk cases.', rating: 'Good' },
  { id: 'sa-002', date: '2026-05-01', type: 'Monthly Case Audit', auditor: 'External — Safeguarding Consultant', casesReviewed: 7, findings: 'All cases compliant. MARAC referrals timely. Prevent procedures correctly followed.', rating: 'Outstanding' },
  { id: 'sa-003', date: '2026-04-01', type: 'Quarterly DSL Review', auditor: 'Dr. Eleanor Vance', casesReviewed: 12, findings: 'Internal review of all active cases. No concerns identified. All statutory duties met.', rating: 'Good' },
];

// Policy records
export const POLICY_RECORDS = [
  { id: 'pol-001', name: 'Safeguarding & Child Protection Policy', version: 'v4.2', lastReviewed: '2026-05-15', nextReview: '2026-11-15', owner: 'Dr. Eleanor Vance', status: 'Current' },
  { id: 'pol-002', name: 'Prevent Duty Policy', version: 'v3.1', lastReviewed: '2026-04-20', nextReview: '2026-10-20', owner: 'Sarah Okonkwo', status: 'Current' },
  { id: 'pol-003', name: 'Domestic Abuse Support Protocol', version: 'v2.0', lastReviewed: '2026-03-10', nextReview: '2026-09-10', owner: 'Dr. Eleanor Vance', status: 'Current' },
  { id: 'pol-004', name: 'Mental Health & Wellbeing Policy', version: 'v3.0', lastReviewed: '2026-02-28', nextReview: '2026-08-28', owner: 'Priya Kapoor', status: 'Current' },
  { id: 'pol-005', name: 'Whistleblowing Policy', version: 'v5.1', lastReviewed: '2026-05-01', nextReview: '2026-11-01', owner: 'Dr. Eleanor Vance', status: 'Current' },
  { id: 'pol-006', name: 'Data Protection & Confidentiality (Safeguarding)', version: 'v4.0', lastReviewed: '2026-06-01', nextReview: '2026-12-01', owner: 'Dr. Eleanor Vance', status: 'Under Review' },
];