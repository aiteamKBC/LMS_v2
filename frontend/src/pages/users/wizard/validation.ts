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
import type { WizardDraft } from '../types';

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

/* ── Step 2 — Skills Radar ────────────────────────────────────────────── */
/**
 * Every rated KSB needs a level. The KSB list itself is fetched by the step from
 * the learner's programme profile, so it isn't available here — completeness is
 * measured against the assessments that exist, and a learner whose programme has
 * no authored competencies is not blocked on a step they cannot complete.
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

  // Additional information
  if (isUnanswered(i.additional.aged16to18)) out.push('Aged 16–18');
  if (isUnanswered(i.additional.aged19to24)) out.push('Aged 19–24');

  // Media consent
  if (isUnanswered(i.media.consent)) out.push('Media consent');

  // Declarations
  if (isUnanswered(i.declarations.plrShared)) out.push('Declaration — PLR shared');
  if (isUnanswered(i.declarations.dfeContact)) out.push('Declaration — DfE contact');
  if (isUnanswered(i.declarations.epaoDetails)) out.push('Declaration — EPAO details');
  if (isUnanswered(i.declarations.kbcHoldsCerts)) out.push('Declaration — KBC holds certificates');
  if (isUnanswered(i.declarations.infoAccurate)) out.push('Declaration — information accurate');
  if (isUnanswered(i.declarations.over50PercentEngland)) out.push('Declaration — over 50% in England');
  if (isBlank(i.declarations.wageRateBand)) out.push('Wage rate band');
  if (isUnanswered(i.declarations.knownByOtherName)) out.push('Known by another name');
  if (isUnanswered(i.declarations.plrAccessAware)) out.push('Aware provider will access PLR');

  // Learning declaration — the learner's own signature block. The provider
  // block is deliberately NOT required: staff countersign it after review.
  if (isBlank(i.learnerSignature.firstNames)) out.push('Declaration — first names');
  if (isBlank(i.learnerSignature.surname)) out.push('Declaration — surname');
  if (isBlank(i.learnerSignature.date)) out.push('Declaration — date');
  if (isBlank(i.learnerSignature.signatureUrl)) out.push('Learner signature');

  return out;
}

/* ── Step 4 — Personal Learning Record ────────────────────────────────── */
function plrMissing(d: WizardDraft): string[] {
  return isBlank(d.plr.uln) ? ['ULN'] : [];
}

/* ── Step 5 — CV / Job Description ────────────────────────────────────── */
/**
 * The CV upload and the free-text experience box are alternatives — the form
 * says "if you do not have a CV to upload, please list your experience" — so
 * one of the two satisfies the requirement.
 */
function cvJobMissing(d: WizardDraft): string[] {
  const cv = d.cvJob;
  const out: string[] = [];
  if (isBlank(cv.cvFile) && isBlank(cv.experienceText)) {
    out.push('CV upload or a description of your experience');
  }
  if (isBlank(cv.pmQualifications)) out.push('Project management qualifications');
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
 * Unfilled fields for one step, by WIZARD_STEPS index. Introduction (0) and
 * Next Steps (7) are read-only and always complete.
 */
export function missingForStep(stepIndex: number, draft: WizardDraft): string[] {
  switch (stepIndex) {
    case 1: return personalDetailsMissing(draft);
    case 2: return skillsRadarMissing(draft);
    case 3: return ilrMissing(draft);
    case 4: return plrMissing(draft);
    case 5: return cvJobMissing(draft);
    case 6: return policiesMissing(draft);
    default: return [];
  }
}

export function isStepComplete(stepIndex: number, draft: WizardDraft): boolean {
  return missingForStep(stepIndex, draft).length === 0;
}

/** Every unfilled field across the whole wizard, in step order. */
export function missingAcrossWizard(draft: WizardDraft, stepCount: number): MissingField[] {
  const out: MissingField[] = [];
  for (let i = 0; i < stepCount; i++) {
    for (const label of missingForStep(i, draft)) out.push({ stepIndex: i, label });
  }
  return out;
}
