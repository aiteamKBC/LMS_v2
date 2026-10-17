import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { DashboardTrainingPayload, TrainingModule } from '@/api/dashboardTraining';
import type { DashboardTabsProps } from '../DashboardTabs';
import DashboardTrainingTab from '../tabs/DashboardTrainingTab';

vi.mock('@/lib/personalLearning', () => ({ learningFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }));
function module(id: string, start = '2026-10-01'): TrainingModule {
  return { id: `current:${id}`, title: `Module ${id}`, moduleId: id, start, end: start ? '2026-12-31' : '',
    progress: 50, done: 1, activityCount: 2, activityCounts: { reading: 2 }, ksbCodes: ['K1'], achievedKsbCodes: [],
    ksbMappingMissing: false, weeks: 8, actual: 2, sessions: [], activities: [{ id: 'a', title: 'Visible activity', completed: true }],
    detail: { id, title: `Module ${id}`, description: `Description ${id}`, start_date: start, end_date: '2026-12-31', tutor_name: 'Tutor', coach_name: 'Coach',
      total_otjh: 4, weeks_number: 8, session_week_day: 'Thursday', session_start_time: '09:00', session_end_time: '10:00', learning_outcomes: ['Visible outcome'] } };
}
const initial = (): DashboardTrainingPayload => ({ timeline: { start: '2026-10', end: '2027-12', modules: [module('M1'), module('M2'), module('M3', '')].map(({ id, title, moduleId, start, end, done, activityCount, progress, detail }) => ({ id, title, moduleId, start, end, done, activityCount, progress, detail: { session_week_day: detail?.session_week_day } })), reviews: [], coachName: 'Coach' }, selectedModuleId: 'current:M1', selectedModule: module('M1') });
const props = { kind: 'commercial', learnerId: '265', programmeStartDate: '2026-10-01' } as DashboardTabsProps;
const requests = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
function mount(extra: Partial<DashboardTabsProps> = {}, path = '/') { return render(<MemoryRouter initialEntries={[path]}><DashboardTrainingTab {...props} {...extra} /></MemoryRouter>); }
beforeEach(() => {
  clearAllCachedResources();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    const match = path.match(/modules\/([^/]+)\//);
    const body = match ? module(decodeURIComponent(match[1]).replace('current:', '')) : initial();
    if (!match) {
      const subject = new URL(path, 'https://example.test').searchParams.get('subject');
      if (subject) Object.assign(body, { selectedModuleId: subject, selectedModule: module(subject.replace('current:', '')) });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('compact Training Plan', () => {
  it('loads only the requested deep-link module and includes subject/month in the initial URL', async () => {
    mount({}, '/?subject=current%3AM2&month=2026-11');
    await screen.findByText('Description M2');
    expect(requests()).toEqual(['/learner_api/dashboard/commercial/265/training/?subject=current%3AM2&month=2026-11&programmeStartDate=2026-10-01']);
  });

  it('partitions cached module details by learner', async () => {
    const view = mount(); await screen.findByText('Description M1');
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    await screen.findByText('Description M2');
    view.rerender(<MemoryRouter><DashboardTrainingTab {...props} learnerId="266" /></MemoryRouter>);
    await screen.findByText('Description M1');
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    await screen.findByText('Description M2');
    expect(requests().filter(url => url.includes('/modules/'))).toEqual([
      '/learner_api/dashboard/commercial/265/training/modules/current%3AM2/',
      '/learner_api/dashboard/commercial/266/training/modules/current%3AM2/',
    ]);
  });

  it('loads only initial detail, switches once, and revisits cached details without requests', async () => {
    mount();
    await screen.findByText('Description M1');
    expect(requests()).toHaveLength(1);
    expect(screen.getByText('3 assigned modules', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    await screen.findByText('Description M2');
    expect(requests().filter(url => url.includes('/modules/'))).toEqual(['/learner_api/dashboard/commercial/265/training/modules/current%3AM2/']);
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M1 overview' }));
    await screen.findByText('Description M1');
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    await screen.findByText('Description M2');
    expect(requests()).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Go to module' }).getAttribute('href')).toContain('subject=current%3AM2');
  });

  it('keeps timeline visible, shows errors as errors and retries the selected module', async () => {
    mount(); await screen.findByText('Description M1');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Module not accessible' }), { status: 403 }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Module not accessible');
    expect(screen.getByRole('region', { name: 'Module timeline' })).toBeTruthy();
    expect(screen.queryByText('Choose a module above to see its details.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry module details' }));
    await screen.findByText('Description M2');
    const afterRetry = requests().length;
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M1 overview' }));
    await screen.findByText('Description M1');
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    await screen.findByText('Description M2');
    expect(requests()).toHaveLength(afterRetry);
  });

  it('ignores a slow response after another module is selected', async () => {
    mount(); await screen.findByText('Description M1');
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M2 overview' }));
    await waitFor(() => expect(requests()).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('Loading module details');
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M3 overview' }));
    await screen.findByText('Description M3');
    await act(async () => { finish(new Response(JSON.stringify(module('M2')), { status: 200 })); });
    expect(screen.getByText('Description M3')).toBeTruthy();
    expect(screen.queryByText('Description M2')).toBeNull();
  });

  it('preserves week/fullscreen controls, missing-date modules and activity previews', async () => {
    mount(); await screen.findByText('Description M1');
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: /Week 1, starting/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    const inspector = await screen.findByRole('complementary', { name: 'Timeline module details' });
    expect(within(inspector).getByText('Visible activity')).toBeTruthy();
    expect(requests()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show Module M3 overview' }));
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'Timeline module details' })).getByText('Module M3')).toBeTruthy());
  });
});
