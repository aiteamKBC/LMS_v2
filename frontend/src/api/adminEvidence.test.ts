import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchClassifiedLearners, fetchLearnerAssignments, setAssignmentSelection } from './adminEvidence';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, text: async () => JSON.stringify({ count: 0, page: 1, pageSize: 25, results: [] }),
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('admin evidence API client', () => {
  it('posts a learner-scoped manual selection with the displayed run and component', async () => {
    await setAssignmentSelection(42, 100, 9, 200, true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/login_api/admin/evidence/classified-learners/42/evidence/100/selection/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ runId: 9, componentId: 200, selected: true });
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Requested-With']).toBe('XMLHttpRequest');
  });
  it('sends the authenticated-session credentials and header', async () => {
    await fetchClassifiedLearners({ page: 2, selection: 'recommended' });
    const [url, init] = fetchMock.mock.calls[0] as [string, NonNullable<Parameters<typeof fetch>[1]>];
    expect(url).toContain('/login_api/admin/evidence/classified-learners/');
    expect(url).toContain('selection=recommended');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
  });

  it('requests recommended and all assignments through the learner-scoped URL', async () => {
    await fetchLearnerAssignments(42, { view: 'recommended', page: 1 });
    expect(fetchMock.mock.calls[0][0]).toContain('/classified-learners/42/assignments/?view=recommended');
  });
});
