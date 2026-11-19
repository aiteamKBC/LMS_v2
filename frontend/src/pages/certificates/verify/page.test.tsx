import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Page from './page';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function route() {
  render(<MemoryRouter initialEntries={['/verify-certificate/token']}><Routes>
    <Route path="/verify-certificate/:token" element={<Page />} />
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
  expect(screen.getAllByText(/Corrected copy · Revision 2 · Corrected 19 November 2026/)).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledWith('/learner_api/certificates/verify/token/', { credentials: 'omit', cache: 'no-store' });
});
it('does not show a document or download action for a revoked certificate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'This certificate has been revoked.' }), { status: 410 })));
  route();
  expect(await screen.findByText('This certificate has been revoked.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  expect(document.querySelector('#certificate-print-area')).toBeNull();
});
