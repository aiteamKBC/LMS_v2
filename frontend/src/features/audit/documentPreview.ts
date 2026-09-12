/** The original Audit viewer: the blob's real extension outranks its label. */
export function auditDocumentEmbedUrl(url: string, name: string, contentType: string | null) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('This document link is unavailable.');
  const kind = (contentType || '').toLowerCase();
  const blobPath = parsed.pathname;
  if (/\.(pdf|png|jpe?g|gif|webp)$/i.test(blobPath) || kind === 'application/pdf') return url;
  const office = /\.(docx?|xlsx?|pptx?)$/i.test(blobPath) || /\.(docx?|xlsx?|pptx?)($|\?)/i.test(name)
    || kind.includes('officedocument') || kind.includes('msword') || kind.includes('ms-excel') || kind.includes('ms-powerpoint');
  return office ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}` : url;
}
