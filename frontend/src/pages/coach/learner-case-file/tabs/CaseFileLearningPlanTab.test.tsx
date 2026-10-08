import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { CaseFileSessionProvider } from '@/features/coach/case-file/hooks/CaseFileSession';
import { clearCaseFileCache } from '@/features/coach/case-file/cache/caseFileCache';
import { caseFileSectionRead } from '@/features/coach/case-file/api/caseFileApi';
import { CaseFileLearningPlanTab } from './CaseFileLearningPlanTab';
import { dateLabel } from '@/pages/learner/training-plan-timeline/presentation';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));
vi.mock('@/hooks/useCoachViewAs', () => ({ useCoachViewAs: () => null }));
const counts = { componentCount: 2, completedCount: 1, inProgressCount: 1, notStartedCount: 0,
  unavailableCount: 0, progressPercent: 50, status: 'in-progress', otjh: 0 };
const module = { ...counts, id: 'current:M1', title: 'Synthetic Module', weekCount: 1 };
const week = { ...counts, id: 'W1', title: 'Week 1', weekNumber: 1 };
const initial = { timeline: { periodStart: '2026-01', periodEnd: '2027-01',
  modules: [{ id: module.id, title: module.title, progressPercent: 33.33, startDate: '2026-09-01', endDate: '2026-12-01', status: 'in-progress' }], reviews: [] },
  journey: { summary: { modules: 1, weeks: 1, components: 2, completed: 1, inProgress: 1, notStarted: 0, unavailable: 0 }, modules: [module] } };
function Tree({ learner = '101', coach = 'coach@example.test' }) {
  return <CaseFileSessionProvider learnerId={learner} coach={coach}><CaseFileLearningPlanTab /></CaseFileSessionProvider>;
}
function setup() {
  vi.stubGlobal('AppIcon', AppIcon);
  transport.mockImplementation(async (url: string, options: RequestInit) => {
    expect(options.method || 'GET').toBe('GET');
    return { ok: true, json: async () => url.includes('/week/') ? { ...week, moduleId: module.id, components: [
      { componentId: 'C1', title: 'Synthetic reading', type: 'reading', status: 'completed', completedAt: null },
      { componentId: 'C2', title: 'Pending acceptance', type: 'assignment', status: 'in-progress', completedAt: null },
    ] } : url.includes('/module/') ? { ...module, weeks: [week] } : initial };
  });
}
afterEach(() => { clearCaseFileCache(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads one compact response, then only the expanded module/week; cached reopen reads nothing', async () => {
  setup();
  const mounted = render(<StrictMode><Tree /></StrictMode>);
  const journey = await screen.findByRole('region', { name: 'Programme Journey' });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33.33');
  expect(screen.getByRole('progressbar')).toHaveTextContent('33%');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '33%');
  expect(within(journey).getByText(/1 week · 2 components · 50%/)).toBeInTheDocument();
  expect(screen.queryByText('Week 1')).not.toBeInTheDocument();
  fireEvent.click(within(journey).getByRole('button', { name: /Module 01/ }));
  await screen.findByText('Week 1');
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[1][0]).toBe('/coach_api/coach/case-file/101/learning-plan/module/current%3AM1');
  expect(screen.queryByText('Synthetic reading')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Week 1/ }));
  await screen.findByText('Pending acceptance');
  expect(transport).toHaveBeenCalledTimes(3);
  expect(transport.mock.calls[2][0]).toBe('/coach_api/coach/case-file/101/learning-plan/module/current%3AM1/week/W1');
  fireEvent.click(within(journey).getByRole('button', { name: /Module 01/ }));
  fireEvent.click(within(journey).getByRole('button', { name: /Module 01/ }));
  await screen.findByText('Week 1');
  fireEvent.click(screen.getByRole('button', { name: /Week 1/ }));
  await screen.findByText('Pending acceptance');
  expect(transport).toHaveBeenCalledTimes(3);
  expect(document.querySelector('form')).toBeNull();
  expect(screen.queryByRole('button', { name: /save|submit|edit|upload|book/i })).not.toBeInTheDocument();
  mounted.unmount(); render(<Tree />);
  await screen.findByRole('region', { name: 'Programme Journey' });
  expect(transport).toHaveBeenCalledTimes(3);
});

it('expires after 60 seconds and isolates coach and learner identities', async () => {
  setup(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  const mounted = render(<Tree />);
  await screen.findByRole('region', { name: 'Programme Journey' });
  mounted.unmount(); clock.mockReturnValue(1_060_001);
  const expired = render(<Tree />);
  await screen.findByRole('region', { name: 'Programme Journey' });
  expect(transport).toHaveBeenCalledTimes(2);
  expired.rerender(<Tree learner="102" />);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  expired.rerender(<Tree learner="102" coach="another@example.test" />);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(4));
  await act(async () => {});
});

it.each(['learning-plan-module', 'learning-plan-week'])('deduplicates %s and expires its scoped detail after 60 seconds', async section => {
  setup();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  const selection = { moduleId: module.id, ...(section === 'learning-plan-week' ? { weekId: week.id } : {}) };
  const read = (scope = 'coach-a', learner = '101', params = selection) => caseFileSectionRead(scope, learner, section, params);
  const [first, duplicate] = await Promise.all([read(), read()]);
  expect(first).toBe(duplicate);
  expect(transport).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(1_059_999);
  await read();
  expect(transport).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(1_060_000);
  await read();
  expect(transport).toHaveBeenCalledTimes(2);
  await read('coach-b');
  await read('coach-a', '102');
  await read('coach-a', '101', { ...selection, moduleId: 'current:M2' });
  expect(transport).toHaveBeenCalledTimes(5);
  if (section === 'learning-plan-week') {
    await read('coach-a', '101', { ...selection, weekId: 'W2' });
    expect(transport).toHaveBeenCalledTimes(6);
  }
});

it('shows a failed read and retries it without masking the error', async () => {
  setup(); transport.mockRejectedValueOnce(new Error('Unavailable'));
  render(<Tree />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Learning Plan' }));
  await screen.findByRole('region', { name: 'Programme Journey' });
  expect(transport).toHaveBeenCalledTimes(2);
});

it('preserves timeline dates, holiday hints, grouped reviews and weekly/fullscreen controls', async () => {
  setup();
  transport.mockResolvedValue({ ok: true, json: async () => ({ ...initial, timeline: { ...initial.timeline,
    modules: [{ ...initial.timeline.modules[0], notes: [{ date: '2026-10-02', slotNumber: 5,
      weekTitle: 'Week 5', holidayNote: 'Published reading hint', holidays: [] }] }],
    reviews: [{ id: 'R1', date: '2026-10-10', type: 'progress-review', title: 'Progress review', status: 'scheduled', invited: false },
      { id: 'R2', date: '2026-10-10', type: 'mcr', title: 'MCR', status: 'completed' }] } }) });
  render(<Tree />);
  await screen.findByRole('region', { name: 'Programme Journey' });
  expect(screen.getByRole('button', { name: 'Show Synthetic Module overview' })).toHaveAttribute('title',
    `Synthetic Module · ${dateLabel('2026-09-01')} – ${dateLabel('2026-12-01')} · In progress · 33% completed`);
  expect(screen.getByRole('img', { name: 'Week 5 note' })).toHaveTextContent('Published reading hint');
  expect(screen.getByRole('img', { name: `Progress review, MCR on ${dateLabel('2026-10-10')}` })).toHaveAttribute('title',
    `${dateLabel('2026-10-10')} · Progress review: Booking pending · MCR: Completed`);
  fireEvent.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByText('W52').parentElement?.parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(52, minmax(44px, 1fr))' });
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(transport).toHaveBeenCalledTimes(1);
});
