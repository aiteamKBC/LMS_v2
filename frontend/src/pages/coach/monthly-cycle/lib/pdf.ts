// ============================================================================
// Monthly Cycle — learner PDF export.
//
// Laid out to match the printed "Learner Journal" report: a header info
// strip (Learner / Programme / Coach), monthly-hours summary cards, and an
// activity log table. Columns are limited to what the monthly activity feed
// actually carries (date, type, title, detail, source, status) — no Activity
// ID or Accepted columns, since those come from a different report.
// ============================================================================
import { jsPDF } from 'jspdf';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import type { MonthlyLearnerActivity } from '../types';
import { formatHoursLabel, formatSourceLabel } from './monthly';

const PDF_MARGIN = 14;
const PDF_PAGE_WIDTH = 210;
const PDF_PAGE_HEIGHT = 297;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - (PDF_MARGIN * 2);

function pdfFileNameSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'learner';
}

export function downloadLearnerMonthlyCyclePdf(
  learner: MonthlyLearnerActivity,
  monthLabel: string,
  monthKey: string,
  coachName: string,
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageBottom = PDF_PAGE_HEIGHT - 18;
  const variance = learner.otjh.monthlyHours - learner.otjh.monthlyTarget;
  const varianceLabel = `${variance >= 0 ? '+' : '-'}${formatHoursLabel(Math.abs(variance))}`;

  const colors = {
    navy: [15, 23, 60] as [number, number, number],
    text: [15, 23, 42] as [number, number, number],
    muted: [100, 116, 139] as [number, number, number],
    border: [226, 232, 240] as [number, number, number],
    panel: [241, 245, 249] as [number, number, number],
    panelAlt: [248, 250, 252] as [number, number, number],
    accent: [84, 32, 138] as [number, number, number],
    emerald: [16, 185, 129] as [number, number, number],
    amber: [245, 158, 11] as [number, number, number],
    red: [239, 68, 68] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
  };

  const infoFields = [
    { label: 'Learner', value: learner.name },
    { label: 'Programme', value: learner.programme || '--' },
    { label: 'Coach', value: coachName || '--' },
    { label: 'Cohort / Group', value: `${learner.cohortName || '--'} / ${learner.group || '--'}` },
    { label: 'Reporting month', value: monthLabel },
    { label: 'Last captured', value: learner.lastActivityDate ? formatDateLabel(learner.lastActivityDate) : 'No date captured' },
  ];

  const summaryCards = [
    { label: 'Monthly target', value: formatHoursLabel(learner.otjh.monthlyTarget), accent: colors.navy },
    { label: 'Actual hours', value: learner.otjh.monthlyHoursLabel, accent: colors.accent },
    { label: 'Variance', value: varianceLabel, accent: variance < 0 ? colors.red : colors.emerald },
    { label: 'KSBs evidenced', value: String(learner.ksb.touched), accent: colors.amber },
  ];

  const tableColumns = [
    { label: 'Date', width: 22 },
    { label: 'Type', width: 24 },
    { label: 'Activity details', width: PDF_CONTENT_WIDTH - 22 - 24 - 30 - 30 },
    { label: 'Source', width: 30 },
    { label: 'Status', width: 30 },
  ];

  const setFill = (color: [number, number, number]) => doc.setFillColor(color[0], color[1], color[2]);
  const setStroke = (color: [number, number, number]) => doc.setDrawColor(color[0], color[1], color[2]);
  const setText = (fontSize: number, fontStyle: 'normal' | 'bold' = 'normal', color: [number, number, number] = colors.text) => {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
  };

  let y = 0;
  let tableRowIndex = 0;

  function drawPageBand() {
    setFill(colors.navy);
    doc.rect(0, 0, PDF_PAGE_WIDTH, 4, 'F');
  }

  function drawTableHeader(startY: number) {
    setFill(colors.navy);
    doc.rect(PDF_MARGIN, startY, PDF_CONTENT_WIDTH, 8, 'F');
    let cursorX = PDF_MARGIN;
    tableColumns.forEach((column) => {
      setText(8, 'bold', colors.white);
      doc.text(column.label.toUpperCase(), cursorX + 2.5, startY + 5.2);
      cursorX += column.width;
    });
    return startY + 8;
  }

  const ensureSpace = (heightNeeded: number, redrawTableHeader = false) => {
    if (y + heightNeeded <= pageBottom) return;
    doc.addPage();
    drawPageBand();
    y = PDF_MARGIN;
    if (redrawTableHeader) {
      y = drawTableHeader(y);
    }
  };

  const addFooter = () => {
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      setStroke(colors.border);
      doc.line(PDF_MARGIN, PDF_PAGE_HEIGHT - 13, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_PAGE_HEIGHT - 13);
      setText(8, 'normal', colors.muted);
      doc.text('Kent Business College | Off-the-job learning record', PDF_MARGIN, PDF_PAGE_HEIGHT - 8);
      doc.text(`Page ${page} of ${pageCount}`, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_PAGE_HEIGHT - 8, { align: 'right' });
    }
  };

  drawPageBand();
  y = PDF_MARGIN;

  setText(18, 'bold', colors.navy);
  doc.text('Learner Journal', PDF_MARGIN, y + 5);
  setText(9, 'normal', colors.muted);
  doc.text('Monthly off-the-job learning record', PDF_MARGIN, y + 11);
  setText(8, 'bold', colors.muted);
  doc.text('REPORTING MONTH', PDF_PAGE_WIDTH - PDF_MARGIN, y + 2, { align: 'right' });
  setText(11, 'bold', colors.text);
  doc.text(monthLabel, PDF_PAGE_WIDTH - PDF_MARGIN, y + 8, { align: 'right' });
  y += 18;

  setStroke(colors.border);
  doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
  y += 6;

  const infoColumnWidth = PDF_CONTENT_WIDTH / 3;
  setFill(colors.panelAlt);
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 20, 'F');
  infoFields.forEach((field, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const cellX = PDF_MARGIN + (column * infoColumnWidth) + 4;
    const cellY = y + 6 + (row * 10);
    setText(7.5, 'bold', colors.muted);
    doc.text(field.label.toUpperCase(), cellX, cellY);
    setText(9.5, 'bold', colors.text);
    const valueLines = doc.splitTextToSize(field.value, infoColumnWidth - 8) as string[];
    doc.text(valueLines[0] || '--', cellX, cellY + 5);
  });
  y += 26;

  const cardGap = 4;
  const cardWidth = (PDF_CONTENT_WIDTH - (cardGap * 3)) / 4;
  summaryCards.forEach((card, index) => {
    const cardX = PDF_MARGIN + (index * (cardWidth + cardGap));
    setFill(colors.panel);
    doc.rect(cardX, y, cardWidth, 16, 'F');
    setFill(card.accent);
    doc.rect(cardX, y, 1.4, 16, 'F');
    setText(7.5, 'bold', colors.muted);
    doc.text(card.label.toUpperCase(), cardX + 4, y + 6);
    setText(12, 'bold', colors.text);
    doc.text(card.value, cardX + 4, y + 12.5);
  });
  y += 24;

  setText(12, 'bold', colors.text);
  doc.text('Activity log', PDF_MARGIN, y);
  setText(8.5, 'normal', colors.muted);
  doc.text('Recorded off-the-job learning activity for ' + monthLabel, PDF_MARGIN, y + 5);
  y += 10;

  if (!learner.activities.length) {
    setStroke(colors.border);
    doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 12);
    setText(9, 'normal', colors.muted);
    doc.text(`No activity captured for ${monthLabel}.`, PDF_MARGIN + 3, y + 7);
    y += 12;
  } else {
    y = drawTableHeader(y);
    learner.activities.forEach((activity) => {
      const dateLines = doc.splitTextToSize(formatDateLabel(activity.date), tableColumns[0].width - 5) as string[];
      const typeLines = doc.splitTextToSize(activity.type || '--', tableColumns[1].width - 5) as string[];
      const titleText = [activity.title, activity.detail].filter(Boolean).join(' - ') || 'Untitled activity';
      const titleLines = doc.splitTextToSize(titleText, tableColumns[2].width - 5) as string[];
      const sourceLines = doc.splitTextToSize(formatSourceLabel(activity.source) || '--', tableColumns[3].width - 5) as string[];
      const statusLines = doc.splitTextToSize(activity.status || '--', tableColumns[4].width - 5) as string[];
      const lineCount = Math.max(dateLines.length, typeLines.length, titleLines.length, sourceLines.length, statusLines.length);
      const rowHeight = Math.max(10, 4 + (lineCount * 4));

      ensureSpace(rowHeight, true);
      setFill(tableRowIndex % 2 === 0 ? colors.white : colors.panelAlt);
      setStroke(colors.border);
      doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, rowHeight, 'FD');

      let cursorX = PDF_MARGIN;
      tableColumns.forEach((column, index) => {
        if (index > 0) doc.line(cursorX, y, cursorX, y + rowHeight);
        cursorX += column.width;
      });

      const textY = y + 5;
      setText(8.5, 'normal', colors.text);
      doc.text(dateLines, PDF_MARGIN + 2.5, textY);
      doc.text(typeLines, PDF_MARGIN + tableColumns[0].width + 2.5, textY);
      doc.text(titleLines, PDF_MARGIN + tableColumns[0].width + tableColumns[1].width + 2.5, textY);
      setText(8.2, 'normal', colors.muted);
      doc.text(sourceLines, PDF_MARGIN + tableColumns[0].width + tableColumns[1].width + tableColumns[2].width + 2.5, textY);
      setText(8.2, 'bold', colors.emerald);
      doc.text(statusLines, PDF_MARGIN + tableColumns[0].width + tableColumns[1].width + tableColumns[2].width + tableColumns[3].width + 2.5, textY);

      y += rowHeight;
      tableRowIndex += 1;
    });
  }

  addFooter();
  doc.save(`learner-journal-${pdfFileNameSegment(learner.name)}-${monthKey}.pdf`);
}
