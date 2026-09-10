import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssignmentsTab, assignmentMonth } from './AssignmentsTab';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses the selected month before completion and submission dates, keeping undated records', () => {
  expect(assignmentMonth({ month: '2026-08', dateCompleted: '2026-09-01', submittedAt: null })).toBe('2026-08');
  expect(assignmentMonth({ month: '2026-13', dateCompleted: null, submittedAt: '2026-09-08T12:00:00Z' })).toBe('2026-09');
  expect(assignmentMonth({ month: null, dateCompleted: null, submittedAt: null })).toBe('');
});

it('groups saved submissions by month and opens the existing assignment template', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignments: [
    { id: '1', activityId: 'COMP-1', title: 'August report', moduleTitle: 'Project', status: 'accepted', month: '2026-08' },
    { id: '2', activityId: 'COMP-2', title: 'September report', moduleTitle: 'Project', status: 'draft', month: '2026-09' },
  ] }) }));
  render(<MemoryRouter><AssignmentsTab kind="apprenticeship" id="92" /></MemoryRouter>);
  expect(await screen.findByText('September 2026')).toBeTruthy();
  expect(screen.getByText('August 2026')).toBeTruthy();
  expect(screen.getByText('Continue draft').getAttribute('href')).toBe('/learner/monthly-submission/apprenticeship/92/COMP-2');
});

it('shows a failed request as an error rather than an empty history', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Access denied' }) }));
  render(<MemoryRouter><AssignmentsTab kind="apprenticeship" id="92" /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toBe('Access denied');
  expect(screen.queryByText('No classified assignments available yet')).toBeNull();
});

it('opens an imported assignment independently of the current curriculum', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignments: [
    { id: 'legacy-1', activityId: 'aptem:92:evidence:20128', title: 'Original report', moduleTitle: 'Old module',
      status: 'accepted', submissionOrigin: 'classified_legacy', month: '2025-06' },
  ] }) }));
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="125" /></MemoryRouter>);
  expect(await screen.findByText('Open submission')).toHaveAttribute('href', '/learner/historical-assignment/commercial/125/aptem%3A92%3Aevidence%3A20128');
});
