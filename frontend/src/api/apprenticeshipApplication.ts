// The public apprenticeship eligibility form (/apprenticeship_application).
// Applicants have no account yet, so nothing here sends cookies; the backend
// requires only the X-Requested-With header (its CSRF defence for public JSON).
// Nothing is saved until the applicant submits: there is no draft.

export const EMPLOYMENT_STATUSES = [
  'In paid employment',
  'Self employment',
  'Not in paid employment, looking for work and available to start work',
  'Not in paid employment, not looking for work and/or not available to start work',
] as const;

export const RESIDENCY_STATUSES = [
  'UK Citizen',
  'Settled Status',
  'Pre-settled Status',
  'Skilled Worker Visa',
  'Study or Graduate Visa',
  'Other',
] as const;

export const PROGRAMMES = [
  'Marketing Executive Level 4',
  'Marketing Manager Level 6',
  'Associate Project Manager Level 4',
  'Project Controls Professional Level 6',
] as const;

export interface ApprenticeshipApplication {
  firstName: string;
  surname: string;
  workEmail: string;
  phoneNumber: string;
  fullAddress: string;
  postcode: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  employmentStatus: string;
  majorityHoursInEngland: boolean | null;
  employerName: string;
  employerAddress: string;
  employerPostcode: string;
  representativeName: string;
  representativeEmail: string;
  livesInUk: boolean | null;
  residenceNotForEducation: boolean | null;
  residencyStatus: string;
  programme: string;
  attendedFundedTraining: boolean | null;
  /** YYYY-MM-DD; only sent after a Yes to attendedFundedTraining. */
  fundedTrainingCompletedOn: string | null;
  notPreviouslyCompletedProgramme: boolean | null;
}

export type ApplicationField = keyof ApprenticeshipApplication;

export class ApplicationSubmitError extends Error {
  readonly status: number;
  /** The server's message per answer it refused, keyed by field. */
  readonly fields: Partial<Record<ApplicationField, string>>;
  constructor(message: string, status: number, fields: Partial<Record<ApplicationField, string>> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const url = '/enrolment_api/public/apprenticeship-application/';

export async function submitApprenticeshipApplication(body: ApprenticeshipApplication): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApplicationSubmitError('We could not reach the application service. Check your connection and try again.', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.submitted !== true) {
    throw new ApplicationSubmitError(
      data?.error || 'We could not submit your application. Please try again.',
      response.status,
      data?.fields && typeof data.fields === 'object' ? data.fields : {},
    );
  }
}
