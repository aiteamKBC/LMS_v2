import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CurriculumApiError,
  fetchCurriculumRevisions,
  updateCurriculumCohort,
  updateCurriculumGroup,
  updateCurriculumModule,
} from '@/lib/curriculumApi';
import type { CurriculumCohort, CurriculumGroup, CurriculumProgramme } from '@/lib/curriculumApi';
import { CohortFormDrawer, GroupFormDrawer } from '../forms';
import { ModuleFormDrawer, type ModuleFormTarget } from '../moduleForm';

/**
 * Two editors saving before either one polls.
 *
 * The co-editing merge next door works on what a poll brought in, which means
 * it only helps when a poll arrived in time. These are the case where none
 * did: both editors hold version 10, one saves, and the other's save is
 * refused by the server rather than allowed to put the first one's work back.
 *
 * Every test here is written as that race -- a save, a refusal carrying the
 * stored record, and the retry -- because that is the only thing the guard
 * exists for. The merge policy itself is unchanged and tested next door.
 */

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

// Partial, so `recordConflict` and `guardedInput` -- the two pieces of the
// guard that live in the API module -- are the real ones under test.
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumRevisions: vi.fn(),
  updateCurriculumCohort: vi.fn(),
  updateCurriculumGroup: vi.fn(),
  updateCurriculumModule: vi.fn(),
  createCurriculumCohort: vi.fn(async () => ({})),
  createCurriculumGroup: vi.fn(async () => ({})),
  createGroupModule: vi.fn(async () => ({ created: [] })),
  previewModuleSessionPlan: vi.fn(async () => ({ sessions: [], finalEndDate: '', warnings: [], skippedHolidays: [] })),
  previewTutorAvailabilityRoster: vi.fn(async () => ({
    sessionDates: [], startTime: '', endTime: '', bookable: false, results: [], availableCount: 0, busyCount: 0,
  })),
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

/** What the server answers a save built on a version somebody else replaced. */
function conflict(record: unknown, currentRevision: string, kind = 'cohort') {
  return new CurriculumApiError('Curriculum API returned 409', 409, '/curriculum/cohorts/COHORT-1/', {
    error: 'Someone else saved this while you were editing it.',
    conflict: true,
    expectedRevision: 'rev-10',
    currentRevision,
    [kind]: record,
  });
}

function renderCohortDrawer() {
  render(
    <CohortFormDrawer
      open
      cohort={storedCohort()}
      programmes={programmes}
      holidays={[]}
      onClose={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
    />,
  );
}

const nameField = () => screen.getByPlaceholderText('e.g. September 2026') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save cohort/i });

/** Every body the drawer has sent, in order. */
const sentBodies = () => vi.mocked(updateCurriculumCohort).mock.calls.map(call => call[1] as Record<string, unknown>);

describe('cohort drawer under a stale save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCurriculumRevisions).mockResolvedValue({ cohort: { 'COHORT-1': 'rev-10' } });
  });

  it('sends the version it read', async () => {
    vi.mocked(updateCurriculumCohort).mockResolvedValue({ updated: true, id: 'COHORT-1', revision: 'rev-11' });
    renderCohortDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateCurriculumCohort).toHaveBeenCalled());
    expect(sentBodies()[0]).toMatchObject({ name: 'B renamed it', expectedRevision: 'rev-10' });
  });

  // A. Different fields, same starting revision.
  it('keeps both editors when the refusal carries a change to another field', async () => {
    vi.mocked(updateCurriculumCohort)
      // Somebody moved the duration while this reader was typing a name. Their
      // save carries the duration it read, which is what used to undo it.
      .mockRejectedValueOnce(conflict(storedCohort({ durationMonths: 18 }), 'rev-11'))
      .mockResolvedValueOnce({ updated: true, id: 'COHORT-1', revision: 'rev-12' });
    renderCohortDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateCurriculumCohort).toHaveBeenCalledTimes(2));
    const retry = sentBodies()[1];
    // Their duration and this reader's name, in one save, against the version
    // the refusal named.
    expect(retry).toMatchObject({ name: 'B renamed it', durationMonths: 18, expectedRevision: 'rev-11' });
    // And no notice: nobody disagreed about anything.
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });

  // B. Same field.
  it('keeps this reader and names the field when both changed the same one', async () => {
    vi.mocked(updateCurriculumCohort)
      .mockRejectedValueOnce(conflict(storedCohort({ name: 'A renamed it' }), 'rev-11'))
      .mockResolvedValueOnce({ updated: true, id: 'COHORT-1', revision: 'rev-12' });
    renderCohortDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateCurriculumCohort).toHaveBeenCalledTimes(2));
    // The policy is unchanged: the editor who is present keeps their value, the
    // other one is reported, and the retry is against the current version.
    expect(sentBodies()[1]).toMatchObject({ name: 'B renamed it', expectedRevision: 'rev-11' });
    expect(await screen.findByTestId('co-edit-notice')).toHaveTextContent(/both changed the cohort name/i);
    expect(nameField()).toHaveValue('B renamed it');
  });

  // D. A third write lands during the rebase.
  it('rebases again when somebody saves during the retry, and stops after three', async () => {
    vi.mocked(updateCurriculumCohort)
      .mockRejectedValueOnce(conflict(storedCohort({ durationMonths: 18 }), 'rev-11'))
      .mockRejectedValueOnce(conflict(storedCohort({ durationMonths: 24 }), 'rev-12'))
      .mockRejectedValueOnce(conflict(storedCohort({ durationMonths: 30 }), 'rev-13'))
      .mockRejectedValueOnce(conflict(storedCohort({ durationMonths: 36 }), 'rev-14'))
      .mockRejectedValue(conflict(storedCohort({ durationMonths: 42 }), 'rev-15'));
    renderCohortDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');
    await userEvent.click(saveButton());

    // The first save plus three rebases, and then it stops rather than
    // spinning: a record being written this fast is a thing to say out loud.
    await waitFor(() => expect(updateCurriculumCohort).toHaveBeenCalledTimes(4));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(updateCurriculumCohort).toHaveBeenCalledTimes(4);
    // Each attempt moved onto the version the last refusal named.
    expect(sentBodies().map(body => body.expectedRevision)).toEqual(['rev-10', 'rev-11', 'rev-12', 'rev-13']);
    // The reader's work is still in front of them either way.
    expect(nameField()).toHaveValue('B renamed it');
  });

  it('saves unguarded when the version could not be read', async () => {
    // A token that cannot be read must not stop somebody saving. They fall back
    // to the write this screen did before any of this existed.
    vi.mocked(fetchCurriculumRevisions).mockRejectedValue(new Error('offline'));
    vi.mocked(updateCurriculumCohort).mockResolvedValue({ updated: true, id: 'COHORT-1' });
    renderCohortDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateCurriculumCohort).toHaveBeenCalled());
    expect(sentBodies()[0]).not.toHaveProperty('expectedRevision');
  });
});

/**
 * The group's delivery slot is what the Teams calendar is built from, so a
 * stale save here does not just lose an edit -- it moves meetings people are
 * in. It is also merged as one value, and that has to survive the rebase.
 */
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

describe('group drawer under a stale save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCurriculumRevisions).mockResolvedValue({ group: { 'GROUP-1': 'rev-10' } });
  });

  function renderGroupDrawer() {
    render(
      <MemoryRouter>
        <GroupFormDrawer
          open
          group={storedGroup()}
          programmes={programmes}
          cohorts={[{ id: 'COHORT-1', name: 'September 2026', programmeId: 'PROG-DATA' }] as CurriculumCohort[]}
          coachNames={['Coach One']}
          onClose={vi.fn()}
          onSaved={vi.fn(async () => undefined)}
        />
      </MemoryRouter>,
    );
  }

  it('keeps this reader whole slot and retries against the stored version', async () => {
    vi.mocked(updateCurriculumGroup)
      // Their save moved the clock; this reader is moving the day.
      .mockRejectedValueOnce(conflict(storedGroup({ startTime: '14:00', endTime: '16:00' }), 'rev-11', 'group'))
      .mockResolvedValueOnce({ updated: true, id: 'GROUP-1', revision: 'rev-12' });
    renderGroupDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Tue' }));
    await userEvent.click(screen.getByRole('button', { name: /save group/i }));

    await waitFor(() => expect(updateCurriculumGroup).toHaveBeenCalledTimes(2));
    const retry = vi.mocked(updateCurriculumGroup).mock.calls[1][1] as Record<string, unknown>;
    // The day this reader added, at this reader's times -- never their days at
    // the other editor's clock, which is a timetable neither of them chose and
    // the calendar would go and book.
    expect(retry).toMatchObject({
      weekDays: 'Monday, Tuesday',
      startTime: '09:00',
      endTime: '11:00',
      expectedRevision: 'rev-11',
    });
    expect(await screen.findByTestId('co-edit-notice')).toBeInTheDocument();
  });
});

/**
 * The module drawer shares the Module Builder's token, because it writes
 * through the same structure save. So a save in the Builder makes an open
 * drawer stale, and the drawer rebases onto it rather than writing the weeks
 * and components back to what they were before.
 */
function storedModule(overrides: Partial<ModuleFormTarget> = {}): ModuleFormTarget {
  return {
    id: 'MOD-1',
    name: 'Data Modelling',
    programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1',
    groupId: 'GROUP-1',
    weeks: 4,
    sessionsNumber: 4,
    weekDays: 'Wednesday',
    startTime: '10:00',
    endTime: '12:00',
    startDate: '2026-09-02',
    tutor: 'Tutor One',
    status: 'draft',
    ...overrides,
  } as ModuleFormTarget;
}

describe('module drawer under a stale save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCurriculumRevisions).mockResolvedValue({ module: { 'MOD-1': 'rev-10' } });
  });

  function renderModuleDrawer() {
    render(
      <MemoryRouter>
        <ModuleFormDrawer
          open
          module={storedModule()}
          programmes={[{ id: 'PROG-DATA', sourceId: 'PROG-DATA', name: 'Data Analyst', isActive: true }] as never}
          cohorts={[{ id: 'COHORT-1', name: 'September', programmeId: 'PROG-DATA', startDate: '2026-09-01', endDate: '2027-08-31' }] as never}
          groups={[{ id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', programmeId: 'PROG-DATA', weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00' }] as never}
          tutorNames={['Tutor One', 'Tutor Two']}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </MemoryRouter>,
    );
  }

  it('rebases onto the stored module and retries against its version', async () => {
    vi.mocked(updateCurriculumModule)
      // Somebody saved this module while the reader was renaming it, and their
      // save moved the status.
      .mockRejectedValueOnce(conflict(storedModule({ status: 'active' }), 'rev-11', 'module'))
      .mockResolvedValueOnce({ updated: true, module: storedModule() as never, revision: 'rev-12' });
    renderModuleDrawer();
    await waitFor(() => expect(fetchCurriculumRevisions).toHaveBeenCalled());

    const name = screen.getByPlaceholderText('e.g. Data Modelling');
    await userEvent.clear(name);
    await userEvent.type(name, 'B renamed it');
    await userEvent.click(screen.getByRole('button', { name: /save module/i }));

    await waitFor(() => expect(updateCurriculumModule).toHaveBeenCalledTimes(2));
    const bodies = vi.mocked(updateCurriculumModule).mock.calls.map(call => call[1] as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ expectedRevision: 'rev-10' });
    expect(bodies[1]).toMatchObject({ name: 'B renamed it', expectedRevision: 'rev-11' });
    // Nothing of the reader's went missing on the way through the rebase.
    expect(name).toHaveValue('B renamed it');
  });
});
