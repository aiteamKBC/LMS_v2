import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssignmentDownload } from './AssignmentDownload';
import { buildAssignmentReport } from './downloadAssignment';
vi.mock('./downloadAssignment', () => ({ buildAssignmentReport: vi.fn() }));
vi.mock('./AssignmentPdfPreview', () => ({ AssignmentPdfPreview: ({ url }: { url: string }) => <div title="Assignment report PDF preview" data-url={url} /> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('previews and downloads the same PDF and releases it on unmount', async () => {
  vi.mocked(buildAssignmentReport).mockResolvedValue({ blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'report.pdf' });
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('report.pdf'); expect(this.href).toBe('blob:report');
  });
  const view = render(<AssignmentDownload kind="commercial" learnerId="12" activityId="A5" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview report' }));
  expect(await screen.findByTitle('Assignment report PDF preview')).toHaveAttribute('data-url', 'blob:report');
  expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Download report (PDF)' }));
  expect(click).toHaveBeenCalledOnce();
  expect(buildAssignmentReport).toHaveBeenCalledOnce();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
});
