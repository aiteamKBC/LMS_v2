// ============================================================================
// Enrolment Console — shared types
// Frontend only. Every shape is named so it can be mapped to the API later.
// ============================================================================
import type { TrainingPlan } from '@/api/trainingPlan';

// ---- Screen A: Users List ----
export type UserType = 'User' | 'Employer' | 'Referrer' | 'Admin' | 'Caseowner';
// Mirrors PROGRAMME_STATUS_OPTIONS. Stays open (`| string`) because rows saved
// before the list was trimmed can still carry a retired status.
export type ProgrammeStatus =
  | 'Fresh user'
  | 'Onboarding'
  | 'Delivery'
  | 'Ready to enrol'
  | 'Active'
  | 'Withdrawn'
  | 'On break'
  | 'Completed'
  | string;

export interface UserListRow {
  id: string;
  /** Permanent identifier, the same value before and after the learner becomes
   *  active. `id` remains the integer the current routes are built on; prefer
   *  this when something new needs to name a user. Null only on rows written
   *  before the uuid backfill. */
  uuid: string | null;
  name: string;
  type: UserType;
  email: string;
  group: string;
  subscriptionStatus: string; // "FullUser"
  subscriptionVerified: boolean; // false -> red ✗
  learningPlan: boolean; // show "Learning plan" link (User rows only)
  /** Whether a learning plan has actually been saved — drives Add vs Edit. */
  hasLearningPlan?: boolean;
  programmeStatus?: ProgrammeStatus;
  /**
   * The programme the learner is on. Absent for staff, admin and employer rows,
   * which have no programme — the directory lists all four kinds in one table.
   */
  programme?: string;
  /**
   * The cohort within that programme. Absent for staff, admin and employer
   * rows, same as `programme`.
   */
  cohort?: string;
  notesCount?: number;
  hasTasks?: boolean;
  reference?: string;
  /**
   * Which table the row came from. The single enrolment section lists
   * apprenticeship learners, commercial learners, staff/admin accounts and
   * employer contacts, and their ids live in separate tables — so row actions
   * must be routed by source, not id alone.
   */
  source?: 'apprenticeship' | 'commercial' | 'staff' | 'employer';
  /**
   * Present on create only, and only when the form asked for an invitation.
   * The record is saved whether or not the email was sent, so the invitation's
   * outcome is reported separately — see backend/login/services.py.
   */
  invitation?: InvitationOutcome;
}

/** Result of an invitation attempt attached to a just-created record. */
export interface InvitationOutcome {
  /** An invitation row was written — the link exists and can be re-sent. */
  invited: boolean;
  /** The email reached the mail transport (false when Azure is unconfigured). */
  emailSent: boolean;
  accountCreated: boolean;
  /** Why the invitation did not go out, when it did not. */
  error: string | null;
  expiresAt: string | null;
  /**
   * The caller was not allowed to issue this invitation — e.g. not signed in,
   * or a staff member trying to create an administrator. No account was
   * created. Distinct from a mail failure: the record still saved, but nobody
   * will ever be able to sign in as them until an authorised user re-invites.
   */
  forbidden?: boolean;
}

export interface UsersFilter {
  userName?: string;
  groups?: string[];
  email?: string;
  statuses?: string[]; // FullUser, Invited, Prospect...
  type?: UserType | 'all';
  programme?: string;
  /**
   * A single cohort, not a list: the curriculum group lookup takes one
   * programme + one cohort, so a multi-select here would have nothing to
   * narrow the group options with.
   */
  cohort?: string;
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
  user: {
    id: string;
    name: string;
    reference: string;
    owner: string;
    /** Resolved from Employer_id where set, else the learner's own text. */
    employer?: string;
    employerId?: number | null;
  };
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
    cohort: string;
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
  trainingPlan: TrainingPlan;
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
  /** PNG data URL — drawn or uploaded via SignaturePad. */
  signature?: string;
  /** ISO date the signature was captured. */
  signatureDate?: string;
}

export type CompetenceKind = 'Knowledge' | 'Skill' | 'Behaviour';
/**
 * Self-assessment scale for the Skills Radar questionnaire (8 points, scored 8
 * down to 1 — see COMPETENCE_LEVELS).
 *
 * The five original RAG values are kept in the union so assessments saved before
 * the scale was widened still load and display instead of coming back as null.
 */
export type RagLevel =
  | 'mastery'
  | 'expert'
  | 'proficient'
  | 'consistently'
  | 'frequently'
  | 'occasionally'
  | 'rarely'
  | 'never'
  // Legacy values (pre-8-point scale).
  | 'always'
  | 'often'
  | 'sometimes';

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

/**
 * Extended ILR — the learner-facing declaration form.
 *
 * Mirrors the printed "Extended ILR" pages of the OnBoarding-ILR document:
 * contact preferences, next of kin, eligibility, employer details, other
 * training, personal circumstances, programme understanding, additional
 * information, media consent and the learning declarations. The statutory
 * Learner Details capture (name / address / ethnicity / prior attainment)
 * is not part of this step.
 */
export interface IlrForm {
  contact: { byPost: boolean | null; byPhone: boolean | null; byEmail: boolean | null };
  nextOfKin: {
    fullName: string;
    relationship: string;
    email: string;
    phone: string;
    sameAddressAsLearner: boolean | null;
  };
  eligibility: {
    employedInEngland: boolean | null;
    countryOfResidence: string;
    ukEeaNational: boolean | null;
    nationality: string;
    residentPrev3Years: boolean | null;
    yearsInUk?: number;
    requiresWorkPermit: boolean | null;
    evidenceDescription: string;
    evidenceFiles: string[];
  };
  employer: {
    organisationName: string;
    postcode: string;
    address: string;
    city: string;
    lineManagerName: string;
    lineManagerEmail: string;
    lineManagerPhone: string;
  };
  otherTraining: { attended12m: boolean | null; completedWhen: string };
  circumstances: { caringResponsibilities: string; other: string; careLeaver: boolean | null };
  understanding: { programmeUnderstanding: string; careerProgression: string };
  additional: { aged16to18: boolean | null; aged19to24: boolean | null };
  media: { consent: boolean | null };
  declarations: {
    plrShared: boolean | null;
    dfeContact: boolean | null;
    epaoDetails: boolean | null;
    kbcHoldsCerts: boolean | null;
    infoAccurate: boolean | null;
    over50PercentEngland: boolean | null;
    wageRateBand: string;
    knownByOtherName: boolean | null;
    plrAccessAware: boolean | null;
  };
  /** Learning declaration signature block (learner). */
  learnerSignature: { firstNames: string; surname: string; signatureUrl?: string; date: string };
  /** Provider / sub-contractor declaration signature block. */
  providerSignature: { printName: string; signatureUrl?: string; date: string };
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
  { slug: 'ilr', label: 'Extended ILR' },
  { slug: 'plr', label: 'Personal Learning Record' },
  { slug: 'cv-job', label: 'CV / Job Description' },
  { slug: 'policies', label: 'Policies' },
  { slug: 'next-steps', label: 'Next Steps' },
];
