// ============================================================================
// Question wording for the three enrolment reviews.
//
// Kept in its own module (rather than inside form.tsx) so the PDF export can be
// triggered from the staff board without importing the whole form page.
// ============================================================================

export interface ReviewQuestion {
  key: string;
  label: string;
  /** Free text rather than Yes/No. */
  type?: 'text';
}

// ---- Eligibility Review & FS Discussion ----
export const ILR_QUESTIONS: ReviewQuestion[] = [
  { key: 'over16', label: 'Is the apprentice over 16 years old at the start of the programme?' },
  { key: 'withinContractTime', label: 'Can the apprentice complete their apprenticeship within the time they have available within their contract of employment?' },
  { key: 'payeScheme', label: 'Is apprentice employed and on the PAYE scheme either directly by you, a connected company, or charity as defined by HMRC?' },
];

export const EXTENDED_ILR_QUESTIONS: ReviewQuestion[] = [
  { key: 'eligibleResidency', label: 'Does the apprentice have an eligible residency status?' },
  { key: 'identityDocumentsSeen', label: 'Have you seen suitable identity documents and/or immigration permission' },
  { key: 'eligibilityEvidence', label: 'What evidence has been seen to confirm eligibility?', type: 'text' },
  { key: 'rightToWorkEngland', label: 'Does the apprentice have the right to work in England?' },
  { key: 'fiftyPercentEngland', label: 'Does the apprentice spend at least 50% of their working hours in England over the duration of the apprenticeship?' },
  { key: 'minimumWage', label: 'Is the apprentice paid at least the minimum wage appropriate to their age and apprenticeship?' },
];

export const FS_JOB_ROLE_QUESTIONS: ReviewQuestion[] = [
  { key: 'holdsLevel2', label: 'Does the apprentice hold an approved qualification for both Level 2 English & maths Functional Skills or equivalent?' },
  { key: 'levelMatchesRole', label: 'Please confirm that the apprenticeship selected matches the level of the role(s) underpinned by this apprenticeship and outlined in their role description' },
  { key: 'productivePurpose', label: "Please confirm that the apprentice's job role has a productive purpose and that there is a direct link between this job role and the chosen apprenticeship standard" },
  { key: 'ksbExposure', label: 'Please confirm that you will provide the individual with the exposure to the Knowledge, Skills & Behaviours - KSBs, and appropriate support & supervision to carry out both their job role and their apprenticeship, particularly where the apprentice is working flexibly, including working from home' },
  { key: 'releaseForOtj', label: 'Please confirm that you will release the apprentice for off-the-job training as required by the training plan including English and maths training if required.' },
  { key: 'embedOtj', label: 'Please confirm that you will provide the apprentice with the opportunity to embed and consolidate the knowledge, skills, and behaviours gained through off-the-job training into the workplace.' },
  { key: 'warningAreas', label: 'Are there any warning areas in the statements above that require further justification or evidence?' },
];

// ---- RPL And Experience ----
export const RPL_QUESTIONS: ReviewQuestion[] = [
  { key: 'apprenticeshipAppropriate', label: 'Have all parties agreed that an apprenticeship is the most appropriate training programme for the individual' },
  { key: 'planAlignsStandard', label: 'Have all parties agreed that the learning plan aligns with the chosen standard and level' },
  { key: 'priorEducation', label: 'Is there any prior education, training or associated qualifications in a related subject area, including previous apprenticeships undertaken that need to be taken into consideration for this apprenticeship?' },
  { key: 'priorWorkExperience', label: 'Is there any learning or competence gained from prior work experience, particularly where the apprentice is an existing employee, or is beginning their apprenticeship after completing another programme with a relevant work placement that need to be taken into consideration for this apprenticeship?' },
  { key: 'planNeedsAdjusting', label: 'As a result of the above, does the training plan need to be adjusted to take into account prior learning and experience' },
];

// ---- Workplace Health & Safety Declaration ----
export const HEALTH_SAFETY_QUESTIONS: ReviewQuestion[] = [
  { key: 'basicArrangements', label: 'We have basic health and safety arrangements in place and we manage workplace risks.' },
  { key: 'dayOneInduction', label: 'The apprentice will receive a day-one induction (including emergency arrangements and how to report concerns).' },
  { key: 'fireSafety', label: 'We have fire safety/emergency arrangements and staff know what to do.' },
  { key: 'firstAid', label: 'We have first aid arrangements (trained first aider(s) and a first aid kit available).' },
  { key: 'supervision', label: 'The apprentice will have appropriate supervision and a named line manager/supervisor.' },
  { key: 'ppe', label: 'We will provide any necessary PPE and training for the apprentice role (where applicable).' },
  { key: 'accidentRecording', label: 'We record and investigate accidents/incidents/near misses and will inform KBC of any serious incident.' },
  { key: 'informChanges', label: 'We will inform KBC if anything important changes (e.g., new site address, change of role, new hazards).' },
  { key: 'hsPolicy', label: 'Do you have a short H&S policy/statement (or similar)?' },
  { key: 'liabilityInsurance', label: "Do you have an Employer's Liability Insurance certificate (and Public Liability if applicable)?" },
];

/**
 * Every question's on-screen wording, keyed by answer key. The PDF export uses
 * this so the document reads like the form rather than like the stored JSON.
 */
export const REVIEW_QUESTION_LABELS: Record<string, string> = Object.fromEntries(
  [
    ...ILR_QUESTIONS,
    ...EXTENDED_ILR_QUESTIONS,
    ...FS_JOB_ROLE_QUESTIONS,
    ...RPL_QUESTIONS,
    ...HEALTH_SAFETY_QUESTIONS,
  ].map((q) => [q.key, q.label]),
);
