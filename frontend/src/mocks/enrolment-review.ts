// ============================================================================
// ENROLMENT REVIEW — Type Definitions & Stats
// ============================================================================

export interface ReviewCheckItem {
  id: string;
  label: string;
  description: string;
  result: 'pass' | 'fail' | 'not-reviewed' | 'not-applicable';
  reviewerNote?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface EnrolmentReviewRecord {
  id: string;
  learnerName: string;
  programme: string;
  standardCode: string;
  employer: string;
  lineManager: string;
  cohort: string;
  targetStartDate: string;
  currentStage: string;
  overallStatus: EnrolmentReviewStatus;
  caseOwner: string;
  reviewerName: string;
  lastUpdated: string;
  daysSinceLastUpdate: number;
  riskStatus: 'Low' | 'Medium' | 'High';
  riskReason?: string;
  nextAction: string;
  nextActionDue: string;
  onboardingSubmittedDate: string;
  reviewStartedDate?: string;
  checksCompleted: number;
  totalChecks: number;
  checkItems: ReviewCheckItem[];
  missingInformation: string[];
  internalNotes: InternalNote[];
  actionHistory: ReviewAction[];
  sourcedFrom: string; // link to self-onboarding ID
}

export interface InternalNote {
  id: string;
  author: string;
  timestamp: string;
  content: string;
  visibility: 'internal' | 'shared';
}

export interface ReviewAction {
  id: string;
  action: 'approved' | 'returned' | 'evidence-requested' | 'note-added' | 'escalated' | 'rejected';
  timestamp: string;
  performedBy: string;
  detail: string;
}

export type EnrolmentReviewStatus =
  | 'Submitted'
  | 'Under Enrolment Review'
  | 'Missing Information'
  | 'Returned to Learner'
  | 'Ready for Eligibility Review'
  | 'Rejected at Enrolment'
  | 'Escalated';

export interface EnrolmentReviewStats {
  totalInReview: number;
  readyForEligibility: number;
  missingInfo: number;
  highRisk: number;
}

export const ENROLMENT_REVIEW_STATS: EnrolmentReviewStats = {
  totalInReview: 6,
  readyForEligibility: 0,
  missingInfo: 1,
  highRisk: 2,
};