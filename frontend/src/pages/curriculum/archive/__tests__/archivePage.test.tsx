import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumArchivedCohort,
  CurriculumArchivedGroup,
  CurriculumArchivedModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';

/**
 * The Curriculum archive, now that it is the only one.
 *
 * Programmes and the Module Builder used to carry a "View archive" toggle over
 * their own records; both were removed, and this page is where every archived
 * record is read and acted on. That makes it the single point of failure for
 * the thing those toggles existed to prevent: a record archived by accident
 * with no way back to it from the product.
 *
 * So what is asserted here is what has to survive a merge — an archived module
 * is listed, Restore actually calls the restore endpoint, and the deep link the
 * audit trail builds (`?type=module&q=<id>`) lands on the one record it names
 * rather than on the whole list.
 */

const archivedModule: CurriculumArchivedModule = {
  id: 'MOD-ARCHIVED',
  catalogueId: 'MOD-ARCHIVED',
  title: 'Project Management Professional',
  programme: 'Team Leader',
  programmeId: 'PROG-TL',
  cohort: 'September Intake',
  group: 'Group A',
  tutor: 'Dana Wills',
  weeks: 34,
  sessions: 34,
  components: 601,
  archivedAt: '2026-08-01T09:00:00Z',
  archivedBy: '',
  programmeArchived: false,
} as CurriculumArchivedModule;

// A second archived module, so "the link filtered the list" is a real claim and
// the counts below belong to one row rather than to whatever rendered first.
const otherArchivedModule: CurriculumArchivedModule = {
  ...archivedModule,
  id: 'MOD-OTHER',
  catalogueId: 'MOD-OTHER',
  title: 'Data Foundations',
  weeks: 12,
  sessions: 12,
  components: 40,
} as CurriculumArchivedModule;

const fetchCurriculumProgrammes = vi.fn(async (): Promise<CurriculumProgramme[]> => []);
const fetchArchivedCurriculumCohorts = vi.fn(async (): Promise<CurriculumArchivedCohort[]> => []);
const fetchArchivedCurriculumGroups = vi.fn(async (): Promise<CurriculumArchivedGroup[]> => []);
const fetchArchivedCurriculumModules = vi.fn(async (): Promise<CurriculumArchivedModule[]> => [
  archivedModule,
  otherArchivedModule,
]);
const fetchArchivedModuleStructure = vi.fn(async () => null);
const restoreCurriculumModule = vi.fn(async () => ({ restored: true, id: 'MOD-ARCHIVED' }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The confirm is answered "yes" rather than stubbed out, or Restore would be
// clicked and nothing behind it would ever run.
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async (options: { onConfirm?: () => Promise<void> | void }) => {
    await options.onConfirm?.();
    return true;
  }),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
  return {
    ...actual,
    fetchCurriculumProgrammes: (...args: unknown[]) => fetchCurriculumProgrammes(...(args as [])),
    fetchArchivedCurriculumCohorts: (...args: unknown[]) => fetchArchivedCurriculumCohorts(...(args as [])),
    fetchArchivedCurriculumGroups: (...args: unknown[]) => fetchArchivedCurriculumGroups(...(args as [])),
    fetchArchivedCurriculumModules: (...args: unknown[]) => fetchArchivedCurriculumModules(...(args as [])),
    fetchArchivedModuleStructure: (...args: unknown[]) => fetchArchivedModuleStructure(...(args as [])),
    restoreCurriculumModule: (...args: unknown[]) => restoreCurriculumModule(...(args as [])),
  };
});

const { default: CurriculumArchivePage } = await import('../page');

function renderArchive(route = '/curriculum/archive') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <CurriculumArchivePage />
    </MemoryRouter>,
  );
}

describe('Curriculum archive', { timeout: 15000 }, () => {
  beforeEach(() => {
    fetchArchivedCurriculumModules.mockClear();
    restoreCurriculumModule.mockClear();
  });

  it('lists what is in the archive, with what a restore would bring back', async () => {
    renderArchive();

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    // The counts are the whole decision, so they are on the row rather than
    // behind the details panel.
    expect(screen.getByText(/34 weeks/)).toBeInTheDocument();
    expect(screen.getByText(/601 components/)).toBeInTheDocument();
  });

  it('restores an archived module and re-reads the archive behind it', async () => {
    // Filtered to the one module, so the Restore clicked below is unambiguously
    // its own: the rows sort by name, and this is not the first of the two.
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED');
    await screen.findByText('Project Management Professional');

    await userEvent.click(await screen.findByRole('button', { name: /restore/i }));

    await waitFor(() => expect(restoreCurriculumModule).toHaveBeenCalledWith('MOD-ARCHIVED'));
    // The row it dealt with has to leave the list, which means re-reading it.
    await waitFor(() => expect(fetchArchivedCurriculumModules).toHaveBeenCalledTimes(2));
  });

  it('opens on the one record a ?type= and ?q= link names', async () => {
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED');

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    // The other archived module is real and still archived; the link asked for
    // one record, so the list has to be filtered rather than merely scrolled.
    expect(screen.queryByText('Data Foundations')).not.toBeInTheDocument();
  });
});
