// ============================================================================
// Enrolment Console — shared types
// Frontend only. Every shape is named so it can be mapped to the API later.
// ============================================================================

// ---- Screen A: Users List ----
export type UserType = 'User' | 'Employer' | 'Referrer' | 'Admin' | 'Caseowner';
export type ProgrammeStatus = 'Non starter' | 'Active' | 'Completed' | 'Entered EPA' | string;

export interface UserListRow {
  id: string;
  name: string;
  type: UserType;
  email: string;
  group: string;
  subscriptionStatus: string; // "FullUser"
  subscriptionVerified: boolean; // false -> red ✗
  learningPlan: boolean; // show "Learning plan" link (User rows only)
  programmeStatus?: ProgrammeStatus;
  notesCount?: number;
  hasTasks?: boolean;
  reference?: string;
}

export interface UsersFilter {
  userName?: string;
  groups?: string[];
  email?: string;
  statuses?: string[]; // FullUser, Invited, Prospect...
  type?: UserType | 'all';
  programme?: string;
  programmeStatus?: string;
  niNumber?: string;
  caseOwner?: string | 'any';
  referenceNumber?: string;
  page: number; // 1-based
  pageSize: number;
}

// ---- Screen B: Enrolment Details Board ----
export interface FsAssessmentRecord {
  id: string;
  name: string;
  level: string;
  date: string;
  result?: string;
}
export interface FsBlock {
  assessments: FsAssessmentRecord[];
  exempt: boolean;
  evidence: DocRow[];
}

export interface ManagedJob {
  id: string;
  employer: string;
  title: string;
  categories: string;
  availableFrom: string;
  availableTo: string;
  hoursPlanned: string; // "12:30"
  hoursLogged: string; // "00:00"
  status: string;
  date: string;
  comments: string;
  currentStep?: string;
  canUnverify?: boolean;
}

export interface TrackerRow {
  id: string;
  type: string;
  status: string;
  programme: string;
  description: string;
  documents: string;
}
export interface MilestoneRow {
  id: string;
  programme: string;
  description: string;
  date: string;
  empWksLeft: string;
  alwWksLeft: string;
  status: string;
  claimed: string;
}
export interface NoteRow {
  id: string;
  text: string;
  administrator: string;
  dateTime: string;
}
export interface CourseProgressRow {
  id: string;
  isLocked: boolean;
  courseName: string;
  progress: string; // "3 / 60% completed"
  status: string;
}
export interface ContactRow {
  id: string;
  name: string;
  type: string;
  phone: string;
  email: string;
  role: string;
  notes: string;
}
export interface ActivityRow {
  id: string;
  date: string;
  timeAndStatus: string;
  event: string;
}
export interface DocRow {
  id: string;
  uploaded: string;
  description: string;
  fileName?: string;
  url?: string;
}
export interface ReviewRow {
  id: string;
  label: string; // "Review - Progress Review 02/12/2025 (0)"
  action?: 'create' | 'needs-signing';
}
export interface ReviewGroup {
  programme: string;
  reviews: ReviewRow[];
}
export interface CompetencyRow {
  id: string;
  name: string;
  version: string;
}
export interface AuditChange {
  property: string;
  value: string;
}
export interface AuditEntry {
  id: string;
  date: string;
  admin: string;
  action: string;
  changes: AuditChange[];
}
export interface SubProgrammeRow {
  name: string;
  startDate: string;
  endDate: string;
}
export interface AimRow {
  aimRef: string;
  qualification: string;
  startDate: string;
  endDate: string;
  exempt: boolean;
}

export interface EnrolmentBoard {
  user: { id: string; name: string; reference: string; owner: string };
  contact: {
    email: string;
    phone: string;
    dob: string;
    groupMembership: string;
    signatureUrl?: string;
    hasMandate: boolean;
  };
  activity: {
    aptemUsage: string;
    daysTillNextReporting: number;
    lastLoggedIn?: string;
    logins: number;
    tasksAddedByUser: number;
    uncompletedTasks: number;
    adviceItemsAccessed: number;
    adviceLastAccessed?: string;
    actionPlans: string;
  };
  programme: {
    type: string;
    name: string;
    status: ProgrammeStatus;
    startDate: string;
    endDate: string;
    enrolledAt: string;
    enrolledBy: string;
    onboardingStatus: string;
    onboardingCompletedAt?: string;
  };
  subProgrammes: SubProgrammeRow[];
  aims: AimRow[];
  previousProgrammes: string[];
  functionalSkills: { english: FsBlock; maths: FsBlock; ict: FsBlock };
  managedJobs: ManagedJob[];
  tracker: TrackerRow[];
  milestones: MilestoneRow[];
  notes: NoteRow[];
  courseProgress: CourseProgressRow[];
  contacts: ContactRow[];
  activities: ActivityRow[];
  complianceDocuments: DocRow[];
  reviewDocuments: ReviewGroup[];
  documents: DocRow[];
  competencies: CompetencyRow[];
  subscription: { startDate: string; endDate: string; status: string };
  auditTrail: AuditEntry[];
}

// ---- Wizard ----
export interface PersonalDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  dob: string;
  age?: number;
  sex: string;
}

export type CompetenceKind = 'Knowledge' | 'Skill' | 'Behaviour';
export type RagLevel = 'always' | 'often' | 'sometimes' | 'rarely' | 'never';

export interface Ksb {
  id: string; // e.g. "PCP-K1"
  theme: string;
  kind: CompetenceKind;
  codes: string[]; // ["K1"] or ["B3","B4"]
  title: string;
}
export interface KsbAssessment {
  ksbId: string;
  level: RagLevel | null;
  evidenceFiles: string[];
  actionPlan: {
    text: string;
    action?: string;
    goal?: string;
    dueDate?: string;
  } | null;
  note?: string;
}
export interface SkillsRadarState {
  standardId: string;
  assessments: Record<string, KsbAssessment>;
}

export interface IlrForm {
  familyName: string;
  givenNames: string;
  dob: string;
  currentPostcode: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  addressLine4: string;
  yearsAtAddress?: number;
  telephone: string;
  postcodePriorToEnrolment: string;
  niNumber: string;
  email: string;
  legalSex: 'Male' | 'Female' | '';
  pronouns?: string;
  ethnicityCode: string;
  hasLongTermDisability: boolean | null;
  priorAttainment: { level: string; date: string }[];
  employmentStatus: { code: string; date: string }[];
  signatureUrl?: string;
}

export interface ContactPreferencesForm {
  consent: { courses: boolean | null; surveys: boolean | null; byPost: boolean | null; byPhone: boolean | null; byEmail: boolean | null };
  nextOfKin: {
    fullName: string;
    relationship: string;
    email: string;
    phone: string;
    sameAddressAsLearner: boolean | null;
    postcode?: string;
    address?: string;
    address2?: string;
    city?: string;
  };
  eligibility: {
    countryOfBirth: string;
    employedInEngland: boolean | null;
    countryOfResidence: string;
    ukEeaNational: boolean | null;
    nationality: string;
    residentPrev3Years: boolean | null;
    yearsInUk?: number;
    requiresWorkPermit: boolean | null;
    evidenceDescription?: string;
    evidenceFiles: string[];
  };
  otherGovFundedTraining12m: boolean | null;
  circumstances: { homeSituation: string; caringResponsibilities: string; other: string; supportNeeded: string; careLeaver: boolean | null };
  understanding: { programmeUnderstanding: string; careerProgression: string };
  additional: { wageRateBand: string; disabilityDiscussEmployer: string; otherIncome?: string; aged16to18: boolean | null; aged19to24: boolean | null };
  media: { consent: boolean | null; preferredName: string; genderIdentity: string; genderOther?: string; pronouns: string };
  declarations: { plrShared: boolean | null; dfeContact: boolean | null; epaoDetails: boolean | null; kbcHoldsCerts: boolean | null; infoAccurate: boolean | null };
}

export interface PlrRecord {
  id: string;
  placeOfStudy: string;
  qualificationType: string;
  subject: string;
  level?: string;
  awardDate?: string;
  credits: number;
  grade: string;
  recordType: 'Imported' | 'Manual' | string;
}
export interface PlrState {
  uln: string;
  records: PlrRecord[];
}

export interface CvJobForm {
  cvFile?: string;
  experienceText?: string;
  pmQualifications: string;
  functionalSkillsEnrol?: string;
}

export interface PolicyDoc {
  id: string;
  label: string;
  url: string;
  requiresAck: boolean;
}
export interface PoliciesState {
  acknowledged: Record<string, boolean>;
}

export interface WizardDraft {
  personalDetails: PersonalDetails;
  skillsRadar: SkillsRadarState;
  ilr: IlrForm;
  contactPreferences: ContactPreferencesForm;
  plr: PlrState;
  cvJob: CvJobForm;
  policies: PoliciesState;
}

export interface WizardStepDef {
  slug: string;
  label: string;
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { slug: 'introduction', label: 'Introduction' },
  { slug: 'personal-details', label: 'Personal Details' },
  { slug: 'skills-radar', label: 'Skills Radar' },
  { slug: 'ilr', label: 'Individualised Learner Record' },
  { slug: 'contact-preferences', label: 'Contact Preferences' },
  { slug: 'plr', label: 'Personal Learning Record' },
  { slug: 'cv-job', label: 'CV / Job Description' },
  { slug: 'policies', label: 'Policies' },
  { slug: 'next-steps', label: 'Next Steps' },
];
