// ============================================================
// KBC LearningOS — AI Audit Trail Data Model
// ============================================================

export type AiUserDecision = 'accepted' | 'edited' | 'rejected';

export interface AiAuditEntry {
  id: string;
  // Who
  triggeredByUserId: string;
  triggeredByUserName: string;
  triggeredByRole: string;
  // What
  aiFeatureUsed: string;
  aiFeatureLabel: string;
  // Context
  tenantId: string;
  learnerId?: string;
  learnerName?: string;
  evidenceId?: string;
  reviewId?: string;
  coachingId?: string;
  quizId?: string;
  // Timeline
  createdAt: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  reviewedByUserName?: string;
  // Content
  inputDataSource: string;
  inputDataSummary: string;
  aiOutput: string;
  // Decision
  userDecision: AiUserDecision;
  finalHumanApprovedText?: string;
  editsMade?: string;
  rejectionReason?: string;
  // Metadata
  sessionMode: 'ai-assisted' | 'manual-fallback';
  processingTimeMs: number;
}

// ============================================================
// Mock audit entries demonstrating the full lifecycle
// ============================================================

export const mockAiAuditEntries: AiAuditEntry[] = [
  {
    id: 'ai_audit_001',
    triggeredByUserId: 'u_learner_001',
    triggeredByUserName: 'Sarah Mitchell',
    triggeredByRole: 'Apprentice Learner',
    aiFeatureUsed: 'proofreading',
    aiFeatureLabel: 'AI Proofreading',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_001',
    learnerName: 'Sarah Mitchell',
    evidenceId: 'ev_001',
    createdAt: '2026-06-08T14:22:00Z',
    reviewedAt: '2026-06-08T14:25:00Z',
    reviewedByUserId: 'u_learner_001',
    reviewedByUserName: 'Sarah Mitchell',
    inputDataSource: 'Evidence reflection text',
    inputDataSummary: 'Reflection on stakeholder communication project — 340 words',
    aiOutput: 'Corrected 3 spelling errors, improved 2 sentence structures for clarity, suggested replacing "done the meeting" with "facilitated the stakeholder meeting"',
    userDecision: 'edited',
    finalHumanApprovedText: 'Facilitated the stakeholder meeting, ensuring all participants had the opportunity to contribute. I prepared the agenda in advance and circulated it 48 hours before.',
    editsMade: 'Accepted 4 of 5 suggestions, rewrote final paragraph independently',
    sessionMode: 'ai-assisted',
    processingTimeMs: 340,
  },
  {
    id: 'ai_audit_002',
    triggeredByUserId: 'u_coach_001',
    triggeredByUserName: 'Martin Reeves',
    triggeredByRole: 'Progress Coach',
    aiFeatureUsed: 'otjh-risk',
    aiFeatureLabel: 'AI OTJH Risk Detection',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_003',
    learnerName: 'Emily Watson',
    createdAt: '2026-06-07T09:15:00Z',
    reviewedAt: '2026-06-07T09:20:00Z',
    reviewedByUserId: 'u_coach_001',
    reviewedByUserName: 'Martin Reeves',
    inputDataSource: 'OTJH records for June 2026 (weeks 1-2)',
    inputDataSummary: 'Emily Watson — 7.5 hours claimed against 12-hour minimum for first two weeks',
    aiOutput: 'ALERT: Emily Watson is trending below OTJH minimum. Current rate projects 22.5 hours for month against 40-hour target. Suggested intervention: schedule additional catch-up session in week 3.',
    userDecision: 'accepted',
    finalHumanApprovedText: 'Scheduled catch-up coaching session for 14 June. OTJH risk flagged in learner dashboard. Employer copied on intervention plan.',
    sessionMode: 'ai-assisted',
    processingTimeMs: 210,
  },
  {
    id: 'ai_audit_003',
    triggeredByUserId: 'u_tutor_001',
    triggeredByUserName: 'Dr. Helen Crawford',
    triggeredByRole: 'Curriculum Tutor',
    aiFeatureUsed: 'ksb-suggestions',
    aiFeatureLabel: 'AI KSB Suggestions',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_002',
    learnerName: 'James Okonkwo',
    evidenceId: 'ev_015',
    createdAt: '2026-06-06T11:45:00Z',
    reviewedAt: '2026-06-06T12:10:00Z',
    reviewedByUserId: 'u_tutor_001',
    reviewedByUserName: 'Dr. Helen Crawford',
    inputDataSource: 'Evidence item: Data analysis report with SQL queries',
    inputDataSummary: 'James submitted a 12-page data analysis report including SQL queries, visualisations and business recommendations',
    aiOutput: 'Suggested KSB mapping: K4 (Data analysis tools) — STRONG match, K6 (Business communication) — MODERATE match, S7 (Technical documentation) — MODERATE match, B2 (Professional standards) — WEAK match. Recommended: strengthen B2 evidence with additional workplace context.',
    userDecision: 'edited',
    finalHumanApprovedText: 'KSB mapped: K4 (validated), K6 (validated), S7 (validated). B2 suggestion noted — requested James to add workplace policy reference in next submission.',
    editsMade: 'Accepted K4, K6, S7 mapping. Deferred B2 mapping pending additional evidence.',
    sessionMode: 'ai-assisted',
    processingTimeMs: 520,
  },
  {
    id: 'ai_audit_004',
    triggeredByUserId: 'u_learner_001',
    triggeredByUserName: 'Sarah Mitchell',
    triggeredByRole: 'Apprentice Learner',
    aiFeatureUsed: 'reflection-quality',
    aiFeatureLabel: 'AI Reflection Quality Check',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_001',
    learnerName: 'Sarah Mitchell',
    evidenceId: 'ev_022',
    createdAt: '2026-06-05T16:30:00Z',
    reviewedAt: '2026-06-05T16:35:00Z',
    reviewedByUserId: 'u_learner_001',
    reviewedByUserName: 'Sarah Mitchell',
    inputDataSource: 'Weekly reflection on customer service module',
    inputDataSummary: 'Reflection text — 280 words covering customer interaction scenarios',
    aiOutput: 'Quality check: Reflection is descriptive but lacks analysis. Missing: how the learning was applied in workplace, what the business impact was, which specific KSBs were developed. Suggested adding: "This improved customer satisfaction because..." and linking to KSB framework.',
    userDecision: 'accepted',
    finalHumanApprovedText: 'Added workplace application section: "I applied the CALM framework to three customer calls this week, which reduced escalation rate by 40% and improved first-call resolution." Linked to K3 and S4.',
    sessionMode: 'ai-assisted',
    processingTimeMs: 380,
  },
  {
    id: 'ai_audit_005',
    triggeredByUserId: 'u_coach_001',
    triggeredByUserName: 'Martin Reeves',
    triggeredByRole: 'Progress Coach',
    aiFeatureUsed: 'progress-review-drafts',
    aiFeatureLabel: 'AI Progress Review Drafts',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_004',
    learnerName: 'David Chen',
    reviewId: 'pr_008',
    createdAt: '2026-06-04T10:00:00Z',
    reviewedAt: '2026-06-04T10:45:00Z',
    reviewedByUserId: 'u_coach_001',
    reviewedByUserName: 'Martin Reeves',
    inputDataSource: 'Monthly data: OTJH (38 hours), KSB (12/18 achieved), attendance (92%), coaching notes (2 sessions), employer feedback',
    inputDataSummary: 'David Chen — May 2026 progress data. Strong KSB progression, OTJH on track, attendance above threshold. Employer reports improved confidence.',
    aiOutput: 'Draft review summary: David continues to make strong progress across all areas. KSB achievement is ahead of schedule (12/18 at month 5). OTJH compliance maintained at 95% of target. Employer feedback positive — note improved client communication skills. Suggested discussion points: 1) Gateway timeline planning 2) EPA preparation resources 3) Stretch objectives for remaining KSBs.',
    userDecision: 'edited',
    finalHumanApprovedText: 'Edited all three discussion points to add specific KSB targets and personalised feedback from last coaching session. Added employer contribution note.',
    editsMade: 'Restructured discussion points, added personalised feedback, included employer contribution verification step',
    sessionMode: 'ai-assisted',
    processingTimeMs: 610,
  },
  {
    id: 'ai_audit_006',
    triggeredByUserId: 'u_learner_003',
    triggeredByUserName: 'Emily Watson',
    triggeredByRole: 'Apprentice Learner',
    aiFeatureUsed: 'proofreading',
    aiFeatureLabel: 'AI Proofreading',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_003',
    learnerName: 'Emily Watson',
    evidenceId: 'ev_030',
    createdAt: '2026-06-03T15:00:00Z',
    inputDataSource: 'Assignment submission — project management case study',
    inputDataSummary: '1,200-word case study on project management methodologies',
    aiOutput: 'Identified 7 grammar errors, 4 awkward phrasings, and suggested restructuring of methodology comparison section for clarity.',
    userDecision: 'rejected',
    rejectionReason: 'Prefer to maintain my own writing style. AI suggestions changed the tone of the technical analysis section.',
    sessionMode: 'ai-assisted',
    processingTimeMs: 450,
  },
  {
    id: 'ai_audit_007',
    triggeredByUserId: 'u_compliance_001',
    triggeredByUserName: 'Patricia Okeke',
    triggeredByRole: 'Compliance Officer',
    aiFeatureUsed: 'ofsted-summaries',
    aiFeatureLabel: 'AI Ofsted Evidence Summaries',
    tenantId: 't_kbc_001',
    createdAt: '2026-06-02T09:30:00Z',
    reviewedAt: '2026-06-02T11:00:00Z',
    reviewedByUserId: 'u_compliance_001',
    reviewedByUserName: 'Patricia Okeke',
    inputDataSource: 'Q2 2026 evidence pack: 340 evidence items, 12 learner progress reviews, 8 coaching records, attendance data',
    inputDataSummary: 'Full Q2 evidence pack for Business Administrator L3 cohort — 7 active learners',
    aiOutput: 'Compiled summary showing: 94% evidence validation rate, 89% OTJH compliance, 91% KSB progression rate. Identified 3 learners requiring additional support. Generated Ofsted-ready evidence index with cross-references.',
    userDecision: 'accepted',
    finalHumanApprovedText: 'Ofsted evidence pack approved. QA spot check scheduled for 3 evidence items flagged as borderline. Pack ready for inspection review.',
    sessionMode: 'ai-assisted',
    processingTimeMs: 890,
  },
  {
    id: 'ai_audit_008',
    triggeredByUserId: 'u_learner_005',
    triggeredByUserName: 'Aisha Patel',
    triggeredByRole: 'Apprentice Learner',
    aiFeatureUsed: 'evidence-checker',
    aiFeatureLabel: 'AI Evidence Checker',
    tenantId: 't_kbc_001',
    learnerId: 'u_learner_005',
    learnerName: 'Aisha Patel',
    evidenceId: 'ev_042',
    createdAt: '2026-06-01T14:15:00Z',
    reviewedAt: '2026-06-01T14:20:00Z',
    reviewedByUserId: 'u_learner_005',
    reviewedByUserName: 'Aisha Patel',
    inputDataSource: 'Evidence upload: meeting minutes and presentation slides',
    inputDataSummary: 'Uploaded meeting minutes from team standup and PowerPoint presentation on digital marketing campaign',
    aiOutput: 'Evidence gap detected: Meeting minutes show task completion but lack reflection on learning. Missing: workplace application context, employer benefit statement, KSB linkage. Presentation slides are supplementary only — primary evidence should include reflection document.',
    userDecision: 'accepted',
    finalHumanApprovedText: 'Added reflection document detailing: what I learned about campaign analytics, how I applied it to the live Instagram campaign, employer benefit (12% engagement increase), KSB mapping to K7, S5, B3.',
    sessionMode: 'ai-assisted',
    processingTimeMs: 410,
  },
];

export const mockAiAuditStats = {
  totalEntries: 247,
  thisMonth: 38,
  acceptedRate: 62,
  editedRate: 28,
  rejectedRate: 10,
  averageProcessingTimeMs: 475,
  topFeatures: [
    { feature: 'AI Proofreading', count: 89 },
    { feature: 'AI KSB Suggestions', count: 52 },
    { feature: 'AI Reflection Quality Check', count: 41 },
    { feature: 'AI OTJH Risk Detection', count: 28 },
    { feature: 'AI Evidence Checker', count: 22 },
  ],
  topUsers: [
    { name: 'Sarah Mitchell', count: 47 },
    { name: 'Dr. Helen Crawford', count: 38 },
    { name: 'Martin Reeves', count: 35 },
    { name: 'James Okonkwo', count: 29 },
    { name: 'Emily Watson', count: 26 },
  ],
};