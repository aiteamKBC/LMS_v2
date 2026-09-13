import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SlidesModal, { type ProgressReviewSlidesDeck } from '../ProgressReviewSlidesModal';
import { reviewDeckMetadata } from '../../lib/reviewDeckMetadata';
import JSZip from 'jszip';
import { saveProgressReviewPptx } from '../../lib/progressReviewPptx';

vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const deck: ProgressReviewSlidesDeck = { learnerName: 'Assigned learner', reviewLabel: 'Review 1', generatedAt: '2026-09-12', windowLabel: '12 weeks', slides: [
  { id: 'cover', type: 'cover', title: 'Cover', heading: 'Review 1', subheading: '', eyebrow: '', details: [
    { label: 'Programme', value: 'Project Controls Professional' }, { label: 'Employer', value: 'Assigned employer' }, { label: 'Line manager', value: 'Assigned manager' },
  ] },
  { id: 'metrics', type: 'metrics', title: 'Learning progress', heading: 'Learning progress', subheading: '', metrics: [] },
] };
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', () => null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the assigned programme and employer after navigating beyond the cover', () => {
  render(<SlidesModal open deck={deck} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByText('Marketing Executive Level 4 Apprenticeship')).not.toBeInTheDocument();
  expect(screen.getAllByText('Project Controls Professional').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Assigned employer').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Manager: Assigned manager').length).toBeGreaterThan(0);
});

it('leaves unavailable programme metadata unrecorded instead of inventing a programme', () => {
  expect(reviewDeckMetadata({ ...deck, slides: deck.slides.slice(1) })).toEqual({
    programme: 'Programme not recorded', employer: 'Employer not recorded', manager: '',
  });
});

it('exports the same programme and employer on slides after the cover', async () => {
  const generate = vi.spyOn(JSZip.prototype, 'generateAsync');
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test-review', revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await saveProgressReviewPptx(deck);
  const zip = generate.mock.contexts[0] as JSZip;
  const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');
  expect(slide).toContain('PROJECT CONTROLS PROFESSIONAL');
  expect(slide).toContain('ASSIGNED EMPLOYER');
  expect(slide).not.toContain('MARKETING EXECUTIVE');
});
