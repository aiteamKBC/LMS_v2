import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumCohort, CurriculumGroup, CurriculumHoliday, CurriculumProgramme } from '@/lib/curriculumApi';
import { CohortFormDrawer, GroupFormDrawer, ProgrammeFormDrawer } from '../forms';

/**
 * Two people with the same record open.
 *
 * A drawer used to do one of two things when the record changed underneath it,
 * and both were wrong in their own way: an untouched drawer re-seeded (right),
 * and a touched one refused to look at all, so it kept showing -- and would go
 * on to save -- a version of the record that no longer existed.
 *
 * Now it merges. A field the reader has not touched takes the stored value; a
 * field they have touched keeps theirs; a field both of them changed keeps
 * theirs and is named on screen.
 */

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', () => ({
  createCurriculumCohort: vi.fn(async () => ({})),
  updateCurriculumCohort: vi.fn(async () => ({})),
  createCurriculumGroup: vi.fn(async () => ({})),
  updateCurriculumGroup: vi.fn(async () => ({})),
  createCurriculumProgramme: vi.fn(async () => ({})),
  updateCurriculumProgramme: vi.fn(async () => ({})),
  previewCohortEndDate: vi.fn(async () => ({
    endDate: '2027-08-31',
    practicalEndDate: '2027-08-31',
    calculatedEndDate: '2027-08-31',
    apprenticeshipEndDate: '2027-11-30',
    warnings: [],
  })),
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4' },
] as CurriculumProgramme[];

const holidays: CurriculumHoliday[] = [];

/** The cohort as the list behind the drawer is holding it. */
function storedCohort(overrides: Partial<CurriculumCohort> = {}): CurriculumCohort {
  return {
    id: 'COHORT-1',
    name: 'September 2026',
    programmeId: 'PROG-DATA',
    programme: 'Data Analyst',
    startDate: '2026-09-07',
    durationMonths: 12,
    color: '#6d28d9',
    ...overrides,
  } as CurriculumCohort;
}

function renderDrawer(cohort: CurriculumCohort) {
  const view = render(
    <CohortFormDrawer
      open
      cohort={cohort}
      programmes={programmes}
      holidays={holidays}
      onClose={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
    />,
  );
  /** The list refreshing behind the drawer with what somebody else stored. */
  const remoteSaveArrives = (next: CurriculumCohort) => view.rerender(
    <CohortFormDrawer
      open
      cohort={next}
      programmes={programmes}
      holidays={holidays}
      onClose={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
    />,
  );
  return { remoteSaveArrives };
}

const nameField = () => screen.getByPlaceholderText('e.g. September 2026') as HTMLInputElement;

describe('drawer co-editing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('brings in a field the reader has not touched', async () => {
    const { remoteSaveArrives } = renderDrawer(storedCohort());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'My unsaved name');

    // They changed the duration; this reader never went near it.
    remoteSaveArrives(storedCohort({ durationMonths: 18 }));

    expect(await screen.findByDisplayValue('18')).toBeInTheDocument();
    // And the name this reader is part-way through typing is untouched.
    expect(nameField()).toHaveValue('My unsaved name');
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });

  it('keeps the reader version and names the field when both changed it', async () => {
    const { remoteSaveArrives } = renderDrawer(storedCohort());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'My unsaved name');

    remoteSaveArrives(storedCohort({ name: 'Autumn 2026, as Sara renamed it' }));

    const notice = await screen.findByTestId('co-edit-notice');
    expect(notice).toHaveTextContent(/both changed the cohort name/i);
    expect(notice).toHaveTextContent(/Yours is kept/i);
    expect(nameField()).toHaveValue('My unsaved name');
  });

  it('still re-seeds outright while the drawer is untouched', async () => {
    const { remoteSaveArrives } = renderDrawer(storedCohort());

    remoteSaveArrives(storedCohort({ name: 'Autumn 2026, as Sara renamed it' }));

    // Nothing of the reader's to weigh it against, so there is no decision to
    // put to them and no banner to show.
    expect(await screen.findByDisplayValue('Autumn 2026, as Sara renamed it')).toBeInTheDocument();
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });

  it('says nothing when the refresh carried no change to this record', async () => {
    const { remoteSaveArrives } = renderDrawer(storedCohort());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'My unsaved name');

    // A new object for the same record -- what a background refresh of the list
    // produces on its own, with nobody having written anything.
    remoteSaveArrives(storedCohort());

    expect(nameField()).toHaveValue('My unsaved name');
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });
});

/**
 * The scheduling slot, and the drawer that used to lose typing on its own.
 *
 * Delivery days and delivery times are chosen together and are what the Teams
 * calendar is built from, so they merge as one value: one editor's whole slot
 * wins. Taking one editor's days with the other's times would produce a
 * timetable neither of them chose, and the calendar would then go and book it.
 */
function renderGroupDrawer(group: CurriculumGroup) {
  const props = (value: CurriculumGroup) => ({
    open: true as const,
    group: value,
    programmes,
    cohorts: [{ id: 'COHORT-1', name: 'September 2026', programmeId: 'PROG-DATA' }] as CurriculumCohort[],
    coachNames: ['Coach One'],
    onClose: vi.fn(),
    onSaved: vi.fn(async () => undefined),
  });
  // The group drawer reaches for the router: its Teams notice offers to take
  // the reader to the calendar their day change has left behind.
  const view = render(<MemoryRouter><GroupFormDrawer {...props(group)} /></MemoryRouter>);
  return {
    remoteSaveArrives: (next: CurriculumGroup) => view.rerender(<MemoryRouter><GroupFormDrawer {...props(next)} /></MemoryRouter>),
  };
}

function storedGroup(overrides: Partial<CurriculumGroup> = {}): CurriculumGroup {
  return {
    id: 'GROUP-1',
    name: 'Group A',
    cohortId: 'COHORT-1',
    programmeId: 'PROG-DATA',
    coach: 'Coach One',
    weekDays: 'Monday',
    startTime: '09:00',
    endTime: '11:00',
    color: '#2563eb',
    ...overrides,
  } as CurriculumGroup;
}

describe('group drawer scheduling slot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets the end time two hours after a newly selected start time', () => {
    renderGroupDrawer(storedGroup());

    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });

    expect(screen.getByDisplayValue('10:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12:00')).toBeInTheDocument();
  });

  it('keeps the slot whole when one editor moves the day and the other the time', async () => {
    const { remoteSaveArrives } = renderGroupDrawer(storedGroup());
    // This reader moves the group to Tuesday.
    await userEvent.click(screen.getByRole('button', { name: 'Tue' }));

    // Their save moved the time instead.
    remoteSaveArrives(storedGroup({ startTime: '14:00', endTime: '16:00' }));

    const notice = await screen.findByTestId('co-edit-notice');
    expect(notice).toHaveTextContent(/both changed the/i);
    // This reader's whole slot survived: Tuesday at their times, never Tuesday
    // at the other editor's times.
    expect(screen.getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByDisplayValue('09:00')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('14:00')).not.toBeInTheDocument();
  });

  it('takes their whole slot when this reader has not touched the schedule', async () => {
    const { remoteSaveArrives } = renderGroupDrawer(storedGroup());
    await userEvent.clear(screen.getByPlaceholderText('e.g. Group A'));
    await userEvent.type(screen.getByPlaceholderText('e.g. Group A'), 'B renamed the group');

    remoteSaveArrives(storedGroup({ weekDays: 'Thursday', startTime: '14:00', endTime: '16:00' }));

    expect(await screen.findByDisplayValue('14:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('e.g. Group A')).toHaveValue('B renamed the group');
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });
});

/**
 * The programme drawer had no guard at all: the list refreshing behind it
 * re-seeded the fields and threw away whatever was half-typed, with no write
 * from anybody involved.
 */
describe('programme drawer under live polling', () => {
  beforeEach(() => vi.clearAllMocks());

  const programmeProps = (programme: CurriculumProgramme) => ({
    open: true as const,
    programme,
    onClose: vi.fn(),
    onSaved: vi.fn(async () => undefined),
  });
  const stored = (overrides: Partial<CurriculumProgramme> = {}) => ({
    id: 'program-data',
    sourceId: 'PROG-DATA',
    name: 'Data Analyst',
    level: 'LVL-4',
    description: 'The stored description',
    color: '#6941c6',
    ...overrides,
  }) as CurriculumProgramme;

  it('does not lose typing to a background refresh that carried no change', async () => {
    const view = render(<ProgrammeFormDrawer {...programmeProps(stored())} />);
    const name = screen.getByPlaceholderText('e.g. Data Analyst');
    await userEvent.clear(name);
    await userEvent.type(name, 'Half-typed nam');

    // A new object for the same record -- what a poll produces on its own.
    view.rerender(<ProgrammeFormDrawer {...programmeProps(stored())} />);
    view.rerender(<ProgrammeFormDrawer {...programmeProps(stored())} />);

    expect(name).toHaveValue('Half-typed nam');
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });

  it('brings in their description without disturbing the name being typed', async () => {
    const view = render(<ProgrammeFormDrawer {...programmeProps(stored())} />);
    const name = screen.getByPlaceholderText('e.g. Data Analyst');
    await userEvent.clear(name);
    await userEvent.type(name, 'Half-typed nam');

    view.rerender(<ProgrammeFormDrawer {...programmeProps(stored({ description: 'A rewrote the description' }))} />);

    expect(await screen.findByDisplayValue('A rewrote the description')).toBeInTheDocument();
    expect(name).toHaveValue('Half-typed nam');
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });
});
