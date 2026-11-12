import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { actualHours, DEMO_KSBS, DEMO_LEARNERS, DEMO_MODULES, DEMO_PROGRAMME, learningProgress, moduleAchievement, trainingDraft } from './demoProgramme';
import HRSystemWorkspace from './page';

const api = vi.hoisted(() => ({ list: vi.fn(), runs: vi.fn() }));
vi.mock('@/api/breatheIntegration', () => ({ listBreatheConnections: api.list, getBreatheRuns: api.runs }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { displayName: 'Demo Administrator' } } }) }));
// Exercise the page without global auth, learner or search service side effects.
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children, navItems }: { children: ReactNode; navItems: SidebarNavItem[] }) => <><nav>{navItems.map(item => <Link key={item.id} to={item.href!}>{item.label}</Link>)}</nav>{children}</> }));

function show(view = '') {
  return render(<MemoryRouter initialEntries={[`/workspace/hr-system${view ? `?view=${view}` : ''}`]}><HRSystemWorkspace /></MemoryRouter>);
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ results: [] });
  api.runs.mockReset().mockResolvedValue({ results: [] });
});

describe('programme demonstration', () => {
  it('reconciles programme hours and distinct KSBs with all four modules for every learner', () => {
    expect(DEMO_MODULES).toHaveLength(4);
    expect(DEMO_MODULES.reduce((sum, module) => sum + module.plannedHours, 0)).toBe(DEMO_PROGRAMME.plannedHours);
    expect(DEMO_PROGRAMME.plannedHours).toBe(850);
    const mappedCodes = DEMO_MODULES.flatMap(module => module.ksbCodes);
    expect(new Set(mappedCodes).size).toBe(62);
    expect([...mappedCodes].sort()).toEqual([...DEMO_KSBS].sort());
    expect(DEMO_LEARNERS.map(actualHours)).toEqual([900, 810, 360]);
    expect(DEMO_LEARNERS.map(learningProgress)).toEqual([100, 90, 30]);
    expect(DEMO_LEARNERS.map(learner => learner.achievedKsbCodes.length)).toEqual([62, 54, 19]);
    for (const learner of DEMO_LEARNERS) {
      expect(DEMO_MODULES.reduce((sum, _, index) => sum + moduleAchievement(learner, index), 0)).toBe(learner.achievedKsbCodes.length);
      expect(trainingDraft(learner)).toMatchObject({ demo: true, sendable: false, employee_id: null, company_training_type_id: null });
      expect(trainingDraft(learner).notes).toContain(`850h planned / ${actualHours(learner)}h actual`);
    }
  });

  it('filters learners, handles empty results and restores focus after inspecting KSBs', async () => {
    const user = userEvent.setup();
    show();
    const table = screen.getByRole('table', { name: 'Demo programme learner progress' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /At risk\s*1/ }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).queryByText('Demo Learner 01')).not.toBeInTheDocument();
    const trigger = within(table).getByRole('button', { name: 'View KSBs for Demo Learner 03' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Programme KSBs · 19 of 62 achieved')).toBeInTheDocument();
    expect(within(dialog).getAllByTitle(/achieved|pending/)).toHaveLength(31);
    await user.click(within(dialog).getByRole('button', { name: /Skills\s*26/ }));
    expect(within(dialog).getAllByTitle(/achieved|pending/)).toHaveLength(26);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.type(screen.getByRole('textbox', { name: 'Search demo learners' }), 'unknown');
    expect(screen.getByText('No demo learners match your search and status filter.')).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('switches module breakdowns without changing another learner and keeps requests unsent', async () => {
    const user = userEvent.setup();
    show('modules');
    expect(screen.getByRole('table', { name: 'Module breakdown for Demo Learner 01' })).toHaveTextContent('900h');
    await user.selectOptions(screen.getByRole('combobox', { name: 'View learner' }), 'demo-02');
    expect(screen.getByRole('table', { name: 'Module breakdown for Demo Learner 02' })).toHaveTextContent('810h');
    await user.selectOptions(screen.getByRole('combobox', { name: 'View learner' }), 'demo-01');
    expect(screen.getByRole('table', { name: 'Module breakdown for Demo Learner 01' })).toHaveTextContent('900h');
    await user.click(screen.getByRole('link', { name: 'Training requests' }));
    await user.click(screen.getAllByRole('button', { name: 'Inspect summary' })[0]);
    const preview = screen.getByRole('dialog');
    expect(preview).toHaveTextContent('Unsent · no employee mapping');
    expect(preview).toHaveTextContent('150h planned / 160h actual');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('shows actual service failures instead of a fabricated connection', async () => {
    api.list.mockRejectedValueOnce(new Error('Request failed (401).'));
    show('connections');
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (401).');
    expect(screen.queryByText('No Breathe connections found')).not.toBeInTheDocument();
    expect(api.runs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh connections' }));
    expect(await screen.findByText('No Breathe connections found')).toBeInTheDocument();
  });

  it('shows only the selected connection history and reports delivery errors', async () => {
    api.list.mockResolvedValue({ results: [
      { id: 'a', externalAccountId: 'Demo account A', status: 'pending', lastVerifiedAt: null, lastSyncAt: null },
      { id: 'b', externalAccountId: 'Demo account B', status: 'error', lastVerifiedAt: null, lastSyncAt: null, lastError: 'Provider unavailable' },
    ] });
    api.runs.mockImplementation((id: string) => id === 'a'
      ? Promise.resolve({ results: [{ id: 'run-a', resources: ['employees'], status: 'failed', dryRun: true, counts: {}, errorMessage: 'Employee lookup failed' }] })
      : Promise.reject(new Error('History unavailable')));
    show('connections');
    expect(await screen.findByText('Employee lookup failed')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Connection' }), 'b');
    expect(await screen.findByText('History unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Employee lookup failed')).not.toBeInTheDocument();
    expect(screen.getByText('Provider unavailable')).toBeInTheDocument();
  });
});
