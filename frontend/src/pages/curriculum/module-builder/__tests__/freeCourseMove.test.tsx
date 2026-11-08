import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFreeCourseToModule, fetchCurriculumDeliveryScope, type CurriculumProgramme } from '@/lib/curriculumApi';
import { FreeCourseMoveDrawer } from '../FreeCourseMoveDrawer';

vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumDeliveryScope: vi.fn(), convertFreeCourseToModule: vi.fn(),
}));

const programmes: CurriculumProgramme[] = [{ id: 'P1', name: 'Programme one' }, { id: 'P2', name: 'Programme two' }].map(item => ({
  ...item, sourceId: item.id, standard: '', level: '', modules: 0, weeks: 0, ksbMapped: 0,
  ksbTotal: 0, learners: 0, cohorts: 1, lastUpdated: '', owner: '', color: '', description: '',
}));
const scope: Awaited<ReturnType<typeof fetchCurriculumDeliveryScope>> = {
  cohorts: [{ id: 'C1', name: 'Cohort one', programmeId: 'P1' }, { id: 'C2', name: 'Cohort two', programmeId: 'P2' }].map(item => ({
    ...item, programme: programmes.find(programme => programme.id === item.programmeId)!.name,
    startDate: '', endDate: '', status: 'active', learners: 0, groups: [], modules: [], sessions: 0, color: '', progress: 0, attendance: 0,
  })),
  groups: [{ id: 'G1', name: 'Group one', programmeId: 'P1', cohortId: 'C1' }, { id: 'G2', name: 'Group two', programmeId: 'P2', cohortId: 'C2' }].map(item => ({
    ...item, programme: programmes.find(programme => programme.id === item.programmeId)!.name,
    cohort: item.cohortId === 'C1' ? 'Cohort one' : 'Cohort two', learners: 0, coach: '', tutor: '',
    startDate: '', endDate: '', status: 'active', schedule: '', mode: '', modules: [], sessions: 0,
  })),
};
const result = { converted: true, moduleCatalogueId: 'FREE-1', programmeId: 'P1', programmeName: 'Programme one',
  cohortId: 'C1', cohortName: 'Cohort one', groupId: 'G1', groupName: 'Group one' };
const moved = vi.fn();
const close = vi.fn();
const renderDrawer = () => render(<MemoryRouter><FreeCourseMoveDrawer module={{ catalogueId: 'FREE-1', title: 'Independent study' }}
  programmes={programmes} onClose={close} onMoved={moved} /></MemoryRouter>);
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}
async function destination(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Destination programme' })).toBeEnabled());
  await choose(user, 'Destination programme', 'Programme one');
  await choose(user, 'Destination cohort', 'Cohort one');
  await choose(user, 'Destination group', 'Group one');
}

describe('Move a free course into a module', () => {
  beforeEach(() => {
    vi.mocked(fetchCurriculumDeliveryScope).mockReset().mockResolvedValue(scope);
    vi.mocked(convertFreeCourseToModule).mockReset().mockResolvedValue(result);
    moved.mockReset().mockResolvedValue(undefined);
    close.mockReset();
  });
  it('requires a complete destination and submits the original course identity', async () => {
    const user = userEvent.setup(); renderDrawer();
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Destination cohort' })).toBeDisabled();
    await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(moved).toHaveBeenCalledWith(result));
    expect(convertFreeCourseToModule).toHaveBeenCalledExactlyOnceWith('FREE-1', { programmeId: 'P1', cohortId: 'C1', groupId: 'G1' });
  });
  it('clears dependent selections when the programme changes', async () => {
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await choose(user, 'Destination programme', 'Programme two');
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Destination group' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Destination cohort' }));
    expect(screen.queryByRole('option', { name: 'Cohort one' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cohort two' })).toBeInTheDocument();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
  it('keeps selections and allows retry when conversion fails', async () => {
    vi.mocked(convertFreeCourseToModule).mockRejectedValueOnce(new Error('Destination no longer available'));
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    expect(await screen.findByText('Destination no longer available')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Destination group' })).toHaveTextContent('Group one');
    expect(close).not.toHaveBeenCalled(); expect(moved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    await waitFor(() => expect(moved).toHaveBeenCalledWith(result));
  });
  it('reports destination loading failures and retries the read without a write', async () => {
    vi.mocked(fetchCurriculumDeliveryScope).mockRejectedValueOnce(new Error('Scope unavailable'));
    const user = userEvent.setup(); renderDrawer();
    expect(await screen.findByText('Scope unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry destinations' }));
    await destination(user);
    expect(screen.getByRole('button', { name: 'Move to module' })).toBeEnabled();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
  it('distinguishes a successful move from a failed refresh and does not repeat the write', async () => {
    moved.mockRejectedValueOnce(new Error('Refresh failed'));
    const user = userEvent.setup(); renderDrawer(); await destination(user);
    await user.click(screen.getByRole('button', { name: 'Move to module' }));
    expect(await screen.findByText(/course was moved, but the catalogue/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Destination programme' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh catalogue' }));
    await waitFor(() => expect(moved).toHaveBeenCalledTimes(2));
    expect(convertFreeCourseToModule).toHaveBeenCalledTimes(1);
  });
  it('can cancel without changing the course', async () => {
    const user = userEvent.setup(); renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(convertFreeCourseToModule).not.toHaveBeenCalled();
  });
});
