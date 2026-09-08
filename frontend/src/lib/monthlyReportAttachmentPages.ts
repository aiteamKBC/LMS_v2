// ============================================================================
// Turning an attached document into pages that can be drawn into the report.
//
// A learner's attachment is stored in blob storage, not in the report, so
// including it in the downloaded PDF means fetching the bytes and converting
// them to images jsPDF can place.
//
// What can and cannot be shown
// ----------------------------
//   image/png, image/jpeg  — drawn directly.
//   application/pdf        — each page rasterised with pdf.js.
//   everything else        — Word, PowerPoint, video: NOT convertible in the
//                            browser. Rendering those needs a server-side
//                            converter (LibreOffice/Gotenberg), so they stay
//                            listed by name with a note saying where to open
//                            them.
// ============================================================================
import type { LearnerKind } from '@/api/learnerDetail';
import {
  monthlyReportAttachmentUrl,
  type MonthlyReportAttachment,
} from '@/api/monthlyReports';

/** One page-sized image ready to place, with its natural aspect ratio. */
export interface RenderedPage {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

export type AttachmentRender =
  | { kind: 'pages'; pages: RenderedPage[]; totalPages: number }
  /** Readable, but not something a PDF can contain. */
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; reason: string };

/** Beyond this, one attachment would dominate the report and the rasterising
 *  would take long enough to look broken. The report says how many were shown. */
const MAX_PDF_PAGES = 20;

/** Rasterising above ~1.5x gains little at print size and costs seconds a page. */
const PDF_RENDER_SCALE = 1.5;

function isImage(contentType: string) {
  return /^image\/(png|jpe?g)$/i.test(contentType);
}

function imageFormatFor(contentType: string): 'PNG' | 'JPEG' {
  return /png/i.test(contentType) ? 'PNG' : 'JPEG';
}

/** Read a blob as a data URL — the form jsPDF's addImage accepts. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result.startsWith('data:')) resolve(result);
      else reject(new Error('The file could not be read.'));
    };
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** Natural pixel dimensions, so the image can be fitted rather than stretched. */
function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The image could not be decoded.'));
    image.src = dataUrl;
  });
}

/** Rasterise every page (up to the cap) of a PDF attachment. */
async function renderPdf(data: ArrayBuffer): Promise<AttachmentRender> {
  // Imported on demand: pdf.js is large, and a report with no PDF attachment
  // must not pay for it. Worker wiring matches the slide-deck viewer.
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const document_ = await getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const totalPages = document_.numPages;
    const pages: RenderedPage[] = [];
    for (let number = 1; number <= Math.min(totalPages, MAX_PDF_PAGES); number += 1) {
      const page = await document_.getPage(number);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not render the PDF pages.');
      // White behind the page: a transparent canvas encodes to black in JPEG.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({
        // JPEG, not PNG: a rasterised text page compresses far smaller, and the
        // report has to stay a sane size with several attachments.
        dataUrl: canvas.toDataURL('image/jpeg', 0.82),
        format: 'JPEG',
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
    }
    return { kind: 'pages', pages, totalPages };
  } finally {
    void document_.cleanup();
  }
}

/** Fetch one attachment and convert it to placeable pages.
 *
 * Never throws: a failure is returned as an `error` result so one unreadable
 * attachment cannot lose the whole report. */
export async function renderAttachment(
  learnerKind: LearnerKind,
  learnerId: string,
  attachment: MonthlyReportAttachment,
): Promise<AttachmentRender> {
  if (attachment.status && attachment.status !== 'approved') {
    return { kind: 'unsupported', reason: 'This file is still being scanned, so it cannot be shown yet.' };
  }

  const contentType = (attachment.contentType || '').toLowerCase();
  const isPdf = contentType === 'application/pdf'
    || (!contentType && /\.pdf$/i.test(attachment.filename));

  if (!isPdf && !isImage(contentType)) {
    return {
      kind: 'unsupported',
      reason: 'This file type cannot be shown inside a PDF. Open it from the monthly activity page.',
    };
  }

  try {
    const response = await fetch(
      monthlyReportAttachmentUrl(learnerKind, learnerId, attachment.id),
      { credentials: 'same-origin' },
    );
    if (!response.ok) {
      // The endpoint answers with a JSON error the learner can act on.
      let message = `The file could not be loaded (${response.status}).`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch {
        /* not JSON — keep the status message */
      }
      return { kind: 'error', reason: message };
    }

    if (isPdf) return await renderPdf(await response.arrayBuffer());

    const dataUrl = await blobToDataUrl(await response.blob());
    const { width, height } = await imageSize(dataUrl);
    return {
      kind: 'pages',
      pages: [{ dataUrl, format: imageFormatFor(contentType), width, height }],
      totalPages: 1,
    };
  } catch (error) {
    return {
      kind: 'error',
      reason: error instanceof Error ? error.message : 'The file could not be loaded.',
    };
  }
}

export { MAX_PDF_PAGES };
