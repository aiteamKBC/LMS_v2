import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAssessmentReportForm, fetchClassifiedLearners, fetchLearnerAssignments, saveAssessmentReportForm, setAssignmentSelection, updateAssignmentKsbCodes } from './adminEvidence';

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

  it('posts editable verified KSB codes for the displayed assignment', async () => {
    await updateAssignmentKsbCodes(42, 100, 9, 200, ['K1', 'S2']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/login_api/admin/evidence/classified-learners/42/evidence/100/ksb-codes/');
    expect(JSON.parse(init.body)).toEqual({
      runId: 9,
      componentId: 200,
      verifiedKsbCodes: ['K1', 'S2'],
    });
  });

  it('loads and saves the learner-scoped assessment report form', async () => {
    await fetchAssessmentReportForm(42, 100);
    expect(fetchMock.mock.calls[0][0]).toBe('/login_api/admin/evidence/classified-learners/42/evidence/100/report-form/');
    await saveAssessmentReportForm(42, 100, {
      learner_name: 'Alex', activity_name: 'Marketing', evidence_name: 'Assignment',
      time_spent: 90, result: 'Accepted', assessor: 'Tutor', date: '08/09/2026',
      criteria: 'K1', comments: 'Good work',
    }, false);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/login_api/admin/evidence/classified-learners/42/evidence/100/report-form/save/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).criteria).toBe('K1');
    expect(JSON.parse(init.body).reanalyze).toBe(false);
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
