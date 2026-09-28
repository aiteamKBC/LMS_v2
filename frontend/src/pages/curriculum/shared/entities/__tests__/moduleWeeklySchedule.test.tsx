import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroupModule, previewModuleSessionPlan, previewTutorAvailabilityRoster, updateCurriculumModule } from '@/lib/curriculumApi';
import type { CurriculumGroup, CurriculumModule } from '@/lib/curriculumApi';
import { ModuleFormDrawer, moduleFormTarget, type ModuleFormTarget } from '../moduleForm';

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
  startDate: '2026-09-02', endDate: '2027-08-31',
} as CurriculumGroup;

function drawer(module?: ModuleFormTarget, extraGroups: CurriculumGroup[] = []) {
  return render(<MemoryRouter><ModuleFormDrawer
    open module={module}
    programmes={[{ id: 'PROG-1', sourceId: 'PROG-1', name: 'Programme', isActive: true }] as never}
    cohorts={[{ id: 'COHORT-1', name: 'September', programmeId: 'PROG-1', startDate: '2026-09-01', endDate: '2027-08-31' }] as never}
    groups={[group, ...extraGroups]} tutorNames={['Tutor One']}
    defaults={{ programmeId: 'PROG-1', cohortId: 'COHORT-1', groupId: 'GROUP-1' }}
    onClose={vi.fn()} onSaved={vi.fn()}
  /></MemoryRouter>);
}

async function choose(field: string, value: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(field, 'i') }));
  await userEvent.click(screen.getByRole('option', { name: new RegExp('^' + value + '$') }));
}

describe('module drawer group-owned scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createGroupModule).mockResolvedValue({ created: [{ moduleCatalogueId: 'MOD-NEW' }] } as never);
    vi.mocked(updateCurriculumModule).mockResolvedValue({ updated: true } as never);
    vi.mocked(previewModuleSessionPlan).mockResolvedValue({ sessions: [], finalEndDate: '', warnings: [], skippedHolidays: [] });
    vi.mocked(previewTutorAvailabilityRoster).mockResolvedValue({ sessionDates: [], startTime: '', endTime: '', bookable: false, results: [], availableCount: 0, busyCount: 0 });
  });

  it('shows module dates and a read-only summary of the selected Group schedule', () => {
    drawer();

    expect(screen.queryByRole('combobox', { name: /Sessions per week/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Delivery days/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^End date/i)).toBeInTheDocument();
    expect(screen.getByText(/The selected Group supplies the delivery days and session times/i)).toBeInTheDocument();
    expect(screen.getByText(/Group A delivers Wednesday, 10:00 AM - 12:00 PM/i)).toBeInTheDocument();
  });

  it('creates the module with its own date window and the selected Group schedule', async () => {
    drawer();
    await userEvent.type(screen.getByPlaceholderText('e.g. Data Modelling'), 'Group-owned schedule');
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Weeks/ }), { target: { value: '4' } });
    await choose('Tutor', 'Tutor One');
    await userEvent.click(screen.getByRole('button', { name: 'Create module' }));

    await waitFor(() => expect(createGroupModule).toHaveBeenCalledWith('GROUP-1', expect.objectContaining({
      weeks: 4,
      sessionsNumber: 4,
      weekDays: 'Wednesday',
      startTime: '10:00',
      endTime: '12:00',
      startDate: '2026-09-01',
      endDate: '2026-09-28',
      weeklySchedule: [{ day: 'Wednesday', startTime: '10:00', endTime: '12:00' }],
    })));
  });

  it('uses the selected Group when editing a module with stale schedule fields', async () => {
    const module = moduleFormTarget({
      id: 'MOD-SAVED', name: 'Saved module', programmeId: 'PROG-1', cohortId: 'COHORT-1', groupId: 'GROUP-1',
      weeks: 4, sessionsNumber: 4, weekDays: 'Monday', startTime: '09:00', endTime: '11:00',
      startDate: '2026-09-07', endDate: '2026-10-01', tutor: 'Tutor One',
    } as CurriculumModule)!;
    drawer(module);

    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));

    await waitFor(() => expect(updateCurriculumModule).toHaveBeenCalledWith('MOD-SAVED', expect.objectContaining({
      sessionsNumber: 4,
      weekDays: 'Wednesday',
      startTime: '10:00',
      endTime: '12:00',
       startDate: '2026-09-07',
       endDate: '2026-10-01',
      weeklySchedule: [{ day: 'Wednesday', startTime: '10:00', endTime: '12:00' }],
    })));
  });
});
