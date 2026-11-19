import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import QualityWorkspace from '@/pages/curriculum/hubs/QualityWorkspace';
import { LegacyQualityRedirect } from '@/router/LegacyQualityRedirect';
vi.mock('@/pages/executive/page', () => ({ default: () => <h1>Quality overview</h1> }));
vi.mock('./components/DeepDivePage', () => ({ default: () => <h1>Deep Dive content</h1> }));
function Destination() { const location = useLocation(); return <output aria-label="Destination">{location.pathname}{location.search}{location.hash}</output>; }
function open(path: string) { return render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/curriculum/quality-demo" element={<LegacyQualityRedirect />} />
  <Route path="/curriculum/quality" element={<QualityWorkspace />} />
  <Route path="/curriculum/coaching-recordings/reviews" element={<Destination />} />
</Routes></MemoryRouter>); }
it('keeps Deep Dive and the overview accessible in the current quality workspace', async () => {
  open('/curriculum/quality?view=deep-dive');
  await screen.findByRole('heading', { name: 'Deep Dive content' });
  fireEvent.click(screen.getByRole('link', { name: 'Quality overview' }));
  await screen.findByRole('heading', { name: 'Quality overview' });
  expect(screen.getByRole('link', { name: 'Quality checks' })).toHaveAttribute('href', '/curriculum/quality');
});
it('preserves saved review filters through both legacy redirects', async () => {
  open('/curriculum/quality-demo?view=checks&type=FORM_EXAMPLE&status=all&review=synthetic&from=2026-11-01');
  expect(await screen.findByLabelText('Destination')).toHaveTextContent('/curriculum/coaching-recordings/reviews?type=FORM_EXAMPLE&status=all&review=synthetic&from=2026-11-01');
});
it('preserves filters and hashes when replacing the obsolete dashboard route', async () => {
  render(<MemoryRouter initialEntries={['/curriculum/quality-demo?view=feedbacks&classification=negative#responses']}><Routes>
    <Route path="/curriculum/quality-demo" element={<LegacyQualityRedirect />} />
    <Route path="/curriculum/quality" element={<Destination />} />
  </Routes></MemoryRouter>);
  expect(await screen.findByLabelText('Destination')).toHaveTextContent('/curriculum/quality?view=feedbacks&classification=negative#responses');
});
