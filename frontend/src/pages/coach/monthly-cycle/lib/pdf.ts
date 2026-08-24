// ============================================================================
// Monthly Cycle — learner PDF export.
//
// Moved verbatim out of page.tsx. The PDF's own layout (jsPDF drawing calls,
// colours, column widths) is a document format, not UI chrome, so it is left
// untouched by this refactor — only the on-screen presentation was in scope.
// ============================================================================
import { jsPDF } from 'jspdf';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import type { MonthlyLearnerActivity } from '../types';
import { formatHoursLabel, formatNumber, inlineActivityCategory, formatSourceLabel, uniqueActivityDays } from './monthly';

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

function ensurePdfSpace(doc: jsPDF, y: number, heightNeeded: number) {
  if (y + heightNeeded <= PDF_PAGE_HEIGHT - PDF_MARGIN) return y;
  doc.addPage();
  return PDF_MARGIN;
}

function addPdfDivider(doc: jsPDF, y: number) {
  const lineY = ensurePdfSpace(doc, y, 2);
  doc.setDrawColor(226, 232, 240);
  doc.line(PDF_MARGIN, lineY, PDF_PAGE_WIDTH - PDF_MARGIN, lineY);
  return lineY + 4;
}

export function downloadLearnerMonthlyCyclePdf(learner: MonthlyLearnerActivity, monthLabel: string, monthKey: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const learningActivities = learner.activities.filter((activity) => ['learning', 'quiz', 'video'].includes(inlineActivityCategory(activity.type)));
  const counts = {
    quiz: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'quiz').length,
    video: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'video').length,
    learning: learningActivities.length,
    coaching: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'coaching').length,
    evidence: learner.activities.filter((activity) => inlineActivityCategory(activity.type) === 'evidence').length,
  };
  const generatedDate = formatDateLabel(new Date().toISOString());
  const pageBottom = PDF_PAGE_HEIGHT - 18;
  const colors = {
    text: [15, 23, 42] as [number, number, number],
    muted: [100, 116, 139] as [number, number, number],
    border: [226, 232, 240] as [number, number, number],
    panel: [248, 250, 252] as [number, number, number],
    accent: [84, 32, 138] as [number, number, number],
    emerald: [16, 185, 129] as [number, number, number],
    amber: [245, 158, 11] as [number, number, number],
    red: [239, 68, 68] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
  };
  const summaryMetrics = [
    { label: 'Total events', value: formatNumber(learner.activities.length) },
    { label: 'Active days', value: formatNumber(uniqueActivityDays(learner.activities)) },
    { label: 'Time logged', value: learner.otjh.monthlyHoursLabel },
    { label: 'OTJ completed', value: formatHoursLabel(learner.otjh.completed) },
    { label: 'OTJ target', value: formatHoursLabel(learner.otjh.target) },
    { label: 'KSBs evidenced', value: formatNumber(learner.ksb.touched) },
    { label: 'Learning', value: formatNumber(counts.learning) },
    { label: 'Videos', value: formatNumber(counts.video) },
    { label: 'Quizzes', value: formatNumber(counts.quiz) },
    { label: 'Coaching', value: formatNumber(counts.coaching) },
    { label: 'Evidence', value: formatNumber(counts.evidence) },
  ];
  const detailRows = [
    { label: 'Programme', value: learner.programme || '--' },
    { label: 'Cohort / Group', value: `${learner.cohortName || '--'} / ${learner.group || '--'}` },
    { label: 'OTJ completed', value: formatHoursLabel(learner.otjh.completed) },
    { label: 'OTJ target', value: formatHoursLabel(learner.otjh.target) },
    { label: 'OTJH status', value: learner.otjhStatus || '--' },
    { label: 'Last captured', value: learner.lastActivityLabel || 'No activity captured' },
  ];
  const tableColumns = [
    { label: 'Date', width: 24 },
    { label: 'Type', width: 22 },
    { label: 'Activity', width: 68 },
    { label: 'Details', width: PDF_CONTENT_WIDTH - 24 - 22 - 68 },
  ];
  const setFill = (color: [number, number, number]) => doc.setFillColor(color[0], color[1], color[2]);
  const setStroke = (color: [number, number, number]) => doc.setDrawColor(color[0], color[1], color[2]);
  const setText = (fontSize: number, fontStyle: 'normal' | 'bold' = 'normal', color: [number, number, number] = colors.text) => {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  let y = PDF_MARGIN;
  let tableRowIndex = 0;

  function drawTableHeader(startY: number) {
    setFill(colors.panel);
    setStroke(colors.border);
    doc.rect(PDF_MARGIN, startY, PDF_CONTENT_WIDTH, 8, 'FD');
    let cursorX = PDF_MARGIN;
    tableColumns.forEach((column, index) => {
      if (index > 0) doc.line(cursorX, startY, cursorX, startY + 8);
      setText(8, 'bold', colors.muted);
      doc.text(column.label.toUpperCase(), cursorX + 2.5, startY + 5.2);
      cursorX += column.width;
    });
    return startY + 8;
  }

  const ensureSpace = (heightNeeded: number, redrawTableHeader = false) => {
    if (y + heightNeeded <= pageBottom) return;
    doc.addPage();
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
      doc.text(`Generated ${generatedDate}`, PDF_MARGIN, PDF_PAGE_HEIGHT - 8);
      doc.text(`Page ${page} of ${pageCount}`, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_PAGE_HEIGHT - 8, { align: 'right' });
    }
  };
  const drawSectionTitle = (title: string) => {
    y = addPdfDivider(doc, y);
    y = addPdfText(doc, { text: title, y, fontSize: 11.5, fontStyle: 'bold', lineHeight: 6 });
  };
  const drawDetailRow = (label: string, value: string) => {
    const safeValue = value || '--';
    const labelWidth = 34;
    const valueLines = doc.splitTextToSize(safeValue, PDF_CONTENT_WIDTH - labelWidth - 8) as string[];
    const rowHeight = Math.max(9, (valueLines.length * 4) + 4);
    ensureSpace(rowHeight);
    setStroke(colors.border);
    doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, rowHeight);
    doc.line(PDF_MARGIN + labelWidth, y, PDF_MARGIN + labelWidth, y + rowHeight);
    setText(8, 'bold', colors.muted);
    doc.text(label.toUpperCase(), PDF_MARGIN + 3, y + 5.2);
    setText(9, 'normal', colors.text);
    doc.text(valueLines, PDF_MARGIN + labelWidth + 3, y + 5.2);
    y += rowHeight;
  };
  const drawMetricCell = (x: number, cellY: number, width: number, label: string, value: string) => {
    setText(8, 'bold', colors.muted);
    doc.text(label.toUpperCase(), x + 3, cellY + 4.6);
    setText(11, 'bold', colors.text);
    doc.text(value, x + width - 3, cellY + 6.2, { align: 'right' });
  };

  setText(16, 'bold', colors.text);
  doc.text('Monthly Activity Summary', PDF_MARGIN, y + 4);
  setText(9, 'normal', colors.muted);
  doc.text(monthLabel, PDF_MARGIN, y + 10);

  y += 16;
  setStroke(colors.border);
  doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
  y += 8;

  setText(18, 'bold', colors.text);
  doc.text(learner.name, PDF_MARGIN, y);
  setText(9, 'normal', colors.muted);
  doc.text(`${learner.programme || '--'} - ${monthLabel}`, PDF_MARGIN, y + 6);
  y += 12;

  drawSectionTitle('Learner details');
  detailRows.forEach((row) => drawDetailRow(row.label, row.value));

  drawSectionTitle('Monthly summary');
  const metricGap = 4;
  const metricWidth = (PDF_CONTENT_WIDTH - metricGap) / 2;
  for (let index = 0; index < summaryMetrics.length; index += 2) {
    ensureSpace(10);
    setStroke(colors.border);
    doc.rect(PDF_MARGIN, y, metricWidth, 10);
    drawMetricCell(PDF_MARGIN, y, metricWidth, summaryMetrics[index].label, summaryMetrics[index].value);

    const secondMetric = summaryMetrics[index + 1];
    if (secondMetric) {
      const secondX = PDF_MARGIN + metricWidth + metricGap;
      doc.rect(secondX, y, metricWidth, 10);
      drawMetricCell(secondX, y, metricWidth, secondMetric.label, secondMetric.value);
    }
    y += 10;
  }

  if (learner.needsAction.length > 0) {
    drawSectionTitle('Attention needed');
    learner.needsAction.forEach((item) => {
      const bulletLines = doc.splitTextToSize(item, PDF_CONTENT_WIDTH - 9) as string[];
      const rowHeight = Math.max(8, (bulletLines.length * 4) + 3);
      ensureSpace(rowHeight);
      setText(9, 'bold', colors.text);
      doc.text('-', PDF_MARGIN + 2, y + 5);
      setText(8.8, 'normal', colors.text);
      doc.text(bulletLines, PDF_MARGIN + 6, y + 5);
      y += rowHeight;
    });
  }

  drawSectionTitle('Activity log');

  if (!learner.activities.length) {
    ensureSpace(14);
    setStroke(colors.border);
    doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 12);
    setText(9, 'normal', colors.muted);
    doc.text(`No activity captured for ${monthLabel}.`, PDF_MARGIN + 3, y + 7);
    y += 12;
  } else {
    y = drawTableHeader(y);
    learner.activities.forEach((activity) => {
      const detailText = [formatSourceLabel(activity.source), activity.detail].filter(Boolean).join(' - ') || '--';
      const dateLines = doc.splitTextToSize(formatDateLabel(activity.date), tableColumns[0].width - 5) as string[];
      const typeLines = doc.splitTextToSize(activity.type || '--', tableColumns[1].width - 5) as string[];
      const titleLines = doc.splitTextToSize(activity.title || 'Untitled activity', tableColumns[2].width - 5) as string[];
      const detailLines = doc.splitTextToSize(detailText, tableColumns[3].width - 5) as string[];
      const lineCount = Math.max(dateLines.length, typeLines.length, titleLines.length, detailLines.length);
      const rowHeight = Math.max(10, 4 + (lineCount * 4));

      ensureSpace(rowHeight, true);
      setFill(tableRowIndex % 2 === 0 ? colors.white : colors.panel);
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
      doc.text(detailLines, PDF_MARGIN + tableColumns[0].width + tableColumns[1].width + tableColumns[2].width + 2.5, textY);

      y += rowHeight;
      tableRowIndex += 1;
    });
  }

  addFooter();
  doc.save(`monthly-cycle-${pdfFileNameSegment(learner.name)}-${monthKey}.pdf`);
}

function addPdfText(
  doc: jsPDF,
  {
    text,
    y,
    x = PDF_MARGIN,
    maxWidth = PDF_CONTENT_WIDTH,
    fontSize = 10,
    fontStyle = 'normal',
    textColor = [17, 24, 39],
    lineHeight = 5,
  }: {
    text: string;
    y: number;
    x?: number;
    maxWidth?: number;
    fontSize?: number;
    fontStyle?: 'normal' | 'bold';
    textColor?: [number, number, number];
    lineHeight?: number;
  },
) {
  doc.setFont('helvetica', fontStyle);
  doc.setFontSize(fontSize);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  const neededHeight = Math.max(lineHeight, lines.length * lineHeight);
  const nextY = ensurePdfSpace(doc, y, neededHeight);

  doc.text(lines, x, nextY);
  return nextY + neededHeight;
}
