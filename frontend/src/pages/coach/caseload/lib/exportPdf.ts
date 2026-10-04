// ============================================================================
// Coach caseload - PDF export.
//
// The export follows the Learner Journal document language: KBC branding,
// navy table headers, soft alternating rows, compact continued-page headers,
// and the same 12 mm page margins used by the journal.
// ============================================================================
import { jsPDF } from 'jspdf';
import {
  EMPTY_VALUE,
  displayValue,
  formatHours,
  formatPercent,
  getOtjhStatusOverride,
  isVisibleCaseloadLearner,
  learnerProgramme,
  otjhProgressAsOfToday,
} from './format';
import type { Learner } from '../types';

type Color = [number, number, number];
type PdfImage = { data: Uint8Array; format: 'PNG' | 'JPEG' };

const colors = {
  navy: [24, 45, 72] as Color,
  muted: [99, 115, 136] as Color,
  border: [222, 226, 232] as Color,
  soft: [246, 248, 251] as Color,
  white: [255, 255, 255] as Color,
};

const margin = 12;
const contentWidth = 273;
const rowHeight = 6.2;

function formatExportDate() {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
}

function pdfText(value: string | null | undefined) {
  return value?.trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"') || EMPTY_VALUE;
}

function font(doc: jsPDF, size: number, bold = false, color = colors.navy) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function image(doc: jsPDF, asset: PdfImage, x: number, y: number, width: number, height: number) {
  const dimensions = doc.getImageProperties(asset.data);
  const ratio = Math.min(width / dimensions.width, height / dimensions.height);
  const drawnWidth = dimensions.width * ratio;
  const drawnHeight = dimensions.height * ratio;
  doc.addImage(asset.data, asset.format, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function fitPdfCellText(doc: jsPDF, value: string, maxWidth: number) {
  const safeValue = pdfText(value);
  if (doc.getTextWidth(safeValue) <= maxWidth) return safeValue;

  let text = safeValue;
  while (text.length > 0 && doc.getTextWidth(`${text}...`) > maxWidth) {
    text = text.slice(0, -1);
  }

  return text ? `${text}...` : safeValue;
}

interface PdfColumn {
  label: string;
  width: number;
}

// These widths total 273 mm, exactly matching the Learners included panel.
const COLUMNS: PdfColumn[] = [
  { label: 'Name', width: 43 },
  { label: 'Status', width: 27 },
  { label: 'OTJH', width: 46 },
  { label: 'OTJH Progress', width: 24 },
  { label: 'Attend.', width: 24 },
  { label: 'Start date', width: 30 },
  { label: 'Planned end date', width: 33 },
  { label: 'Programme', width: 46 },
];

function formatOtjhRatio(actualHours: number | null, targetHours: number | null) {
  if (actualHours === null) return EMPTY_VALUE;
  return `${formatHours(actualHours)} / ${targetHours === null ? EMPTY_VALUE : formatHours(targetHours)}`;
}

function formatOtjhPercent(percent: number | null) {
  return percent === null ? EMPTY_VALUE : `${Math.round(percent)}%`;
}

function drawDocumentHeader(doc: jsPDF, ownerName: string, logo: PdfImage | null, generated: string, learnerCount: number) {
  if (logo) image(doc, logo, margin, 8, 38, 18);
  else {
    font(doc, 12, true);
    doc.text('Kent Business College', margin, 18);
  }

  doc.setDrawColor(...colors.border);
  doc.setLineWidth(.3);
  doc.line(56, 8, 56, 26);
  font(doc, 16, true);
  doc.text('Coach Learners', 63, 13.5);
  font(doc, 8.5, false, colors.muted);
  doc.text('Learner caseload export', 63, 20);

  doc.setFillColor(...colors.soft);
  doc.roundedRect(242, 9, 43, 15, 3, 3, 'F');
  font(doc, 6.5, true, colors.muted);
  doc.text('GENERATED', 263.5, 14, { align: 'center' });
  font(doc, 9.5, true);
  doc.text(generated, 263.5, 20.5, { align: 'center' });
  doc.line(margin, 31, 285, 31);

  doc.setFillColor(...colors.soft);
  doc.roundedRect(margin, 35, contentWidth, 11, 2.5, 2.5, 'F');
  font(doc, 7, true, colors.muted);
  doc.text('LEARNERS INCLUDED', margin + 5, 39.5);
  doc.text('PREPARED BY', 163, 39.5);
  font(doc, 8.5, true);
  doc.text(String(learnerCount), margin + 5, 44);
  doc.text(pdfText(ownerName), 163, 44, { maxWidth: 115 });
}

function drawContinuedHeader(doc: jsPDF, ownerName: string, logo: PdfImage | null, generated: string) {
  if (logo) image(doc, logo, margin, 7, 25, 11.5);
  else {
    font(doc, 8.5, true);
    doc.text('Kent Business College', margin, 13);
  }
  font(doc, 8.5, true);
  doc.text(pdfText(ownerName), 44, 12, { maxWidth: 150 });
  font(doc, 7, false, colors.muted);
  doc.text(`Coach learners continued - ${generated}`, 44, 18);
  doc.setDrawColor(...colors.border);
  doc.line(margin, 23, 285, 23);
}

function drawLearnerPdfHeader(doc: jsPDF, y: number) {
  let x = margin;
  doc.setFillColor(...colors.navy);
  doc.rect(margin, y, contentWidth, 8, 'F');
  font(doc, 7, true, colors.white);
  COLUMNS.forEach((column) => {
    doc.text(column.label, x + 1.8, y + 5.1);
    x += column.width;
  });
}

function drawFooter(doc: jsPDF, page: number, pageCount: number) {
  doc.setDrawColor(...colors.border);
  doc.line(margin, 198, 285, 198);
  font(doc, 6.8, false, colors.muted);
  doc.text('Kent Business College  |  Coach learner caseload', margin, 203);
  doc.text(`Page ${page} of ${pageCount}`, 285, 203, { align: 'right' });
}

export function buildLearnersPdf(learners: Learner[], ownerName: string, logo: PdfImage | null = null) {
  const includedLearners = learners.filter(isVisibleCaseloadLearner);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const generated = formatExportDate();
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomLimit = Math.min(195, pageHeight - 15);
  let y = 51;

  doc.setProperties({
    title: 'Coach Learners',
    author: 'Kent Business College',
    subject: 'Coach learner caseload export',
  });
  drawDocumentHeader(doc, ownerName, logo, generated, includedLearners.length);
  drawLearnerPdfHeader(doc, y);
  y += 8;
  font(doc, 7.2);

  includedLearners.forEach((learner, index) => {
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      drawContinuedHeader(doc, ownerName, logo, generated);
      y = 27;
      drawLearnerPdfHeader(doc, y);
      y += 8;
      font(doc, 7.2);
    }

    if (index % 2 === 0) {
      doc.setFillColor(...colors.soft);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }

    const otjh = otjhProgressAsOfToday(learner);
    const otjhStatusOverride = getOtjhStatusOverride(learner.rawProgramStatus)
      ?? getOtjhStatusOverride(learner.enrollmentStatus);
    const row = [
      learner.name,
      displayValue(learner.rawProgramStatus),
      otjhStatusOverride || formatOtjhRatio(otjh.actualHours, otjh.targetHours),
      otjhStatusOverride ? EMPTY_VALUE : formatOtjhPercent(otjh.percent),
      formatPercent(learner.liveAttendanceRate),
      displayValue(learner.startDate),
      displayValue(learner.plannedEndDate),
      learnerProgramme(learner),
    ];

    let x = margin;
    row.forEach((value, columnIndex) => {
      const column = COLUMNS[columnIndex];
      doc.text(fitPdfCellText(doc, value, column.width - 3.6), x + 1.8, y + 4.2);
      x += column.width;
    });

    doc.setDrawColor(...colors.border);
    doc.setLineWidth(.15);
    doc.line(margin, y + rowHeight, margin + contentWidth, y + rowHeight);
    y += rowHeight;
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawFooter(doc, page, pageCount);
  }
  return doc;
}

async function loadLogo(): Promise<PdfImage> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/kbc-logo.png`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('The KBC report logo could not be loaded. Please try again.');
  const data = new Uint8Array(await response.arrayBuffer());
  const png = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  const jpeg = data[0] === 0xff && data[1] === 0xd8;
  if (!png && !jpeg) throw new Error('The KBC report logo is invalid. Please try again.');
  return { data, format: png ? 'PNG' : 'JPEG' };
}

export async function downloadLearnersPdf(learners: Learner[], ownerName: string) {
  const logo = await loadLogo();
  const doc = buildLearnersPdf(learners, ownerName, logo);
  await doc.save('coach-learners.pdf', { returnPromise: true });
}
