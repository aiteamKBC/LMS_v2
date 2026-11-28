import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createEnrolmentUser, EnrolmentUserApiError, fetchEnrolmentUserFields, updateEnrolmentUser } from '@/api/enrolmentUsers';
import type { UserListRow } from '../../types';
import { CreateUserModal } from '../CreateUserModal';

vi.mock('@/api/enrolmentUsers', async original => ({
  ...await original<typeof import('@/api/enrolmentUsers')>(), createEnrolmentUser: vi.fn(), fetchEnrolmentUserFields: vi.fn(), updateEnrolmentUser: vi.fn(),
}));
vi.mock('@/api/curriculum', () => ({ fetchProgrammes: async () => [], fetchCohorts: async () => [], fetchGroups: async () => [] }));
vi.mock('@/api/staffUsers', () => ({ fetchCaseOwners: async () => ['Test Coach'] }));
vi.mock('@/api/employers', () => ({ listEmployers: async () => ({ results: [] }) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock('../Modal', () => ({ Modal: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => <div>{children}{footer}</div> }));

const learner: UserListRow = {
  id: '7', uuid: null, name: 'Example Learner', email: 'extra@example.test', source: 'commercial', type: 'User',
  group: '', programme: '', subscriptionStatus: 'FullUser', subscriptionVerified: true, learningPlan: false, hasSignedIn: true,
};
const fields = {
  id: '7', username: learner.name, email: learner.email, phone: '', dob: '', type: '', status: 'FullUser',
  programmeStatus: 'Delivery', programme: '', cohort: '', group: '', employer: '', employerId: null,
  organization: '', lineManager: '', learnerType: 'commercial' as const, caseOwner: 'Test Coach',
};

beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', () => null);
  vi.mocked(fetchEnrolmentUserFields).mockResolvedValue(fields);
  vi.mocked(updateEnrolmentUser).mockResolvedValue({} as Awaited<ReturnType<typeof updateEnrolmentUser>>);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it.each(['commercial', 'apprenticeship'] as const)('sends only the corrected email and preserves blank fields on a %s learner', async source => {
  const onSaved = vi.fn();
  vi.mocked(fetchEnrolmentUserFields).mockResolvedValue({ ...fields, learnerType: source });
  render(<MemoryRouter><CreateUserModal editing={{ ...learner, source }} onClose={vi.fn()} onCreated={vi.fn()} onSaved={onSaved} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText(/^Email/)).toHaveValue(learner.email));
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'correct@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(updateEnrolmentUser).toHaveBeenCalledWith('7', { email: 'correct@example.test' }));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: '7', email: 'correct@example.test' }));
});

it('keeps the edit open and offers the conflicting archived record without overwriting values', async () => {
  vi.mocked(updateEnrolmentUser).mockRejectedValue(new EnrolmentUserApiError('Email already exists.', {
    id: '42', name: 'Another Learner', programme: 'Other programme', learnerType: 'apprenticeship', archived: true,
  }));
  const onClose = vi.fn(); const onSaved = vi.fn();
  render(<MemoryRouter><CreateUserModal editing={learner} onClose={onClose} onCreated={vi.fn()} onSaved={onSaved} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText(/^Email/)).toHaveValue(learner.email));
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'taken@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Another Learner in the archive');
  expect(screen.getByRole('link', { name: 'Open existing learner' })).toHaveAttribute('href', '/users/42');
  expect(screen.getByLabelText(/^Email/)).toHaveValue('taken@example.test');
  expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'available@example.test' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('offers the existing commercial learner after a duplicate Create without losing the new form', async () => {
  vi.mocked(createEnrolmentUser).mockRejectedValue(new EnrolmentUserApiError('Email already exists.', {
    id: '42', name: 'Existing Learner', programme: '', learnerType: 'commercial', archived: false,
  }));
  const onClose = vi.fn(); const onCreated = vi.fn();
  render(<MemoryRouter><CreateUserModal onClose={onClose} onCreated={onCreated} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/^First name/), { target: { value: 'New' } });
  fireEvent.change(screen.getByLabelText(/^Surname/), { target: { value: 'Learner' } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'existing@example.test' } });
  fireEvent.change(await screen.findByLabelText(/^Case owner/), { target: { value: 'Test Coach' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByRole('link', { name: 'Open existing learner' })).toHaveAttribute('href', '/users/42?source=commercial');
  expect(screen.getByLabelText(/^First name/)).toHaveValue('New');
  expect(onClose).not.toHaveBeenCalled(); expect(onCreated).not.toHaveBeenCalled();
});
