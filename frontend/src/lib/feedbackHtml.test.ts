import { describe, expect, it } from 'vitest';
import { feedbackHtmlToPlainText, normalizeFeedbackHtml, sanitizeFeedbackHtml } from './feedbackHtml';

describe('coach feedback formatting', () => {
  it('keeps the supported formatting and removes executable markup', () => {
    const html = sanitizeFeedbackHtml('<h3>Next steps</h3><ul><li><strong>Measure results</strong></li></ul><script>alert(1)</script>');
    expect(html).toContain('<h3>Next steps</h3>');
    expect(html).toContain('<strong>Measure results</strong>');
    expect(html).not.toContain('<script');
  });

  it('normalizes legacy plain feedback and recovers readable text', () => {
    const html = normalizeFeedbackHtml('First point\n\nSecond point');
    expect(html).toBe('<p>First point</p><p>Second point</p>');
    expect(feedbackHtmlToPlainText(html)).toContain('First point');
    expect(feedbackHtmlToPlainText(html)).toContain('Second point');
  });
});
