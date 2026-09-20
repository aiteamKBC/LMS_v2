import { useState, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumEntities } from '@/hooks/useCurriculumEntities';
import { archiveCurriculumModule, createGroupModule, updateCurriculumModule } from '@/lib/curriculumApi';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import GroupWorkspacePage from '../page';

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(),
  showCurriculumConfirm: vi.fn(async () => false),
}));
vi.mock('@/pages/curriculum/module-builder/moduleAuthoringData', () => ({
  createNewModule: vi.fn(),
}));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  archiveCurriculumModule: vi.fn(async (id: string) => ({ archived: true, id })),
  updateCurriculumModule: vi.fn(async () => ({ updated: true })),
  createGroupModule: vi.fn(),
  previewModuleSessionPlan: vi.fn(async () => ({
    sessions: [{ sessionNumber: 1, date: '2026-09-02', day: 'Wednesday', skippedHolidays: [] }],
    finalEndDate: '2026-09-02', warnings: [], skippedHolidays: [],
  })),
  previewTutorAvailabilityRoster: vi.fn(async () => ({
    sessionDates: [], startTime: '', endTime: '', bookable: false,
    results: [], availableCount: 0, busyCount: 0,
  })),
}));

const fixture = {
  programmes: [{ id: 'PROG-1', sourceId: 'PROG-1', name: 'Example programme', isActive: true }],
  cohorts: [{
    id: 'COHORT-1', name: 'September', programmeId: 'PROG-1',
    startDate: '2026-09-01', endDate: '2027-08-31', status: 'active',
  }],
  groups: [
    { id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', programmeId: 'PROG-1', weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00' },
    { id: 'GROUP-2', name: 'Group B', cohortId: 'COHORT-1', programmeId: 'PROG-1', weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00' },
  ],
  // Same titles with different catalogue/delivery IDs exercise the actual row selection.
  modules: [1, 2, 3].map(index => ({
    id: `DELIVERY-${index}`, moduleCatalogueId: `MOD-${index}`, name: 'Data Foundations',
    groupId: index === 3 ? 'GROUP-2' : 'GROUP-1', cohortId: 'COHORT-1', programmeId: 'PROG-1',
    tutor: 'Tutor One', weeks: 1, sessionsNumber: 1, lessons: 1,
    startDate: '2026-09-02', endDate: '2026-09-02', status: 'published',
    weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00',
    notes: `Notes for module ${index}`, color: '#123456',
  })),
  tutors: [{ id: 1, name: 'Tutor One' }], coaches: [], holidays: [], teamsMeetings: [],
} as unknown as CurriculumEntities;

const reload = vi.fn(async () => null);
vi.mock('@/hooks/useCurriculumEntities', () => ({
  useCurriculumEntities: function useMockEntities() {
    const [entities, applyLocal] = useState(fixture);
    return { ...entities, applyLocal, reload, loaded: true, loading: false, refreshing: false, error: null };
  },
}));

async function openModules() {
  render(<MemoryRouter initialEntries={['/curriculum/groups/GROUP-1']}>
    <Routes>
      <Route path="/curriculum/groups/:id" element={<GroupWorkspacePage />} />
      <Route path="/curriculum/modules/:id" element={<div>Module workspace navigation</div>} />
    </Routes>
  </MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: /^Modules/ }));
}

describe('group module actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(archiveCurriculumModule).mockResolvedValue({ archived: true, id: 'MOD-2' });
    // Any accidentally unmocked transport fails without contacting the app or database.
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('edits the selected canonical module, keeps stored fields and refreshes after saving', async () => {
    await openModules();
    expect(screen.getAllByRole('button', { name: 'Edit module' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Archive module' })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit module' })[1]);
    expect(screen.getByRole('heading', { name: 'Edit module' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Notes for module 2');
    const name = screen.getByPlaceholderText('e.g. Data Modelling');
    await userEvent.clear(name);
    await userEvent.type(name, 'Updated foundations');
    await userEvent.click(screen.getByRole('button', { name: 'Save module' }));
    await waitFor(() => expect(updateCurriculumModule).toHaveBeenCalledTimes(1));
    expect(updateCurriculumModule).toHaveBeenCalledWith('MOD-2', expect.objectContaining({
      name: 'Updated foundations', notes: 'Notes for module 2', status: 'published',
      color: '#123456', groupId: 'GROUP-1', cohortId: 'COHORT-1', tutor: 'Tutor One',
      sessionsNumber: 1, startDate: '2026-09-02', endDate: '2026-09-02',
    }));
    expect(createGroupModule).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledWith({ silent: true });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit module' })).not.toBeInTheDocument());
    expect(screen.queryByText('Module workspace navigation')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    expect(screen.getByPlaceholderText('e.g. Data Modelling')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create module' })).toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])('opens Edit from the keyboard with %s without navigating the row', async key => {
    await openModules();
    screen.getAllByRole('button', { name: 'Edit module' })[0].focus();
    await userEvent.keyboard(key);
    expect(screen.getByRole('heading', { name: 'Edit module' })).toBeInTheDocument();
    expect(screen.queryByText('Module workspace navigation')).not.toBeInTheDocument();
    expect(updateCurriculumModule).not.toHaveBeenCalled();
  });

  it('keeps rows when archive is cancelled and removes only the confirmed module after success', async () => {
    await openModules();
    screen.getAllByRole('button', { name: 'Archive module' })[1].focus();
    await userEvent.keyboard('{Enter}');
    expect(showCurriculumConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Archive module?' }));
    expect(archiveCurriculumModule).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link', { name: /Data Foundations/ })).toHaveLength(2);
    expect(screen.queryByText('Module workspace navigation')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Archive module' })[1]);
    const confirmation = vi.mocked(showCurriculumConfirm).mock.calls.at(-1)![0];
    await act(async () => { await confirmation.onConfirm(); });
    expect(archiveCurriculumModule).toHaveBeenCalledExactlyOnceWith('MOD-2');
    const remaining = screen.getAllByRole('link', { name: /Data Foundations/ });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveAttribute('href', '/curriculum/modules/MOD-1?moduleName=Data+Foundations');
    expect(screen.getByRole('button', { name: /^Modules/ })).toHaveTextContent('1');
    expect(reload).toHaveBeenCalledWith({ silent: true });
  });

  it('keeps the module and lets the shared confirmation report an archive failure', async () => {
    vi.mocked(archiveCurriculumModule).mockRejectedValueOnce(new Error('Archive unavailable'));
    await openModules();
    await userEvent.click(screen.getAllByRole('button', { name: 'Archive module' })[0]);
    const confirmation = vi.mocked(showCurriculumConfirm).mock.calls.at(-1)![0];
    await expect(confirmation.onConfirm()).rejects.toThrow('Archive unavailable');
    expect(screen.getAllByRole('link', { name: /Data Foundations/ })).toHaveLength(2);
    expect(reload).not.toHaveBeenCalled();
  });
});
