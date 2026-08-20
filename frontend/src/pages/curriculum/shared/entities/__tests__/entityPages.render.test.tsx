import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumHoliday,
  CurriculumModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';

/**
 * A lazy route test proves a page *imports*; it does not prove the page renders.
 * These mount each entity page and workspace against the same fixture and assert
 * the headline content, so a runtime error inside a page body cannot ship as a
 * blank screen.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

// Counted rather than stubbed away: the sessions tab used to set its own loading
// flag and watch it in the same dependency list, so every render tore down the
// request it had just started and began another -- a visible flicker on screen.
const fetchCurriculumSessions = vi.fn(async () => []);

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumSessions: (...args: unknown[]) => fetchCurriculumSessions(...(args as [])),
  previewModuleSessionPlan: vi.fn(async () => ({ sessions: [], finalEndDate: '', warnings: [] })),
}));

// The module workspace pulls its authored structure and Teams artifacts from the
// Module Builder's data layer; neither is under test here.
vi.mock('@/pages/curriculum/module-builder/moduleAuthoringData', () => ({
  loadModuleStructure: vi.fn(async () => null),
  loadTeamsMeetingArtifacts: vi.fn(async () => ({ series: {}, occurrences: [] })),
  restoreModuleTeamsMeeting: vi.fn(async () => ({ restored: true, updatedComponents: 0, meeting: {}, module: {} })),
  syncTeamsMeetingArtifacts: vi.fn(async () => ({ synced: {}, errors: [], partial: false })),
  teamsMeetingArtifactPreviewUrl: (session: string, artifact: string) => `/preview/${session}/${artifact}`,
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
    apprenticeshipEndDate: '2027-11-30',
    epaMonths: 3,
    durationMonths: 12,
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
    coach: 'Coach One',
    weekDays: 'Wednesday',
    startTime: '10:00',
    endTime: '12:00',
    status: 'active',
  },
] as unknown as CurriculumGroup[];

const modules = [
  {
    id: 'MOD-1',
    moduleCatalogueId: 'MOD-1',
    name: 'Data Foundations',
    groupId: 'GROUP-1',
    tutor: 'Tutor One',
    sessionsNumber: 6,
    startDate: '2026-09-02',
    endDate: '2026-10-07',
    status: 'published',
    weeks: 6,
  },
] as unknown as CurriculumModule[];

const holidays = [
  { id: '1', label: 'Christmas closure', startDate: '2026-12-24', endDate: '2027-01-02', type: 'Christmas' },
] as CurriculumHoliday[];

vi.mock('@/hooks/useCurriculumEntities', () => ({
  useCurriculumEntities: () => ({
    programmes,
    cohorts,
    groups,
    modules,
    holidays,
    tutors: [{ id: 1, name: 'Tutor One' }],
    coaches: [{ id: 2, name: 'Coach One' }],
    teamsMeetings: [],
    entities: {},
    loading: false,
    loaded: true,
    error: null,
    reload: vi.fn(async () => null),
  }),
}));

async function renderAt(importer: () => Promise<{ default: () => ReactNode }>, path: string, route: string) {
  const { default: Page } = await importer();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('entity pages render', () => {
  it('Cohorts lists a cohort with its calculated dates', async () => {
    await renderAt(() => import('../../../cohorts/page'), '/curriculum/cohorts', '/curriculum/cohorts');
    expect(await screen.findByText('Sept 2026')).toBeInTheDocument();
    expect(screen.getByText('30 Nov 2027')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 1 cohorts/)).toBeInTheDocument();
  });

  it('Groups lists a group with its cohort and timetable', async () => {
    await renderAt(() => import('../../../groups/page'), '/curriculum/groups', '/curriculum/groups');
    const table = (await screen.findByText('Group A')).closest('div[class*="divide-y"]') as HTMLElement;
    expect(within(table).getByText('Wednesday · 10:00–12:00')).toBeInTheDocument();
    expect(within(table).getByText('Coach One')).toBeInTheDocument();
    expect(within(table).getByText('Sept 2026')).toBeInTheDocument();
  });

  it('Holidays lists a holiday and the cohorts that selected it', async () => {
    await renderAt(() => import('../../../holidays/page'), '/curriculum/holidays', '/curriculum/holidays');
    expect(await screen.findByText('Christmas closure')).toBeInTheDocument();
    expect(screen.getByText('Sept 2026')).toBeInTheDocument();
  });

  it('Cohort workspace shows the cohort and its context', async () => {
    await renderAt(() => import('../../../cohort-workspace/page'), '/curriculum/cohorts/COHORT-1', '/curriculum/cohorts/:id');
    expect(await screen.findByRole('heading', { name: 'Sept 2026' })).toBeInTheDocument();
    expect(screen.getByText('Part of Data Analyst')).toBeInTheDocument();
  });

  it('Group workspace shows the group under its cohort and programme', async () => {
    await renderAt(() => import('../../../group-workspace/page'), '/curriculum/groups/GROUP-1', '/curriculum/groups/:id');
    expect(await screen.findByRole('heading', { name: 'Group A' })).toBeInTheDocument();
    expect(screen.getAllByText('Sept 2026 · Data Analyst').length).toBeGreaterThan(0);
  });

  it('Module workspace shows the module with the context derived through its group', async () => {
    await renderAt(() => import('../../../module-workspace/page'), '/curriculum/modules/MOD-1', '/curriculum/modules/:id');
    expect(await screen.findByRole('heading', { name: 'Data Foundations' })).toBeInTheDocument();
    // Programme / Cohort / Group, resolved from the group rather than the module.
    expect(screen.getAllByText('Data Analyst / Sept 2026 / Group A').length).toBeGreaterThan(0);
  });

  it('Module workspace asks for its sessions once instead of looping', async () => {
    fetchCurriculumSessions.mockClear();
    await renderAt(() => import('../../../module-workspace/page'), '/curriculum/modules/MOD-1?tab=sessions', '/curriculum/modules/:id');
    expect(await screen.findByRole('heading', { name: 'Data Foundations' })).toBeInTheDocument();

    await waitFor(() => expect(fetchCurriculumSessions).toHaveBeenCalled());
    // Long enough for a self-retriggering effect to have fired many more times.
    await new Promise(resolve => { setTimeout(resolve, 120); });
    expect(fetchCurriculumSessions).toHaveBeenCalledTimes(1);
  });

  it('Module workspace refuses to invent a record that does not exist', async () => {
    await renderAt(() => import('../../../module-workspace/page'), '/curriculum/modules/MOD-GONE', '/curriculum/modules/:id');
    expect(await screen.findByText('Module not found')).toBeInTheDocument();
  });
});
