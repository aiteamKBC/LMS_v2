/**
 * Wizard completeness rules — every step must be filled before the enrolment
 * can be submitted.
 *
 * "Required" here means *everything the learner can actually answer*. Purely
 * conditional follow-ups are skipped when their trigger answer wasn't given
 * (asking a UK national for a work permit is a dead end), and the provider
 * declaration is excluded because staff countersign it later — a learner cannot
 * sign it themselves, so requiring it would make submission impossible.
 *
 * Steps are validated by index, matching WIZARD_STEPS.
 */
import { POLICY_DOCS_KBC } from '@/mocks/enrolment-console';
import { formatError } from './steps/fields';
import { WIZARD_STEPS, type WizardDraft } from '../types';

/** One unfilled field, named so the UI can point the learner straight at it. */
export interface MissingField {
  /** Index into WIZARD_STEPS. */
  stepIndex: number;
  /** Human label, as shown on the form. */
  label: string;
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Typed fields must also be well-formed, not merely non-empty — `type="email"`
 * and `type="tel"` do not enforce anything outside a native form submit, so
 * "w" would otherwise satisfy both. Shares formatError with the input itself so
 * the inline message and the blocking rule can never disagree.
 */
function badFormat(type: 'email' | 'tel', value: string | undefined, label: string): string | null {
  if (isBlank(value)) return null; // missing is reported by the required check
  return formatError(type, String(value)) ? `${label} — ${formatError(type, String(value))}` : null;
}

/** A Yes/No question is answered when it is true or false — never null. */
const isUnanswered = (v: boolean | null | undefined): boolean => v !== true && v !== false;

/* ── Step 1 — Personal Details ────────────────────────────────────────── */
function personalDetailsMissing(d: WizardDraft): string[] {
  const pd = d.personalDetails;
  const out: string[] = [];
  if (isBlank(pd.firstName)) out.push('First Name');
  if (isBlank(pd.lastName)) out.push('Last Name');
  if (isBlank(pd.email)) out.push('Email');
  else { const e = badFormat('email', pd.email, 'Email'); if (e) out.push(e); }
  if (isBlank(pd.phone)) out.push('Phone');
  else { const e = badFormat('tel', pd.phone, 'Phone'); if (e) out.push(e); }
  if (isBlank(pd.address)) out.push('Address');
  if (isBlank(pd.dob)) out.push('Date of Birth');
  if (pd.age == null || Number.isNaN(pd.age)) out.push('Age');
  if (isBlank(pd.sex)) out.push('Sex');
  if (isBlank(pd.signature)) out.push('Your signature');
  return out;
}

/* ── ILR Learner Details ───────────────────────────────────────────────── */
// Same loose check as the input (steps/IlrLearnerDetails.tsx).
const NI_RE = /^[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i;

/** The ILR step's missing label for its certification signature. */
export const ILR_SIGNATURE_LABEL = 'Declaration signature';

export function ilrDetailsMissing(d: WizardDraft): string[] {
  const i = d.ilrDetails;
  // Drafts saved before this step existed have no section at all.
  if (!i) return ['Postcode prior to enrolment'];
  const out: string[] = [];
  if (isBlank(i.postcodePriorToEnrolment)) out.push('Postcode prior to enrolment');
  // An NI number, or confirmation that the learner has applied for one.
  if (isBlank(i.niNumber)) {
    if (i.niApplied !== true) out.push('National Insurance number, or confirm you have applied for one');
  } else if (!NI_RE.test(i.niNumber.trim())) {
    out.push('National Insurance number — enter a valid number, for example AB 12 34 56 C');
  }
  if (isBlank(i.legalSex)) out.push('Legal Sex');
  if (isBlank(i.ethnicity)) out.push('Ethnicity');
  if (isUnanswered(i.longTermDisability)) out.push('Long-term disability, health problem or learning difficulty');
  if (isBlank(i.highestQualification)) out.push('Highest qualification achieved');
  if (isBlank(i.employmentStatus)) out.push('Employment status');
  // Only asked of learners in paid employment.
  if (i.employmentStatus === 'In paid employment' && isBlank(i.employmentStartDate)) out.push('Start date with employer');
  if (isUnanswered(i.fullTimeEducation)) out.push('Full-time education or training');
  if (isBlank(i.signature)) out.push(ILR_SIGNATURE_LABEL);
  return out;
}

/* ── Step 2 — Skills Radar ────────────────────────────────────────────── */
/**
 * Every KSB needs a level. The KSB list itself is fetched by the step from the
 * learner's programme profile, so it isn't available here — completeness is
 * measured against the assessments in the draft, which the step seeds with an
 * unrated row per competency as soon as it loads the profile. A learner whose
 * programme has no authored competencies has nothing to seed, and so is not
 * blocked on a step they cannot complete.
 */
function skillsRadarMissing(d: WizardDraft): string[] {
  const rows = Object.values(d.skillsRadar.assessments ?? {});
  const unrated = rows.filter((a) => a.level == null).length;
  return unrated > 0
    ? [`${unrated} ${unrated === 1 ? 'competency' : 'competencies'} not yet rated`]
    : [];
}

/* ── Step 3 — Extended ILR ────────────────────────────────────────────── */
function ilrMissing(d: WizardDraft): string[] {
  const i = d.ilr;
  const out: string[] = [];

  // Contact preferences
  if (isUnanswered(i.contact.byPost)) out.push('Contact by post');
  if (isUnanswered(i.contact.byPhone)) out.push('Contact by phone');
  if (isUnanswered(i.contact.byEmail)) out.push('Contact by e-mail');

  // Next of kin
  if (isBlank(i.nextOfKin.fullName)) out.push('Next of kin — full name');
  if (isBlank(i.nextOfKin.relationship)) out.push('Next of kin — relationship');
  if (isBlank(i.nextOfKin.email)) out.push('Next of kin — email');
  else { const e = badFormat('email', i.nextOfKin.email, 'Next of kin — email'); if (e) out.push(e); }
  if (isBlank(i.nextOfKin.phone)) out.push('Next of kin — phone');
  else { const e = badFormat('tel', i.nextOfKin.phone, 'Next of kin — phone'); if (e) out.push(e); }
  if (isUnanswered(i.nextOfKin.sameAddressAsLearner)) out.push('Next of kin — same address');
  if (i.nextOfKin.sameAddressAsLearner === false) {
    if (isBlank(i.nextOfKin.postcode)) out.push('Next of kin — postcode');
    if (isBlank(i.nextOfKin.address)) out.push('Next of kin — address');
  }

  // Eligibility
  if (isUnanswered(i.eligibility.employedInEngland)) out.push('Employed in England');
  if (isBlank(i.eligibility.countryOfResidence)) out.push('Country of residence');
  if (isUnanswered(i.eligibility.ukEeaNational)) out.push('UK / EEA national');
  if (isBlank(i.eligibility.nationality)) out.push('Nationality');
  if (isUnanswered(i.eligibility.residentPrev3Years)) out.push('Resident for the previous 3 years');
  // Only asked of learners who have NOT been resident for 3 years.
  if (i.eligibility.residentPrev3Years === false && i.eligibility.yearsInUk == null) {
    out.push('Years in the UK');
  }
  // Only asked of non-UK/EEA nationals.
  if (i.eligibility.ukEeaNational === false && isUnanswered(i.eligibility.requiresWorkPermit)) {
    out.push('Requires a work permit');
  }

  // Employer
  if (isBlank(i.employer.organisationName)) out.push('Employer — organisation name');
  if (isBlank(i.employer.postcode)) out.push('Employer — postcode');
  if (isBlank(i.employer.address)) out.push('Employer — address');
  if (isBlank(i.employer.city)) out.push('Employer — city');
  if (isBlank(i.employer.lineManagerName)) out.push('Line manager — name');
  if (isBlank(i.employer.lineManagerEmail)) out.push('Line manager — email');
  else { const e = badFormat('email', i.employer.lineManagerEmail, 'Line manager — email'); if (e) out.push(e); }
  if (isBlank(i.employer.lineManagerPhone)) out.push('Line manager — phone');
  else { const e = badFormat('tel', i.employer.lineManagerPhone, 'Line manager — phone'); if (e) out.push(e); }

  // Other training — the date is only asked of those who attended.
  if (isUnanswered(i.otherTraining.attended12m)) out.push('Other training in the last 12 months');
  if (i.otherTraining.attended12m === true && isBlank(i.otherTraining.completedWhen)) {
    out.push('Other training — when completed');
  }

  // Personal circumstances
  if (isBlank(i.circumstances.caringResponsibilities)) out.push('Caring responsibilities');
  if (isUnanswered(i.circumstances.careLeaver)) out.push('Care leaver');

  // Understanding
  if (isBlank(i.understanding.programmeUnderstanding)) out.push('Understanding of the programme');
  if (isBlank(i.understanding.careerProgression)) out.push('Career progression');

  // Additional Information. It replaced the age questions, media consent, the
  // other declarations and both signature blocks, so none of those is required
  // any more. Read defensively: answers saved before the section existed have
  // no `additionalInformation` until the wizard's defaults are merged in.
  const ai = i.additionalInformation;
  if (isBlank(ai?.jobRoleRelevance)) out.push('Job role and the programme');
  if (isBlank(ai?.residenceNotForFullTimeEducation)) out.push('Residence not for full-time education');
  if (isBlank(ai?.ehcp)) out.push('EHCP');
  if (isUnanswered(i.declarations.over50PercentEngland)) out.push('Declaration — over 50% in England');
  if (isBlank(i.declarations.wageRateBand)) out.push('Wage rate band');
  if (isUnanswered(i.declarations.knownByOtherName)) out.push('Known by another name');
  if (isUnanswered(i.declarations.plrAccessAware)) out.push('Aware provider will access PLR');

  return out;
}

/* ── Step 4 — Personal Learning Record ────────────────────────────────── */
/**
 * Nothing is required: the ULN is no longer asked, and a learner may have no
 * prior learning to record. Each entry's own required fields are checked by the
 * Add/Edit PLR form before it is saved.
 */
function plrMissing(_d: WizardDraft): string[] {
  return [];
}

/* ── Step 5 — CV / Job Description ────────────────────────────────────── */
/**
 * The experience box is always answered — the form asks for "N/A" when a CV was
 * uploaded — so it alone stands for "CV or experience". Uploads are not in the
 * draft (they are stored in Azure), so none of them is required here. The
 * project management question is no longer asked.
 */
function cvJobMissing(d: WizardDraft): string[] {
  const cv = d.cvJob;
  const out: string[] = [];
  if (isBlank(cv.experienceText)) out.push('Previous experience (or N/A)');
  if (isBlank(cv.highestQualification)) out.push('Highest-level qualification');
  if (isBlank(cv.highestQualificationField)) out.push('Field of highest qualification');
  if (isUnanswered(cv.hasFieldQualification)) out.push('Qualifications in your programme field');
  if (cv.hasFieldQualification === true && isBlank(cv.highestFieldQualification)) {
    out.push('Highest qualification in your programme field');
  }
  if (isUnanswered(cv.gcseEnglish)) out.push('GCSE in English');
  if (isUnanswered(cv.gcseMaths)) out.push('GCSE in Maths');
  if (isBlank(cv.functionalSkillsEnrol)) out.push('Functional Skills enrolment');
  return out;
}

/* ── Step 6 — Policies ────────────────────────────────────────────────── */
function policiesMissing(d: WizardDraft): string[] {
  const ack = d.policies.acknowledged ?? {};
  const outstanding = POLICY_DOCS_KBC.filter((doc) => !ack[doc.id]).length;
  return outstanding > 0
    ? [`${outstanding} ${outstanding === 1 ? 'document' : 'documents'} not acknowledged`]
    : [];
}

/**
 * Unfilled fields for one step, by WIZARD_STEPS index. Matched on the step's
 * slug rather than its position, so adding a step cannot shift which rules
 * apply to which step. Introduction, Before You Begin and Next Steps are
 * read-only and always complete.
 */
export function missingForStep(stepIndex: number, draft: WizardDraft): string[] {
  switch (WIZARD_STEPS[stepIndex]?.slug) {
    case 'personal-details': return personalDetailsMissing(draft);
    case 'ilr-details': return ilrDetailsMissing(draft);
    case 'skills-radar': return skillsRadarMissing(draft);
    case 'ilr': return ilrMissing(draft);
    case 'plr': return plrMissing(draft);
    case 'cv-job': return cvJobMissing(draft);
    case 'policies': return policiesMissing(draft);
    default: return [];
  }
}

export function isStepComplete(stepIndex: number, draft: WizardDraft): boolean {
  return missingForStep(stepIndex, draft).length === 0;
}

/**
 * First step that still has unfilled fields, or -1 when the whole wizard is
 * complete. Drives the learner's step gating: they may not run ahead of it.
 */
export function firstIncompleteStep(draft: WizardDraft, stepCount: number): number {
  for (let i = 0; i < stepCount; i++) {
    if (!isStepComplete(i, draft)) return i;
  }
  return -1;
}

/**
 * Furthest step a learner is allowed to open: the first incomplete one (they
 * must be able to reach the step they still have to fill in), or the last step
 * once nothing is outstanding. Steps behind it stay open for review/editing.
 */
export function maxReachableStep(draft: WizardDraft, stepCount: number): number {
  const gap = firstIncompleteStep(draft, stepCount);
  return gap === -1 ? stepCount - 1 : gap;
}

/** Every unfilled field across the whole wizard, in step order. */
export function missingAcrossWizard(draft: WizardDraft, stepCount: number): MissingField[] {
  const out: MissingField[] = [];
  for (let i = 0; i < stepCount; i++) {
    for (const label of missingForStep(i, draft)) out.push({ stepIndex: i, label });
  }
  return out;
}
