import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumCohort, CurriculumHoliday } from '@/lib/curriculumApi';
import { createCurriculumHoliday, updateCurriculumHoliday } from '@/lib/curriculumApi';
import type { ReactNode } from 'react';
import HolidaysPage from '../page';

/**
 * A holiday type is not a record: it is the `type` text on the holiday row. These
 * cover what that means for the drawer — the list is exactly the types the saved
 * holidays carry, a name the user invents is stored the moment the holiday is
 * saved, and renaming or removing one rewrites the holidays that carry it.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  // The real dialog runs onConfirm when the user presses the confirm button.
  showCurriculumConfirm: vi.fn(async (options: { onConfirm: () => Promise<void> | void }) => {
    await options.onConfirm();
    return true;
  }),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', () => ({
  createCurriculumHoliday: vi.fn(async () => ({ created: true })),
  updateCurriculumHoliday: vi.fn(async () => ({ updated: true })),
  archiveCurriculumHoliday: vi.fn(async () => ({ archived: true })),
}));

const holidays = [
  { id: '1', label: 'Christmas closure', startDate: '2026-12-24', endDate: '2027-01-02', type: 'Christmas', color: '#16a34a' },
  { id: '2', label: 'Workshop week', startDate: '2026-10-05', endDate: '2026-10-09', type: 'Workshop', color: '#2563eb' },
  // Same type, spelled differently: one row in the list, both holidays rewritten.
  { id: '3', label: 'Second workshop', startDate: '2027-02-01', endDate: '2027-02-05', type: 'workshop', color: '#2563eb' },
] as CurriculumHoliday[];

const cohorts = [
  { id: 'COHORT-1', name: 'Sept 2026', holidayIds: ['1'] },
] as unknown as CurriculumCohort[];

const reload = vi.fn(async () => null);

vi.mock('@/hooks/useCurriculumEntities', () => ({
  useCurriculumEntities: () => ({
    programmes: [],
    cohorts,
    groups: [],
    modules: [],
    holidays,
    tutors: [],
    coaches: [],
    teamsMeetings: [],
    entities: {},
    loading: false,
    loaded: true,
    error: null,
    reload,
  }),
}));

async function openDrawer() {
  render(<MemoryRouter><HolidaysPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Add Holiday' }));
}

describe('holiday types', () => {
  beforeEach(() => {
    vi.mocked(createCurriculumHoliday).mockClear();
    vi.mocked(updateCurriculumHoliday).mockClear();
    reload.mockClear();
  });

  it('lists the types the calendar uses, most used first, each one manageable', async () => {
    await openDrawer();
    const rows = screen.getAllByRole('button', { name: /^(Workshop|Christmas)/ });
    // Workshop covers two holidays, so it leads; the count is on the row.
    expect(rows[0]).toHaveTextContent('Workshop');
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('Christmas');

    // Every row is a real type, so every row can be renamed or removed.
    expect(screen.getByRole('button', { name: 'Edit type Workshop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete type Workshop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit type Christmas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete type Christmas' })).toBeInTheDocument();

    // A name nobody has used is not a row — it is a suggestion in the add form.
    expect(screen.queryByRole('button', { name: /^Bank holiday/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New type' }));
    expect(screen.getByRole('button', { name: 'Bank holiday' })).toBeInTheDocument();
  });

  it('saves a holiday with a type the user named', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'New type' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. Exam week'), 'Field trip');
    fireEvent.change(screen.getByLabelText('Type colour'), { target: { value: '#123456' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add type' }));

    // The new type joins the list, selected, and flagged as not saved yet.
    const added = screen.getByRole('button', { name: /^Field trip/ });
    expect(added).toHaveAttribute('aria-pressed', 'true');
    expect(added).toHaveTextContent('unsaved');

    await userEvent.type(screen.getByPlaceholderText('e.g. Christmas closure'), 'Museum visit');
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '2027-05-10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));

    await waitFor(() => expect(createCurriculumHoliday).toHaveBeenCalledTimes(1));
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Museum visit',
      startDate: '2027-05-10',
      type: 'Field trip',
      color: '#123456',
    }));
  });

  it('fills the add form from a suggestion, colour included', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'New type' }));
    await userEvent.click(screen.getByRole('button', { name: 'Half term' }));
    expect(screen.getByPlaceholderText('e.g. Exam week')).toHaveValue('Half term');
    await userEvent.click(screen.getByRole('button', { name: 'Add type' }));

    const added = screen.getByRole('button', { name: /^Half term/ });
    expect(added).toHaveAttribute('aria-pressed', 'true');
    // Suggested colours come from the suggestion, not the default draft colour.
    expect(added.querySelector('span')).toHaveStyle({ backgroundColor: '#2563eb' });
  });

  it('refuses a type name the list already has', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'New type' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. Exam week'), 'christmas');
    await userEvent.click(screen.getByRole('button', { name: 'Add type' }));

    expect(screen.getByText('"christmas" is already in the list.')).toBeInTheDocument();
    // The form stays open with the answer in it, so the name can be corrected.
    expect(screen.getByPlaceholderText('e.g. Exam week')).toHaveValue('christmas');
  });

  it('renames a type by rewriting every holiday that carries it', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Edit type Workshop' }));
    const nameField = screen.getByPlaceholderText('e.g. Exam week');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Study week');
    await userEvent.click(screen.getByRole('button', { name: 'Save type' }));

    await waitFor(() => expect(updateCurriculumHoliday).toHaveBeenCalledTimes(2));
    expect(updateCurriculumHoliday).toHaveBeenCalledWith('2', { type: 'Study week', color: '#2563eb' });
    expect(updateCurriculumHoliday).toHaveBeenCalledWith('3', { type: 'Study week', color: '#2563eb' });
    // The Christmas holiday is untouched.
    expect(updateCurriculumHoliday).not.toHaveBeenCalledWith('1', expect.anything());
    expect(reload).toHaveBeenCalled();
  });

  it('removes a type by clearing it off its holidays, keeping the holidays', async () => {
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Delete type Workshop' }));

    await waitFor(() => expect(updateCurriculumHoliday).toHaveBeenCalledTimes(2));
    expect(updateCurriculumHoliday).toHaveBeenCalledWith('2', { type: '' });
    expect(updateCurriculumHoliday).toHaveBeenCalledWith('3', { type: '' });
    expect(reload).toHaveBeenCalled();
  });
});
