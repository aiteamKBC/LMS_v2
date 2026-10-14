import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Page from './page';
import { ApplicationSubmitError, submitApprenticeshipApplication } from '@/api/apprenticeshipApplication';
import { isRecordedPath } from '@/lib/activityTrail';
import routes from '@/router/config';

vi.mock('@/api/apprenticeshipApplication', async original => ({
  ...await original<typeof import('@/api/apprenticeshipApplication')>(),
  submitApprenticeshipApplication: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choose = (group: RegExp, option: string) =>
  fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByLabelText(option));
const next = () => fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

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

it('walks the four sections and submits one complete application', async () => {
  vi.mocked(submitApprenticeshipApplication).mockResolvedValue();
  render(<Page />);

  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(screen.queryByRole('button', { name: /Previous/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Save for later/ })).not.toBeInTheDocument();
  fillPersonalDetails();
  next();

  expect(screen.getByRole('heading', { name: 'Employment' })).toHaveFocus();
  expect(screen.getByText('50% complete')).toBeInTheDocument();
  fillEmployment();
  next();

  expect(screen.getByRole('heading', { name: 'Residency' })).toBeInTheDocument();
  fillResidency();
  next();

  expect(screen.getByRole('heading', { name: 'Programme Suitability' })).toBeInTheDocument();
  expect(screen.getByText('100% complete')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Associate Project Manager Level 4' } });
  // "When was it completed?" is asked only after a Yes.
  expect(screen.queryByLabelText(/When was it completed/)).not.toBeInTheDocument();
  choose(/government funded training programmes/, 'Yes');
  type(/When was it completed/, '2026-03-01');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));

  expect(await screen.findByRole('heading', { name: 'Application submitted' })).toBeInTheDocument();
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
  });
  expect(screen.getByText('Associate Project Manager Level 4')).toBeInTheDocument();
});

it('keeps the applicant on a section until its required answers are valid', () => {
  render(<Page />);
  next();
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  expect(screen.getByLabelText(/First Name/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(/First Name/)).toHaveFocus();
  // Phone number is optional.
  expect(screen.getByLabelText(/Phone Number/)).toHaveAttribute('aria-invalid', 'false');

  fillPersonalDetails();
  type(/Work Email Address/, 'not-an-email');
  type(/Date of Birth/, '2027-01-01');
  next();
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(screen.getByText('The date cannot be in the future.')).toBeInTheDocument();
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
});

it('returns to earlier sections with the answers kept', () => {
  render(<Page />);
  fillPersonalDetails();
  next();
  fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
  expect(screen.getByLabelText(/First Name/)).toHaveValue('Sam');
  expect(screen.getByLabelText(/Date of Birth/)).toHaveValue('1995-04-03');
});

it('does not send a completion date once the answer is changed to No', async () => {
  vi.mocked(submitApprenticeshipApplication).mockResolvedValue();
  render(<Page />);
  fillPersonalDetails(); next();
  fillEmployment(); next();
  fillResidency(); next();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Marketing Manager Level 6' } });
  choose(/government funded training programmes/, 'Yes');
  type(/When was it completed/, '2026-03-01');
  choose(/government funded training programmes/, 'No');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));
  await screen.findByRole('heading', { name: 'Application submitted' });
  expect(vi.mocked(submitApprenticeshipApplication).mock.calls[0][0]).toMatchObject({
    attendedFundedTraining: false, fundedTrainingCompletedOn: null,
  });
});

it('shows a failed submission and sends the applicant to the answer the server refused', async () => {
  vi.mocked(submitApprenticeshipApplication).mockRejectedValue(
    new ApplicationSubmitError('Please correct the highlighted answers.', 400, { workEmail: 'Enter a valid email address.' }),
  );
  render(<Page />);
  fillPersonalDetails(); next();
  fillEmployment(); next();
  fillResidency(); next();
  fireEvent.change(screen.getByLabelText(/Choose Your Applying Programme/), { target: { value: 'Marketing Manager Level 6' } });
  choose(/government funded training programmes/, 'No');
  choose(/not previously completed this programme/, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: /Submit application/ }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted answers.');
  expect(screen.getByText('Section 1 of 4')).toBeInTheDocument();
  expect(screen.getByLabelText(/Work Email Address/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByRole('heading', { name: 'Application submitted' })).not.toBeInTheDocument();
});

it('is a public route that the signed-in activity recorder skips', () => {
  // Public routes are the top-level entries; everything else sits under RequireAuth.
  expect(routes.some(route => route.path === '/apprenticeship_application')).toBe(true);
  expect(isRecordedPath('/apprenticeship_application')).toBe(false);
});
