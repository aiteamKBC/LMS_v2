import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLearnerReviewInstance } from './LearnerReviewInstanceForm.helpers';

const definition = { template: { name: 'Synthetic MCM' }, migratedForm: true, readOnly: false };

afterEach(() => { vi.unstubAllGlobals(); });

describe('learner review preparation', () => {
  it('prepares the selected imported form after obtaining CSRF', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/csrf')
      ? new Response(JSON.stringify({ csrfToken: 'synthetic' }))
      : new Response(JSON.stringify(definition)));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLearnerReviewInstance('commercial', '12', 'imported-review:synthetic', false, true));
    await waitFor(() => expect(result.current.definition).toMatchObject(definition));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/prepare-review');
  });

  it('uses a read-only GET for an admin preview and never prepares a form', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ...definition, readOnly: true })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLearnerReviewInstance('commercial', '12', 'imported-review:synthetic', false, false, true));
    await waitFor(() => expect(result.current.definition?.readOnly).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/preview-review/commercial/12');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('method', 'POST');
  });
});
