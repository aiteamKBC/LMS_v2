import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumHoliday,
  CurriculumProgramme,
} from '@/lib/curriculumApi';
import { CurriculumApiError, createGroupModule, updateCurriculumModule } from '@/lib/curriculumApi';
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
    sessions: [],
    skippedHolidays: [],
    finalEndDate: '2026-10-07',
    warnings: [],
  })),
}));

vi.mock('@/pages/curriculum/module-builder/moduleAuthoringData', () => ({
  createNewModule: vi.fn(async () => ({ catalogueId: 'MOD-DRAFT', id: 'local-MOD-DRAFT' })),
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4' },
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
    updateCurriculumModuleMock.mockClear();
    createNewModuleMock.mockClear();
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

  it('shows the end date the backend calculated, read-only', async () => {
    // The end date is the last session of the generated plan, so the drawer
    // displays it instead of taking it: a typed date could only disagree with
    // the plan the save stores.
    renderDrawer({ lockGroup: true, defaults: { programmeId: 'PROG-DATA', cohortId: 'COHORT-1', groupId: 'GROUP-1' } });

    const endDate = screen.getByRole('combobox', { name: 'End date' });
    expect(endDate).toBeDisabled();
    await waitFor(() => expect(endDate).toHaveValue('07/10/2026'));
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
