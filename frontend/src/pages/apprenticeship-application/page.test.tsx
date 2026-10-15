import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Page from './page';
import {
  ApplicationSubmitError,
  fetchEligibilityForm,
  lookupPostcode,
  submitApprenticeshipApplication,
  type PostcodeCheck,
} from '@/api/apprenticeshipApplication';
import { isRecordedPath } from '@/lib/activityTrail';
import routes from '@/router/config';
import { defaultLayout } from './layout/resolve';
import type { EligibilityLayout } from './layout/types';

vi.mock('@/api/apprenticeshipApplication', async original => ({
  ...await original<typeof import('@/api/apprenticeshipApplication')>(),
  submitApprenticeshipApplication: vi.fn(),
  fetchEligibilityForm: vi.fn(),
  lookupPostcode: vi.fn(),
}));

const EXETER: PostcodeCheck = { status: 'found', postcode: 'EX1 2MP', country: 'England', region: 'South West', district: 'Exeter', inEngland: true };
const EDINBURGH: PostcodeCheck = { status: 'found', postcode: 'EH1 1YZ', country: 'Scotland', region: '', district: 'City of Edinburgh', inEngland: false };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  vi.mocked(fetchEligibilityForm).mockResolvedValue({ layout: null, version: null });
  vi.mocked(lookupPostcode).mockResolvedValue(EXETER);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const open = async () => {
  render(<Page />);
  await screen.findByText(/^Section 1 of/);
};
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choose = (group: RegExp, option: string) =>
  fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByLabelText(option));
const next = () => fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
const heading = (name: string) => screen.findByRole('heading', { name });

function fillPersonalDetails() {
  type(/First Name/, 'Sam');
  type(/Surname/, 'Example');
  type(/Work Email Address/, 'sam@employer.example');
  type(/Full Address/, '1 Example Street');
  type(/^6\. Postcode/, 'EX1 2MP');
  type(/Date of Birth/, '1995-04-03');
}

function fillEmployment() {
  choose(/Your Employment Status/, 'In paid employment');
  choose(/50% of your working hours in England/, 'No');
  type(/^3\. Employer/, 'Example Ltd');
  type(/Employer Full Address/, '2 Business Park');
  type(/Employer Postcode/, 'EX3 4MP');
  type(/Employer Representative Name/, 'Alex Manager');
  type(/Employer Representative Email/, 'alex@employer.example');
}

function fillResidency() {
  choose(/live in United Kingdom/, 'Yes');
  choose(/ordinary residence in the UK/, 'Yes');
  fireEvent.change(screen.getByLabelText(/residency status/), { target: { value: 'Pre-settled Status' } });
}

async function reachProgramme() {
  fillPersonalDetails(); next();
  await heading('Employment');
  fillEmployment(); next();
  await heading('Residency');
  fillResidency(); next();
  await heading('Programme Suitability');
}

it('walks the four sections and submits one complete application', async () => {
  vi.mocked(submitApprenticeshipApplication).mockResolvedValue();
  await open();

  expect(screen.getByRole('heading', { name: 'Eligibility Form' })).toBeInTheDocument();
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(screen.queryByRole('button', { name: /Previous/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Save for later/ })).not.toBeInTheDocument();
  fillPersonalDetails();
  next();

  expect(await heading('Employment')).toHaveFocus();
  expect(screen.getByText('50% complete')).toBeInTheDocument();
  fillEmployment();
  next();

  expect(await heading('Residency')).toBeInTheDocument();
  fillResidency();
  next();

  expect(await heading('Programme Suitability')).toBeInTheDocument();
  expect(screen.getByText('100% complete')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Associate Project Manager Level 4' } });
  // "When was it completed?" is asked only after a Yes.
  expect(screen.queryByLabelText(/When was it completed/)).not.toBeInTheDocument();
  choose(/government funded training programmes/, 'Yes');
  type(/When was it completed/, '2026-03-01');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));

  expect(await heading('Application submitted')).toBeInTheDocument();
  expect(submitApprenticeshipApplication).toHaveBeenCalledTimes(1);
  expect(submitApprenticeshipApplication).toHaveBeenCalledWith({
    firstName: 'Sam', surname: 'Example', workEmail: 'sam@employer.example', phoneNumber: '',
    fullAddress: '1 Example Street', postcode: 'EX1 2MP', dateOfBirth: '1995-04-03',
    employmentStatus: 'In paid employment', majorityHoursInEngland: false,
    employerName: 'Example Ltd', employerAddress: '2 Business Park', employerPostcode: 'EX3 4MP',
    representativeName: 'Alex Manager', representativeEmail: 'alex@employer.example',
    livesInUk: true, residenceNotForEducation: true, residencyStatus: 'Pre-settled Status',
    programme: 'Associate Project Manager Level 4', attendedFundedTraining: true,
    fundedTrainingCompletedOn: '2026-03-01', notPreviouslyCompletedProgramme: true,
    custom: {}, layoutVersion: null,
  });
  expect(screen.getByText('Associate Project Manager Level 4')).toBeInTheDocument();
});

it('keeps the applicant on a section until its required answers are valid', async () => {
  await open();
  next();
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  expect(screen.getByLabelText(/First Name/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(/First Name/)).toHaveFocus();
  // Phone number is optional.
  expect(screen.getByLabelText(/Phone Number/)).toHaveAttribute('aria-invalid', 'false');

  fillPersonalDetails();
  type(/Work Email Address/, 'not-an-email');
  type(/Date of Birth/, '2027-01-01');
  type(/^6\. Postcode/, '12345');
  next();
  expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
  expect(screen.getByText('The date cannot be in the future.')).toBeInTheDocument();
  expect(screen.getByText('Enter a valid UK postcode, for example CT1 1AA.')).toBeInTheDocument();
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  // A malformed postcode is never looked up.
  expect(lookupPostcode).not.toHaveBeenCalled();
});

it('shows where a postcode is, and warns without blocking when it is outside England', async () => {
  vi.mocked(lookupPostcode).mockImplementation(async (postcode: string) => (postcode.toUpperCase().startsWith('EH') ? EDINBURGH : EXETER));
  await open();
  fillPersonalDetails();
  type(/^6\. Postcode/, 'eh1 1yz');
  fireEvent.blur(screen.getByLabelText(/^6\. Postcode/));

  expect(await screen.findByText('City of Edinburgh, Scotland')).toBeInTheDocument();
  expect(screen.getByText(/is outside England\. You must be living in England/)).toBeInTheDocument();
  expect(lookupPostcode).toHaveBeenCalledWith('eh1 1yz');
  next();
  expect(await heading('Employment')).toBeInTheDocument();

  type(/Employer Postcode/, 'EX3 4MP');
  fireEvent.blur(screen.getByLabelText(/Employer Postcode/));
  expect(await screen.findByText('Exeter, South West, England')).toBeInTheDocument();
});

it('stops on a postcode that does not exist', async () => {
  vi.mocked(lookupPostcode).mockResolvedValue({ status: 'notFound' });
  await open();
  fillPersonalDetails();
  next();

  expect(await screen.findByText('We could not find this postcode. Check it and try again.')).toBeInTheDocument();
  expect(screen.getByLabelText(/^6\. Postcode/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  // Correcting the postcode clears its error.
  type(/^6\. Postcode/, 'EX1 2MQ');
  expect(screen.getByLabelText(/^6\. Postcode/)).toHaveAttribute('aria-invalid', 'false');
});

it('lets the applicant carry on when a postcode cannot be checked', async () => {
  vi.mocked(lookupPostcode).mockResolvedValue({ status: 'unavailable' });
  await open();
  fillPersonalDetails();
  next();
  expect(await heading('Employment')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
  expect(await screen.findByText('We could not check this postcode just now. You can still continue.')).toBeInTheDocument();
});

it('returns to earlier sections with the answers kept', async () => {
  await open();
  fillPersonalDetails();
  next();
  await heading('Employment');
  fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
  expect(screen.getByLabelText(/First Name/)).toHaveValue('Sam');
  expect(screen.getByLabelText(/Date of Birth/)).toHaveValue('1995-04-03');
});

it('does not send a completion date once the answer is changed to No', async () => {
  vi.mocked(submitApprenticeshipApplication).mockResolvedValue();
  await open();
  await reachProgramme();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Marketing Manager Level 6' } });
  choose(/government funded training programmes/, 'Yes');
  type(/When was it completed/, '2026-03-01');
  choose(/government funded training programmes/, 'No');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));
  await heading('Application submitted');
  expect(vi.mocked(submitApprenticeshipApplication).mock.calls[0][0]).toMatchObject({
    attendedFundedTraining: false, fundedTrainingCompletedOn: null,
  });
});

it('shows a failed submission and sends the applicant to the answer the server refused', async () => {
  vi.mocked(submitApprenticeshipApplication).mockRejectedValue(
    new ApplicationSubmitError('Please correct the highlighted answers.', 400, { workEmail: 'Enter a valid email address.' }),
  );
  await open();
  await reachProgramme();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Marketing Manager Level 6' } });
  choose(/government funded training programmes/, 'No');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted answers.');
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  expect(screen.getByLabelText(/Work Email Address/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByRole('heading', { name: 'Application submitted' })).not.toBeInTheDocument();
});

/** The standard form with the builder's changes: as the public endpoint would return it. */
function publishedLayout(): EligibilityLayout {
  const layout = defaultLayout();
  const [personal, employment, residency, programme] = layout.sections;
  personal.title = 'About you';
  personal.items.find(item => item.key === 'dateOfBirth')!.hidden = true;
  personal.items.push(
    { key: 'cf_line_manager', builtin: false, hidden: false, required: true, label: 'Do you have a line manager?', type: 'yesno', column: 'custom_line_manager' },
    {
      key: 'cf_manager_name', builtin: false, hidden: false, required: true, label: "Your manager's name", type: 'text', column: 'custom_manager_name',
      condition: { field: 'cf_line_manager', values: ['Yes'] },
    },
  );
  employment.hidden = true;
  residency.hidden = true;
  programme.items.find(item => item.key === 'programme')!.options = ['Data Analyst Level 4'];
  layout.texts = { 'firstName.label': 'Given name', 'page.title': 'Apply for an apprenticeship' };
  return layout;
}

it('asks the questions of the published form', async () => {
  vi.mocked(submitApprenticeshipApplication).mockResolvedValue();
  vi.mocked(fetchEligibilityForm).mockResolvedValue({ layout: publishedLayout(), version: 3 });
  await open();

  expect(screen.getByRole('heading', { name: 'Apply for an apprenticeship' })).toBeInTheDocument();
  expect(screen.getByText('Section 1 of 2')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Date of Birth/)).not.toBeInTheDocument();
  type(/Given name/, 'Sam');
  type(/Surname/, 'Example');
  type(/Work Email Address/, 'sam@employer.example');
  type(/Full Address/, '1 Example Street');
  type(/Postcode/, 'EX1 2MP');
  // The follow-up is asked only after a Yes, and is then required.
  expect(screen.queryByLabelText(/Your manager's name/)).not.toBeInTheDocument();
  choose(/Do you have a line manager/, 'Yes');
  next();
  expect(await screen.findByText('This field is required.')).toBeInTheDocument();
  type(/Your manager's name/, 'Alex');
  next();

  expect(await heading('Programme Suitability')).toBeInTheDocument();
  expect(within(screen.getByLabelText(/Choose Your Applying Programme/)).getAllByRole('option').map(o => o.textContent))
    .toEqual(['Please select', 'Data Analyst Level 4']);
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Data Analyst Level 4' } });
  choose(/government funded training programmes/, 'No');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));

  await heading('Application submitted');
  expect(vi.mocked(submitApprenticeshipApplication).mock.calls[0][0]).toMatchObject({
    firstName: 'Sam', dateOfBirth: '', programme: 'Data Analyst Level 4',
    custom: { cf_line_manager: true, cf_manager_name: 'Alex' },
    layoutVersion: 3,
  });
});

it('reloads a form republished while it was being filled in, keeping the answers', async () => {
  vi.mocked(submitApprenticeshipApplication).mockRejectedValueOnce(
    new ApplicationSubmitError('This form was updated while you were filling it in.', 409, {}, true),
  );
  vi.mocked(fetchEligibilityForm)
    .mockResolvedValueOnce({ layout: null, version: null })
    .mockResolvedValueOnce({ layout: publishedLayout(), version: 3 });
  await open();
  await reachProgramme();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Marketing Manager Level 6' } });
  choose(/government funded training programmes/, 'No');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));

  expect(await screen.findByRole('alert')).toHaveTextContent('This form was updated while you were filling it in.');
  expect(fetchEligibilityForm).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Section 1 of 2')).toBeInTheDocument();
  expect(screen.getByLabelText(/Given name/)).toHaveValue('Sam');
  expect(screen.getByRole('radiogroup', { name: /Do you have a line manager/ })).toBeInTheDocument();
});

it('offers to try again when the form cannot be loaded', async () => {
  vi.mocked(fetchEligibilityForm)
    .mockRejectedValueOnce(new Error('The application form is not available just now.'))
    .mockResolvedValueOnce({ layout: null, version: null });
  render(<Page />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The application form is not available just now.');
  fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
  expect(await screen.findByText('Section 1 of 4')).toBeInTheDocument();
});

it('is a public route that the signed-in activity recorder skips', () => {
  // Public routes are the top-level entries; everything else sits under RequireAuth.
  expect(routes.some(route => 'path' in route && route.path === '/apprenticeship_application')).toBe(true);
  expect(isRecordedPath('/apprenticeship_application')).toBe(false);
});
