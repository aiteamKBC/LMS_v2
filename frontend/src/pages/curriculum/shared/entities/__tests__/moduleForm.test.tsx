import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumHoliday,
  CurriculumProgramme,
} from '@/lib/curriculumApi';
import {
  CurriculumApiError,
  createGroupModule,
  previewModuleSessionPlan,
  previewTutorAvailabilityRoster,
  updateCurriculumModule,
} from '@/lib/curriculumApi';
import { createNewModule } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { ModuleFormDrawer } from '../moduleForm';

/**
 * The one form that creates and places a module, in place of the six-step
 * structure wizard. Which endpoint a save uses is the whole point of it: a module
 * placed in a group has to go through the group endpoint, because that is what
 * bounds the start date to the cohort, builds the session plan and refuses a
 * tutor double-booking. A module with no group yet must not.
 */

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  createGroupModule: vi.fn(async () => ({ created: [{ moduleCatalogueId: 'MOD-NEW' }] })),
  updateCurriculumModule: vi.fn(async () => ({ updated: true })),
  previewModuleSessionPlan: vi.fn(async () => ({
    sessions: [
      { sessionNumber: 1, date: '2026-09-02', day: 'Wednesday', skippedHolidays: [] },
      { sessionNumber: 2, date: '2026-09-09', day: 'Wednesday', skippedHolidays: [] },
      { sessionNumber: 3, date: '2026-09-16', day: 'Wednesday', skippedHolidays: [] },
      { sessionNumber: 4, date: '2026-09-23', day: 'Wednesday', skippedHolidays: [] },
      { sessionNumber: 5, date: '2026-09-30', day: 'Wednesday', skippedHolidays: [] },
      { sessionNumber: 6, date: '2026-10-07', day: 'Wednesday', skippedHolidays: [] },
    ],
    skippedHolidays: [],
    finalEndDate: '2026-10-07',
    warnings: [],
  })),
  // Nothing checked by default, so a test that is not about tutor availability
  // sees the form it always saw. The tests that are about it answer per case.
  previewTutorAvailabilityRoster: vi.fn(async () => ({
    sessionDates: [],
    startTime: '',
    endTime: '',
    bookable: false,
    results: [],
    availableCount: 0,
    busyCount: 0,
  })),
}));

vi.mock('@/pages/curriculum/module-builder/moduleAuthoringData', () => ({
  createNewModule: vi.fn(async () => ({ catalogueId: 'MOD-DRAFT', id: 'local-MOD-DRAFT' })),
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4', isActive: true, isArchived: false },
  { id: 'program-mba', sourceId: 'PROG-MBA', name: 'MBA', level: '4', isActive: false, isArchived: true, status: 'archived' },
  { id: 'program-disabled', sourceId: 'PROG-DISABLED', name: 'Disabled Programme', level: '4', isActive: false, isArchived: false },
] as CurriculumProgramme[];

const cohorts = [
  {
    id: 'COHORT-1',
    name: 'Sept 2026',
    programmeId: 'PROG-DATA',
    programme: 'Data Analyst',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    practicalEndDate: '2027-08-31',
    status: 'active',
    holidayIds: ['1'],
  },
] as unknown as CurriculumCohort[];

const groups = [
  {
    id: 'GROUP-1',
    name: 'Group A',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    programme: 'Data Analyst',
    weekDays: 'Wednesday',
    startTime: '10:00',
    endTime: '12:00',
  },
] as unknown as CurriculumGroup[];

const holidays = [
  { id: '1', label: 'Christmas closure', startDate: '2026-12-24', endDate: '2027-01-02', type: 'Christmas' },
] as CurriculumHoliday[];

const createGroupModuleMock = vi.mocked(createGroupModule);
const previewModuleSessionPlanMock = vi.mocked(previewModuleSessionPlan);
const previewTutorAvailabilityRosterMock = vi.mocked(previewTutorAvailabilityRoster);
const updateCurriculumModuleMock = vi.mocked(updateCurriculumModule);
const createNewModuleMock = vi.mocked(createNewModule);

function renderDrawer(props: Partial<Parameters<typeof ModuleFormDrawer>[0]> = {}) {
  const onSaved = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(
    <ModuleFormDrawer
      open
      programmes={programmes}
      cohorts={cohorts}
      groups={groups}
      holidays={holidays}
      tutorNames={['Tutor One']}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onSaved, onClose };
}

/** Open the named combobox and pick the option whose label starts with `option`. */
async function choose(field: string, option: string) {
  const combobox = screen.getByRole('combobox', { name: new RegExp(field, 'i') });
  await userEvent.click(combobox);
  await userEvent.click(screen.getByRole('option', { name: new RegExp(`^${option}`) }));
}

describe('ModuleFormDrawer', () => {
  beforeEach(() => {
    createGroupModuleMock.mockClear();
    previewModuleSessionPlanMock.mockClear();
    previewTutorAvailabilityRosterMock.mockClear();
    updateCurriculumModuleMock.mockClear();
    createNewModuleMock.mockClear();
  });

  it('only offers active non-archived programmes in the module placement select', async () => {
    renderDrawer();

    await userEvent.click(screen.getByRole('combobox', { name: /programme/i }));

    expect(screen.getByRole('option', { name: /^Data Analyst/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^MBA/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Disabled Programme/ })).not.toBeInTheDocument();
  });

  it('shows cohort and group names exactly as entered', async () => {
    renderDrawer();

    const cohortSelect = screen.getByRole('combobox', { name: /^Cohort/ });

    await userEvent.click(cohortSelect);
    expect(screen.getByRole('option', { name: /^Sept 2026$/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Sept 2026.*Data Analyst/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /^Sept 2026$/ }));

    // Groups are a tick list rather than a dropdown: the same module regularly
    // runs for more than one group of a cohort, and a closed dropdown showing one
    // name does not say that a second is allowed.
    expect(screen.getByRole('button', { name: /Group A/ })).toBeInTheDocument();
  });

  it('creates one delivery per ticked group', async () => {
    const twoGroups = [
      ...groups,
      {
        id: 'GROUP-2',
        name: 'Group B',
        cohortId: 'COHORT-1',
        cohort: 'Sept 2026',
        programme: 'Data Analyst',
        weekDays: 'Monday, Thursday',
        startTime: '14:00',
        endTime: '16:00',
      },
    ] as unknown as CurriculumGroup[];
    renderDrawer({ groups: twoGroups, defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1' } });

    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Data Modelling');
    await userEvent.click(screen.getByRole('button', { name: /Group A/ }));
    await userEvent.click(screen.getByRole('button', { name: /Group B/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    await waitFor(() => expect(createGroupModuleMock).toHaveBeenCalledTimes(2));
    // Each group is attached on its own delivery days and times, not on the
    // first group's: a second group frequently runs a different timetable.
    expect(createGroupModuleMock).toHaveBeenCalledWith('GROUP-1', expect.objectContaining({
      groupId: 'GROUP-1',
      weekDays: 'Wednesday',
      startTime: '10:00',
    }));
    expect(createGroupModuleMock).toHaveBeenCalledWith('GROUP-2', expect.objectContaining({
      groupId: 'GROUP-2',
      weekDays: 'Monday, Thursday',
      startTime: '14:00',
    }));
  });

  it('creates a module in a locked group through the group endpoint', async () => {
    const { onSaved } = renderDrawer({
      lockGroup: true,
      defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' },
    });

    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Data Modelling');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    expect(createNewModuleMock).not.toHaveBeenCalled();
    expect(createGroupModuleMock).toHaveBeenCalledTimes(1);
    const [groupId, payload] = createGroupModuleMock.mock.calls[0];
    expect(groupId).toBe('GROUP-1');
    expect(payload).toMatchObject({
      moduleName: 'Data Modelling',
      cohortId: 'COHORT-1',
      groupId: 'GROUP-1',
      // Delivery days and times come off the group, not off this form.
      weekDays: 'Wednesday',
      startTime: '10:00',
      endTime: '12:00',
    });
    // The caller gets the canonical id so it can open the module straight away.
    expect(onSaved).toHaveBeenCalledWith({ catalogueId: 'MOD-NEW', name: 'Data Modelling', created: true });
  });

  it('reports saving for the full create and caller refresh lifecycle', async () => {
    let releaseCreate!: () => void;
    const createPending = new Promise<void>(resolve => { releaseCreate = resolve; });
    createGroupModuleMock.mockImplementationOnce(async () => {
      await createPending;
      return { created: [{ moduleCatalogueId: 'MOD-NEW' }] };
    });
    const onSavingChange = vi.fn();
    const onSaved = vi.fn(async () => undefined);
    renderDrawer({
      lockGroup: true,
      defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' },
      onSavingChange,
      onSaved,
    });

    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Data Modelling');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));
    expect(onSaved).not.toHaveBeenCalled();

    releaseCreate();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });

  it('shows the end date the backend calculated by default', async () => {
    // The end date is the last session of the generated plan, so the drawer
    // displays it until the user picks a different date.
    renderDrawer({ lockGroup: true, defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' } });

    const endDate = screen.getByRole('combobox', { name: 'End date' });
    expect(endDate).toBeEnabled();
    await waitFor(() => expect(endDate).toHaveValue('07/10/2026'));
  });

  it('saves a manually adjusted module end date', async () => {
    renderDrawer({ lockGroup: true, defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' } });

    const endDate = screen.getByRole('combobox', { name: 'End date' });
    await waitFor(() => expect(endDate).toHaveValue('07/10/2026'));
    await userEvent.clear(endDate);
    await userEvent.type(endDate, '14/10/2026');
    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Manual End');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    expect(createGroupModuleMock).toHaveBeenCalledWith('GROUP-1', expect.objectContaining({
      moduleName: 'Manual End',
      endDate: '2026-10-14',
    }));
  });

  it('opens a session date preview and marks holiday shifts', async () => {
    previewModuleSessionPlanMock.mockResolvedValueOnce({
      sessions: [
        { sessionNumber: 1, date: '2026-12-23', day: 'Wednesday', skippedHolidays: [] },
        { sessionNumber: 2, date: '2027-01-06', day: 'Wednesday', skippedHolidays: ['2026-12-30'] },
      ],
      skippedHolidays: ['2026-12-30'],
      finalEndDate: '2027-01-06',
      warnings: [],
    });

    renderDrawer({ lockGroup: true, defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' } });

    const previewButton = await screen.findByRole('button', { name: /view sessions/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await userEvent.click(previewButton);

    expect(screen.getByRole('dialog', { name: /module/i })).toBeInTheDocument();
    expect(screen.getByText('30 Dec 2026')).toBeInTheDocument();
    expect(screen.getByText('06 Jan 2027')).toBeInTheDocument();
    expect(screen.getByText(/Blocked by Christmas closure/)).toBeInTheDocument();
    expect(screen.getByText('Shifted to replacement')).toBeInTheDocument();
    expect(screen.getByText('Replacement delivered')).toBeInTheDocument();
  });

  it('creates a catalogue draft when no group has been chosen', async () => {
    const { onSaved } = renderDrawer();

    await choose('Programme', 'Data Analyst');
    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Unplaced Module');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    expect(createGroupModuleMock).not.toHaveBeenCalled();
    expect(createNewModuleMock).toHaveBeenCalledTimes(1);
    expect(createNewModuleMock.mock.calls[0][0]).toMatchObject({
      title: 'Unplaced Module',
      programme: 'Data Analyst',
      programmeId: 'PROG-DATA',
      status: 'draft',
    });
    expect(onSaved).toHaveBeenCalledWith({ catalogueId: 'MOD-DRAFT', name: 'Unplaced Module', created: true });
  });

  it('refuses a module with no name before it calls anything', async () => {
    renderDrawer({ lockGroup: true, defaults: { groupId: 'GROUP-1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));
    expect(await screen.findByText('Give the module a name.')).toBeInTheDocument();
    expect(createGroupModuleMock).not.toHaveBeenCalled();
    expect(createNewModuleMock).not.toHaveBeenCalled();
  });

  it('refuses a start date outside the cohort before it calls anything', async () => {
    // The date field blocks an out-of-range date the user *types*; a stored one
    // arrives already set, so the form has to refuse it on the way out.
    renderDrawer({
      module: {
        id: 'MOD-1',
        name: 'Data Foundations',
        programmeId: 'PROG-DATA',
        cohortId: 'COHORT-1',
        groupId: 'GROUP-1',
        sessionsNumber: 2,
        startDate: '2026-08-03',
        endDate: '2026-08-10',
        status: 'draft',
      },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    // Shown on the date field and again in the drawer's error line.
    expect(await screen.findAllByText(/cannot start before the cohort start date/)).not.toHaveLength(0);
    expect(updateCurriculumModuleMock).not.toHaveBeenCalled();
  });

  it('refuses a module that finishes after the cohort has ended', async () => {
    // The start date sits inside the cohort, so only the end date is out of
    // bounds -- the case a start-date bound on its own lets through.
    renderDrawer({
      module: {
        id: 'MOD-1',
        name: 'Data Foundations',
        programmeId: 'PROG-DATA',
        cohortId: 'COHORT-1',
        groupId: 'GROUP-1',
        sessionsNumber: 2,
        startDate: '2027-08-25',
        endDate: '2027-10-06',
        status: 'draft',
      },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findAllByText(/cannot finish after the cohort end date/)).not.toHaveLength(0);
    expect(updateCurriculumModuleMock).not.toHaveBeenCalled();
  });

  it('refuses a generated session plan that runs past the cohort end', async () => {
    // Nobody typed this end date: it is the plan's own last session, which is
    // why the field's own bounds cannot catch it.
    previewModuleSessionPlanMock.mockResolvedValueOnce({
      sessions: [
        { sessionNumber: 1, date: '2027-08-25', day: 'Wednesday', skippedHolidays: [] },
        { sessionNumber: 2, date: '2027-09-15', day: 'Wednesday', skippedHolidays: [] },
      ],
      skippedHolidays: [],
      finalEndDate: '2027-09-15',
      warnings: [],
    });

    renderDrawer({
      module: {
        id: 'MOD-1',
        name: 'Data Foundations',
        programmeId: 'PROG-DATA',
        cohortId: 'COHORT-1',
        groupId: 'GROUP-1',
        sessionsNumber: 2,
        startDate: '2027-08-25',
        status: 'draft',
      },
    });

    const endDate = screen.getByRole('combobox', { name: 'End date' });
    await waitFor(() => expect(endDate).toHaveValue('15/09/2027'));
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findAllByText(/cannot finish after the cohort end date/)).not.toHaveLength(0);
    expect(updateCurriculumModuleMock).not.toHaveBeenCalled();
  });

  it('patches an existing module rather than creating a second one', async () => {
    const { onSaved } = renderDrawer({
      module: {
        id: 'MOD-1',
        name: 'Data Foundations',
        programmeId: 'PROG-DATA',
        cohortId: 'COHORT-1',
        groupId: 'GROUP-1',
        sessionsNumber: 6,
        startDate: '2026-09-02',
        tutor: 'Tutor One',
        status: 'published',
      },
    });

    const name = screen.getByPlaceholderText('e.g. Data Modelling');
    await userEvent.clear(name);
    await userEvent.type(name, 'Data Foundations II');
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    expect(createGroupModuleMock).not.toHaveBeenCalled();
    expect(createNewModuleMock).not.toHaveBeenCalled();
    expect(updateCurriculumModuleMock).toHaveBeenCalledTimes(1);
    const [id, payload] = updateCurriculumModuleMock.mock.calls[0];
    expect(id).toBe('MOD-1');
    expect(payload).toMatchObject({
      name: 'Data Foundations II',
      status: 'published',
      tutor: 'Tutor One',
      groupId: 'GROUP-1',
      cohortId: 'COHORT-1',
    });
    expect(onSaved).toHaveBeenCalledWith({ catalogueId: 'MOD-1', name: 'Data Foundations II', created: false });
  });

  it('restores placement fields from a saved delivery when editing from the catalogue', async () => {
    renderDrawer({
      module: {
        id: 'MOD-1',
        name: 'Data Foundations',
        programmeId: 'PROG-DATA',
        sessionsNumber: 5,
        startDate: '2026-09-02',
        endDate: '2026-09-30',
        tutor: 'Unassigned',
        status: 'published',
        notes: 'Bring calculators.',
        deliveryUsages: [{
          programmeId: 'PROG-DATA',
          programme: 'Data Analyst',
          cohortId: 'COHORT-1',
          cohort: 'Sept 2026',
          groupId: 'GROUP-1',
          group: 'Group A',
          startDate: '2026-09-02',
          endDate: '2026-09-30',
          sessions: 5,
          tutor: 'Tutor One',
        }],
      },
    });

    expect(screen.getByRole('combobox', { name: /programme/i })).toHaveTextContent('Data Analyst');
    expect(screen.getByRole('combobox', { name: /^Cohort/ })).toHaveTextContent('Sept 2026');
    expect(screen.getByRole('button', { name: /Group A/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /tutor/i })).toHaveTextContent('Tutor One');
    expect(screen.getByPlaceholderText('Optional delivery notes')).toHaveValue('Bring calculators.');

    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    expect(updateCurriculumModuleMock).toHaveBeenCalledWith('MOD-1', expect.objectContaining({
      cohortId: 'COHORT-1',
      cohortName: 'Sept 2026',
      groupId: 'GROUP-1',
      groupName: 'Group A',
      tutor: 'Tutor One',
      notes: 'Bring calculators.',
    }));
  });

  it('shows a tutor double-booking refusal verbatim', async () => {
    // A real CurriculumApiError: `tutorConflictMessage` only unwraps that shape,
    // which is what keeps a generic 409 from being shown as a booking clash.
    const conflict = new CurriculumApiError(
      'Curriculum API returned 409 for /curriculum/modules/MOD-1/',
      409,
      '/curriculum/modules/MOD-1/',
      {
        error: 'Tutor One is already teaching "Data Foundations" on Wednesday at 10:00.',
        tutorConflicts: [{ moduleName: 'Data Foundations' }],
      },
    );
    updateCurriculumModuleMock.mockRejectedValueOnce(conflict);

    renderDrawer({
      module: { id: 'MOD-1', name: 'Data Foundations', groupId: 'GROUP-1', tutor: 'Tutor One' },
    });

    const name = screen.getByPlaceholderText('e.g. Data Modelling');
    await userEvent.type(name, ' edited');
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findByText('Tutor One is already teaching "Data Foundations" on Wednesday at 10:00.')).toBeInTheDocument();
  });
});

/**
 * The double-booking rule, asked before the save rather than by it.
 *
 * A refused save is the worst moment to learn that a tutor was never available:
 * the form is filled in and the choice was never going to work. So the same rule
 * is asked of the same endpoint as soon as the slot can be dated, and the answer
 * has to reach the screen as the *sessions* that collide -- the fix is to move
 * one of the two modules, which nobody can decide from a count.
 */
describe('ModuleFormDrawer tutor availability', () => {
  const BUSY_ROSTER = {
    sessionDates: ['2026-09-02', '2026-09-09', '2026-09-16'],
    startTime: '10:00',
    endTime: '12:00',
    bookable: true,
    results: [
      {
        tutor: 'Tutor One',
        available: false,
        message: 'Tutor One is already teaching "MBA-TESt" at 10:00-12:00 on 02 Sep 2026.',
        conflicts: [{
          moduleCatalogueId: 'MOD-MBA',
          moduleName: 'MBA-TESt',
          programme: 'MBA',
          cohort: 'Feb 2025',
          group: 'Group B',
          startTime: '10:00',
          endTime: '12:00',
          dates: ['2026-09-02', '2026-09-09'],
        }],
      },
      { tutor: 'Tutor Two', available: true, message: '', conflicts: [] },
    ],
    availableCount: 1,
    busyCount: 1,
  };

  beforeEach(() => {
    createGroupModuleMock.mockClear();
    previewTutorAvailabilityRosterMock.mockClear();
    previewTutorAvailabilityRosterMock.mockResolvedValue(BUSY_ROSTER);
  });

  function renderPlacedDrawer() {
    return renderDrawer({
      lockGroup: true,
      defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' },
      tutorNames: ['Tutor One', 'Tutor Two'],
    });
  }

  it('asks about the slot with the cohort holidays that move its dates', async () => {
    renderPlacedDrawer();

    await waitFor(() => expect(previewTutorAvailabilityRosterMock).toHaveBeenCalled());
    expect(previewTutorAvailabilityRosterMock.mock.calls[0][0]).toMatchObject({
      startDate: '2026-09-01',
      weekDays: 'Wednesday',
      startTime: '10:00',
      endTime: '12:00',
      cohortId: 'COHORT-1',
      // The ticked selection, not every holiday on file: it is what shifts a
      // session onto the day the clash is really about.
      holidays: [expect.objectContaining({ label: 'Christmas closure' })],
    });
  });

  it('names the clashing sessions as soon as the tutor is chosen', async () => {
    renderPlacedDrawer();
    await waitFor(() => expect(previewTutorAvailabilityRosterMock).toHaveBeenCalled());

    await choose('Tutor', 'Tutor One');

    expect(await screen.findByText(/Tutor One is already teaching in this slot/)).toBeInTheDocument();
    expect(screen.getByText('MBA-TESt')).toBeInTheDocument();
    expect(screen.getByText('MBA › Feb 2025 › Group B')).toBeInTheDocument();
    // The sessions themselves, weekday and all -- not "2 dates".
    // Sep/Sept is the platform's own en-GB abbreviation, so only the parts the
    // component decides are asserted.
    expect(screen.getByText(/^Wed 02 Sept? 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/^Wed 09 Sept? 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/2 of this module's 3 sessions/)).toBeInTheDocument();
  });

  it('does not send a save it already knows will be refused', async () => {
    renderPlacedDrawer();
    await waitFor(() => expect(previewTutorAvailabilityRosterMock).toHaveBeenCalled());

    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Test-Conflict');
    await choose('Tutor', 'Tutor One');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    expect(await screen.findByText(/Tutor One is already teaching in this slot\./)).toBeInTheDocument();
    expect(createGroupModuleMock).not.toHaveBeenCalled();
  });

  it('offers the tutors the slot is free for as the fix', async () => {
    renderPlacedDrawer();
    await waitFor(() => expect(previewTutorAvailabilityRosterMock).toHaveBeenCalled());
    await choose('Tutor', 'Tutor One');

    await userEvent.click(await screen.findByRole('button', { name: /Tutor Two/ }));

    expect(screen.getByRole('combobox', { name: /tutor/i })).toHaveTextContent('Tutor Two');
    expect(screen.queryByText(/is already teaching in this slot/)).not.toBeInTheDocument();
  });

  it('marks the busy names in the picker, without blocking the choice', async () => {
    renderPlacedDrawer();
    await waitFor(() => expect(previewTutorAvailabilityRosterMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('combobox', { name: /tutor/i }));

    expect(screen.getByText('Already teaching then')).toBeInTheDocument();
    expect(screen.getByText('Free in this slot')).toBeInTheDocument();
    expect(screen.getByText('2 clashes')).toBeInTheDocument();
    // Moving the delivery day or the time is a legitimate fix, so the busy name
    // is still selectable -- it is labelled, not disabled.
    expect(screen.getByRole('option', { name: /^Tutor One/ })).toBeEnabled();
  });

  it('says nothing at all when the slot books nothing', async () => {
    previewTutorAvailabilityRosterMock.mockResolvedValue({
      ...BUSY_ROSTER,
      sessionDates: [],
      bookable: false,
    });
    renderPlacedDrawer();
    await waitFor(() => expect(previewTutorAvailabilityRosterMock).toHaveBeenCalled());

    await choose('Tutor', 'Tutor One');

    // An unbookable slot clashes with nothing, so a warning here would be a
    // guess -- and "everyone is free" would be a false all-clear.
    expect(screen.queryByText(/is already teaching in this slot/)).not.toBeInTheDocument();
  });

  it('lets the save through when the preview itself fails', async () => {
    // Advisory only: a preview that cannot answer must degrade to the old
    // find-out-on-save behaviour, never to a form that refuses to save.
    previewTutorAvailabilityRosterMock.mockRejectedValue(new Error('offline'));
    renderPlacedDrawer();

    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Test-Conflict');
    await choose('Tutor', 'Tutor One');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    await waitFor(() => expect(createGroupModuleMock).toHaveBeenCalledTimes(1));
  });
});
