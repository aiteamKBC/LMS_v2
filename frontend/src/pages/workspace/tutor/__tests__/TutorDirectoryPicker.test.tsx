/**
 * The card-per-tutor picker an administrator sees at /workspace/tutor.
 *
 * "Every tutor" is two overlapping sets — the curriculum's tutor profiles and
 * the accounts holding Tutor access — and the behaviours worth pinning are the
 * ones that decide whether a card can be trusted: the union is complete, the
 * same person appears once, a tutor with no login account is still openable,
 * and either source failing costs its own rows rather than the whole list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchStaffUsers = vi.fn();
const fetchCurriculumTutors = vi.fn();

vi.mock('@/api/staffUsers', () => ({ fetchStaffUsers: () => fetchStaffUsers() }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumTutors: () => fetchCurriculumTutors() }));

const { TutorDirectoryPicker } = await import('../TutorDirectoryPicker');

const PROFILES = [
  // Has an account too — the same person from both sources.
  { id: 'p1', name: 'Rachel Myers', email: 'Rachel@kbc.test', jobTitle: 'Business Admin Tutor', moduleCount: 6, groupCount: 3, inProgressCount: 2 },
  // Added under Curriculum, never given a login. Openable by name.
  { id: 'p2', name: 'Priya Nair', email: '', jobTitle: 'Data Tutor', moduleCount: 2, groupCount: 1, inProgressCount: 1 },
];

const STAFF = [
  { id: 1, name: 'Rachel Myers', email: 'rachel@kbc.test', position: 'Tutor', access: 'tutor' },
  // Tutor access, no curriculum profile yet.
  { id: 2, name: 'Sam Tutor', email: 'sam@kbc.test', position: 'Tutor', access: 'tutor' },
  { id: 3, name: 'Amina Okoro', email: 'amina@kbc.test', position: 'Caseowner', access: 'coach' },
  { id: 4, name: 'Demo Admin', email: 'admin@kbc.test', position: 'Admin', access: 'super-admin' },
];

beforeEach(() => {
  localStorage.clear();
  fetchStaffUsers.mockResolvedValue(STAFF);
  fetchCurriculumTutors.mockResolvedValue(PROFILES);
});

describe('TutorDirectoryPicker', () => {
  it('shows one card per tutor from both sources', async () => {
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);

    expect(await screen.findByText('Rachel Myers')).toBeTruthy();
    expect(screen.getByText('Priya Nair')).toBeTruthy();
    expect(screen.getByText('Sam Tutor')).toBeTruthy();
  });

  it('does not list a coach or an administrator as a tutor', async () => {
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByText('Rachel Myers');

    expect(screen.queryByText('Amina Okoro')).toBeNull();
    expect(screen.queryByText('Demo Admin')).toBeNull();
  });

  it('shows somebody in both sources once', async () => {
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByText('Rachel Myers');

    expect(screen.getAllByText('Rachel Myers')).toHaveLength(1);
  });

  it('shows the teaching load from the curriculum profile', async () => {
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByText('Rachel Myers');

    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Business Admin Tutor')).toBeTruthy();
  });

  it('opens a tutor who has no login account, by name', async () => {
    const onSelect = vi.fn();
    render(<TutorDirectoryPicker onSelect={onSelect} />);
    await screen.findByText('Priya Nair');

    expect(screen.getByText(/No address/)).toBeTruthy();
    await userEvent.click(screen.getByText('Priya Nair'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Priya Nair', email: '', moduleCount: 2 }),
    );
  });

  it('reports the tutor that was clicked, with a normalised address', async () => {
    const onSelect = vi.fn();
    render(<TutorDirectoryPicker onSelect={onSelect} />);
    await screen.findByText('Rachel Myers');

    await userEvent.click(screen.getByText('Rachel Myers'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'rachel@kbc.test', name: 'Rachel Myers' }),
    );
  });

  it('keeps the accounts when the curriculum profiles cannot be read', async () => {
    fetchCurriculumTutors.mockRejectedValue(new Error('curriculum schema not provisioned'));
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);

    expect(await screen.findByText('Sam Tutor')).toBeTruthy();
    expect(screen.getByText(/Teaching numbers are unavailable/)).toBeTruthy();
  });

  it('keeps the profiles when the accounts cannot be read', async () => {
    fetchStaffUsers.mockRejectedValue(new Error('Staff directory unavailable'));
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);

    expect(await screen.findByText('Rachel Myers')).toBeTruthy();
    expect(screen.getByText('Priya Nair')).toBeTruthy();
  });

  it('reports an error only when both sources fail', async () => {
    fetchCurriculumTutors.mockRejectedValue(new Error('Tutor list unavailable'));
    fetchStaffUsers.mockRejectedValue(new Error('Staff directory unavailable'));
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);

    expect(await screen.findByText('Tutor list unavailable')).toBeTruthy();
  });

  it('filters by the search box', async () => {
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByText('Rachel Myers');

    await userEvent.type(screen.getByPlaceholderText('Search name or email...'), 'sam');

    expect(screen.getByText('Sam Tutor')).toBeTruthy();
    expect(screen.queryByText('Rachel Myers')).toBeNull();
  });

  it('says where tutors come from when there are none', async () => {
    fetchCurriculumTutors.mockResolvedValue([]);
    fetchStaffUsers.mockResolvedValue([STAFF[2]]);
    render(<TutorDirectoryPicker onSelect={vi.fn()} />);

    expect(await screen.findByText(/No tutors yet/)).toBeTruthy();
  });
});
