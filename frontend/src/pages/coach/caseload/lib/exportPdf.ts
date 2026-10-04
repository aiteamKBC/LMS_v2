// ============================================================================
// Coach caseload — PDF export.
//
// Lifted out of the page component unchanged in behaviour: same landscape A4
// layout, same file name, same "selected learners or current view" contract.
// The only additions are the Risk verdict and Gateway columns, because an export
// that omits why a learner is flagged loses the point of the page it came from.
// ============================================================================
import { jsPDF } from 'jspdf';
import {
  EMPTY_VALUE,
  displayValue,
  formatHours,
  formatPercent,
  formatRatio,
  learnerProgramme,
} from './format';
import type { InsightMap } from './attention';
import type { Learner } from '../types';

// Keep the caseload export visually aligned with the Monthly Logs PDF.
const MONTHLY_LOGS_COLORS = {
  navy: [24, 45, 72] as [number, number, number],
  muted: [99, 115, 136] as [number, number, number],
  border: [222, 226, 232] as [number, number, number],
  soft: [246, 248, 251] as [number, number, number],
  alternate: [247, 249, 252] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

function formatExportDate() {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
}

function fitPdfCellText(doc: jsPDF, value: string, maxWidth: number) {
  const safeValue = value || EMPTY_VALUE;
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

function drawLearnerPdfHeader(doc: jsPDF, columns: PdfColumn[], startX: number, y: number, rowHeight: number) {
  let x = startX;
  const totalWidth = columns.reduce((total, column) => total + column.width, 0);

  doc.setFillColor(...MONTHLY_LOGS_COLORS.navy);
  doc.rect(startX, y, totalWidth, rowHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...MONTHLY_LOGS_COLORS.white);

  columns.forEach((column) => {
    doc.text(column.label, x + 1.5, y + 4.7);
    x += column.width;
  });

  doc.setDrawColor(...MONTHLY_LOGS_COLORS.border);
  doc.line(startX, y + rowHeight, startX + totalWidth, y + rowHeight);
}

const COLUMNS: PdfColumn[] = [
  { label: 'Name', width: 30 },
  { label: 'Risk', width: 20 },
  { label: 'Status', width: 18 },
  { label: 'Progress', width: 15 },
  { label: 'OTJH', width: 20 },
  { label: 'Attend.', width: 14 },
  { label: 'Components', width: 19 },
  { label: 'KSB', width: 15 },
  { label: 'Gateway', width: 21 },
  { label: 'Programme', width: 42 },
  { label: 'Group', width: 22 },
];

function fitColumnsToWidth(columns: PdfColumn[], targetWidth: number) {
  const sourceWidth = columns.reduce((total, column) => total + column.width, 0);

  return columns.map((column) => ({
    ...column,
    width: (column.width / sourceWidth) * targetWidth,
  }));
}

export function downloadLearnersPdf(learners: Learner[], ownerName: string, insights: InsightMap) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginY = 12;
  const rowHeight = 7;
  const contentWidth = pageWidth - (marginX * 2);
  const columns = fitColumnsToWidth(COLUMNS, contentWidth);
  const totalWidth = columns.reduce((total, column) => total + column.width, 0);

  let y = marginY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...MONTHLY_LOGS_COLORS.navy);
  doc.text('Coach Learners Export', marginX, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MONTHLY_LOGS_COLORS.muted);
  doc.text(`Generated ${formatExportDate()} by ${ownerName}`, marginX, y);

  y += 6;
  doc.setFillColor(...MONTHLY_LOGS_COLORS.soft);
  doc.roundedRect(marginX, y - 4.5, contentWidth, 8, 2, 2, 'F');
  doc.setFontSize(9);
  doc.setTextColor(...MONTHLY_LOGS_COLORS.navy);
  doc.text(`Learners included: ${learners.length}`, marginX + 2.5, y + 0.5);

  y += 7.5;
  drawLearnerPdfHeader(doc, columns, marginX, y, rowHeight);
  y += rowHeight;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MONTHLY_LOGS_COLORS.navy);

  learners.forEach((learner, index) => {
    if (y + rowHeight > pageHeight - marginY) {
      doc.addPage();
      y = marginY;
      drawLearnerPdfHeader(doc, columns, marginX, y, rowHeight);
      y += rowHeight;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...MONTHLY_LOGS_COLORS.navy);
    }

    if (index % 2 === 0) {
      doc.setFillColor(...MONTHLY_LOGS_COLORS.alternate);
      doc.rect(marginX, y, totalWidth, rowHeight, 'F');
    }

    const insight = insights.get(learner.id);
    const row = [
      learner.name,
      insight?.riskLabel || EMPTY_VALUE,
      displayValue(learner.rawProgramStatus),
      learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE,
      learner.overallProgressAvailable
        ? `${formatHours(learner.otjhCompleted)} / ${formatHours(learner.otjhTarget)}`
        : EMPTY_VALUE,
      formatPercent(learner.liveAttendanceRate),
      formatRatio(learner.componentsCompleted, learner.componentsPlanned),
      formatRatio(learner.ksbCompleted, learner.ksbTarget),
      displayValue(learner.gatewayReviewDate),
      learnerProgramme(learner),
      displayValue(learner.group),
    ];

    let x = marginX;
    row.forEach((value, columnIndex) => {
      const column = columns[columnIndex];
      doc.text(fitPdfCellText(doc, value, column.width - 3), x + 1.5, y + 4.5);
      x += column.width;
    });

    doc.setDrawColor(...MONTHLY_LOGS_COLORS.border);
    doc.line(marginX, y + rowHeight, marginX + totalWidth, y + rowHeight);
    y += rowHeight;
  });

  doc.save('coach-learners.pdf');
}
