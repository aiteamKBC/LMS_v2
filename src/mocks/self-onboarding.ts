export interface PolicyAcknowledgement {
  policyName: string;
  policyVersion: string;
  documentLink: string;
  read: boolean;
  acknowledgedDate: string | null;
  learnerSignature: string | null;
  timestamp: string | null;
  auditTrail: boolean;
}

export interface SelfOnboardingLearner {
  id: string;
  learnerName: string;
  programme: string;
  standardCode: string;
  employer: string;
  lineManager: string;
  cohort: string;
  targetStartDate: string;
  currentStage: string;
  overallStatus: OnboardingStatus;
  caseOwner: string;
  lastUpdated: string;
  daysSinceLastUpdate: number;
  riskStatus: 'Low' | 'Medium' | 'High';
  riskReason?: string;
  nextAction: string;
  nextActionDue?: string;
  sectionsComplete: number;
  totalSections: number;
  personalDetails: Record<string, string>;
  contactDetails: Record<string, string>;
  emergencyContact: Record<string, string>;
  employmentDetails: Record<string, string | number>;
  employerAndLineManager: Record<string, string>;
  residencyRightToWork: Record<string, string | boolean>;
  priorAttainment: Record<string, string | string[]>;
  governmentFundedTraining: Record<string, string | boolean>;
  personalCircumstances: Record<string, string | boolean>;
  supportNeeds: Record<string, string | boolean>;
  learningSupportScreening: Record<string, string | boolean>;
  englishAndMaths: Record<string, string | boolean | number>;
  programmeUnderstanding: Record<string, string | boolean>;
  priorLearning: Record<string, string | boolean | string[]>;
  cvJobDescription: Record<string, string | boolean | string[]>;
  policyAcknowledgements: PolicyAcknowledgement[];
  declarations: Record<string, string | boolean>;
  evidenceUploads: Record<string, string | string[] | boolean>;
  reviewAndSubmit: Record<string, string | boolean | number>;
}

export type OnboardingStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Submitted'
  | 'Returned to Learner'
  | 'Under Review'
  | 'Missing Information'
  | 'Approved'
  | 'Rejected'
  | 'Escalated';

export const DEFAULT_POLICIES: PolicyAcknowledgement[] = [
  { policyName: 'Health and Safety', policyVersion: 'v4.2', documentLink: '/policies/health-and-safety.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Harassment and Bullying', policyVersion: 'v3.1', documentLink: '/policies/harassment-bullying.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Complaints Procedure', policyVersion: 'v5.0', documentLink: '/policies/complaints-procedure.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Business Continuity', policyVersion: 'v2.4', documentLink: '/policies/business-continuity.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Safeguarding and Prevent', policyVersion: 'v6.1', documentLink: '/policies/safeguarding-prevent.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Learner Code of Conduct', policyVersion: 'v4.0', documentLink: '/policies/code-of-conduct.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Equality, Diversity and Inclusion', policyVersion: 'v3.3', documentLink: '/policies/edi.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'British Values', policyVersion: 'v2.0', documentLink: '/policies/british-values.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
  { policyName: 'Attendance and Engagement Policy', policyVersion: 'v4.1', documentLink: '/policies/attendance-engagement.pdf', read: false, acknowledgedDate: null, learnerSignature: null, timestamp: null, auditTrail: true },
];

export const ONBOARDING_SECTIONS = [
  'Welcome and Introduction',
  'Individualised Learner Record',
  'Personal Details',
  'Contact Details',
  'Address History',
  'Emergency Contact',
  'Employment Details',
  'Employer and Line Manager',
  'Residency and Right to Work',
  'Prior Attainment',
  'Government-Funded Training',
  'Personal Circumstances',
  'Support Needs',
  'Learning Support Screening',
  'English and Maths',
  'Programme Understanding',
  'PLR / Prior Learning',
  'CV / Job Description',
  'Policy Acknowledgements',
  'Declarations',
  'Evidence Uploads',
  'Review and Submit',
];

export const ONBOARDING_STATS = {
  total: 6,
  submitted: 2,
  inProgress: 2,
  missingInfo: 1,
  returnedForCorrection: 1,
  approved: 0,
  byRisk: { low: 3, medium: 2, high: 1 },
};