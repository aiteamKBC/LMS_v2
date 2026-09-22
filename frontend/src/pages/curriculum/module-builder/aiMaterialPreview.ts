import type { AiMaterialRecord } from './moduleAuthoringData';

/** Formats for which the uploads route itself returns something viewable. */
const INLINE_PREVIEW_EXTENSIONS = ['.pdf', '.txt'];
/** Formats the Office Online viewer opens, which the route serves at `?preview=1`. */
const OFFICE_PREVIEW_EXTENSIONS = ['.doc', '.docx'];

function extensionOf(fileName: string) {
  const dot = String(fileName || '').lastIndexOf('.');
  return dot < 0 ? '' : String(fileName).slice(dot).toLowerCase();
}

/**
 * The URL that shows the book, or '' when the format has no viewer.
 *
 * EPUB — and the document formats Office Online does not open — have no browser
 * viewer, so the dialog offers the download rather than an empty frame. The
 * viewable cases deliberately mirror what the uploads route already does:
 * it streams a PDF with byte ranges, and frames an Office file through the
 * Office Online viewer at `?preview=1`.
 */
export function aiMaterialPreviewUrl(material: AiMaterialRecord | null) {
  if (!material?.url) return '';
  const extension = extensionOf(material.fileName);
  if (INLINE_PREVIEW_EXTENSIONS.includes(extension)) return material.url;
  if (OFFICE_PREVIEW_EXTENSIONS.includes(extension)) return `${material.url}?preview=1`;
  return '';
}

export function formatMaterialSize(bytes: number) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
