import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { HistoricalEvidenceItem, HistoricalEvidenceDetail } from '@/api/historicalEvidence';
import type { EvidenceRecord } from '@/api/evidence';
import { EvidenceBody } from './components/EvidenceBody';
import { auditDocumentEmbedUrl } from '@/features/audit/documentPreview';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: 125 } } }) }));

const historical: HistoricalEvidenceItem = { id: 'aptem:123', source: 'aptem', source_id: 123, name: 'Leadership assignment.docx', component_name: 'Leadership', category: 'assignment', status: 'Accepted', date: '2026-08-10', otjh_hours: 2, ksb_codes: ['K1'], has_file: true, has_report: true, has_note: true, replaced: false, original_has_file: true, note_preview: 'Saved reflection' };
const review: HistoricalEvidenceItem = { ...historical, id: 'aptem:124', source_id: 124, name: 'Progress review', category: 'review', status: 'Recorded', date: '2026-07-02' };
const native: EvidenceRecord = { id: 'native-1', filename: 'New evidence.pdf', contentType: 'application/pdf', sizeBytes: 200, status: 'approved', markingStatus: '', scanResult: null, sectionRef: '', uploadedAt: '2026-09-10', trainingPlanDetails: null, canDelete: true };
const detail: HistoricalEvidenceDetail = { item: historical, documents: [{ part: 'file', name: historical.name, content_type: null }, { part: 'report', name: 'Assessment report.docx', content_type: 'application/pdf' }], note: '<p>Original saved note</p><script>bad()</script>', feedbacks: [{ author: 'Coach', message: 'Original assessment feedback' }] };

function show(props: Partial<Parameters<typeof EvidenceBody>[0]> = {}, expand = true) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><MemoryRouter>
    <EvidenceBody learnerKind="commercial" learnerId="125" real={null} canProgress={false} showReadOnlyNotice
      evidenceRecords={[native]} historicalRecords={[historical, review]} evidenceLoading={false} evidenceError={null} reloadEvidence={vi.fn()} {...props} />
  </MemoryRouter></QueryClientProvider>);
  const expandButton = screen.queryByRole('button', { name: 'Expand all months' });
  if (expand && expandButton) fireEvent.click(expandButton);
}

beforeEach(() => {
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes('/open/')) {
      const report = url.includes('part=report');
      return new Response(JSON.stringify({ url: `https://files.example.test/${report ? 'report.pdf' : 'assignment.docx'}?sig=preview`, download_url: 'https://files.example.test/download', name: report ? 'Assessment report.docx' : historical.name, content_type: report ? 'application/pdf' : null }));
    }
    return new Response(JSON.stringify(detail));
  }));
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('Previous evidence in the learner library', () => {
  it('groups months newest first and opens evidence within its component', () => {
    show({}, false);
    const library = within(screen.getByRole('region', { name: 'Evidence by month' }));
    expect(library.getByRole('button', { name: 'September 2026', exact: true })).toHaveAttribute('aria-expanded', 'true');
    expect(library.getByRole('button', { name: 'August 2026', exact: true })).toHaveAttribute('aria-expanded', 'false');
    expect(library.queryByRole('button', { name: `Open evidence: ${historical.name}` })).not.toBeInTheDocument();
    fireEvent.click(library.getByRole('button', { name: 'August 2026', exact: true }));
    const month = within(library.getByRole('region', { name: 'August 2026 evidence' }));
    const component = within(month.getByRole('region', { name: 'Leadership component' }));
    expect(component.getByRole('button', { name: `Open evidence: ${historical.name}` })).toBeVisible();
    fireEvent.click(component.getByRole('button', { name: 'Leadership', exact: true }));
    expect(component.queryByRole('button', { name: `Open evidence: ${historical.name}` })).not.toBeInTheDocument();
    fireEvent.click(library.getByRole('button', { name: 'Expand all months' }));
    expect(component.getByRole('button', { name: `Open evidence: ${historical.name}` })).toBeVisible();
    fireEvent.click(library.getByRole('button', { name: 'Collapse all months' }));
    expect(library.queryAllByRole('button', { name: /^Open evidence:/ })).toHaveLength(0);
  });
  it('uses real component identities and keeps undated records in a separate section', () => {
    const first = { ...historical, component_id: 11 };
    const second = { ...historical, id: 'aptem:125', source_id: 125, component_id: 12, name: 'Second assignment.docx' };
    const undated = { ...review, component_id: 13, date: null };
    show({ evidenceRecords: [], historicalRecords: [first, second, undated] });
    const august = within(screen.getByRole('region', { name: 'August 2026 evidence' }));
    expect(august.getAllByRole('region', { name: 'Leadership component' })).toHaveLength(2);
    const noDate = within(screen.getByRole('region', { name: 'Date not recorded evidence' }));
    expect(noDate.getByRole('button', { name: 'Open evidence: Progress review' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Open evidence:/ })).toHaveLength(3);
  });
  it('searches component names and filenames across collapsed months and opens matching groups', () => {
    const current = { ...native, trainingPlanDetails: { componentId: 'assignment-1', componentTitle: 'Strategic leadership', moduleTitle: 'Leadership', weekTitle: 'Week 2' } };
    show({ evidenceRecords: [current] }, false);
    fireEvent.change(screen.getByPlaceholderText('Search evidence, component or KSB...'), { target: { value: 'leadership' } });
    expect(screen.getByRole('button', { name: 'Open evidence: New evidence.pdf' })).toBeVisible();
    expect(screen.getByRole('button', { name: `Open evidence: ${historical.name}` })).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText('Search evidence, component or KSB...'), { target: { value: 'New evidence.pdf' } });
    expect(screen.getByText('Showing 1 of 3 items')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Strategic leadership component' })).toBeVisible();
  });
  it('combines the two sources and filters assignments, source and month', () => {
    show();
    expect(screen.getByText('Showing 3 of 3 items')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Assignments only' }));
    expect(screen.getByRole('button', { name: `Open evidence: ${historical.name}` })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open evidence: New evidence.pdf' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear all filters'));
    fireEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'previous' } });
    expect(screen.getByText('Showing 2 of 3 items')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-07' } });
    expect(screen.getByRole('button', { name: 'Open evidence: Progress review' })).toBeVisible();
    expect(screen.getByText('Showing 1 of 3 items')).toBeVisible();
  });
  it('opens the original Office file and PDF report in place with saved notes and feedback', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: `Open evidence: ${historical.name}` }));
    const dialog = within(screen.getByRole('dialog', { name: historical.name }));
    expect(await dialog.findByTitle(historical.name)).toHaveAttribute('src', expect.stringContaining('https://view.officeapps.live.com/op/embed.aspx?src='));
    expect(fetch).toHaveBeenCalledWith('/learner_api/evidence/commercial/125/historical/aptem/123/', expect.anything());
    expect(dialog.getByText('Original assessment feedback')).toBeVisible();
    expect(dialog.queryByRole('button', { name: /Remove|Delete/ })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Assessment report' }));
    expect(await dialog.findByTitle('Assessment report.docx')).toHaveAttribute('src', 'https://files.example.test/report.pdf?sig=preview');
    fireEvent.click(dialog.getByRole('button', { name: 'Saved note' }));
    const note = dialog.getByTitle(`Saved note: ${historical.name}`);
    expect(note).toHaveAttribute('sandbox', '');
    expect(note.getAttribute('srcdoc')).toContain('Original saved note');
    expect(note.getAttribute('srcdoc')).not.toContain('<script>');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 3 items')).toBeVisible();
  });
  it('retains real uploads when the historical source fails and does not claim an empty library', () => {
    show({ historicalRecords: [], historicalError: 'Source unavailable' });
    expect(screen.getByRole('alert')).toHaveTextContent('Previous evidence: Source unavailable');
    expect(screen.getByRole('button', { name: 'Open evidence: New evidence.pdf' })).toBeVisible();
    expect(screen.queryByText('No evidence found yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry previous evidence' })).toBeVisible();
  });
  it('does not label scan approval or an unknown historic status as assessment validation', () => {
    show();
    expect(within(screen.getByRole('button', { name: 'Open evidence: New evidence.pdf' })).getByText('Draft')).toBeVisible();
    expect(within(screen.getByRole('button', { name: 'Open evidence: Progress review' })).getByText('Recorded')).toBeVisible();
    expect(within(screen.getByRole('button', { name: `Open evidence: ${historical.name}` })).getByText('Accepted')).toBeVisible();
  });
  it('retries document preparation without losing the evidence details', async () => {
    const normal = vi.mocked(fetch).getMockImplementation()!;
    let failed = false;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).includes('/open/') && !failed) { failed = true; return new Response(JSON.stringify({ error: 'Storage unavailable' }), { status: 503 }); }
      return normal(...args);
    });
    show();
    fireEvent.click(screen.getByRole('button', { name: `Open evidence: ${historical.name}` }));
    expect(await screen.findByText('Storage unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry document' }));
    expect(await screen.findByTitle(historical.name)).toBeVisible();
  });
  it('does not replace an unfinished load with a no-evidence message', () => {
    show({ evidenceRecords: [], historicalRecords: [], historicalLoading: true });
    expect(screen.queryByText('No evidence found yet')).not.toBeInTheDocument();
    expect(screen.getByText('Loading evidence…')).toBeVisible();
  });
  it('opens an activity selected as audit evidence through this learner’s existing content preview', async () => {
    const activity = { id: 19, title: 'Selected activity', category: 'assignment', month: '2026-08', activity_date: '2026-08-10',
      completion_note: 'Completed', accepted: true, actual_hours: 2, planned_hours: 2, documents: [], results: [], timestamp_label: '', activity_time: null };
    const item: HistoricalEvidenceItem = { ...historical, source: 'uploaded', source_id: 'audit-activity-test', id: 'uploaded:audit-activity-test', activity };
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).includes('/monthly-logs/')
      ? { id: 19, parts: [{ id: 1, title: 'Original activity text', category: 'assignment', html: '<p>Saved activity body</p>', url: null, quiz: null }] }
      : { item, documents: [], note: 'Completed', feedbacks: [] })));
    show({ historicalRecords: [item] });
    fireEvent.click(screen.getByRole('button', { name: `Open evidence: ${item.name}` }));
    expect(await screen.findByTitle('Original activity text')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/learner_api/monthly-logs/125/2026-08/activities/19/?perspective=learner', expect.anything());
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).startsWith('/audit_api'))).toBe(true);
  });
});

it('uses the actual report format and rejects executable document URLs', () => {
  expect(auditDocumentEmbedUrl('https://files.example.test/report.pdf?sig=x', 'Assignment.docx', null)).toBe('https://files.example.test/report.pdf?sig=x');
  expect(() => auditDocumentEmbedUrl('javascript:alert(1)', 'Test.pdf', null)).toThrow();
});
