import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';
import type { ModuleCatalogueItem, ModuleWeek } from '../moduleAuthoringData';

/**
 * The Course structure rail, read as a timetable.
 *
 * A module is authored week by week but delivered by month, so the rail has to
 * say which month each stretch of weeks belongs to — and the split has to follow
 * the module's own dates, so a six-week module that crosses a closed Christmas
 * reads as one week in December and five in January rather than as six weeks in
 * a row that hide where the year changed.
 */

function week(number: number, sessionDate: string): ModuleWeek {
  return {
    id: `WEEK-${number}`,
    moduleId: 'MOD-WEEKS',
    weekNumber: number,
    title: `Week ${number}`,
    summary: '',
    learningOutcomes: [],
    components: [],
    ksbMappings: [],
    sessionDate,
    sessionDay: 'Saturday',
  };
}

const structure = {
  id: 'module-MOD-WEEKS',
  catalogueId: 'MOD-WEEKS',
  programmeId: 'PROG-DATA',
  programmeName: 'Data Analyst',
  title: 'Fouda-ss',
  description: '',
  status: 'published',
  sessionsNumber: 6,
  startDate: '2026-12-12',
  endDate: '2027-01-30',
  weeks: 6,
  totalOtjh: 0,
  ksbCount: 0,
  lessonCount: 0,
  quizCount: 0,
  qualityScore: 0,
  moduleKsbMappings: [],
  background: '',
  epaRequirements: [],
  qualificationOutcomes: [],
  weekStructure: [
    week(1, '2026-12-12'),
    week(2, '2027-01-02'),
    week(3, '2027-01-09'),
    week(4, '2027-01-16'),
    week(5, '2027-01-23'),
    week(6, '2027-01-30'),
  ],
} as unknown as ModuleCatalogueItem;

const loadModuleStructure = vi.fn(async () => structure);

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/pages/curriculum/week-builder/weekTemplateData', () => ({
  fetchComponentPointsDefaults: vi.fn(async () => ({})),
  loadCurriculumScope: vi.fn(async () => ({ programmes: [], cohorts: [], groups: [] })),
  fetchWeekTemplates: vi.fn(async () => []),
  fetchWeekTemplateDetail: vi.fn(async () => null),
  filterWeekTemplatesForScope: () => [],
}));

vi.mock('@/pages/curriculum/shared/components/weekAuthoringLazy', () => ({
  ComponentEditor: () => null,
  WeekComponentRail: () => null,
  WeekOverviewPanel: () => null,
}));

vi.mock('../moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../moduleAuthoringData')>()),
  loadModuleStructure: (...args: unknown[]) => loadModuleStructure(...(args as [])),
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst' },
] as CurriculumProgramme[];

const modules = [
  {
    id: 'MOD-WEEKS',
    moduleCatalogueId: 'MOD-WEEKS',
    name: 'Fouda-ss',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    sessionsNumber: 6,
    status: 'published',
  },
] as CurriculumModule[];

vi.mock('@/hooks/useCurriculumModules', () => ({
  useCurriculumModules: () => ({ modules, loading: false, error: null, reload: vi.fn(async () => null) }),
}));

vi.mock('@/hooks/useCurriculumProgrammes', () => ({
  useCurriculumProgrammes: () => ({ programmes, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('@/hooks/useCurriculumKsbSets', () => ({
  useCurriculumKsbSets: () => ({ ksbSets: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumTutors: vi.fn(async () => []),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  fetchCurriculumOverview: vi.fn(async () => ({ programmes, cohorts: [], groups: [], modules })),
  fetchCurriculumHolidays: vi.fn(async () => []),
}));

async function openBuilder() {
  window.history.replaceState({}, '', '/curriculum/module-builder?module=MOD-WEEKS');
  const { default: ModuleBuilder } = await import('../page');
  return render(
    <MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-WEEKS']}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
}

describe('Course structure months', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('heads each stretch of weeks with the month it runs in', async () => {
    await openBuilder();
    await waitFor(() => expect(loadModuleStructure).toHaveBeenCalledWith('MOD-WEEKS'));

    expect(await screen.findByText('December 2026')).toBeInTheDocument();
    expect(await screen.findByText('January 2027')).toBeInTheDocument();
    // The counts are what make the split readable: December holds the one week
    // before the closure, January the five that were pushed past it.
    expect(await screen.findByText('1 week · 0.0h')).toBeInTheDocument();
    expect(await screen.findByText('5 weeks · 0.0h')).toBeInTheDocument();
    // And each week says the day it actually runs.
    expect(await screen.findByText('12 Dec 2026')).toBeInTheDocument();
    expect(await screen.findByText('30 Jan 2027')).toBeInTheDocument();
  });
});
