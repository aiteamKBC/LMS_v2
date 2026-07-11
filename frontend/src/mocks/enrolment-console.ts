// ============================================================================
// Enrolment Console — reference/config data (frontend only)
// User rows and boards come from the API (see src/api/enrolmentUsers.ts); this
// file holds only static reference data the wizard needs (KSBs, RAG levels,
// policy docs, select option lists).
// ============================================================================
import type {
  Ksb,
  PolicyDoc,
  RagLevel,
} from '@/pages/users/types';

// ---- RAG levels meta (Skills Radar) — best → worst ----
export interface RagLevelMeta {
  level: RagLevel;
  label: string;
  help: string;
  cellFill: string; // filled radar cell
  dot: string; // corner marker
  tintBg: string;
  tintBorder: string;
  tintText: string;
}

export const RAG_LEVELS: RagLevelMeta[] = [
  { level: 'always', label: 'Always', help: 'I do not need any training as I am fully competent and can evidence my abilities.', cellFill: 'bg-blue-500', dot: 'bg-blue-500', tintBg: 'bg-blue-50', tintBorder: 'border-blue-300', tintText: 'text-blue-700' },
  { level: 'often', label: 'Often', help: 'I am confident in my ability but would benefit from further training to be fully competent.', cellFill: 'bg-emerald-500', dot: 'bg-emerald-500', tintBg: 'bg-emerald-50', tintBorder: 'border-emerald-300', tintText: 'text-emerald-700' },
  { level: 'sometimes', label: 'Sometimes', help: 'I have limited experience and need further training.', cellFill: 'bg-amber-400', dot: 'bg-amber-400', tintBg: 'bg-amber-50', tintBorder: 'border-amber-300', tintText: 'text-amber-700' },
  { level: 'rarely', label: 'Rarely', help: 'I have some basic experience but still need training.', cellFill: 'bg-orange-500', dot: 'bg-orange-500', tintBg: 'bg-orange-50', tintBorder: 'border-orange-300', tintText: 'text-orange-700' },
  { level: 'never', label: 'Never', help: 'I have no experience and need training.', cellFill: 'bg-red-500', dot: 'bg-red-500', tintBg: 'bg-red-50', tintBorder: 'border-red-300', tintText: 'text-red-700' },
];

// ---- Skills Radar: PCP Level 6 KSB dataset ----
export const PCP_STANDARD = { id: 'pcp-l6', label: 'Project Controls Professional Level 6' };

export const PCP_KSBS: Ksb[] = [
  // Strategic Project Management
  { id: 'PCP-K1', theme: 'Strategic Project Management', kind: 'Knowledge', codes: ['K1'], title: 'Organisational and business strategies' },
  { id: 'PCP-K30', theme: 'Strategic Project Management', kind: 'Knowledge', codes: ['K30'], title: 'Leadership strategies' },
  { id: 'PCP-B3B4', theme: 'Strategic Project Management', kind: 'Behaviour', codes: ['B3', 'B4'], title: 'Commercial astuteness; Pre-emptive thinking' },
  // Scope
  { id: 'PCP-K2K6', theme: 'Scope', kind: 'Knowledge', codes: ['K2', 'K6'], title: 'Principles of project control and project life cycle; Breakdown and coding structures' },
  { id: 'PCP-S18S20', theme: 'Scope', kind: 'Skill', codes: ['S18', 'S20'], title: 'Preparing estimating framework; Preparing planning and scheduling strategic frameworks' },
  // Time & Cost
  { id: 'PCP-K22K23K20', theme: 'Time & Cost', kind: 'Knowledge', codes: ['K22', 'K23', 'K20'], title: 'Planning and scheduling practice; Modelling techniques; Estimating techniques' },
  { id: 'PCP-S23S21S19', theme: 'Time & Cost', kind: 'Skill', codes: ['S23', 'S21', 'S19'], title: 'Applying cost engineering practice; Creating credible control schedules; Evidence-based estimating' },
  // Integration & CMS
  { id: 'PCP-K7K8', theme: 'Integration & CMS', kind: 'Knowledge', codes: ['K7', 'K8'], title: 'Project Control Plans and reporting frameworks; Strategic principles of change management systems' },
  { id: 'PCP-S28S26', theme: 'Integration & CMS', kind: 'Skill', codes: ['S28', 'S26'], title: 'Steering project controls functions and mentoring team members; Identifying and explaining integration' },
  // Quality
  { id: 'PCP-K21K31', theme: 'Quality', kind: 'Knowledge', codes: ['K21', 'K31'], title: 'Assurance techniques; Continuous improvement' },
  { id: 'PCP-S29', theme: 'Quality', kind: 'Skill', codes: ['S29'], title: 'Applying continuous improvement approaches' },
  { id: 'PCP-B9', theme: 'Quality', kind: 'Behaviour', codes: ['B9'], title: 'Innovation; learning from innovative solutions and seeking out new ideas to deliver' },
  // Risk and Health & Safety
  { id: 'PCP-K15K18', theme: 'Risk and Health & Safety', kind: 'Knowledge', codes: ['K15', 'K18'], title: 'Risk management and risk process; Environmental impact and sustainability' },
  { id: 'PCP-B1', theme: 'Risk and Health & Safety', kind: 'Behaviour', codes: ['B1'], title: 'Safety culture' },
  { id: 'PCP-S14S9', theme: 'Risk and Health & Safety', kind: 'Skill', codes: ['S14', 'S9'], title: 'Risk management and analysis; Ensuring project control work adheres to standards' },
  // Communication and Engagement
  { id: 'PCP-K14', theme: 'Communication and Engagement', kind: 'Knowledge', codes: ['K14'], title: 'Approaches to communicating with stakeholders' },
  { id: 'PCP-S27S13', theme: 'Communication and Engagement', kind: 'Skill', codes: ['S27', 'S13'], title: 'Communicating and justifying conclusions and recommendations; Identifying stakeholders' },
  { id: 'PCP-B8', theme: 'Communication and Engagement', kind: 'Behaviour', codes: ['B8'], title: 'Collaboration; interacting within a wide, multi-disciplinary team' },
  // Procurement and Contracting
  { id: 'PCP-K18K19', theme: 'Procurement and Contracting', kind: 'Knowledge', codes: ['K18', 'K19'], title: 'Commercial matters; Key principles of invitations to tender' },
  { id: 'PCP-S16S17', theme: 'Procurement and Contracting', kind: 'Skill', codes: ['S16', 'S17'], title: 'Commercial matters and subcontractor/supplier performance management' },
];

// ---- Policies (Tab 8) ----
export const POLICY_DOCS_KBC: PolicyDoc[] = [
  'Apprentice Attendance and Engagement Policy Kent Business College.pdf',
  'BUSINESS CONTINUITY POLICY KENT BUSINESS COLLEGE.pdf',
  'COMPLAINT PROCEDURES POLICY KENT BUSINESS COLLEGE.pdf',
  'HARASSMENT AND BULLYING POLICY KENT BUSINESS COLLEGE.pdf',
  'Health and Safety Handbook Kent Business College.pdf',
  'Introduction to British Values Kent Business College.pdf',
  'Introduction to Equality, Diversity _ Inclusion Kent Business College.pdf',
  'Introduction to Safeguarding and Prevent Kent Business College.pdf',
  'Learner Code of Conduct Kent Business College.pdf',
  'Manager_Handbook Kent Business College.pdf',
  'Safeguarding and Prevent Handbook Kent Business College.pdf',
].map((label, i) => ({ id: `kbc-${i}`, label, url: '#', requiresAck: true }));

export const POLICY_DOCS_IBIS: PolicyDoc[] = [
  'Health and Safety Handbook IBIS.pdf',
  'HARASSMENT AND BULLYING POLICY IBIS.pdf',
  'COMPLAINT PROCEDURES POLICY IBIS.pdf',
  'BUSINESS CONTINUITY POLICY IBIS.pdf',
  'Safeguarding and Prevent Handbook IBIS.pdf',
  'Learner Code of Conduct IBIS.pdf',
  'Introduction to Safeguarding _ PREVENT IBIS.pdf',
  'Introduction to Equality, Diversity _ Inclusion IBIS.pdf',
  'Introduction to British Values IBIS.pdf',
  'Apprentice Attendance and Engagement Policy IBIS.pdf',
].map((label, i) => ({ id: `ibis-${i}`, label, url: '#', requiresAck: false }));

// ---- Option lists (selects) ----
export const ETHNICITY_OPTIONS = [
  '31 - English / Welsh / Scottish / Northern Irish / British',
  '32 - Irish',
  '33 - Any other White background',
  '34 - Any other White background',
  '35 - White and Black Caribbean',
  '36 - White and Black African',
  '37 - White and Asian',
  '38 - Any other Mixed background',
  '39 - Indian',
  '40 - Pakistani',
  '41 - Bangladeshi',
  '42 - Chinese',
  '43 - Any other Asian background',
  '44 - African',
  '45 - Caribbean',
  '46 - Any other Black background',
  '47 - Arab',
  '98 - Any other ethnic group',
];

export const COUNTRY_OPTIONS = ['United Kingdom', 'Ireland', 'France', 'Germany', 'Spain', 'Italy', 'Poland', 'Romania', 'Egypt', 'India', 'Nigeria', 'Other'];
export const NATIONALITY_OPTIONS = ['British', 'Irish', 'French', 'German', 'Spanish', 'Italian', 'Polish', 'Romanian', 'Egyptian', 'Indian', 'Nigerian', 'Other'];
export const SEX_OPTIONS = ['Male', 'Female', 'Prefer not to say'];
export const GENDER_IDENTITY_OPTIONS = ['Man', 'Woman', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'];
export const WAGE_BAND_OPTIONS = [
  'National Living Wage (23 and over)',
  'National Minimum Wage (21 to 22)',
  'National Minimum Wage (18 to 20)',
  'Apprentice rate',
  'Other',
];
export const YES_NO_SELECT = ['Yes', 'No'];
export const CASE_OWNER_OPTIONS = ['Ayman Badewi', 'Amgad Badewi', 'Afaan Khan', 'Adeyemi Adeshina'];
