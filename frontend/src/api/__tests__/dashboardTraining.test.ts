import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { invalidateLearnerReads } from '../learnerRead';
import { dashboardTraining, peekTrainingModule, type DashboardTrainingPayload, type TrainingModule } from '../dashboardTraining';

const module = (): TrainingModule => ({ id: 'current:M1', moduleId: 'M1', title: 'Module', start: '', end: '',
  done: 0, activityCount: 0, progress: 0, activityCounts: {}, ksbCodes: [], achievedKsbCodes: [],
  ksbMappingMissing: false, weeks: 0, actual: 0, activities: [], sessions: [],
  detail: { id: 'M1', title: 'Module', description: '', start_date: null, end_date: null, coach_name: '', tutor_name: '' } });
const payload = (): DashboardTrainingPayload => ({ timeline: { start: '', end: '', modules: [], reviews: [] },
  selectedModuleId: 'current:M1', selectedModule: module() });
beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('Training snapshot ownership', () => {
  it('shows a cached initial snapshot synchronously and isolates filters and learners', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload())));
    const first = await dashboardTraining.read('commercial', '7');
    expect(dashboardTraining.peek('commercial', '7')).toBe(first);
    expect(dashboardTraining.peek('apprenticeship', '7')).toBeUndefined();
    expect(dashboardTraining.peek('commercial', '8')).toBeUndefined();
  });

  it('does not prime module details with an initial read superseded by a save', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stale = dashboardTraining.read('commercial', '7');
    invalidateLearnerReads();
    finish(new Response(JSON.stringify(payload())));
    await stale;
    expect(peekTrainingModule('commercial', '7', 'current:M1')).toBeUndefined();
  });

  it('does not restore module snapshots after account caches are cleared', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stale = dashboardTraining.read('commercial', '7');
    clearAllCachedResources();
    finish(new Response(JSON.stringify(payload())));
    await stale;
    expect(peekTrainingModule('commercial', '7', 'current:M1')).toBeUndefined();
  });
});
