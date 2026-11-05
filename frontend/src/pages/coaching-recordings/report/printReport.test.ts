import { describe, expect, it, vi } from 'vitest';
import { buildCoachingAiReport, openCoachingReport } from './printReport';

describe('Coaching Session report presentation', () => {
  it('uses the source HTML/PDF sections without altering saved quality or attendance judgements', () => {
    const report = { id: 'saved', learnerName: 'Synthetic Learner', type: 'progress_review', status: 'completed', updatedAt: null,
      report: { executive_summary: 'Saved executive summary', overall_rating: { rag: 'Amber', average_rating: 3, professional_judgement: 'Saved judgement' },
        strengths: ['Saved strength'], priority_actions: [{ owner: 'Coach', action: 'Follow up', due: 'Next month' }],
        qa: [{ metric: 'Employer sign-off', rag: 'Red', result: 'Not evidenced', evidence: [{ quote: 'Saved original evidence' }] }] } };
    const before = JSON.stringify(report);
    const html = buildCoachingAiReport(report);
    expect(html).toContain('@page{size:A4 portrait;margin:14mm 13mm}');
    expect(html).toContain('ai-qa-grid');
    for (const text of ['AI Quality Report', 'Professional Judgement', 'Executive Summary', 'Strengths', 'Actions', 'QA Metrics', 'Not evidenced', 'Saved original evidence']) expect(html).toContain(text);
    expect(html).toContain('Save as PDF');
    expect(html).not.toContain('<script');
    expect(JSON.stringify(report)).toBe(before);
  });

  it('escapes report content and confines the preview to static HTML', () => {
    const html = buildCoachingAiReport({ id: 'saved', learnerName: '<img src=x onerror=alert(1)>', type: 'monthly_coaching', status: 'completed', updatedAt: null,
      report: { executive_summary: '</p><script>alert(1)</script>', qa: [{ metric: '<iframe src="https://foreign.invalid">' }] } }, null, true);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('id="save-report-pdf"');
  });

  it('handles blocked report windows and binds browser PDF printing to an explicit click', () => {
    const create = vi.fn(() => 'blob:synthetic-report');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const blocked = vi.spyOn(window, 'open').mockReturnValueOnce(null);
    expect(openCoachingReport('<html></html>')).toBe(false);
    const button = document.createElement('button');
    const win = { opener: window, document: { getElementById: () => button }, print: vi.fn(), focus: vi.fn(), addEventListener: vi.fn() };
    blocked.mockReturnValueOnce(win as unknown as Window);
    expect(openCoachingReport('<html>Saved report</html>')).toBe(true);
    expect(win.opener).toBeNull();
    expect(win.print).not.toHaveBeenCalled();
    (win.addEventListener.mock.calls[0][1] as () => void)();
    button.click();
    expect(win.print).toHaveBeenCalledTimes(1);
    blocked.mockRestore();
    vi.unstubAllGlobals();
  });
});
