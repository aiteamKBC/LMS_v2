import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * Opening a record from a curriculum list and stepping Back has to land on the
 * list as it was left, so every control on these lists lives in the URL and is
 * read back from it on arrival.
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
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumStandards: vi.fn(async () => [{
    id: 'ST0001', code: 'ST0001', standardRef: 'ST0001', version: '1.0', name: 'Data analyst', status: 'Approved for delivery',
    level: '4', levelValue: '4', degree: '', route: 'Digital', duration: '18', minimumHours: '', maxFunding: '', larsCode: '1',
    eqaProvider: '', sourceUrl: '', approvedForDelivery: '', dateUpdated: '', lastSynced: '', knowledge: 1, skills: 1, behaviours: 1,
  }]),
}));

const programmes = [{ id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst', level: '4' }] as CurriculumProgramme[];
const cohorts = [{
  id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst', startDate: '2026-09-01',
  endDate: '2027-08-31', status: 'active',
}] as unknown as CurriculumCohort[];
const groups = [{
  id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026', programme: 'Data Analyst', programmeId: 'PROG-DATA',
  coach: 'Coach One', status: 'active',
}] as unknown as CurriculumGroup[];
const modules = [{
  id: 'MOD-1', moduleCatalogueId: 'MOD-1', name: 'Data Foundations', programme: 'Data Analyst', programmeId: 'PROG-DATA',
  groupId: 'GROUP-1', cohortId: 'COHORT-1', status: 'published', weeks: 6,
}] as unknown as CurriculumModule[];

// Whether the entities have loaded, as a store the mocked hook subscribes to.
const entitiesStore = vi.hoisted(() => {
  let loaded = true;
  const listeners = new Set<() => void>();
  return {
    read: () => loaded,
    set(value: boolean) { loaded = value; listeners.forEach(listener => listener()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});
const reloadEntities = vi.fn(async () => null);

vi.mock('@/hooks/useCurriculumEntities', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useCurriculumEntities: () => {
      const loaded = useSyncExternalStore(entitiesStore.subscribe, entitiesStore.read);
      return {
        programmes: loaded ? programmes : [], cohorts: loaded ? cohorts : [], groups: loaded ? groups : [],
        modules: loaded ? modules : [], holidays: [], tutors: [], coaches: [{ id: 2, name: 'Coach One' }], teamsMeetings: [],
        entities: {}, loading: !loaded, loaded, refreshing: false, error: null, reload: reloadEntities, applyLocal: vi.fn(),
      };
    },
  };
});

vi.mock('@/hooks/useCurriculumData', () => ({
  useCurriculumData: () => ({ data: { programmes, cohorts, groups, modules }, loading: false, error: null, reload: vi.fn() }),
}));

function Address() {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

async function renderAt(importer: () => Promise<{ default: () => ReactNode }>, path: string, search: string) {
  const { default: Page } = await importer();
  return render(
    <MemoryRouter initialEntries={[`${path}${search}`]}>
      <Routes><Route path={path} element={<><Page /><Address /></>} /></Routes>
    </MemoryRouter>,
  );
}

function address() {
  return new URLSearchParams(screen.getByTestId('address').textContent || '');
}

describe('curriculum lists keep their place in the URL', { timeout: 20000 }, () => {
  beforeEach(() => {
    entitiesStore.set(true);
    // Vite auto-imports these in the app; the standalone test config does not.
    vi.stubGlobal('AppIcon', AppIcon);
    vi.stubGlobal('useMemo', useMemo);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Cohorts returns with its search, year and sort, and writes new ones back', async () => {
    await renderAt(() => import('../../../cohorts/page'), '/curriculum/cohorts', '?programme=PROG-DATA&q=Sept&year=2026&sort=name');
    const searchBox = await screen.findByPlaceholderText('Search cohorts, programmes, dates...');
    expect(searchBox).toHaveValue('Sept');
    expect(address().get('year')).toBe('2026');
    expect(address().get('sort')).toBe('name');

    fireEvent.change(searchBox, { target: { value: 'Sept 2026' } });
    await waitFor(() => expect(address().get('q')).toBe('Sept 2026'));
    expect(address().get('programme')).toBe('PROG-DATA');
  });

  it('Groups keeps a returning cohort filter while the cohorts are still loading', async () => {
    entitiesStore.set(false);
    await renderAt(() => import('../../../groups/page'), '/curriculum/groups', '?programme=PROG-DATA&cohort=COHORT-1&q=Group&coach=Coach+One');
    expect(await screen.findByPlaceholderText('Search groups, cohorts, coaches...')).toHaveValue('Group');
    expect(address().get('cohort')).toBe('COHORT-1');

    act(() => entitiesStore.set(true));
    await screen.findByText('Group A');
    expect(address().get('cohort')).toBe('COHORT-1');
    expect(address().get('coach')).toBe('Coach One');
  });

  it('Standards returns with its search and status', async () => {
    await renderAt(() => import('../../../standards/page'), '/curriculum/standards', '?q=data&status=Approved+for+delivery');
    const searchBox = await screen.findByPlaceholderText('Search by standard, code, route, LARS or KSB...');
    expect(searchBox).toHaveValue('data');
    fireEvent.change(searchBox, { target: { value: 'analyst' } });
    await waitFor(() => expect(address().get('q')).toBe('analyst'));
    expect(address().get('status')).toBe('Approved for delivery');
  });

  it('Published returns with its filters, and Reset clears every one of them at once', async () => {
    await renderAt(() => import('../../../published/page'), '/curriculum/published', '?q=Data&programme=PROG-DATA&sort=name');
    expect(await screen.findByPlaceholderText('Search modules, programmes, cohorts or groups...')).toHaveValue('Data');

    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^$/));
  });
});
