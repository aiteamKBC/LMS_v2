import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installActivityCapture } from '../activityCapture';
import { flushActivity, recordPageView, resetActivity } from '../activityTrail';

/**
 * The LMS-wide capture of read actions.
 *
 * Two failures are being guarded against, and they pull in opposite directions.
 * Recording too little leaves a workspace looking as though nobody did anything
 * on the pages they opened. Recording too much puts a password, a half-typed
 * case note or a learner's address into the audit log under the word "search".
 * So the tests below check both edges: that a coach's search and filter are
 * caught without that workspace calling anything, and that an ordinary text
 * field is not.
 */

interface SentEvent {
  kind: string;
  path: string;
  detail?: Record<string, unknown>;
}

function sentEvents(fetchMock: ReturnType<typeof vi.fn>): SentEvent[] {
  return fetchMock.mock.calls
    .map(call => JSON.parse((call[1] as { body: string }).body))
    .flatMap((body: { events: SentEvent[] }) => body.events);
}

describe('LMS-wide read-action capture', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    resetActivity();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recorded: 1, available: true }) });
    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '';
    uninstall = installActivityCapture(document);
    // A read action is always recorded against an open page. Without one there
    // is nothing to attribute it to and the recorder drops it.
    recordPageView('/coach/caseload');
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
    resetActivity();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function settle() {
    await vi.runAllTimersAsync();
    await flushActivity();
  }

  it('records a search on a page that never asked to be recorded', async () => {
    document.body.innerHTML = '<input type="search" aria-label="Search learners" />';
    const input = document.querySelector('input')!;
    input.value = 'hassan';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const search = sentEvents(fetchMock).find(event => event.kind === 'search');
    expect(search).toBeTruthy();
    expect(search?.path).toBe('/coach/caseload');
    expect(search?.detail?.query).toBe('hassan');
    expect(search?.detail?.scope).toBe('Search learners');
  });

  it('leaves an ordinary text field alone', async () => {
    // The difference between an audit log and surveillance is exactly this: a
    // box has to say it is a search before what is typed into it is recorded.
    document.body.innerHTML = '<input type="text" name="learnerNotes" placeholder="Add a note" />';
    const input = document.querySelector('input')!;
    input.value = 'safeguarding concern raised';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(sentEvents(fetchMock).some(event => event.kind === 'search')).toBe(false);
  });

  it('never records a password, whatever the field is called', async () => {
    document.body.innerHTML = '<input type="password" name="searchPassword" aria-label="Search" />';
    const input = document.querySelector('input')!;
    input.value = 'hunter2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(sentEvents(fetchMock).some(event => event.kind === 'search')).toBe(false);
  });

  it('records a native filter by the name shown against it', async () => {
    document.body.innerHTML = `
      <label for="status">Status</label>
      <select id="status"><option value="">All</option><option value="at-risk">At risk</option></select>
    `;
    const select = document.querySelector('select')!;
    select.value = 'at-risk';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const filter = sentEvents(fetchMock).find(event => event.kind === 'filter');
    expect(filter?.detail?.filter).toBe('Status');
    expect(filter?.detail?.value).toBe('At risk');
  });

  it('records an export by the button that took the data out', async () => {
    document.body.innerHTML = '<button type="button">Export CSV</button>';
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const exported = sentEvents(fetchMock).find(event => event.kind === 'export');
    expect(exported?.detail?.format).toBe('Export CSV');
  });

  it('stays out of a toolkit that reports itself', async () => {
    // Both layers firing would make one filter change read as two, and an audit
    // trail that double-counts is not one anybody can rely on.
    document.body.innerHTML = `
      <div data-audit="manual">
        <input type="search" aria-label="Search" />
      </div>
    `;
    const input = document.querySelector('input')!;
    input.value = 'anything';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(sentEvents(fetchMock).some(event => event.kind === 'search')).toBe(false);
  });

  it('records nothing at all on a page the LMS does not record', async () => {
    resetActivity();
    recordPageView('/login');
    document.body.innerHTML = '<input type="search" aria-label="Search" />';
    const input = document.querySelector('input')!;
    input.value = 'anything';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(sentEvents(fetchMock)).toHaveLength(0);
  });
});
