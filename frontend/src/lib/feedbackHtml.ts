import DOMPurify from 'dompurify';

const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'font', 'span'];
const allowedAttributes = ['size', 'style'];

export function sanitizeFeedbackHtml(value: string | null | undefined): string {
  return DOMPurify.sanitize(value || '', {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    FORBID_ATTR: ['class', 'id', 'src', 'href'],
  }).replace(/ style="[^"]*"/gi, match => {
    const style = match.match(/style="([^"]*)"/i)?.[1] || '';
    return /^font-size\s*:\s*\d+(?:\.\d+)?(?:px|em|rem|%)\s*;?$/i.test(style.trim())
      ? ` style="${style.replace(/"/g, '&quot;')}"`
      : '';
  });
}

export function plainTextToFeedbackHtml(value: string | null | undefined): string {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';
  return text.split(/\n{2,}/).map(paragraph => {
    const lines = paragraph.split('\n');
    return `<p>${lines.map(line => escapeHtml(line)).join('<br>')}</p>`;
  }).join('');
}

export function normalizeFeedbackHtml(value: string | null | undefined): string {
  const raw = String(value || '');
  return /<[a-z][^>]*>/i.test(raw) ? sanitizeFeedbackHtml(raw) : plainTextToFeedbackHtml(raw);
}

export function feedbackHtmlToPlainText(value: string | null | undefined): string {
  const html = normalizeFeedbackHtml(value);
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const container = document.createElement('div');
  container.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|h2|h3|h4|li)>/gi, '\n')
    .replace(/<(?:p|h2|h3|h4|li)>/gi, '');
  return (container.innerText || container.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}
