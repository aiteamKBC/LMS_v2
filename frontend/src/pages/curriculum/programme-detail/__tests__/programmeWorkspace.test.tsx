import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumCohort,
  CurriculumComponent,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';

/**
 * The Programme workspace is the top of the hierarchy, and every level below it
 * already has a page that owns it. So this page is only allowed to answer the
 * questions that need the whole programme in view; anything that belongs to one
 * cohort, group or module is *opened*, never redrawn here.
 *
 * These tests pin that boundary, because it is exactly what drifted before: the
 * page had grown a flat Groups tab that repeated the Cohorts tab, a Weeks tab
 * that repeated the module's own timeline, and a Review tab that drew cohorts,
 * groups, modules and weeks a third time.
 */

const programme = {
  id: 'program-data',
  sourceId: 'PROG-DATA',
  name: 'Data Analyst',
  standard: 'ST0118',
  level: 'Level 4',
  owner: 'Rachel Myers',
  color: '#6941c6',
  description: 'Data curriculum',
} as CurriculumProgramme;

const cohorts = [
  {
    id: 'COHORT-1',
    name: 'Sept 2026',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    startDate: '2026-09-02',
    endDate: '2027-06-30',
    apprenticeshipEndDate: '2027-09-30',
    epaMonths: 3,
    status: 'active',
    learners: 12,
    holidayIds: [],
    modules: [],
  },
] as unknown as CurriculumCohort[];

const groups = [
  {
    id: 'GROUP-1',
    name: 'Group A',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    learners: 12,
    coach: 'Coach One',
    // Carried by the payload, and deliberately never rendered on a group: the
    // tutor is assigned per module, in the module form.
    tutor: 'Tutor One',
    startDate: '2026-09-02',
    endDate: '2027-06-30',
    status: 'active',
    schedule: 'Mondays',
    mode: 'Live',
    modules: ['Data Foundations'],
    sessions: 6,
  },
] as unknown as CurriculumGroup[];

const modules = [
  {
    id: 'MOD-1',
    moduleCatalogueId: 'MOD-1',
    sourceId: 1,
    name: 'Data Foundations',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    groupId: 'GROUP-1',
    group: 'Group A',
    tutor: 'Tutor One',
    weeks: 1,
    status: 'published',
    ksbCodes: ['K1'],
  },
  {
    // Stored against a cohort that is not a cohort record on this programme.
    // The page used to synthesize a cohort row for it, which is why its cohort
    // count could disagree with the Cohorts page.
    id: 'MOD-2',
    moduleCatalogueId: 'MOD-2',
    sourceId: 2,
    name: 'Orphan Module',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    cohort: 'Ghost Cohort',
    group: 'Ghost Group',
    tutor: '',
    weeks: 0,
    status: 'draft',
    ksbCodes: [],
  },
] as unknown as CurriculumModule[];

const components = [
  {
    id: 'COMP-1',
    moduleCatalogueId: 'MOD-1',
    title: 'Intro live session',
    type: 'Live Session',
    module: 'Data Foundations',
    programme: 'Data Analyst',
    week: 'Week 1',
    weekTitle: 'Getting started',
    duration: 60,
    expectedOtjh: 1,
    ksbRefs: ['K1'],
    status: 'published',
    lastEdited: '',
    settings: {
      liveSessionUrl: 'https://teams.example/meet/1',
      sessionDate: '2026-09-07',
      sessionTime: '09:00',
      attendanceRequired: true,
    },
  },
] as unknown as CurriculumComponent[];

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumProgrammeDetail: vi.fn(async () => ({
    schema: 'test',
    programme,
    cohorts: [],
    flat: { cohorts, groups, groupIds: ['GROUP-1'], modules, sessions: [], components: [] },
  })),
  fetchCurriculumComponents: vi.fn(async () => components),
  fetchCurriculumProgrammes: vi.fn(async () => [programme]),
  fetchCurriculumCoaches: vi.fn(async () => [{ id: 1, name: 'Coach One' }, { id: 2, name: 'Coach Two' }]),
  fetchCurriculumTutors: vi.fn(async () => [{ id: 3, name: 'Tutor One' }]),
  fetchCurriculumKsbFrameworks: vi.fn(async () => []),
  fetchCurriculumHolidays: vi.fn(async () => []),
  fetchCurriculumKsbSets: vi.fn(async () => []),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => null),
  fetchCurriculumProgrammeLearnerRoster: vi.fn(async () => ({ assignedLearners: [] })),
  fetchCurriculumProgrammeLearnerKsbImpact: vi.fn(async () => null),
}));

async function renderWorkspace() {
  const { default: ProgrammeDetailPage } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={['/curriculum/programmes/PROG-DATA']}>
      <Routes>
        <Route path="/curriculum/programmes/:id" element={<ProgrammeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Data Analyst' });
  return result;
}

/** The tab strip, which is the page's table of contents. */
function tabStrip() {
  const overview = screen.getByRole('button', { name: /Overview/ });
  const strip = overview.parentElement?.parentElement;
  if (!strip) throw new Error('No tab strip rendered');
  return within(strip);
}

async function openTab(name: RegExp) {
  await userEvent.click(tabStrip().getByRole('button', { name }));
}

describe('Programme workspace', { timeout: 15000 }, () => {
  it('opens with the programme in a header, not straight into a records table', async () => {
    await renderWorkspace();

    // The other three Curriculum workspaces all open with this: breadcrumb,
    // title, and the counts that say what state the record is in. This page had
    // none of it and began at its tab strip.
    expect(screen.getByRole('link', { name: 'Programmes' })).toHaveAttribute('href', '/curriculum/programmes');
    expect(screen.getByRole('heading', { name: 'Data Analyst' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit programme/ })).toBeInTheDocument();
  });

  it('carries one tab per programme-level question and none that repeat a lower level', async () => {
    await renderWorkspace();
    const strip = tabStrip();

    expect(strip.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
    expect(strip.getByRole('button', { name: /Design/ })).toBeInTheDocument();
    expect(strip.getByRole('button', { name: /Delivery/ })).toBeInTheDocument();
    expect(strip.getByRole('button', { name: /Coverage/ })).toBeInTheDocument();
    expect(strip.getByRole('button', { name: /Quality/ })).toBeInTheDocument();

    // Groups were the Cohorts tab again, flattened; Weeks was the module's own
    // timeline; Review drew all of it a third time.
    expect(strip.queryByRole('button', { name: /^Groups/ })).not.toBeInTheDocument();
    expect(strip.queryByRole('button', { name: /^Weeks/ })).not.toBeInTheDocument();
    expect(strip.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
  });

  it('keeps Design recommended while providing a clear handoff to Delivery', async () => {
    await renderWorkspace();
    await openTab(/Design/);

    expect(screen.getByRole('button', { name: /Set up delivery instead/ })).toBeInTheDocument();
    expect(await screen.findByText('Design foundation ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Continue to Delivery/ }));

    expect(await screen.findByText('Cohorts & groups')).toBeInTheDocument();
  });

  it('sends the reader to the page that owns each record type rather than being a second catalogue', async () => {
    await renderWorkspace();

    expect(screen.getByRole('link', { name: /cohort/ })).toHaveAttribute('href', '/curriculum/cohorts?programme=PROG-DATA');
    expect(screen.getByRole('link', { name: /group/ })).toHaveAttribute('href', '/curriculum/groups?programme=PROG-DATA');
    expect(screen.getByRole('link', { name: /module/ })).toHaveAttribute('href', '/curriculum/module-builder?programme=PROG-DATA');
  });

  it('reports a module whose cohort is not a cohort record instead of inventing one', async () => {
    await renderWorkspace();

    // One cohort record, so one cohort — the orphan module does not add a second.
    expect(screen.getByRole('link', { name: /Cohorts page/ })).toHaveAccessibleName(/^1 cohort/);
    expect(screen.getByText(/not attached to a live cohort/)).toBeInTheDocument();
    expect(screen.getByText(/Ghost Cohort/)).toBeInTheDocument();
  });

  it('shows a cohort with its groups, and never a tutor on a group', async () => {
    await renderWorkspace();
    await openTab(/Delivery/);

    expect(screen.getByRole('link', { name: /^Sept 2026/ })).toHaveAttribute('href', '/curriculum/cohorts/COHORT-1');
    expect(screen.getByRole('link', { name: /Group A/ })).toHaveAttribute('href', '/curriculum/groups/GROUP-1');
    // The coach belongs to the group and is assignable in place.
    expect(screen.getByText('Coach One')).toBeInTheDocument();
    // The tutor does not, even though the group payload carries one.
    expect(screen.queryByText('Tutor One')).not.toBeInTheDocument();
  });

  it('lists modules as rows that open the module, not as cards that redraw it', async () => {
    await renderWorkspace();
    await openTab(/Design/);

    expect(screen.getByRole('link', { name: /^Data Foundations/ })).toHaveAttribute('href', '/curriculum/modules/MOD-1');
    // Row actions say what they do rather than leaving the reader to decode a
    // glyph, and there is one per module.
    expect(screen.getAllByRole('button', { name: 'Builder' })).toHaveLength(2);
    // A module's Teams series, week timeline and KSB weights are its own page's
    // job. Repeating them here is what made this tab a second module workspace.
    expect(screen.queryByText(/Fetch attendance & recordings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Week breakdown/)).not.toBeInTheDocument();
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
  });

  it('rolls every module up into one delivery schedule inside Delivery', async () => {
    await renderWorkspace();
    await openTab(/Delivery/);
    await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

    expect(screen.getByText('Intro live session')).toBeInTheDocument();
    expect(screen.getByText(/Week 1 · Getting started/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://teams.example/meet/1');
  });
});
