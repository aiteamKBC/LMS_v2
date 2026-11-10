import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Page from './page';
import { deleteCoach, emptyLinks, listCoaches, saveCoach } from '@/api/coachBookingDirectory';

vi.mock('../_shared/AdminPage', () => ({ AdminPage: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <section data-testid="shared-frame">{actions}{children}</section> }));
vi.mock('@/pages/users/presentation/EnrolmentPage', () => ({ EnrolmentPage: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <section data-testid="enrolment-frame">{actions}{children}</section> }));
vi.mock('@/api/coachBookingDirectory', async original => ({ ...await original<typeof import('@/api/coachBookingDirectory')>(), listCoaches: vi.fn(async () => ({ coaches: [] })), saveCoach: vi.fn(), deleteCoach: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it.each(['admin', 'curriculum', 'compliance'] as const)('isolates the Enrollment frame from the %s directory', async workspaceRole => {
  render(<MemoryRouter><Page workspaceRole={workspaceRole} /></MemoryRouter>);
  await screen.findByText('No coaches found.');
  expect(screen.getByTestId(workspaceRole === 'compliance' ? 'enrolment-frame' : 'shared-frame')).toBeInTheDocument();
  expect(screen.queryByTestId(workspaceRole === 'compliance' ? 'shared-frame' : 'enrolment-frame')).not.toBeInTheDocument();
  if (workspaceRole === 'compliance') {
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
  } else {
    expect(screen.queryByRole('group', { name: 'Coach directory layout' })).not.toBeInTheDocument();
  }
});

it('keeps all booking-link fields in the Enrollment drawer and confirms before discarding', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MemoryRouter><Page workspaceRole="compliance" /></MemoryRouter>);
  await screen.findByText('No coaches found.');
  const add = screen.getByRole('button', { name: 'Add coach' });
  add.focus(); fireEvent.click(add);
  const dialog = screen.getByRole('dialog', { name: 'Coach editor' });
  expect(within(dialog).getByLabelText('Coach name')).toHaveFocus();
  expect(within(dialog).getAllByRole('textbox')).toHaveLength(6);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(confirm).toHaveBeenCalledWith('Discard changes to this coach?');
  expect(dialog).toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Coach editor' })).not.toBeInTheDocument();
  expect(add).toHaveFocus();
  expect(saveCoach).not.toHaveBeenCalled();
});

it('shows save failures inside the drawer and preserves the entered coach details', async () => {
  vi.mocked(saveCoach).mockRejectedValueOnce(new Error('Save was rejected'));
  render(<MemoryRouter><Page workspaceRole="compliance" /></MemoryRouter>);
  await screen.findByText('No coaches found.');
  fireEvent.click(screen.getByRole('button', { name: 'Add coach' }));
  const dialog = screen.getByRole('dialog', { name: 'Coach editor' });
  fireEvent.change(within(dialog).getByLabelText('Coach name'), { target: { value: 'Isolated test coach' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save coach' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save was rejected');
  expect(within(dialog).getByLabelText('Coach name')).toHaveValue('Isolated test coach');
  expect(saveCoach).toHaveBeenCalledWith({ name: 'Isolated test coach', links: emptyLinks() });
});

it('keeps the existing reload action available when the Enrollment list fails', async () => {
  vi.mocked(listCoaches).mockRejectedValueOnce(new Error('Directory unavailable'));
  render(<MemoryRouter><Page workspaceRole="compliance" /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Reload directory' }));
  expect(await screen.findByText('No coaches found.')).toBeInTheDocument();
});

it('combines link search and booking filters, sorts results, and retains filters when switching layouts', async () => {
  const coaches = [
    { id: 1, version: 1, name: 'Zulu Coach', slug: 'zulu-coach', links: { ...emptyLinks(), coaching_session: 'https://example.org/coaching' } },
    { id: 2, version: 1, name: 'Alpha Coach', slug: 'alpha-coach', links: { ...emptyLinks(), support_session: 'https://example.org/support' } },
    { id: 3, version: 1, name: 'Beta Coach', slug: 'booking-needle', links: emptyLinks() },
  ];
  vi.mocked(listCoaches).mockResolvedValue({ coaches });
  render(<MemoryRouter><Page workspaceRole="compliance" /></MemoryRouter>);
  await screen.findByRole('article', { name: 'Alpha Coach' });
  expect(screen.getAllByRole('article').map(card => card.getAttribute('aria-label'))).toEqual(['Alpha Coach', 'Beta Coach', 'Zulu Coach']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search coaches' }), { target: { value: 'needle' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('Showing 1 of 3 coaches')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
  expect(screen.getByRole('article', { name: 'Beta Coach' })).toBeInTheDocument();
  expect(screen.getByText('0 enabled')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter booking types' }), { target: { value: 'coaching_session' } });
  expect(screen.getByText('No coaches found.')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search coaches' }), { target: { value: '' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article', { name: 'Zulu Coach' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter booking types' }), { target: { value: '' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort coaches' }), { target: { value: 'desc' } });
  expect(screen.getAllByRole('article').map(card => card.getAttribute('aria-label'))).toEqual(['Zulu Coach', 'Beta Coach', 'Alpha Coach']);
  expect(listCoaches).toHaveBeenCalledTimes(1);
  expect(saveCoach).not.toHaveBeenCalled();
});

it('preserves booking targets, edit values and removal confirmation in the Enrollment presentation', async () => {
  const coach = { id: 7, version: 4, name: 'Example Coach', slug: 'example-coach', links: { ...emptyLinks(), first_session: 'https://example.org/intro' } };
  vi.mocked(listCoaches).mockResolvedValue({ coaches: [coach] });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<MemoryRouter><Page workspaceRole="compliance" /></MemoryRouter>);
  const card = await screen.findByRole('article', { name: coach.name });
  expect(within(card).getByRole('link', { name: `Preview booking page for ${coach.name}` })).toHaveAttribute('href', '/coach-booking/example-coach');
  const details = card.querySelector('details')!;
  fireEvent.click(details.querySelector('summary')!);
  expect(within(card).getByRole('link', { name: 'First session: Available' })).toHaveAttribute('href', coach.links.first_session);
  fireEvent.click(within(card).getByRole('button', { name: `Edit ${coach.name}` }));
  const editor = screen.getByRole('dialog', { name: 'Coach editor' });
  expect(within(editor).getByLabelText('First session URL')).toHaveValue(coach.links.first_session);
  expect(within(editor).getByLabelText('One to one URL')).toHaveValue('');
  fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
  confirm.mockReturnValue(false);
  const more = card.querySelectorAll('details')[1];
  fireEvent.click(more.querySelector('summary')!);
  fireEvent.click(within(card).getByRole('button', { name: 'Remove coach' }));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('does not delete their LMS account or cancel existing bookings'));
  expect(deleteCoach).not.toHaveBeenCalled();
});
