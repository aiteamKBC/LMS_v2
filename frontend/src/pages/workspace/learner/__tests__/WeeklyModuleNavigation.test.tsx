import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { WeeklyLearningResponse } from '@/api/weeklyLearning';
import { WeeklyLearningPlan } from '../WeeklyLearningPlan';

vi.mock('@/hooks/useWebPointPlan', () => ({ useWebPointPlan: () => ({ plan: null, loading: false, error: null }) }));

const modules = [{ id: 'M1', title: 'Current module' }, { id: 'M2', title: 'Another module' }];
function response(moduleId: string): WeeklyLearningResponse {
  return { modules, weeks: [{ id: `${moduleId}:1`, moduleId, weekId: `W-${moduleId}`, weekNumber: 1, slotNumber: 1,
    kind: 'live-session', title: 'Week 1', startDate: '2026-10-05', endDate: '2026-10-11', status: 'current',
    progress: 0, completedActivities: 0, totalActivities: 1, attendance: 'unmarked', sessionState: 'unscheduled', holidayNote: '', holidays: [] }],
    selectedWeek: { weekId: `${moduleId}:1`, summary: { ksbCount: 0, achievedKsbCount: 0, otjhHours: null,
      plannedOtjhHours: 1, untimedActivities: 0 }, liveSession: null, activities: [{ id: `C-${moduleId}`, title: `Reading for ${moduleId}`,
      type: 'reading', isQuiz: false, status: 'not-started', expectedHours: 1, actualHours: null, durationMinutes: 60,
      quizDuration: null, quizTimeUnit: null, ksbCodes: [], contentAvailable: true }] } };
}

afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); });

it.each(['commercial', 'apprenticeship'] as const)('loads %s module rails on selection and keeps the complete picker', async kind => {
  const requests: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push(url);
    return new Response(JSON.stringify(response(url.searchParams.get('moduleId') || 'M1')));
  }));
  render(<MemoryRouter><WeeklyLearningPlan kind={kind} learnerId="125" initialModuleId="M1" /></MemoryRouter>);
  expect(await screen.findByText('Reading for M1')).toBeVisible();
  expect(within(screen.getByRole('combobox', { name: 'Module' })).getAllByRole('option')).toHaveLength(2);
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('navigation')).toBe('module');
  expect(requests[0].searchParams.get('preferCurrent')).toBe('1');
  fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'M2' } });
  expect(await screen.findByText('Reading for M2')).toBeVisible();
  expect(screen.queryByText('Reading for M1')).not.toBeInTheDocument();
  expect(requests).toHaveLength(2);
  expect(requests[1].searchParams.get('moduleId')).toBe('M2');
  expect(requests[1].searchParams.get('preferCurrent')).toBe('0');
  fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'M1' } });
  expect(await screen.findByText('Reading for M1')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Module' })).toHaveValue('M1'));
  expect(requests).toHaveLength(2);
  fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'M2' } });
  expect(await screen.findByText('Reading for M2')).toBeVisible();
  expect(requests).toHaveLength(2);
});

it('shows a retryable module failure without showing the previous module as the new one', async () => {
  let available = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const moduleId = new URL(String(input), 'http://localhost').searchParams.get('moduleId') || 'M1';
    if (moduleId === 'M2' && !available) {
      return new Response(JSON.stringify({ error: 'Temporarily unavailable' }), { status: 503 });
    }
    return new Response(JSON.stringify(response(moduleId)));
  }));
  render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125" initialModuleId="M1" /></MemoryRouter>);
  expect(await screen.findByText('Reading for M1')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'M2' } });
  expect(await screen.findByText('Could not load your weekly plan', {}, { timeout: 8000 })).toBeVisible();
  expect(screen.queryByText('Reading for M1')).not.toBeInTheDocument();
  available = true;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Reading for M2')).toBeVisible();
});
