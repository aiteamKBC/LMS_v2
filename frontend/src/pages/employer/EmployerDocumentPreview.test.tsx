import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmployerDocumentPreview } from './EmployerDocumentPreview';
import { loadEmployerDocumentPreview } from './employerDocumentPreviewData';
import type { SigningTarget } from './useEmployerSigning';

const mocks = vi.hoisted(() => ({ native: vi.fn(), migrated: vi.fn(), legacy: vi.fn(), fetch: vi.fn(), form: vi.fn(),
  agreement: vi.fn(), training: vi.fn(), written: vi.fn() }));
vi.mock('@/api/employerPortal', () => ({ fetchEmployerReviewInstance: mocks.native, fetchEmployerEnrolmentReview: mocks.legacy }));
vi.mock('@/api/learnerCalendar', () => ({ fetchMigratedReviewForParty: mocks.migrated }));
// PDF.js canvas rendering has its own suite and the browser check; record which PDF is previewed here.
vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: ({ url, label }: { url: string; label: string }) =>
  <section aria-label={label} data-url={url} /> }));
vi.mock('@/pages/learner/reviews/LearnerReviewInstanceForm', () => ({ LearnerReviewInstanceForm: (props: unknown) => {
  mocks.form(props); return <div>Saved review answers</div>;
} }));
vi.mock('@/lib/apprenticeshipAgreementPdf', () => ({ renderAgreementPdf: mocks.agreement }));
vi.mock('@/lib/trainingPlanPdf', () => ({ renderTrainingPlanPdf: mocks.training }));
vi.mock('@/lib/writtenAgreementPdf', () => ({ renderWrittenAgreementPdf: mocks.written }));

const target: SigningTarget = { kind: 'commercial', learnerId: '101', item: {
  kind: 'review', eventKey: 'cal:1', reviewInstanceId: 'ri-1', label: 'Example review', reviewType: 'progress',
  scheduledDate: '2026-10-21', completed: false, signable: false, signed: false, signedAt: null,
  signedName: '', learnerSigned: false, adminSigned: false, employerSignatureRequired: true, sectionsTotal: 1,
} };
const definition = { template: {}, instance: { id: 'ri-1', status: 'draft' },
  pdf: { available: false, reason: 'Complete the review and required signatures before downloading.' } };
const pdfResponse = () => new Response('%PDF-1.7 saved example', { headers: {
  'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Signed-review.pdf"',
} });

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no native dialog implementation; browser checks exercise real focus/Escape behavior.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  mocks.native.mockResolvedValue(definition);
  mocks.migrated.mockResolvedValue(definition);
  mocks.fetch.mockImplementation(() => Promise.resolve(pdfResponse()));
  for (const renderPdf of [mocks.agreement, mocks.training, mocks.written]) {
    renderPdf.mockReturnValue({ output: () => new Blob(['%PDF-1.7 snapshot'], { type: 'application/pdf' }) });
  }
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['commercial', 'apprenticeship'] as const)('reads a draft through the %s employer endpoint without exposing edit or sign actions', async kind => {
  render(<EmployerDocumentPreview employerId="9" target={{ ...target, kind }} onClose={vi.fn()} />);
  expect(await screen.findByText('Saved review answers')).toBeVisible();
  expect(mocks.native).toHaveBeenCalledWith('9', kind, '101', 'cal:1');
  expect(mocks.form.mock.calls[0][0]).toEqual({ definition, viewerRole: 'employer', signatoryName: '' });
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.legacy).not.toHaveBeenCalled();
});

it('previews the native signed PDF and exposes an explicit download of the same bytes', async () => {
  mocks.native.mockResolvedValue({ ...definition, pdf: { available: true } });
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const view = render(<EmployerDocumentPreview employerId="9" target={target} onClose={vi.fn()} />);
  const link = await screen.findByRole('link', { name: 'Download' });
  expect(link).toHaveAttribute('href', 'blob:preview');
  expect(link).toHaveAttribute('download', 'Signed-review.pdf');
  expect(screen.getByRole('region', { name: 'Example review preview' })).toHaveAttribute('data-url', 'blob:preview');
  expect(mocks.fetch).toHaveBeenCalledWith('/learner_api/employer-portal/9/learner/commercial/101/events/cal%3A1/review/pdf/',
    expect.objectContaining({ credentials: 'include' }));
  expect(clicked).not.toHaveBeenCalled();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});

it('previews unfinished migrated reviews without requesting a final PDF', async () => {
  const draft = { ...target, item: { ...target.item, migratedForm: true, signed: true, completed: false } } as SigningTarget;
  render(<EmployerDocumentPreview employerId="9" target={draft} onClose={vi.fn()} />);
  expect(await screen.findByText('Saved review answers')).toBeVisible();
  expect(mocks.migrated).toHaveBeenCalledWith('cal:1', expect.any(AbortSignal));
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.native).not.toHaveBeenCalled();
});

it('shows an error and retries without exposing a fake successful preview', async () => {
  mocks.native.mockRejectedValueOnce(new Error('Review unavailable'));
  render(<EmployerDocumentPreview employerId="9" target={target} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Review unavailable');
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Saved review answers')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('ignores a late response after switching learners and after closing', async () => {
  let resolveFirst!: (value: unknown) => void;
  mocks.native.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }));
  const view = render(<EmployerDocumentPreview employerId="9" target={target} onClose={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading preview');
  view.rerender(<EmployerDocumentPreview employerId="9" target={{ ...target, learnerId: '102' }} onClose={vi.fn()} />);
  await screen.findByText('Saved review answers');
  view.unmount();
  await act(async () => resolveFirst({ ...definition, pdf: { available: true } }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(mocks.form.mock.calls.every(([props]) => props.definition === definition)).toBe(true);
});

it('closes with the dialog cancel event and restores the initiating control', async () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  const onClose = vi.fn();
  const view = render(<EmployerDocumentPreview employerId="9" target={target} onClose={onClose} />);
  await screen.findByText('Saved review answers');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it.each([['agreement', mocks.agreement], ['training-plan', mocks.training], ['written-agreement', mocks.written]] as const)(
  'renders the saved %s snapshot instead of fetching a generic document with the same id', async (kind, renderPdf) => {
    const snapshot = { id: 'doc-1', frozen: true };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ kind, document: snapshot })));
    const value = await loadEmployerDocumentPreview('9', { ...target,
      item: { kind, id: 'doc-1', label: 'Saved document' } as SigningTarget['item'] }, new AbortController().signal);
    expect(value.kind).toBe('pdf');
    expect(renderPdf).toHaveBeenCalledWith(snapshot);
    expect(mocks.fetch.mock.calls[0][0]).toBe(`/learner_api/employer-portal/9/learner/commercial/101/documents/${kind}/doc-1/`);
  },
);

it('loads a stored compliance PDF using the employer-owned URL without forwarding cookies to storage', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ kind: 'document', url: 'https://storage.example.invalid/saved.pdf' })));
  const value = await loadEmployerDocumentPreview('9', { ...target,
    item: { kind: 'document', id: 'doc-1', label: 'Saved document' } as SigningTarget['item'] }, new AbortController().signal);
  expect(value.kind).toBe('pdf');
  expect(mocks.fetch).toHaveBeenLastCalledWith('https://storage.example.invalid/saved.pdf', expect.objectContaining({ credentials: 'omit' }));
});

it('does not preview an HTML login response as a signed document', async () => {
  mocks.native.mockResolvedValue({ ...definition, pdf: { available: true } });
  mocks.fetch.mockResolvedValueOnce(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));
  render(<EmployerDocumentPreview employerId="9" target={target} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The server did not return a PDF.');
  expect(screen.queryByRole('region', { name: 'Example review preview' })).not.toBeInTheDocument();
});
