import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const doc = {
    setProperties: vi.fn(), setFillColor: vi.fn(), rect: vi.fn(), setFont: vi.fn(), setFontSize: vi.fn(),
    setTextColor: vi.fn(), text: vi.fn(), roundedRect: vi.fn(), setDrawColor: vi.fn(),
    setLineWidth: vi.fn(), line: vi.fn(), getNumberOfPages: vi.fn(() => 2), setPage: vi.fn(),
    addPage: vi.fn(), save: vi.fn(),
  };
  return { doc, jsPDF: vi.fn(function MockJsPdf() { return doc; }), autoTable: vi.fn() };
});

vi.mock('jspdf', () => ({ jsPDF: mocks.jsPDF }));
vi.mock('jspdf-autotable', () => ({ default: mocks.autoTable }));

import {
  downloadAttendanceSummaryPdf,
  downloadLearnerAttendancePdf,
} from './attendancePdf';

it('exports the report summary and the learner detail table in one PDF', () => {
  downloadAttendanceSummaryPdf({
    rows: [{
      learner: {
        id: 'kbc:42', kbcId: '42', name: 'Alex Example', email: 'alex@example.invalid',
        programmeId: 'P1', cohortId: 'C1', groupId: 'G1', endDate: '',
      },
      groupName: 'Group A', cohortName: 'Autumn',
    }],
    entries: [{ name: 'Group A', learners: 1, present: 1, absent: 0, total: 1, rate: 100 }],
    breakdownLabel: 'Group', start: '2026-10-17', end: '2026-10-17', scopeLabel: 'Engineering',
    dayIsos: ['2026-10-17'], getStatus: () => 'present',
  });

  expect(mocks.autoTable).toHaveBeenCalledTimes(2);
  expect(mocks.doc.save).toHaveBeenCalledWith('attendance-report_engineering_2026-10-17_to_2026-10-17.pdf');
});

it('exports the saved KBC and live attendance history for one learner', () => {
  downloadLearnerAttendancePdf({
    learner: {
      id: 'kbc:42', kbcId: '42', name: 'Alex Example', email: 'alex@example.invalid',
      programmeId: 'P1', cohortId: 'C1', groupId: 'G1', endDate: '',
    },
    cohortName: 'Autumn', moduleLabel: 'Module A',
    history: [{
      id: 'live:7', recordKey: 'live:7', sessionDate: '2026-10-17', moduleName: 'Module A',
      lectureName: 'Live session', attendance: 'present', source: 'live',
    }],
  });

  expect(mocks.autoTable).toHaveBeenCalledTimes(3);
  expect(mocks.doc.save).toHaveBeenCalledWith('attendance-history_alex-example.pdf');
});
