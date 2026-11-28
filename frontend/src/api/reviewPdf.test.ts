import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveReviewPdfResponse } from './reviewPdf';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Review PDF response', () => {
  it('surfaces signature and authentication refusals without starting a download', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await expect(saveReviewPdfResponse(new Response(JSON.stringify({ detail: 'Awaiting learner signature.' }), { status: 409 })))
      .rejects.toThrow('Awaiting learner signature.');
    await expect(saveReviewPdfResponse(new Response('Sign in', { status: 401 }))).rejects.toThrow('could not be downloaded');
    expect(click).not.toHaveBeenCalled();
  });

  it('rejects an HTML login page even if the response status is successful', async () => {
    await expect(saveReviewPdfResponse(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })))
      .rejects.toThrow('did not return a PDF');
  });

  it('downloads the server PDF and releases the object URL', async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockReturnValue('blob:test-pdf');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await saveReviewPdfResponse(new Response('%PDF-1.7', { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Monthly-Coaching-Meeting-REVI-1.pdf"',
    } }));
    expect(create).toHaveBeenCalledOnce();
    expect(filename).toBe('Monthly-Coaching-Meeting-REVI-1.pdf');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:test-pdf');
  });
});
