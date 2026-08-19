import DOMPurify from "dompurify";

/**
 * LMS reading bodies contain staff-authored rich HTML. Keep the document
 * structure, but remove executable markup and source-owned styling before the
 * content is inserted into the ledger DOM.
 */
export function sanitizeReadingHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ["style"],
  });
}
