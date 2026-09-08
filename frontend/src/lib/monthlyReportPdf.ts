// ============================================================================
// Learner monthly report — PDF download.
//
// Renders a submitted monthly report: the learner/month header strip, the
// headline figures, what the learner wrote, the KSBs claimed, the documents
// attached, the activity log as it stood at submission, and the learner's
// signature.
//
// Attached documents are then appended in full, one section per file: images
// are drawn directly and PDFs are rasterised page by page with pdf.js. Formats
// a browser cannot convert -- Word, PowerPoint, video -- stay listed by name
// with a note saying where to open them, because rendering those would need a
// server-side converter.
//
// Because the attachment bytes have to be fetched, this is async.
// ============================================================================
import { jsPDF } from 'jspdf';
import type { LearnerKind } from '@/api/learnerDetail';
import type { MonthlyReport, MonthlyReportActivity } from '@/api/monthlyReports';
import {
  MAX_PDF_PAGES,
  renderAttachment,
  type RenderedPage,
} from '@/lib/monthlyReportAttachmentPages';

const MARGIN = 14;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
const PAGE_BOTTOM = PAGE_HEIGHT - 18;

const COLORS = {
  navy: [15, 23, 60] as [number, number, number],
  text: [15, 23, 42] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  panel: [241, 245, 249] as [number, number, number],
  accent: [84, 32, 138] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const TYPE_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  video: 'Video',
  learning: 'Learning',
  coaching: 'Coaching',
  review: 'Review',
};

function fileNameSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'learner';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The jsPDF image format for a data URL.
 *
 * A signature can be uploaded as a JPEG or WebP, not only produced as a PNG by
 * the signature pad. Passing 'PNG' for a JPEG throws, so the format is read
 * from the URL's own MIME type. WebP is not a jsPDF format, so it is reported
 * as unsupported and the caller falls back to the typed name. */
function imageFormat(dataUrl: string): 'PNG' | 'JPEG' | null {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
  if (mime === 'image/png') return 'PNG';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'JPEG';
  return null;
}

/** Activity detail line, trimmed to what fits one table row. */
function activityDetail(activity: MonthlyReportActivity) {
  const parts = [activity.module, activity.week, activity.detail].filter(Boolean);
  if (activity.reportedTime) parts.push(`Logged ${activity.reportedTime}`);
  if (activity.ksbs?.length) parts.push(activity.ksbs.join(', '));
  return parts.join(' · ');
}

export async function downloadMonthlyReportPdf(
  report: MonthlyReport,
  learner: { learnerKind: LearnerKind; learnerId: string },
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const monthLabel = report.monthLabel || report.monthKey;
  let y = MARGIN;

  /** Start a new page when the next block would cross the bottom margin. */
  const ensureSpace = (needed: number) => {
    if (y + needed <= PAGE_BOTTOM) return;
    doc.addPage();
    y = MARGIN;
  };

  const sectionHeading = (title: string) => {
    ensureSpace(14);
    doc.setFillColor(...COLORS.accent);
    doc.rect(MARGIN, y, 2.5, 5.5, 'F');
    doc.setTextColor(...COLORS.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(title.toUpperCase(), MARGIN + 5, y + 4.2);
    y += 9;
  };

  // ── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, PAGE_WIDTH, 30, 'F');
  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Monthly learning report', MARGIN, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(monthLabel, MARGIN, 21);
  const submitted = report.submittedAt ? `Submitted ${formatDate(report.submittedAt)}` : 'Not yet submitted';
  doc.text(submitted, PAGE_WIDTH - MARGIN, 21, { align: 'right' });
  y = 38;

  // ── Learner strip ────────────────────────────────────────────────────────
  const infoRows: [string, string][] = [
    ['Learner', report.learnerName || '—'],
    ['Programme', report.programmeName || '—'],
  ];
  doc.setDrawColor(...COLORS.border);
  doc.setFillColor(...COLORS.panel);
  doc.rect(MARGIN, y, CONTENT_WIDTH, 8 * infoRows.length, 'FD');
  infoRows.forEach(([label, value], index) => {
    const rowY = y + (index * 8) + 5.4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(label, MARGIN + 3, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.text);
    doc.text(String(value), MARGIN + 34, rowY);
  });
  y += (8 * infoRows.length) + 8;

  // ── Headline figures ─────────────────────────────────────────────────────
  const metrics = report.summaryMetrics || {};
  const cards: [string, string][] = [
    ['Total events', String(metrics.totalEvents ?? report.activitySnapshot.length)],
    ['Active days', String(metrics.activeDays ?? 0)],
    ['Time logged', metrics.loggedLabel || '0m'],
    ['KSBs evidenced', String(metrics.ksbCount ?? 0)],
  ];
  sectionHeading('This month at a glance');
  const cardWidth = (CONTENT_WIDTH - 9) / 4;
  cards.forEach(([label, value], index) => {
    const x = MARGIN + (index * (cardWidth + 3));
    doc.setDrawColor(...COLORS.border);
    doc.setFillColor(...COLORS.white);
    doc.rect(x, y, cardWidth, 16, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(label.toUpperCase(), x + 2.5, y + 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...COLORS.navy);
    doc.text(value, x + 2.5, y + 12.5);
  });
  y += 22;

  // ── What the learner wrote ───────────────────────────────────────────────
  sectionHeading('What I learned this month');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.text);
  const summaryLines = doc.splitTextToSize(report.learnedSummary || '—', CONTENT_WIDTH - 4);
  summaryLines.forEach((line: string) => {
    ensureSpace(6);
    doc.text(line, MARGIN + 2, y);
    y += 5;
  });
  y += 5;

  // ── KSBs claimed for the month ───────────────────────────────────────────
  sectionHeading('KSBs worked on this month');
  if (!report.selectedKsbs?.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    ensureSpace(6);
    doc.text('No KSBs were selected for this month.', MARGIN + 2, y);
    y += 9;
  } else {
    report.selectedKsbs.forEach((ksb) => {
      const label = ksb.description ? `${ksb.code} — ${ksb.description}` : ksb.code;
      const lines = doc.splitTextToSize(label, CONTENT_WIDTH - 6) as string[];
      ensureSpace(lines.length * 4.6 + 2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      lines.forEach((line, index) => {
        doc.text(index === 0 ? `• ${line}` : `  ${line}`, MARGIN + 2, y);
        y += 4.6;
      });
      y += 1;
    });
    y += 4;
  }

  // ── Attachments (listed, not embedded — see file header) ─────────────────
  sectionHeading('Documents attached');
  if (!report.attachments.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    ensureSpace(6);
    doc.text('No documents were attached to this report.', MARGIN + 2, y);
    y += 9;
  } else {
    report.attachments.forEach((attachment) => {
      ensureSpace(6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...COLORS.text);
      const size = formatBytes(attachment.sizeBytes);
      doc.text(`• ${attachment.filename}${size ? ` (${size})` : ''}`, MARGIN + 2, y);
      y += 5.5;
    });
    // Points at the appended sections, so a reader knows to keep going rather
    // than assuming the files were left out.
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      'Each document is reproduced after the signature, where its format allows.',
      MARGIN + 2,
      y,
    );
    y += 8;
  }

  // ── Activity log ─────────────────────────────────────────────────────────
  sectionHeading('Activity record');
  const columns: [string, number][] = [['Date', 24], ['Type', 22], ['Activity', 58], ['Detail', 78]];

  const drawTableHead = () => {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN, y, CONTENT_WIDTH, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.white);
    let x = MARGIN + 2;
    columns.forEach(([label, width]) => {
      doc.text(label, x, y + 4.8);
      x += width;
    });
    y += 7;
  };

  if (!report.activitySnapshot.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    doc.text('No activity was recorded for this month.', MARGIN + 2, y);
    y += 6;
  } else {
    drawTableHead();
    // Oldest first: the log reads as the month unfolded, unlike the on-screen
    // timeline which leads with the most recent event.
    const ordered = [...report.activitySnapshot].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    ordered.forEach((activity, index) => {
      const cells = [
        formatDate(activity.at),
        TYPE_LABELS[activity.type] || activity.type,
        activity.title || '—',
        activityDetail(activity) || '—',
      ];
      const wrapped = cells.map((cell, cellIndex) =>
        doc.splitTextToSize(String(cell), columns[cellIndex][1] - 3) as string[]);
      const rowHeight = Math.max(...wrapped.map((lines) => lines.length)) * 4 + 3;

      if (y + rowHeight > PAGE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
        drawTableHead();
      }

      if (index % 2 === 1) {
        doc.setFillColor(...COLORS.panel);
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.text);
      let x = MARGIN + 2;
      wrapped.forEach((lines, cellIndex) => {
        lines.forEach((line, lineIndex) => {
          doc.text(line, x, y + 4.4 + (lineIndex * 4));
        });
        x += columns[cellIndex][1];
      });
      doc.setDrawColor(...COLORS.border);
      doc.line(MARGIN, y + rowHeight, MARGIN + CONTENT_WIDTH, y + rowHeight);
      y += rowHeight;
    });
  }

  // ── The learner's sign-off ───────────────────────────────────────────────
  y += 6;
  ensureSpace(40);
  sectionHeading('Signed by the learner');
  doc.setDrawColor(...COLORS.border);
  doc.setFillColor(...COLORS.white);
  const signBoxHeight = 30;
  doc.rect(MARGIN, y, CONTENT_WIDTH, signBoxHeight, 'FD');

  const signatureFormat = report.signature ? imageFormat(report.signature) : null;
  if (report.signature && signatureFormat) {
    try {
      // Fitted inside the box rather than stretched: a signature distorted to
      // fill a fixed rectangle no longer looks like the mark that was made.
      doc.addImage(report.signature, signatureFormat, MARGIN + 4, y + 4, 56, 16);
    } catch {
      // An unreadable or corrupt data URL must not lose the whole report; the
      // typed name below still records who signed.
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text('Signature', MARGIN + 4, y + signBoxHeight - 4);

  const signedName = report.signedName || report.learnerName || '';
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.text);
  doc.setFont('helvetica', 'bold');
  doc.text(signedName || '—', MARGIN + 72, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(
    report.signedAt ? `Signed ${formatDate(report.signedAt)}` : 'Not signed',
    MARGIN + 72,
    y + 16,
  );
  doc.text(
    'Confirmed by the learner as a true record of the month.',
    MARGIN + 72,
    y + 22,
  );
  y += signBoxHeight + 6;

  // ── The attached documents themselves ────────────────────────────────────
  // Fetched and converted here rather than earlier, so the report's own pages
  // are complete before anything that depends on the network. Each attachment
  // starts a fresh page: a document reproduced mid-page reads as part of the
  // report rather than as an exhibit.
  for (const attachment of report.attachments) {
    doc.addPage();
    y = MARGIN;

    sectionHeading('Attached document');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.navy);
    const nameLines = doc.splitTextToSize(attachment.filename, CONTENT_WIDTH - 4) as string[];
    nameLines.forEach((line) => {
      doc.text(line, MARGIN + 2, y);
      y += 5;
    });

    const rendered = await renderAttachment(learner.learnerKind, learner.learnerId, attachment);
    const sizeLabel = formatBytes(attachment.sizeBytes);
    const pageLabel = rendered.kind === 'pages'
      ? rendered.totalPages > rendered.pages.length
        ? `first ${rendered.pages.length} of ${rendered.totalPages} pages shown (limit ${MAX_PDF_PAGES})`
        : `${rendered.totalPages} ${rendered.totalPages === 1 ? 'page' : 'pages'}`
      : '';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text([sizeLabel, pageLabel].filter(Boolean).join(' · ') || '—', MARGIN + 2, y);
    y += 6;

    if (rendered.kind !== 'pages') {
      // Not reproducible, or unreadable: say which, so the omission is explicit
      // rather than looking like the file was lost.
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...(rendered.kind === 'error' ? COLORS.accent : COLORS.muted));
      const reasonLines = doc.splitTextToSize(rendered.reason, CONTENT_WIDTH - 4) as string[];
      reasonLines.forEach((line) => {
        ensureSpace(6);
        doc.text(line, MARGIN + 2, y);
        y += 5;
      });
      continue;
    }

    rendered.pages.forEach((page: RenderedPage, index) => {
      // Every page after the first gets its own sheet. Packing two document
      // pages onto one sheet shrinks both below readable size, which defeats
      // the point of reproducing them.
      if (index > 0) {
        doc.addPage();
        y = MARGIN;
      }
      // Fitted to the space left, aspect ratio preserved: a page stretched to
      // fill the frame is unreadable.
      const scale = Math.min(CONTENT_WIDTH / page.width, (PAGE_BOTTOM - y) / page.height);
      const width = page.width * scale;
      const height = page.height * scale;

      try {
        doc.addImage(page.dataUrl, page.format, MARGIN, y, width, height);
        doc.setDrawColor(...COLORS.border);
        doc.rect(MARGIN, y, width, height);
      } catch {
        // A page that will not encode must not lose the rest of the report.
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(...COLORS.muted);
        doc.text('This page could not be reproduced.', MARGIN + 2, y + 5);
      }
      y += height + 4;
    });
  }

  // ── Page footers ─────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `${report.learnerName || 'Learner'} · Monthly report · ${monthLabel}`,
      MARGIN,
      PAGE_HEIGHT - 10,
    );
    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 10, { align: 'right' });
  }

  doc.save(`monthly-report-${fileNameSegment(report.learnerName || 'learner')}-${report.monthKey}.pdf`);
}
