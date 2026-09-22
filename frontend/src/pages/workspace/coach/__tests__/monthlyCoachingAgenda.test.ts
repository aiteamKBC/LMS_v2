import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { monthlyCoachingAgenda } from '../monthlyCoachingAgenda';
import { saveProgressReviewPptx } from '@/pages/coach/progress-reviews/lib/progressReviewPptx';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('downloads an agenda with the selected meeting details and monthly coaching labels', async () => {
  const deck = monthlyCoachingAgenda({ id: 'example', title: 'Monthly Coaching', type: 'coaching', source: 'mcr', status: 'scheduled',
    learner: 'Example Learner', programme: 'Example Programme', ownerName: 'Example Coach',
    scheduledDate: '2026-09-21', scheduledTime: '10:30', durationMinutes: 45 });
  const generate = vi.spyOn(JSZip.prototype, 'generateAsync');
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:agenda', revokeObjectURL: vi.fn() });
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  await saveProgressReviewPptx(deck, 'Monthly Coaching Agenda');
  expect(filename).toBe('monthly-coaching-agenda-example-learner.pptx');
  const zip = generate.mock.contexts[0] as JSZip;
  const cover = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(cover).toContain('MONTHLY COACHING AGENDA');
  expect(cover).toContain('Example Learner');
  expect(cover).toContain('EXAMPLE PROGRAMME');
  expect(cover).toContain('45 minutes');
  expect(cover).not.toContain('PROGRESS REVIEW');
  const metadata = await zip.file('docProps/core.xml')!.async('string');
  expect(metadata).toContain('Monthly Coaching Agenda');
  expect(deck.slides).toHaveLength(3);
});
