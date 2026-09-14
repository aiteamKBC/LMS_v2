import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumCohort, CurriculumHoliday } from '@/lib/curriculumApi';
import { archiveCurriculumHoliday, createCurriculumHoliday } from '@/lib/curriculumApi';
import type { ReactNode } from 'react';
import HolidaysPage from '../page';

/**
 * A holiday is a PERIOD, and the calendar has two sources.
 *
 * The period is the point of this page: a college closure runs from one date to
 * another, and every day between the two is closed. A single day is the special
 * case, not the rule — and it is stored as a period whose two ends are equal, so
 * that nothing downstream has to know the difference.
 *
 * The two sources are GOV.UK's bank holidays (mirrored, read-only — they change
 * when GOV.UK changes them) and this college's own closures (authored here).
 * Both close delivery days; only one of them can be edited, and these pin that
 * the page never offers a write it cannot make.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
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
  // Authored here: a fortnight's closure over Christmas.
  { id: '1', label: 'Christmas closure', startDate: '2026-12-21', endDate: '2027-01-01', type: 'Christmas', color: '#16a34a', source: 'authored' },
  // Authored here: a single day, stored as a one-day period.
  { id: '2', label: 'Staff training', startDate: '2027-03-01', endDate: '2027-03-01', type: 'Staff training', color: '#0891b2', source: 'authored' },
  // Mirrored from GOV.UK.
  { id: 'england-and-wales:2027-01-01', label: 'New Year’s Day', startDate: '2027-01-01', endDate: '2027-01-01', type: 'Bank holiday', color: '#91d64c', source: 'gov.uk' },
] as CurriculumHoliday[];

const cohorts = [
  { id: 'COHORT-1', name: 'Sept 2026', holidayIds: ['1', 'england-and-wales:2027-01-01'] },
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

function renderPage() {
  return render(<MemoryRouter><HolidaysPage /></MemoryRouter>);
}

async function openDrawer() {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Add Holiday' }));
}

async function fillHoliday({ name, start, end }: { name: string; start: string; end?: string }) {
  await userEvent.type(screen.getByPlaceholderText('e.g. Christmas closure'), name);
  fireEvent.change(screen.getByLabelText(/^Start date$/), { target: { value: start } });
  if (end) fireEvent.change(screen.getByLabelText(/^End date$/), { target: { value: end } });
}

describe('a holiday covers a range of dates', () => {
  beforeEach(() => {
    vi.mocked(createCurriculumHoliday).mockClear();
    vi.mocked(archiveCurriculumHoliday).mockClear();
    reload.mockClear();
  });

  it('saves the whole range a closure runs across', async () => {
    await openDrawer();
    await fillHoliday({ name: 'Summer closure', start: '2027-08-02', end: '2027-08-13' });
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));

    await waitFor(() => expect(createCurriculumHoliday).toHaveBeenCalledTimes(1));
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Summer closure',
      startDate: '2027-08-02',
      endDate: '2027-08-13',
    }));
  });

  it('treats a blank end date as a single day rather than an open end', async () => {
    await openDrawer();
    await fillHoliday({ name: 'Staff day', start: '2027-04-19' });
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));

    await waitFor(() => expect(createCurriculumHoliday).toHaveBeenCalledTimes(1));
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2027-04-19',
      endDate: '2027-04-19',
    }));
  });

  it('refuses an end date before the start instead of quietly swapping them', async () => {
    // A fortnight typed backwards is a typo; reinterpreting it would close the
    // wrong fortnight. The end field knows the start date and rejects it on the
    // spot, so the backwards range never reaches the save at all.
    await openDrawer();
    await fillHoliday({ name: 'Backwards', start: '2027-08-13', end: '2027-08-02' });
    fireEvent.blur(screen.getByLabelText(/^End date$/));

    expect(await screen.findByText(/Cannot be before/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    await waitFor(() => expect(createCurriculumHoliday).toHaveBeenCalledTimes(1));
    // Saved as the single day that was actually entered, never as 13 Aug → 2 Aug.
    expect(createCurriculumHoliday).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2027-08-13',
      endDate: '2027-08-13',
    }));
  });

  it('counts the closed days of each holiday in the list', async () => {
    renderPage();

    // 21 Dec to 1 Jan inclusive is twelve days; a single day is one.
    expect(await screen.findByText('Christmas closure')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });
});

describe('the two sources of the calendar', () => {
  beforeEach(() => {
    vi.mocked(createCurriculumHoliday).mockClear();
    vi.mocked(archiveCurriculumHoliday).mockClear();
    reload.mockClear();
  });

  it('lists both kinds and says which is which', async () => {
    renderPage();

    expect(await screen.findByText('Christmas closure')).toBeInTheDocument();
    expect(screen.getByText('New Year’s Day')).toBeInTheDocument();
    expect(screen.getByText('GOV.UK')).toBeInTheDocument();
    expect(screen.getAllByText('Added here')).toHaveLength(2);
  });

  it('offers no edit or archive on a holiday GOV.UK owns', async () => {
    renderPage();

    await screen.findByText('New Year’s Day');
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    // Two authored rows, so two of each action and no more.
    expect(screen.getAllByRole('button', { name: 'Edit holiday' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Archive holiday' })).toHaveLength(2);
  });

  it('never offers a bank holiday type for rename or removal', async () => {
    // The type of a GOV.UK row is not stored — being in the mirror is what makes
    // it a bank holiday — so renaming it would be a write the server refuses.
    await openDrawer();

    expect(screen.getByRole('button', { name: /^Christmas/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Bank holiday \d/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit type Bank holiday' })).not.toBeInTheDocument();
  });

  it('filters the list down to the closures added here', async () => {
    renderPage();
    await screen.findByText('New Year’s Day');

    await userEvent.click(screen.getByRole('combobox', { name: /Source/i }));
    await userEvent.click(screen.getByRole('option', { name: /^Added here/ }));

    await waitFor(() => expect(screen.queryByText('New Year’s Day')).not.toBeInTheDocument());
    expect(screen.getByText('Christmas closure')).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 3 holidays')).toBeInTheDocument();
  });

  it('archives a closure added here', async () => {
    renderPage();
    await screen.findByText('Christmas closure');

    await userEvent.click(screen.getAllByRole('button', { name: 'Archive holiday' })[0]);

    await waitFor(() => expect(archiveCurriculumHoliday).toHaveBeenCalledWith('1'));
  });
});
