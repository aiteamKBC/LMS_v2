import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  fetchEnglandHolidaySyncs,
  fetchEnglandHolidays,
  refreshEnglandHolidays,
  type EnglandHoliday,
  type EnglandHolidaySync,
} from '@/lib/curriculumApi';
import EnglandHolidaysPage from '../page';

/**
 * The page mirrors GOV.UK and never writes, so what matters is that it reads the
 * feed's own fields back faithfully — the substitute-day note and the weekday
 * that explains it included — and that an environment where the table has not
 * been created yet says so rather than showing a bare empty table.
 *
 * Beyond the list, the page has one job the mirror itself cannot do: tell a
 * curriculum designer *what GOV.UK changed*. A moved bank holiday reschedules
 * every cohort running across it, so the recorded checks are covered here as
 * carefully as the holidays are.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn().mockResolvedValue(undefined),
  showCurriculumConfirm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/curriculumApi', () => ({
  fetchEnglandHolidays: vi.fn(),
  fetchEnglandHolidaySyncs: vi.fn(),
  refreshEnglandHolidays: vi.fn(),
}));

const holidays = [
  { id: 'england-and-wales:2026-01-01', division: 'england-and-wales', title: 'New Year’s Day', date: '2026-01-01', notes: '', bunting: true, fetchedAt: '2026-09-13T10:00:00' },
  { id: 'england-and-wales:2026-04-03', division: 'england-and-wales', title: 'Good Friday', date: '2026-04-03', notes: '', bunting: false, fetchedAt: '2026-09-13T10:00:00' },
  // Boxing Day 2026 falls on a Saturday, so GOV.UK moves it and says why.
  { id: 'england-and-wales:2026-12-28', division: 'england-and-wales', title: 'Boxing Day', date: '2026-12-28', notes: 'Substitute day', bunting: true, fetchedAt: '2026-09-13T10:00:00' },
  { id: 'england-and-wales:2027-01-01', division: 'england-and-wales', title: 'New Year’s Day', date: '2027-01-01', notes: '', bunting: true, fetchedAt: '2026-09-13T10:00:00' },
] as EnglandHoliday[];

const status = {
  autoSync: true,
  intervalHours: 24,
  lastCheckedAt: '2026-09-14T09:00:00',
  lastSuccessAt: '2026-09-14T09:00:00',
  nextCheckDueAt: '2026-09-15T09:00:00',
  source: 'https://www.gov.uk/bank-holidays.json',
};

function sync(overrides: Partial<EnglandHolidaySync> = {}): EnglandHolidaySync {
  return {
    id: 'check-1',
    checkedAt: '2026-09-14T09:00:00',
    source: 'auto',
    status: 'ok',
    feedCount: 4,
    added: [],
    changed: [],
    moved: [],
    withdrawn: [],
    agedOut: [],
    message: '',
    ...overrides,
  };
}

function renderPage() {
  return render(<MemoryRouter><EnglandHolidaysPage /></MemoryRouter>);
}

/** Open the named combobox and pick an option — the filters are custom listboxes. */
async function choose(field: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(field, 'i') }));
  await userEvent.click(screen.getByRole('option', { name: new RegExp(`^${option}`) }));
}

/** One cell per row carries the division, so counting it counts the rows. */
function renderedRowCount(): number {
  return screen.queryAllByText('england-and-wales').length;
}

describe('England Holidays page', () => {
  beforeEach(() => {
    vi.mocked(fetchEnglandHolidays).mockReset();
    vi.mocked(fetchEnglandHolidays).mockResolvedValue(holidays);
    vi.mocked(fetchEnglandHolidaySyncs).mockReset();
    vi.mocked(fetchEnglandHolidaySyncs).mockResolvedValue({ status, results: [] });
    vi.mocked(refreshEnglandHolidays).mockReset();
  });

  it('lists every bank holiday the feed carries', async () => {
    renderPage();

    await waitFor(() => expect(renderedRowCount()).toBe(4));
    expect(screen.getByText('Good Friday')).toBeInTheDocument();
    expect(screen.getAllByText('New Year’s Day')).toHaveLength(2);
    expect(screen.getByText('Showing 4 of 4 bank holidays', { exact: false })).toBeInTheDocument();
  });

  it('shows the weekday and the substitute-day note', async () => {
    renderPage();

    // 28 Dec 2026 is a Monday — the weekday is the whole reason the day moved.
    await waitFor(() => expect(screen.getByText('Substitute day')).toBeInTheDocument());
    expect(screen.getByText('Monday')).toBeInTheDocument();
  });

  it('filters to a single year', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Good Friday')).toBeInTheDocument());

    await choose('Year', '2027');

    await waitFor(() => expect(renderedRowCount()).toBe(1));
    expect(screen.queryByText('Good Friday')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 4 bank holidays', { exact: false })).toBeInTheDocument();
  });

  it('searches by title', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Good Friday')).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText('Search bank holidays...'), 'boxing');

    await waitFor(() => expect(renderedRowCount()).toBe(1));
    expect(screen.queryByText('Good Friday')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 4 bank holidays', { exact: false })).toBeInTheDocument();
  });

  it('explains an empty table rather than looking merely unpopulated', async () => {
    vi.mocked(fetchEnglandHolidays).mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('No bank holidays stored yet')).toBeInTheDocument());
  });

  it('surfaces a failed read', async () => {
    vi.mocked(fetchEnglandHolidays).mockRejectedValue(new Error('curriculum.england_holidays is unreachable'));
    renderPage();

    await waitFor(() => expect(
      screen.getByText('curriculum.england_holidays is unreachable'),
    ).toBeInTheDocument());
  });
});

describe('What GOV.UK has changed', () => {
  beforeEach(() => {
    vi.mocked(fetchEnglandHolidays).mockReset();
    vi.mocked(fetchEnglandHolidays).mockResolvedValue(holidays);
    vi.mocked(fetchEnglandHolidaySyncs).mockReset();
    vi.mocked(refreshEnglandHolidays).mockReset();
  });

  it('says so plainly when nothing on the site has moved', async () => {
    // A quiet check is still recorded; what it must not do is read as "we have
    // not looked".
    vi.mocked(fetchEnglandHolidaySyncs).mockResolvedValue({ status, results: [sync()] });
    renderPage();

    await waitFor(() => expect(
      screen.getByText('No changes recorded. Every bank holiday stored here matches what GOV.UK is publishing.'),
    ).toBeInTheDocument());
  });

  it('names a holiday GOV.UK moved, with both dates', async () => {
    vi.mocked(fetchEnglandHolidaySyncs).mockResolvedValue({
      status,
      results: [sync({
        moved: [{
          id: 'england-and-wales:2026-12-28',
          title: 'Boxing Day',
          date: '2026-12-28',
          previousDate: '2026-12-26',
          notes: 'Substitute day',
        }],
      })],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Moved')).toBeInTheDocument());
    expect(screen.getByText('26 Dec 2026 → 28 Dec 2026')).toBeInTheDocument();
  });

  it('names a newly published holiday and a withdrawn one', async () => {
    vi.mocked(fetchEnglandHolidaySyncs).mockResolvedValue({
      status,
      results: [sync({
        added: [{ id: 'a', title: 'Coronation bank holiday', date: '2027-06-07' }],
        withdrawn: [{ id: 'w', title: 'Invented holiday', date: '2027-03-01' }],
      })],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());
    expect(screen.getByText('Coronation bank holiday')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByText('Invented holiday')).toBeInTheDocument();
  });

  it('reports a check that could not reach GOV.UK', async () => {
    // The dates are unchanged, which is right — but a reader has to know they
    // are also unconfirmed.
    vi.mocked(fetchEnglandHolidaySyncs).mockResolvedValue({
      status: { ...status, lastCheckedAt: '2026-09-14T09:00:00', lastSuccessAt: '2026-09-10T09:00:00' },
      results: [sync({ status: 'error', message: 'Could not read https://www.gov.uk/bank-holidays.json: timed out' })],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Check failed')).toBeInTheDocument());
    expect(screen.getByText(/timed out/)).toBeInTheDocument();
  });

  it('checks GOV.UK on demand and reloads what it found', async () => {
    vi.mocked(fetchEnglandHolidaySyncs).mockResolvedValue({ status, results: [] });
    vi.mocked(refreshEnglandHolidays).mockResolvedValue({
      status,
      summary: { ...sync({ added: [{ id: 'a', title: 'Coronation bank holiday', date: '2027-06-07' }] }), applied: true, unchanged: 3 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Good Friday')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Check GOV.UK now/i }));

    await waitFor(() => expect(refreshEnglandHolidays).toHaveBeenCalledTimes(1));
    // Re-read afterwards: the point of the button is to see the new dates.
    await waitFor(() => expect(fetchEnglandHolidays).toHaveBeenCalledTimes(2));
  });
});
