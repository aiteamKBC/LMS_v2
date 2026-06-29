import type { RPLRecord } from './rpl-review-data';

export interface KSBCategory {
  id: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
  ref: string;
  description: string;
  standardWeight: number;
  rplStatus: 'not-assessed' | 'evidence-provided' | 'partially-met' | 'fully-met' | 'not-met';
  rplPercentage: number;
  evidence: string;
  assessorDecision: 'accept' | 'partial-accept' | 'reject' | 'pending';
  assessorNote: string;
}

export interface ExperienceCrosswalk {
  id: string;
  role: string;
  employer: string;
  duration: string;
  responsibilities: string[];
  mappedKSBs: string[];
  relevanceScore: number;
  evidenceStrength: 'strong' | 'moderate' | 'weak';
}

export interface DurationReduction {
  standardDuration: number;
  rplReduction: number;
  adjustedDuration: number;
  reductionPercentage: number;
  breakdown: {
    category: string;
    months: number;
    reason: string;
  }[];
  decisionStatus: 'proposed' | 'approved' | 'rejected' | 'pending-review';
  approvedBy: string;
  approvedAt: string;
}

export interface RPLRecord {
  id: string;
  learnerName: string;
  programme: string;
  standardCode: string;
  employer: string;
  lineManager: string;
  cohort: string;
  targetStartDate: string;
  overallStatus: RPLStatus;
  riskStatus: 'Low' | 'Medium' | 'High';
  riskReason: string;
  caseOwner: string;
  assessor: string;
  submittedDate: string;
  assessedDate: string;
  lastUpdated: string;
  daysSinceLastUpdate: number;
  nextAction: string;
  nextActionDue: string;
  eligibilityResult: string;
  initialAssessmentResult: string;
  ksbCategories: KSBCategory[];
  experienceCrosswalk: ExperienceCrosswalk[];
  durationReduction: DurationReduction;
  priorQualificationsSummary: string;
  rplDecision: {
    outcome: 'approved' | 'partial-approved' | 'rejected' | 'pending';
    totalKSBRPL: number;
    totalKSBCount: number;
    rplPercentage: number;
    decidedBy: string;
    decidedAt: string;
    summary: string;
  };
  notes: { author: string; text: string; timestamp: string; visibility: 'Internal' | 'Shared' }[];
  actionHistory: { action: string; by: string; timestamp: string; detail: string }[];
}

export type RPLStatus =
  | 'Not Started'
  | 'Evidence Collection'
  | 'RPL In Progress'
  | 'RPL Applied'
  | 'RPL Approved'
  | 'RPL Rejected'
  | 'Makes Learner Ineligible'
  | 'Escalated';

export const RPL_STATS = {
  totalInRPL: 6,
  rplApproved: 2,
  rplInProgress: 2,
  rplRejected: 1,
  highRisk: 1,
};