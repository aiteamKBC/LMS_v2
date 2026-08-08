export interface ResidencyTest {
  id: string;
  label: string;
  description: string;
  status: 'pass' | 'fail' | 'evidence-required' | 'not-reviewed';
  evidence: string;
  reviewerNote: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface FundingEligibilityCheck {
  id: string;
  check: string;
  detail: string;
  status: 'pass' | 'fail' | 'not-applicable' | 'not-reviewed';
  note: string;
}

export interface PriorAttainmentRecord {
  id: string;
  qualification: string;
  level: string;
  year: number;
  awardingBody: string;
  grade: string;
  verified: boolean;
  relevance?: 'relevant' | 'partial' | 'not-relevant';
  evidenceProvided: boolean;
  note: string;
}

export interface EligibilityReviewRecord {
  id: string;
  learnerName: string;
  programme: string;
  standardCode: string;
  employer: string;
  lineManager: string;
  cohort: string;
  targetStartDate: string;
  overallStatus: EligibilityStatus;
  riskStatus: 'Low' | 'Medium' | 'High';
  riskReason: string;
  caseOwner: string;
  reviewer: string;
  submittedDate: string;
  reviewStartedDate: string;
  lastUpdated: string;
  daysSinceLastUpdate: number;
  nextAction: string;
  nextActionDue: string;
  enrolmentResult: string;
  residencyTests: ResidencyTest[];
  fundingChecks: FundingEligibilityCheck[];
  priorAttainment: PriorAttainmentRecord[];
  rightToWork: {
    status: 'verified' | 'evidence-required' | 'not-checked' | 'flagged';
    document: string;
    expiryDate: string;
    note: string;
  };
  ageValidation: {
    dob: string;
    ageAtStart: number;
    meetsMinimum: boolean;
    note: string;
  };
  eligibilityOutcome: {
    decision: 'eligible' | 'not-eligible' | 'conditionally-eligible' | 'pending';
    decidedBy: string;
    decidedAt: string;
    reason: string;
    conditions: string[];
  };
  notes: { author: string; text: string; timestamp: string; visibility: 'Internal' | 'Shared' }[];
  actionHistory: { action: string; by: string; timestamp: string; detail: string }[];
}

export type EligibilityStatus =
  | 'Submitted'
  | 'Under Eligibility Review'
  | 'Evidence Required'
  | 'Eligible'
  | 'Not Eligible'
  | 'Conditionally Eligible'
  | 'Escalated';

export const ELIGIBILITY_STATS = {
  totalInReview: 6,
  eligible: 2,
  notEligible: 1,
  evidenceRequired: 1,
  highRisk: 2,
};
