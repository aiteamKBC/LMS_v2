import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Page from './page';

const pdfMocks = vi.hoisted(() => ({ toPng: vi.fn(), create: vi.fn(), addImage: vi.fn(), save: vi.fn() }));
vi.mock('html-to-image', () => ({ toPng: pdfMocks.toPng }));
vi.mock('jspdf', () => ({ jsPDF: function (options: unknown) {
  pdfMocks.create(options);
  return { addImage: pdfMocks.addImage, save: pdfMocks.save };
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
function route(personal = false) {
  const path = personal ? '/verify-personal-certificate/:token' : '/verify-certificate/:token';
  render(<MemoryRouter initialEntries={[path.replace(':token', 'token')]}><Routes>
    <Route path={path} element={<Page personal={personal} />} />
  </Routes></MemoryRouter>);
}
it('renders the corrected name and revision on both the document and printable copy', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ valid: true, certificate: {
    certificateNumber: 'KBC-TEST', templateVersion: 3, progressPercent: 90, revision: 2, correctedAt: '2026-11-19T12:00:00Z',
    snapshot: { learner: { name: 'Corrected student' }, moduleTitle: 'Course', bodyText: 'Completed requirements', layoutConfig: { decorationStyle: 'none', showQr: false } },
    issuedAt: '2026-11-18T12:00:00Z', verificationToken: 'token',
  } }))));
  route();
  expect(await screen.findByRole('status')).toHaveTextContent('Corrected copy · Revision 2');
  expect(screen.getAllByText('Corrected student')).toHaveLength(2);
  expect(screen.getAllByText(/Corrected copy · Revision 2 · Corrected 19 November 2026/)).toHaveLength(1);
  expect(document.querySelector('.certificate-preview-shell')).not.toHaveTextContent('Corrected copy');
  expect(document.querySelector('#certificate-print-area')).not.toHaveTextContent('Corrected copy');
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledWith('/learner_api/certificates/verify/token/', { credentials: 'omit', cache: 'no-store' });
});

it.each([false, true])('renders genuine inline QR codes for both the screen and print copy (personal: %s)', async personal => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ valid: true, certificate: {
    certificateNumber: 'KBC-TEST', templateVersion: 3, progressPercent: 80,
    snapshot: { learner: { name: 'Example student' }, layoutConfig: { showQr: true, decorationStyle: 'none' } },
    issuedAt: '2026-11-18T12:00:00Z', verificationToken: 'token',
  } }))));
  route(personal);
  await screen.findByRole('button', { name: 'Download PDF' });
  expect(document.querySelectorAll('svg[data-certificate-qr="ready"]')).toHaveLength(2);
  expect(document.querySelector('#certificate-print-area svg[data-certificate-qr="ready"]')).not.toBeNull();
  expect(document.querySelector('img[src*="qrserver"]')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(`/learner_api/${personal ? 'personal-learning' : 'certificates'}/verify/token/`, { credentials: 'omit', cache: 'no-store' });
});

async function readyForDownload(showQr = true) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ valid: true, certificate: {
    certificateNumber: 'KBC-TEST', templateVersion: 3, progressPercent: 100, otjHours: 12.5,
    snapshot: { learner: { name: 'Example student' }, layoutConfig: { showQr, decorationStyle: 'none' } },
    issuedAt: '2026-11-18T12:00:00Z', verificationToken: 'token',
  } }))));
  route();
  return screen.findByRole('button', { name: 'Download PDF' });
}

it.each([true, false])('exports the printable certificate independently of the responsive preview (QR enabled: %s)', async showQr => {
  pdfMocks.toPng.mockResolvedValue('data:image/png;base64,example');
  fireEvent.click(await readyForDownload(showQr));
  await waitFor(() => expect(pdfMocks.save).toHaveBeenCalledWith('KBC-TEST.pdf'));
  const source = pdfMocks.toPng.mock.calls[0][0] as HTMLElement;
  expect(source.closest('#certificate-print-area')).not.toBeNull();
  expect(source).toHaveTextContent('Example student');
  expect(source).toHaveTextContent('100%');
  expect(source).toHaveTextContent('12h 30m');
  expect(!!source.querySelector('svg[data-certificate-qr="ready"]')).toBe(showQr);
  expect(pdfMocks.addImage).toHaveBeenCalledWith('data:image/png;base64,example', 'PNG', 0, 0, 297, 210);
});

it('does not download a certificate when its required QR is missing from the export', async () => {
  const button = await readyForDownload();
  document.querySelector('#certificate-print-area svg[data-certificate-qr="ready"]')!.remove();
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('The verification QR code is unavailable');
  expect(pdfMocks.toPng).not.toHaveBeenCalled();
  expect(pdfMocks.save).not.toHaveBeenCalled();
  expect(button).toBeEnabled();
});

it('shows an export failure and allows retrying without downloading an incomplete PDF', async () => {
  pdfMocks.toPng.mockRejectedValueOnce(new Error('Could not render certificate')).mockResolvedValue('data:image/png;base64,example');
  const button = await readyForDownload();
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not render certificate');
  expect(pdfMocks.save).not.toHaveBeenCalled();
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(pdfMocks.save).toHaveBeenCalledWith('KBC-TEST.pdf'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not show a document or download action for a revoked certificate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'This certificate has been revoked.' }), { status: 410 })));
  route();
  expect(await screen.findByText('This certificate has been revoked.')).toBeVisible();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Certificate not verified');
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  expect(document.querySelector('#certificate-print-area')).toBeNull();
});

it.each([false, true])('allows retrying a service failure without declaring the certificate invalid (personal: %s)', async personal => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Certificate verification is unavailable.' }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, certificate: {
      certificateNumber: 'KBC-RETRY', templateVersion: 3, progressPercent: 100, otjHours: 3.5,
      snapshot: { learner: { name: 'Corrected student' }, layoutConfig: { showQr: false } },
      issuedAt: '2026-11-18T12:00:00Z', verificationToken: 'token',
    } })));
  vi.stubGlobal('fetch', fetchMock);
  route(personal);
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Verification temporarily unavailable');
  expect(screen.queryByText('Certificate not verified')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  expect(document.querySelector('#certificate-print-area')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Certificate verified');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByText('Corrected student')).toHaveLength(2);
  expect(screen.getAllByText('3h 30m')).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith(`/learner_api/${personal ? 'personal-learning' : 'certificates'}/verify/token/`, { credentials: 'omit', cache: 'no-store' });
});

it.each(['network', 'gateway', 'empty response'])('offers retry instead of a certificate verdict for %s errors', async failure => {
  const fetchMock = vi.fn();
  if (failure === 'network') fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  else if (failure === 'gateway') fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
  else fetchMock.mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  route();
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  expect(screen.queryByText('Certificate verified')).not.toBeInTheDocument();
  expect(document.querySelector('#certificate-print-area')).toBeNull();
});

it.each([
  [404, 'Certificate not found.'],
  [410, 'This certificate has been replaced by a newer template version.'],
])('preserves a definitive verification response (%s)', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: message }), { status: Number(status) })));
  route();
  expect(await screen.findByRole('alert')).toHaveTextContent(String(message));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Certificate not verified');
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
});

it('reopening the same link reads the latest name, course, progress and design for screen and print', async () => {
  const certificate = {
    certificateNumber: 'KBC-TEST', templateVersion: 3, progressPercent: 80, otjHours: 8.5,
    snapshot: { learner: { name: 'First name' }, moduleTitle: 'First course', certificateTitle: 'First title',
      bodyText: 'First text', layoutConfig: { showQr: false, decorationStyle: 'none' } },
    issuedAt: '2026-11-18T12:00:00Z', verificationToken: 'token',
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ valid: true, certificate }))));
  route();
  expect(await screen.findAllByText('First name')).toHaveLength(2);
  expect(screen.getAllByText('8h 30m')).toHaveLength(2);
  cleanup();
  certificate.progressPercent = 100;
  certificate.otjHours = 12.5;
  certificate.snapshot = { ...certificate.snapshot, learner: { name: 'Current name' }, moduleTitle: 'Current course',
    certificateTitle: 'Published title', bodyText: 'Published text' };
  route();
  expect(await screen.findAllByText('Current name')).toHaveLength(2);
  expect(screen.getAllByText('Published text')).toHaveLength(2);
  expect(screen.getAllByText('Current course')).toHaveLength(3);
  expect(screen.getAllByText('100%')).toHaveLength(3);
  expect(screen.getAllByText('12h 30m')).toHaveLength(2);
  expect(document.querySelector('#certificate-print-area')).toHaveTextContent('OTJ hours completed: 12h 30m');
  expect(screen.queryByText('8h 30m')).not.toBeInTheDocument();
  expect(screen.queryByText('First name')).not.toBeInTheDocument();
  expect(screen.getAllByText('KBC-TEST')).toHaveLength(3);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('makes a failed refresh visible while showing the saved certificate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ valid: true, certificate: {
    certificateNumber: 'KBC-TEST', templateVersion: 3, progressPercent: 80,
    snapshot: { learner: { name: 'Saved name' }, layoutConfig: { showQr: false } },
    issuedAt: '2026-11-18T12:00:00Z', verificationToken: 'token',
    refreshWarnings: ['Current course details could not be loaded. Showing the saved course and progress.'],
  } }))));
  route();
  expect(await screen.findByRole('alert')).toHaveTextContent('Showing the saved course and progress');
  expect(screen.getAllByText('Saved name')).toHaveLength(2);
});
