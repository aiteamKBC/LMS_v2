import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCurriculumProgramme, type CurriculumProgramme } from '@/lib/curriculumApi';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';

// ---------------------------------------------------------------------------
// Creating a programme has to put it on the list without a page reload.
//
// The page does this by reloading the collection with `skipCache` after the
// create resolves. What makes that fragile is the request already in flight: the
// list build is slow, so the first load is often still running when the create
// lands, and its response predates the write. These cover that sequence end to
// end through the real API client — mocking only `fetch` — because the caching,
// in-flight sharing and request-ordering that decide the outcome all live
// between the hook and the network.
// ---------------------------------------------------------------------------

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };

function deferred(): Deferred {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}

/** Only the fields these assertions read; the rest of the row is irrelevant. */
const programme = (name: string) => ({
  id: `PROG-${name}`,
  sourceId: `PROG-${name}`,
  name,
  status: 'active',
  isArchived: false,
  isActive: true,
} as CurriculumProgramme);

type HarnessApi = {
  reload: (options?: { skipCache?: boolean; silent?: boolean }) => unknown;
  upsertProgramme: (programme: CurriculumProgramme) => void;
};

function Harness({ onReady }: { onReady: (api: HarnessApi) => void }) {
  const { programmes, reload, upsertProgramme } = useCurriculumProgrammes({ visibility: 'all' });
  onReady({ reload, upsertProgramme } as HarnessApi);
  return (
    <ul>
      {programmes.map(item => <li key={item.id}>{item.name}</li>)}
    </ul>
  );
}

describe('programme list refresh after a create', () => {
  let listBodies: unknown[];
  let firstListCall: Deferred | null;

  beforeEach(() => {
    listBodies = [];
    firstListCall = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Serves the queued list bodies in order; the first GET can be held open. */
  const stubFetch = (options: { holdFirstList?: boolean } = {}) => {
    let listCalls = 0;
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return jsonResponse({ created: true, programme: programme('New') });
      }
      const index = Math.min(listCalls, listBodies.length - 1);
      listCalls += 1;
      const body = { schema: 'curriculum', count: 0, results: listBodies[index] };
      if (index === 0 && options.holdFirstList) {
        firstListCall = deferred();
        await firstListCall.promise;
      }
      return jsonResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('shows the created programme once the list is reloaded', async () => {
    listBodies = [[programme('Existing')], [programme('Existing'), programme('New')]];
    stubFetch();
    let api: HarnessApi | null = null;

    render(<Harness onReady={value => { api = value; }} />);
    await screen.findByText('Existing');

    await act(async () => {
      await createCurriculumProgramme({ name: 'New' });
      await api!.reload({ skipCache: true, silent: true });
    });

    expect(await screen.findByText('New')).toBeTruthy();
  });

  it('does not adopt a list request that was already in flight when the create landed', async () => {
    // The slow first load returns the pre-create list. If the refresh joins it,
    // the new programme is missing until the page is reloaded by hand — which is
    // exactly the bug this guards.
    listBodies = [[programme('Existing')], [programme('Existing'), programme('New')]];
    stubFetch({ holdFirstList: true });
    let api: HarnessApi | null = null;

    render(<Harness onReady={value => { api = value; }} />);
    await waitFor(() => expect(firstListCall).not.toBeNull());

    await act(async () => {
      await createCurriculumProgramme({ name: 'New' });
      // The stale response lands after the write, mid-refresh.
      firstListCall!.resolve(undefined);
      await api!.reload({ skipCache: true, silent: true });
    });

    expect(await screen.findByText('New')).toBeTruthy();
  });

  it('shows a created programme before the rebuilt list comes back', async () => {
    // The page inserts what the create returned, so the card is there while the
    // collection request — which can take seconds — is still running. The list
    // served here deliberately does not contain it yet.
    listBodies = [[programme('Existing')]];
    stubFetch();
    let api: HarnessApi | null = null;

    render(<Harness onReady={value => { api = value; }} />);
    await screen.findByText('Existing');

    await act(async () => {
      const { programme: created } = await createCurriculumProgramme({ name: 'New' });
      api!.upsertProgramme(created);
    });

    expect(await screen.findByText('New')).toBeTruthy();
    // First, so a paginated list cannot hide it on a page nobody is looking at.
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['New', 'Existing']);
  });

  it('does not duplicate a programme the list already knows', async () => {
    listBodies = [[programme('Existing')]];
    stubFetch();
    let api: HarnessApi | null = null;

    render(<Harness onReady={value => { api = value; }} />);
    await screen.findByText('Existing');

    await act(async () => {
      api!.upsertProgramme({ ...programme('Existing'), name: 'Existing renamed' });
    });

    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Existing renamed']);
  });
});
