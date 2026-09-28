import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroupModule, previewModuleSessionPlan, previewTutorAvailabilityRoster, updateCurriculumModule } from '@/lib/curriculumApi';
import type { CurriculumGroup } from '@/lib/curriculumApi';
import { ModuleFormDrawer, type ModuleFormTarget } from '../moduleForm';

/**
 * Two people with the same module's placement open.
 *
 * The delivery pattern -- which days it runs on, and at what times -- is the
 * part that matters most here. It is chosen as one decision and it is what the
 * Teams calendar is built from, so it merges as one value: one editor's whole
 * pattern survives. Taking this reader's days with the other editor's times
 * would produce a timetable neither of them chose, and the calendar would then
 * go and book it.
 */

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(), showCurriculumConfirm: vi.fn(),
}));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  createGroupModule: vi.fn(), updateCurriculumModule: vi.fn(),
  previewModuleSessionPlan: vi.fn(), previewTutorAvailabilityRoster: vi.fn(),
}));

const group = {
  id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', programmeId: 'PROG-1',
  weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00',
} as CurriculumGroup;

/** The module row as the list behind the drawer is holding it. */
function storedModule(overrides: Partial<ModuleFormTarget> = {}): ModuleFormTarget {
  return {
    id: 'MOD-1',
    name: 'Data Modelling',
    programmeId: 'PROG-1',
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

function renderDrawer(module: ModuleFormTarget) {
  const props = (value: ModuleFormTarget) => ({
    open: true as const,
    module: value,
    programmes: [{ id: 'PROG-1', sourceId: 'PROG-1', name: 'Programme', isActive: true }] as never,
    cohorts: [{ id: 'COHORT-1', name: 'September', programmeId: 'PROG-1', startDate: '2026-09-01', endDate: '2027-08-31' }] as never,
    groups: [group],
    tutorNames: ['Tutor One'],
    onClose: vi.fn(),
    onSaved: vi.fn(),
  });
  const view = render(<MemoryRouter><ModuleFormDrawer {...props(module)} /></MemoryRouter>);
  return {
    /** The list refreshing behind the drawer with what somebody else stored. */
    remoteSaveArrives: (next: ModuleFormTarget) => view.rerender(<MemoryRouter><ModuleFormDrawer {...props(next)} /></MemoryRouter>),
  };
}

const nameField = () => screen.getByPlaceholderText('e.g. Data Modelling');

/** Pick from one of the drawer's comboboxes, the way a reader does. */
async function choose(field: string, value: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(field, 'i') }));
  await userEvent.click(screen.getByRole('option', { name: new RegExp(`^${value}$`) }));
}

describe('module drawer co-editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createGroupModule).mockResolvedValue({ created: [{ moduleCatalogueId: 'MOD-NEW' }] } as never);
    vi.mocked(updateCurriculumModule).mockResolvedValue({ updated: true } as never);
    vi.mocked(previewTutorAvailabilityRoster).mockResolvedValue({ sessionDates: [], startTime: '', endTime: '', bookable: false, results: [], availableCount: 0, busyCount: 0 });
    vi.mocked(previewModuleSessionPlan).mockResolvedValue({ sessions: [], finalEndDate: '', warnings: [], skippedHolidays: [] });
  });

  it('brings in a field this reader has not touched', async () => {
    const { remoteSaveArrives } = renderDrawer(storedModule());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');

    // They changed the tutor; this reader never went near it.
    remoteSaveArrives(storedModule({ status: 'active' }));

    expect(await screen.findByDisplayValue('B renamed it')).toBeInTheDocument();
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });

  it('does not expose delivery pattern fields for co-editing', () => {
    renderDrawer(storedModule());

    expect(screen.queryByRole('combobox', { name: /Sessions per week/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Delivery days/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Start date/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^End date/i)).not.toBeInTheDocument();
  });

  it('keeps the module name edit when a refresh carries group-owned schedule data', async () => {
    const { remoteSaveArrives } = renderDrawer(storedModule());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'B renamed it');

    remoteSaveArrives(storedModule({ weekDays: 'Thursday', startTime: '14:00', endTime: '16:00' }));

    expect(nameField()).toHaveValue('B renamed it');
    expect(screen.queryByDisplayValue('14:00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thu' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });

  it('does not reset the drawer when a refresh carried no change', async () => {
    const { remoteSaveArrives } = renderDrawer(storedModule());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Half-typed nam');

    remoteSaveArrives(storedModule());
    remoteSaveArrives(storedModule());

    expect(nameField()).toHaveValue('Half-typed nam');
    expect(screen.queryByTestId('co-edit-notice')).not.toBeInTheDocument();
  });
});
