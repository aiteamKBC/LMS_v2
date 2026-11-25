import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DatabaseExplorerPage from '../page';
import { schemaGroups, searchCatalogue, totalTables } from '../catalogue';
import expectedCatalogue from './expectedCatalogue.json';
import { mayAccessRoute } from '@/lib/routeAccess';
import { adminNavItems } from '@/mocks/navigation';

// No session bootstrap, backend requests or external services in these tests.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { displayName: 'Test Admin' } } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

function show(path = '/workspace/admin/database') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/workspace/admin/database" element={<DatabaseExplorerPage />} />
    <Route path="/workspace/admin/database/:groupId" element={<DatabaseExplorerPage />} />
  </Routes></MemoryRouter>);
}

describe('Database catalogue acceptance', () => {
  it('preserves all 13 requested groups and all 95 table assignments exactly once', () => {
    expect(schemaGroups.map(group => ({ name: group.name, tables: group.tables.map(table => table.name) }))).toEqual(expectedCatalogue);
    expect(schemaGroups).toHaveLength(13);
    expect(schemaGroups.map(group => group.tables.length)).toEqual([9, 8, 4, 3, 4, 6, 7, 20, 12, 7, 8, 3, 4]);
    expect(totalTables).toBe(95);
    expect(new Set(schemaGroups.flatMap(group => group.tables.map(table => table.name))).size).toBe(95);
    for (const table of schemaGroups.flatMap(group => group.tables)) {
      expect(table.description).toMatch(/[A-Za-z]/);
      expect(table.description).not.toMatch(/[\u0600-\u06ff]/);
      expect(table.description.length).toBeGreaterThan(25);
      expect(table.description).not.toMatch(/foreign key|index|constraint|SQL|stores related data/i);
    }
  });

  it('matches table names, group names and English descriptions regardless of case', () => {
    expect(searchCatalogue('  CALENDAR_HOLIDAYS ').flatMap(group => group.tables.map(table => table.name)))
      .toEqual(['calendar_holidays', 'cohort_calendar_holidays', 'module_calendar_holidays']);
    expect(searchCatalogue('Free Courses')[0].tables).toHaveLength(3);
    expect(searchCatalogue('  OFFICIAL AND LOCAL HOLIDAYS  ').some(group => group.tables.some(table => table.name === 'calendar_holidays'))).toBe(true);
    expect(searchCatalogue('organises training cohorts')[0].tables.map(table => table.name)).toEqual(['cohorts']);
    expect(searchCatalogue('no-such-table')).toEqual([]);
  });

  it('places Database under Platform and retains the admin-only route boundary', () => {
    expect(adminNavItems.find(item => item.id === 'admin-group-platform')?.children)
      .toContainEqual(expect.objectContaining({ label: 'Database', href: '/workspace/admin/database' }));
    for (const path of ['/workspace/admin/database', '/workspace/admin/database/reviews']) {
      expect(mayAccessRoute(path, { role: 'admin' })).toBe(true);
      for (const role of ['staff', 'employer', 'learner'] as const) expect(mayAccessRoute(path, { role })).toBe(false);
    }
  });
});

describe('Database Explorer', () => {
  it('shows every group and clearly labels static counts', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Database', level: 1 })).toBeVisible();
    expect(screen.getByText('95')).toBeVisible();
    expect(screen.getByText(/Counts are not live database totals/)).toBeVisible();
    for (const group of schemaGroups) expect(screen.getByRole('heading', { name: group.name })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(13);
  });

  it('opens a group with the keyboard and returns through the breadcrumb', async () => {
    show();
    const user = userEvent.setup();
    screen.getByRole('link', { name: /Core Curriculum/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 1, name: 'Core Curriculum' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Core Curriculum tables' }).querySelectorAll('li')).toHaveLength(9);
    expect(screen.getByText('programmes')).toBeVisible();
    const description = screen.getByText('Organises training cohorts within programmes, including their start and end dates.');
    expect(description).toHaveAttribute('lang', 'en');
    expect(description).toHaveAttribute('dir', 'ltr');
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Database' }));
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(13);
  });

  it('searches English descriptions, opens matching groups and preserves the search on return', async () => {
    show();
    const user = userEvent.setup();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'OFFICIAL AND LOCAL HOLIDAYS' } });
    expect(screen.getByText('calendar_holidays')).toBeVisible();
    expect(screen.queryByText('quizzes')).toBeNull();
    await user.click(screen.getByRole('link', { name: /Week Templates and Calendar/ }));
    expect(screen.getByRole('searchbox')).toHaveValue('OFFICIAL AND LOCAL HOLIDAYS');
    await user.click(screen.getByRole('link', { name: /Back to Database overview/ }));
    expect(screen.getByRole('searchbox')).toHaveValue('OFFICIAL AND LOCAL HOLIDAYS');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(13);
  });

  it('handles empty results and clearing the query', async () => {
    show('/workspace/admin/database?q=missing-table');
    expect(screen.getByRole('heading', { name: 'No matching tables' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('0 matching tables in 0 groups');
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0]);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(13);
  });

  it('supports direct group links and safely handles unknown groups', () => {
    const view = show('/workspace/admin/database/microsoft-teams?q=sync');
    expect(screen.getByText('teams_calendar_sync_state')).toBeVisible();
    expect(screen.queryByText('teams_graph_failures')).toBeNull();
    view.unmount();
    show('/workspace/admin/database/not-a-group');
    expect(screen.getByRole('heading', { name: 'Group not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse all groups' })).toHaveAttribute('href', '/workspace/admin/database');
  });
});
