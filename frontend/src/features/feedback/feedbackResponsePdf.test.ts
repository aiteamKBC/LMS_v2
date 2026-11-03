import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const doc = {
    setFillColor: vi.fn(), rect: vi.fn(), setTextColor: vi.fn(), setFont: vi.fn(), setFontSize: vi.fn(),
    text: vi.fn(), setDrawColor: vi.fn(), setLineWidth: vi.fn(), roundedRect: vi.fn(), line: vi.fn(), lines: vi.fn(), addPage: vi.fn(), addImage: vi.fn(),
    setProperties: vi.fn(), save: vi.fn(),
    splitTextToSize: vi.fn((value: string) => [value]),
  };
  return { doc, jsPDF: vi.fn(function MockJsPdf() { return doc; }) };
});

vi.mock('jspdf', () => ({ jsPDF: mocks.jsPDF }));

import type { FeedbackResponse } from '@/api/feedback';
import { downloadFeedbackResponsePdf, feedbackAnswerText } from './feedbackResponsePdf';

const response: FeedbackResponse = {
  id: 91, formId: 20, formTitle: 'Live Sessions Feedback', formType: 'post_lecture', deliveryId: 30,
  sessionTitle: 'Marketing - Session 1', sessionStartsAt: '2026-10-19T09:00:00Z', tutorName: 'Original Tutor',
  learnerId: '61', learnerName: 'Synthetic Learner', programme: 'Business', status: 'completed',
  startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z', submittedAt: '2026-10-20T10:00:00Z',
  sections: [{
    title: 'Session quality', description: '', questions: [
      { type: 'rating', text: 'How was the session?', required: true, helpText: '', config: { max: 5, display: 'stars' }, answer: 4 },
      { type: 'long_text', text: 'What worked well?', required: false, helpText: '', config: {}, answer: 'Clear explanations' },
    ],
  }],
};

it('downloads one branded feedback response with its lecture context and answers', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })));
  await downloadFeedbackResponsePdf(response);

  expect(mocks.jsPDF).toHaveBeenCalledWith({ unit: 'mm', format: 'a4' });
  expect(mocks.doc.text).toHaveBeenCalledWith('Feedback Response Report', 53, 22);
  expect(mocks.doc.addImage).toHaveBeenCalledWith(expect.any(Uint8Array), 'PNG', 18, 14, 26, 22);
  expect(mocks.doc.text).toHaveBeenCalledWith('19 Oct 2026', expect.any(Number), expect.any(Number));
  expect(mocks.doc.text).not.toHaveBeenCalledWith('4 / 5 stars', 20, expect.any(Number));
  expect(mocks.doc.lines).toHaveBeenCalledTimes(5);
  expect(mocks.doc.lines.mock.calls.filter(call => call[4] === 'FD')).toHaveLength(4);
  expect(mocks.doc.lines.mock.calls.filter(call => call[4] === 'S')).toHaveLength(1);
  expect(mocks.doc.text).toHaveBeenCalledWith('Clear explanations', 20, expect.any(Number));
  expect(mocks.doc.save).toHaveBeenCalledWith('feedback-response-synthetic-learner-91.pdf');
});

it('formats supported feedback answer types for the PDF', () => {
  const question = response.sections![0].questions[1];
  expect(feedbackAnswerText(question, ['Option A', 'Option B'])).toBe('Option A, Option B');
  expect(feedbackAnswerText(question, true)).toBe('Yes');
  expect(feedbackAnswerText(question, { firstName: 'Taylor', lastName: 'Learner' })).toBe('Taylor Learner');
  expect(feedbackAnswerText(question, null)).toBe('No answer');
});
