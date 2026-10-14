import { Briefcase, GraduationCap, House, UserRound, type LucideIcon } from 'lucide-react';
import {
  EMPLOYMENT_STATUSES,
  PROGRAMMES,
  RESIDENCY_STATUSES,
  type ApplicationField,
  type ApprenticeshipApplication,
} from '@/api/apprenticeshipApplication';
import { SYSTEM_TIME_ZONE } from '@/lib/format';

/** What the form holds while it is being filled in: dates stay '' until chosen. */
export type Answers = Omit<ApprenticeshipApplication, 'fundedTrainingCompletedOn'> & { fundedTrainingCompletedOn: string };
export type Errors = Partial<Record<ApplicationField, string>>;

type Base = { label: string; hint?: string; required: boolean; shown?: (answers: Answers) => boolean };
export type Question =
  | (Base & { kind: 'text' | 'email' | 'tel'; key: ApplicationField; maxLength: number; autoComplete?: string })
  | (Base & { kind: 'date'; key: ApplicationField; autoComplete?: string })
  | (Base & { kind: 'choice'; key: ApplicationField; options: readonly string[] })
  | (Base & { kind: 'select'; key: ApplicationField; options: readonly string[] })
  | (Base & { kind: 'yesno'; key: ApplicationField });
export type Note = { kind: 'note'; text: string };

export interface Section {
  title: string;
  description: string;
  icon: LucideIcon;
  items: (Question | Note)[];
}

export const emptyAnswers = (): Answers => ({
  firstName: '', surname: '', workEmail: '', phoneNumber: '', fullAddress: '', postcode: '', dateOfBirth: '',
  employmentStatus: '', majorityHoursInEngland: null, employerName: '', employerAddress: '', employerPostcode: '',
  representativeName: '', representativeEmail: '',
  livesInUk: null, residenceNotForEducation: null, residencyStatus: '',
  programme: '', attendedFundedTraining: null, fundedTrainingCompletedOn: '', notPreviouslyCompletedProgramme: null,
});

// Wording and limits match the backend (enrolment_api/eligibility_form.py).
export const SECTIONS: Section[] = [
  {
    title: 'Personal Details',
    description: 'Please provide your personal information.',
    icon: UserRound,
    items: [
      { kind: 'text', key: 'firstName', label: 'First Name', hint: 'Please enter your legal first name', required: true, maxLength: 100, autoComplete: 'given-name' },
      { kind: 'text', key: 'surname', label: 'Surname', hint: 'Please enter your legal surname', required: true, maxLength: 100, autoComplete: 'family-name' },
      { kind: 'email', key: 'workEmail', label: 'Work Email Address', hint: 'Please enter your email address within your organisation domain', required: true, maxLength: 254, autoComplete: 'work email' },
      { kind: 'tel', key: 'phoneNumber', label: 'Phone Number', hint: 'Enter your contact phone number.', required: false, maxLength: 40, autoComplete: 'tel' },
      { kind: 'text', key: 'fullAddress', label: 'Full Address', hint: 'Enter your full address', required: true, maxLength: 500, autoComplete: 'street-address' },
      { kind: 'text', key: 'postcode', label: 'Postcode', hint: 'Enter your postcode', required: true, maxLength: 12, autoComplete: 'postal-code' },
      { kind: 'date', key: 'dateOfBirth', label: 'Date of Birth', hint: 'Please enter your date of birth (You must be 16 or over to be eligible)', required: true, autoComplete: 'bday' },
    ],
  },
  {
    title: 'Employment',
    description: 'Tell us about your current employment situation.',
    icon: Briefcase,
    items: [
      { kind: 'choice', key: 'employmentStatus', label: 'Your Employment Status:', hint: 'Choose your employment status', required: true, options: EMPLOYMENT_STATUSES },
      {
        kind: 'yesno',
        key: 'majorityHoursInEngland',
        label: 'Could you confirm whether you expect to spend more than 50% of your working hours in England? (The measure of 50% should exclude any time expected to be spent outside of England in remote and/or hybrid working)',
        hint: 'Choose your answer',
        required: true,
      },
      { kind: 'text', key: 'employerName', label: 'Employer', hint: 'Please enter your current company name', required: true, maxLength: 200, autoComplete: 'organization' },
      { kind: 'text', key: 'employerAddress', label: 'Employer Full Address', hint: "Please enter your company's address", required: true, maxLength: 500 },
      { kind: 'text', key: 'employerPostcode', label: 'Employer Postcode', hint: "Please enter your company's postcode", required: true, maxLength: 12 },
      {
        kind: 'note',
        text: 'Please provide the details of a representative who will support you with your application. This could be your Head of Apprenticeships, HR representative, Finance contact, or Manager.',
      },
      { kind: 'text', key: 'representativeName', label: 'Employer Representative Name', required: true, maxLength: 200 },
      { kind: 'email', key: 'representativeEmail', label: 'Employer Representative Email', required: true, maxLength: 254 },
    ],
  },
  {
    title: 'Residency',
    description: 'Help us assess your residency status for apprenticeship funding.',
    icon: House,
    items: [
      { kind: 'yesno', key: 'livesInUk', label: 'Do you currently live in United Kingdom?', hint: 'You must be living in England to be eligible for funding.', required: true },
      {
        kind: 'yesno',
        key: 'residenceNotForEducation',
        label: 'Please confirm that your ordinary residence in the UK for the last 3 years has not been mainly or wholly for the purpose of full-time education.',
        required: true,
      },
      { kind: 'select', key: 'residencyStatus', label: 'Please provide your residency status?', hint: 'Select the option that best describes your residency status.', required: true, options: RESIDENCY_STATUSES },
    ],
  },
  {
    title: 'Programme Suitability',
    description: 'Please briefly explain how the programme aligns with your role, experience, and career goals.',
    icon: GraduationCap,
    items: [
      { kind: 'select', key: 'programme', label: 'Choose Your Applying Programme', hint: 'You must confirm before submitting your application.', required: true, options: PROGRAMMES },
      { kind: 'yesno', key: 'attendedFundedTraining', label: 'Have you attended any other government funded training programmes in the last 12 months?', required: true },
      { kind: 'date', key: 'fundedTrainingCompletedOn', label: 'When was it completed?', required: true, shown: answers => answers.attendedFundedTraining === true },
      { kind: 'yesno', key: 'notPreviouslyCompletedProgramme', label: 'Please confirm that you have not previously completed this programme as part of a funded apprenticeship.', required: true },
    ],
  },
];

/** Today in the business time zone, as the YYYY-MM-DD a date input expects. */
export const businessToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REQUIRED = 'This field is required.';

export const isQuestion = (item: Question | Note): item is Question => item.kind !== 'note';
export const isShown = (question: Question, answers: Answers) => !question.shown || question.shown(answers);

export function validateSection(section: Section, answers: Answers, today = businessToday()): Errors {
  const errors: Errors = {};
  for (const question of section.items.filter(isQuestion)) {
    if (!isShown(question, answers)) continue;
    const value = answers[question.key];
    const empty = value === null || (typeof value === 'string' && !value.trim());
    if (empty) {
      if (question.required) errors[question.key] = REQUIRED;
      continue;
    }
    if (question.kind === 'email' && !EMAIL.test(String(value).trim())) {
      errors[question.key] = 'Enter a valid email address.';
    } else if (question.kind === 'date') {
      const date = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01') errors[question.key] = 'Enter a valid date.';
      else if (date > today) errors[question.key] = 'The date cannot be in the future.';
    }
  }
  return errors;
}

/** The body the backend expects. A hidden completion date is never sent. */
export function toPayload(answers: Answers): ApprenticeshipApplication {
  return {
    ...answers,
    fundedTrainingCompletedOn: answers.attendedFundedTraining === true ? answers.fundedTrainingCompletedOn || null : null,
  };
}
