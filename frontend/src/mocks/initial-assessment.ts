import type { InitialAssessmentRecord } from './initial-assessment-data';

export interface BKSBResult {
  subject: 'English' | 'Maths';
  initialLevel: string;
  diagnosticLevel: string;
  diagnosticScore: number;
  maxScore: number;
  areas: {
    name: string;
    score: number;
    maxScore: number;
    percentage: number;
    status: 'above' | 'at' | 'below' | 'well-below';
  }[];
  dateTaken: string;
  timeTaken: string;
  proctored: boolean;
  proctorNote: string;
}

export interface LearningStyleProfile {
  visual: number;
  auditory: number;
  readingWriting: number;
  kinaesthetic: number;
  primaryStyle: 'Visual' | 'Auditory' | 'Reading/Writing' | 'Kinaesthetic' | 'Multimodal';
  secondaryStyle: string;
  recommendations: string[];
  dateAssessed: string;
}

export interface ProgrammeReadiness {
  overallScore: number;
  maxScore: number;
  percentage: number;
  band: 'Ready' | 'Ready with Support' | 'Requires Development' | 'Not Ready';
  categories: {
    name: string;
    score: number;
    maxScore: number;
    percentage: number;
  }[];
  assessorNote: string;
}

export interface SupportRequirement {
  type: string;
  detail: string;
  recommended: boolean;
  urgency: 'standard' | 'priority' | 'critical';
  costImplication: string;
}

export interface InitialAssessmentRecord {
  id: string;
  learnerName: string;
  programme: string;
  standardCode: string;
  employer: string;
  lineManager: string;
  cohort: string;
  targetStartDate: string;
  overallStatus: InitialAssessmentStatus;
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
  bksbResults: BKSBResult[];
  learningStyle: LearningStyleProfile;
  readiness: ProgrammeReadiness;
  supportRequirements: SupportRequirement[];
  englishLevel: string;
  mathsLevel: string;
  digitalSkillsLevel: string;
  diagnosticSummary: string;
  assessorRecommendation: string;
  notes: { author: string; text: string; timestamp: string; visibility: 'Internal' | 'Shared' }[];
  actionHistory: { action: string; by: string; timestamp: string; detail: string }[];
}

export type InitialAssessmentStatus =
  | 'Not Started'
  | 'Awaiting BKSB'
  | 'Awaiting Diagnostics'
  | 'Assessed'
  | 'Below Required Level'
  | 'Requires LSP'
  | 'Ready for Programme'
  | 'Escalated';

export const INITIAL_ASSESSMENT_STATS = {
  totalAssessed: 6,
  readyForProgramme: 3,
  requiresLSP: 1,
  belowRequired: 1,
  highRisk: 1,
};