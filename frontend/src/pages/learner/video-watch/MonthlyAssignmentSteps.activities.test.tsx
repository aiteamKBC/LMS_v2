vi.mock('@/api/extraActivities', () => ({ useExtraActivities: () => ({ activities: [], loading: false, error: '', refresh: vi.fn() }) }));
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { MonthlyAssignmentSteps } from './MonthlyAssignmentSteps';

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { step: 4, mode: 'impact', kind: 'commercial' },
  { step: 5, mode: 'action', kind: 'commercial' },
  { step: 4, mode: 'impact', kind: 'apprenticeship' },
  { step: 5, mode: 'action', kind: 'apprenticeship' },
] as const)('loads monthly activities before drafting $mode for $kind on direct entry', async ({ step, mode, kind }) => {
  let resolveDetail!: (detail: LearnerDetail) => void;
  vi.mocked(fetchLearnerDetail).mockReturnValue(new Promise(resolve => { resolveDetail = resolve; }));
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetch);
  const props: ComponentProps<typeof MonthlyAssignmentSteps> = {
    step, kind, learnerId: '1', activityId: 'assignment', title: 'Assignment', question: 'Question',
    data: emptyMonthlyAssignment([], '2026-09'), onChange: vi.fn(),
    answers: { assignmentAnswer: 'My assignment answer', whatYouLearned: '', businessImpact: '' },
    onAnswer: vi.fn(), plannedOtjh: null, mappings: [], evidenceFiles: [], evidenceUploader: null, timeControl: null,
    disabled: false, payload: vi.fn(), checks: [], checking: false, onCheck: vi.fn(), onSave: vi.fn(),
  };
  render(<MonthlyAssignmentSteps {...props} />);
  expect(fetchLearnerDetail).toHaveBeenCalledWith(kind, '1');
  expect(fetch).not.toHaveBeenCalled();
  const at = '2026-09-12T10:00:00Z';
  await act(async () => resolveDetail({
    activityFeed: [
      { kind: 'video', componentId: 'video-1', title: 'Audience research', at },
      { kind: 'component', componentId: 'old', title: 'Previous month', at: '2026-08-12T10:00:00Z' },
    ],
    videoProgress: [{ componentId: 'video-1', submittedAt: at, feedback: 'I practised grouping interview responses.', ksbs: ['K1'] }],
  } as LearnerDetail));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ mode, context: {
    answer: 'My assignment answer', month: '2026-09',
    activities: [{ title: 'Audience research', date: '2026-09-12', reflection: 'I practised grouping interview responses.', ksbs: ['K1'] }],
  } });
});
