import { jsPDF } from 'jspdf';

import type { FeedbackAnswerValue, FeedbackQuestion, FeedbackResponse } from '@/api/feedback';

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
const PAGE_BOTTOM = PAGE_HEIGHT - 16;
const PURPLE = [113, 55, 232] as const;
const NAVY = [32, 38, 55] as const;
const MUTED = [124, 129, 147] as const;
const BORDER = [225, 228, 236] as const;
const PANEL = [251, 251, 253] as const;
const STAR = [250, 196, 72] as const;

function formatDate(value: string | null) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'response';
}

async function loadLogo() {
  try {
    const response = await fetch('/assets/kbc-logo.png', { credentials: 'same-origin' });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export function feedbackAnswerText(question: FeedbackQuestion, answer: FeedbackAnswerValue = question.answer ?? null) {
  if (answer == null || answer === '' || (Array.isArray(answer) && !answer.length)) return 'No answer';
  if (question.type === 'rating' && typeof answer === 'number') {
    const maximum = question.config.max ?? 5;
    const suffix = question.config.display === 'stars' ? ` star${answer === 1 ? '' : 's'}` : '';
    return `${answer} / ${maximum}${suffix}`;
  }
  if (question.type === 'date' && typeof answer === 'string') return formatDate(answer);
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (Array.isArray(answer)) return answer.join(', ');
  if (typeof answer === 'object') {
    if ('filename' in answer) return answer.filename || 'Uploaded photo';
    if ('firstName' in answer || 'lastName' in answer) return [answer.firstName, answer.lastName].filter(Boolean).join(' ') || 'No answer';
  }
  return String(answer);
}

export async function buildFeedbackResponsePdf(response: FeedbackResponse) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  const pageBand = () => { doc.setFillColor(...PURPLE); doc.rect(0, 0, PAGE_WIDTH, 7, 'F'); };
  const newPage = () => { doc.addPage(); pageBand(); y = 16; };
  const ensureSpace = (height: number) => { if (y + height > PAGE_BOTTOM) newPage(); };
  const lines = (value: string, width = CONTENT_WIDTH - 8) => doc.splitTextToSize(value, width) as string[];
  const writeLines = (values: string[], x: number, lineHeight = 4.8) => {
    values.forEach(value => { ensureSpace(lineHeight); doc.text(value, x, y); y += lineHeight; });
  };
  const drawStars = (value: number, maximum: number, x: number, centerY: number) => {
    const starCount = Math.max(1, Math.min(maximum, 10));
    const selected = Math.max(0, Math.min(Math.round(value), starCount));
    const outerRadius = 2.25;
    const innerRadius = 1;
    const gap = 1.2;
    doc.setDrawColor(...STAR);
    doc.setLineWidth(0.45);
    for (let index = 0; index < starCount; index += 1) {
      const centerX = x + outerRadius + (index * ((outerRadius * 2) + gap));
      const points = Array.from({ length: 10 }, (_, pointIndex) => {
        const angle = (-Math.PI / 2) + (pointIndex * Math.PI / 5);
        const radius = pointIndex % 2 === 0 ? outerRadius : innerRadius;
        return [centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius)] as const;
      });
      const segments = points.slice(1).map((point, pointIndex) => [
        point[0] - points[pointIndex][0],
        point[1] - points[pointIndex][1],
      ] as [number, number]);
      segments.push([points[0][0] - points[9][0], points[0][1] - points[9][1]]);
      if (index < selected) doc.setFillColor(...STAR);
      doc.lines(segments, points[0][0], points[0][1], [1, 1], index < selected ? 'FD' : 'S', true);
    }
  };

  doc.setProperties({
    title: `Feedback Response Report - ${response.learnerName}`,
    author: 'Kent Business College',
    subject: response.formTitle,
  });
  pageBand();
  doc.setDrawColor(...BORDER);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(MARGIN, 12, 32, 26, 2.5, 2.5, 'FD');
  const logo = await loadLogo();
  if (logo) doc.addImage(logo, 'PNG', MARGIN + 3, 14, 26, 22);
  else {
    doc.setTextColor(...PURPLE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('KENT BUSINESS', MARGIN + 4, 24);
    doc.text('COLLEGE', MARGIN + 4, 29);
  }
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Feedback Response Report', 53, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(response.formTitle || 'Feedback form', 53, 29);
  y = 43;

  const details: Array<[string, string]> = [
    [response.formType === 'post_progress_review_employer' ? 'Employer' : 'Learner', response.learnerName || 'Not recorded'],
    ['Form', response.formTitle || 'Feedback form'],
    ['Submitted', formatDate(response.submittedAt)],
    ['Programme', response.programme || 'Not recorded'],
  ];
  if (response.formType === 'post_lecture') details.push(
    ['Lecture', response.sessionTitle || 'Lecture'],
    ['Lecture date', formatDate(response.sessionStartsAt)],
    ['Tutor', response.tutorName || 'Not recorded'],
  );

  const detailRows = Math.ceil(details.length / 3);
  const detailHeight = (detailRows * 16) + 7;
  doc.setFillColor(...PANEL);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, detailHeight, 3, 3, 'FD');
  details.forEach(([label, value], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const columnWidth = CONTENT_WIDTH / 3;
    const x = MARGIN + 5 + (column * columnWidth);
    const rowY = y + 7 + (row * 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x, rowY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(...NAVY);
    doc.text(lines(value, columnWidth - 9)[0] || 'Not recorded', x, rowY + 5.2);
  });
  y += detailHeight + 9;

  (response.sections || []).forEach((section, sectionIndex) => {
    ensureSpace(15);
    doc.setFillColor(...PURPLE);
    doc.rect(MARGIN, y, 2.5, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(section.title || `Section ${sectionIndex + 1}`, MARGIN + 6, y + 5);
    y += 12;

    section.questions.forEach((question, questionIndex) => {
      const questionLines = lines(question.text || `Question ${questionIndex + 1}`);
      const starRating = question.type === 'rating'
        && question.config.display === 'stars'
        && typeof question.answer === 'number';
      const answerLines = starRating ? [] : lines(feedbackAnswerText(question));
      const answerHeight = starRating ? 6.4 : answerLines.length * 4.8;
      const cardHeight = (questionLines.length * 4.8) + answerHeight + 14;
      ensureSpace(Math.min(cardHeight, PAGE_BOTTOM - 16));
      doc.setDrawColor(...BORDER);
      doc.setFillColor(255, 255, 255);
      if (cardHeight <= PAGE_BOTTOM - 16) doc.roundedRect(MARGIN, y, CONTENT_WIDTH, cardHeight, 2.5, 2.5, 'FD');
      y += 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      writeLines(questionLines, MARGIN + 5);
      y += 1.5;
      if (starRating) {
        drawStars(question.answer as number, question.config.max ?? 5, MARGIN + 5, y + 2.4);
        y += answerHeight;
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...MUTED);
        writeLines(answerLines, MARGIN + 5);
      }
      y += 6;
    });
    y += 2;
  });

  if (!(response.sections || []).length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('No answers were recorded for this response.', MARGIN, y);
  }

  return doc;
}

export async function downloadFeedbackResponsePdf(response: FeedbackResponse) {
  const doc = await buildFeedbackResponsePdf(response);
  doc.save(`feedback-response-${fileSegment(response.learnerName)}-${response.id}.pdf`);
}
