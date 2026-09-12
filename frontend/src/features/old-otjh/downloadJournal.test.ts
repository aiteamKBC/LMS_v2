import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMonth, type MonthDetail, type Summary } from './api';
import { buildJournalPdf } from './journalPdf';
import { downloadJournal } from './downloadJournal';

vi.mock('./api', () => ({ getMonth: vi.fn() }));
vi.mock('./journalPdf', () => ({ buildJournalPdf: vi.fn() }));
const save = vi.fn();
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const fetchImage = vi.fn();
const report = (month: string): MonthDetail => ({ month, status: 'complete', row_count: 0, planned_hours: 0, actual_hours: 0,
  not_accepted_hours: 0, pending_revisions: 0, can_complete: false, source_finalization: null, snapshot_digest: month, rows: [],
  student_signature: { url: '/saved-signature.png', signer_name: 'Learner', signed_at: '2026-09-01' }, coach_signature: null });
const summary: Summary = { is_legacy: true, state: 'complete', can_access_lms: true,
  learner: { id: 1, aptem_id: 42, name: 'Learner', programme: 'Programme', coach_name: 'Coach' },
  months: ['2026-07', '2026-08'].map(report) };
beforeEach(() => {
  vi.mocked(getMonth).mockImplementation(async month => report(month));
  vi.mocked(buildJournalPdf).mockReturnValue({ save } as unknown as ReturnType<typeof buildJournalPdf>);
  fetchImage.mockImplementation(async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchImage);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('journal downloads', () => {
  it('downloads the selected saved month using the coach learner scope', async () => {
    const controller = new AbortController();
    await downloadJournal({ summary, months: ['2026-08'], aptemId: 42, signal: controller.signal });
    expect(getMonth).toHaveBeenCalledExactlyOnceWith('2026-08', 42, controller.signal);
    expect(buildJournalPdf).toHaveBeenCalledWith(summary, [report('2026-08')], expect.objectContaining({ signatures: expect.any(Map) }));
    expect(save).toHaveBeenCalledWith('Learner-Journal_Learner_2026-08.pdf', { returnPromise: true });
    expect(fetchImage).toHaveBeenCalledWith('/saved-signature.png', expect.objectContaining({ credentials: 'same-origin' }));
  });
  it('exports all months in one file and loads a reused signature only once', async () => {
    await downloadJournal({ summary, months: ['2026-08', '2026-07', '2026-08'] });
    expect(getMonth).toHaveBeenCalledTimes(2);
    expect(buildJournalPdf).toHaveBeenCalledWith(summary, [report('2026-07'), report('2026-08')], expect.anything());
    expect(fetchImage.mock.calls.filter(([url]) => url === '/saved-signature.png')).toHaveLength(1);
    expect(save).toHaveBeenCalledExactlyOnceWith('Learner-Journal_Learner_all-months_2026-07_to_2026-08.pdf', { returnPromise: true });
  });
  it('does not save a partial PDF if a month fails', async () => {
    vi.mocked(getMonth).mockImplementation(async month => { if (month === '2026-08') throw new Error('Report unavailable'); return report(month); });
    await expect(downloadJournal({ summary, months: ['2026-07', '2026-08'] })).rejects.toThrow('Report unavailable');
    expect(save).not.toHaveBeenCalled();
  });
  it('stops when a saved signature cannot be fetched', async () => {
    fetchImage.mockImplementation(async url => url === '/saved-signature.png' ? new Response('', { status: 403 }) : new Response(png));
    await expect(downloadJournal({ summary, months: ['2026-08'] })).rejects.toThrow('saved signature could not be loaded');
    expect(save).not.toHaveBeenCalled();
  });
  it('does not download after the page is closed or the learner changes', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(downloadJournal({ summary, months: ['2026-08'], signal: controller.signal })).rejects.toThrow();
    expect(getMonth).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
});
