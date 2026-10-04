import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadLearnersPdf } from './exportPdf';
import type { Learner } from '../types';
import type { InsightMap } from './attention';

const pdf = vi.hoisted(() => ({
  internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
  setFont: vi.fn(), setFontSize: vi.fn(), setTextColor: vi.fn(), setFillColor: vi.fn(),
  setDrawColor: vi.fn(), rect: vi.fn(), roundedRect: vi.fn(), text: vi.fn(), line: vi.fn(),
  getTextWidth: vi.fn((value: string) => value.length), addPage: vi.fn(), save: vi.fn(),
}));

vi.mock('jspdf', () => ({ jsPDF: class { constructor() { return pdf; } } }));

const learner = {
  id: 'learner-1', name: 'Example Learner', rawProgramStatus: 'active', overallProgress: 72,
  overallProgressAvailable: true, otjhCompleted: 42, otjhTarget: 60, liveAttendanceRate: 88,
  componentsCompleted: 8, componentsPlanned: 10, ksbCompleted: 7, ksbTarget: 9,
  programmeName: 'Business Administration', group: 'Group A', gatewayReviewDate: null,
} as Learner;

describe('coach learner PDF export', () => {
  beforeEach(() => { Object.values(pdf).forEach(value => { if (typeof value === 'function' && 'mockClear' in value) value.mockClear(); }); });

  it('uses the Monthly Logs PDF palette and full content width for the report table', () => {
    downloadLearnersPdf([learner], 'Example Coach', new Map([['learner-1', { riskLabel: 'On track' }]]) as InsightMap);

    expect(pdf.setFillColor).toHaveBeenCalledWith(24, 45, 72);
    expect(pdf.setFillColor).toHaveBeenCalledWith(246, 248, 251);
    expect(pdf.setFillColor).toHaveBeenCalledWith(247, 249, 252);
    expect(pdf.setTextColor).toHaveBeenCalledWith(255, 255, 255);
    expect(pdf.setTextColor).toHaveBeenCalledWith(24, 45, 72);
    expect(pdf.rect).toHaveBeenCalledWith(10, expect.any(Number), expect.closeTo(277), 7, 'F');
    expect(pdf.save).toHaveBeenCalledWith('coach-learners.pdf');
  });
});
