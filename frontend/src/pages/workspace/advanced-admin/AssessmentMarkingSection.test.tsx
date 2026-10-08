import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AssessmentMarkingSection from './AssessmentMarkingSection';
import type { AdvancedAdminAuditAssignment, AdvancedAdminSubmission } from '@/api/advancedAdmin';

const assignments: AdvancedAdminAuditAssignment[] = [
  { componentId: 11, name: 'Case study', type: 'Assignment', month: '2026-09',
    status: 'EvidenceSubmitted', plannedHours: 4, actualHours: 2.5, evidence: [{
      id: 100, name: 'Case study upload', status: 'PendingAssessment', submittedAt: '2026-09-12T10:00:00Z',
      completedAt: null, feedbacks: [{ message: 'Original coach feedback' }], hasFile: true,
      hasReport: false, note: 'A submitted answer', verifiedKsbCodes: ['K1'], reviews: [],
    }] },
  { componentId: 12, name: 'Future assignment', type: 'Assignment', month: '2026-10',
    status: 'NotStarted', plannedHours: 3, actualHours: null, evidence: [] },
];

const props = {
  learner: { id: 42, name: 'Sample Learner', programme: 'Sample Programme', programmeCode: 'ME' as const,
    programmeStatus: 'Active', cohort: 'Autumn 2026', group: 'Group 1', coach: '', lmsLinked: true },
  assignments, submissions: [] as AdvancedAdminSubmission[], readOnly: false, loading: false,
  errors: {}, onMark: vi.fn().mockResolvedValue(true), onMarkAssignment: vi.fn().mockResolvedValue(true),
  onMarkAssignmentSource: vi.fn().mockResolvedValue(true),
  onOpenAssignmentDocument: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('shows plan months, recorded hours, uploaded files, View and Mark without counting pending KSBs', async () => {
  const onMarkAssignment = vi.fn().mockResolvedValue(true);
  const onOpenAssignmentDocument = vi.fn();
  render(<AssessmentMarkingSection {...props} onMarkAssignment={onMarkAssignment}
    onOpenAssignmentDocument={onOpenAssignmentDocument} />);
  expect(screen.getByText('Sample Learner')).toBeInTheDocument();
  expect(screen.getByText('2.5h')).toBeInTheDocument();
  expect(screen.getByText(/of 7h planned assignment hours/)).toBeInTheDocument();
  const plannedRow = screen.getByRole('row', { name: /Future assignment/ });
  expect(within(plannedRow).getByRole('button', { name: 'Mark' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /September 2026/ }));
  const uploadedRow = screen.getByRole('row', { name: /Case study/ });
  expect(within(uploadedRow).getByText('File uploaded')).toBeInTheDocument();
  expect(within(uploadedRow).getByLabelText('No verified KSBs')).toBeInTheDocument();
  fireEvent.click(within(uploadedRow).getByRole('button', { name: 'View' }));
  expect(screen.getByText('A submitted answer')).toBeInTheDocument();
  expect(screen.getByText('Original coach feedback')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View submitted file' }));
  expect(onOpenAssignmentDocument).toHaveBeenCalledWith(100, 'file');
  fireEvent.click(within(uploadedRow).getByRole('button', { name: 'Mark' }));
  fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Reviewed.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  await waitFor(() => expect(onMarkAssignment).toHaveBeenCalledWith(100, 'accepted', 'Reviewed.'));
});

it('counts completed assignments, recorded hours, and verified KSBs from accepted files', () => {
  const completed = {
    ...assignments[0], status: 'Completed', actualHours: 8,
    evidence: [
      { ...assignments[0].evidence[0], status: 'Accepted', hasFile: false, verifiedKsbCodes: ['K1', 'S2'] },
      { ...assignments[0].evidence[0], id: 101, status: 'PendingAssessment', verifiedKsbCodes: ['K99'] },
    ],
  };
  render(<AssessmentMarkingSection {...props} assignments={[completed, assignments[1]]} />);
  const summary = screen.getByLabelText('Assignment summary');
  expect(within(summary).getByText('8h')).toBeInTheDocument();
  expect(within(summary).getByText('1 / 2 completed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /September 2026/ }));
  const row = screen.getByRole('row', { name: /Case study/ });
  expect(within(row).getByText('Completed')).toBeInTheDocument();
  expect(within(row).getByText('K1')).toBeInTheDocument();
  expect(within(row).getByText('S2')).toBeInTheDocument();
  expect(within(row).queryByText('K99')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /September 2026/ })).toHaveTextContent('2 KSBs');
});

it('filters by academic year and keeps other assessments outside assignment totals', () => {
  const reflection: AdvancedAdminSubmission = { id: 'reflection-1', activityTitle: 'Monthly reflection',
    activityType: 'reflection', module: 'Module A', status: 'pending', submittedAt: '2026-09-12T10:00:00Z',
    dateCompleted: null, learningReflection: 'Reflection body', applicationText: '', evidenceFiles: [],
    coachFeedback: null, reviewedBy: null, reviewedAt: null };
  render(<AssessmentMarkingSection {...props} submissions={[reflection]} assignments={[...assignments,
    { componentId: 13, name: 'Older work', type: 'Assignment', month: '2025-09', status: 'Completed', plannedHours: 2,
      actualHours: 2, evidence: [] }]} />);
  expect(screen.getByText('Monthly reflection')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  const other = screen.getByRole('region', { name: 'Other submitted assessments' });
  fireEvent.click(within(other).getByRole('button', { name: 'View' }));
  expect(within(other).getByText('Reflection body')).toBeInTheDocument();
  expect(within(other).queryByRole('button', { name: 'Save decision' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Academic year'), { target: { value: '2025 - 2026' } });
  expect(screen.getByRole('button', { name: /September 2025/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /September 2026/ })).not.toBeInTheDocument();
});

it('excludes future and undated plan months from every total and includes the current UK month', () => {
  // It is still September in UTC, but October in the LMS business time zone.
  vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
  const future: AdvancedAdminAuditAssignment = {
    componentId: 14, name: 'November work', type: 'Assignment', month: '2026-11',
    status: 'Completed', plannedHours: 100, actualHours: 9, evidence: [{
      id: 101, name: 'Future upload', status: 'Accepted', submittedAt: '2026-11-01T12:00:00Z',
      completedAt: null, feedbacks: [], hasFile: false, hasReport: false, note: '',
      verifiedKsbCodes: ['K99'], reviews: [],
    }],
  };
  const undated: AdvancedAdminAuditAssignment = {
    ...future, componentId: 15, name: 'Undated work', month: null,
  };
  const all = [...assignments, future, undated];
  const { rerender } = render(<AssessmentMarkingSection {...props} assignments={all} />);
  const summary = screen.getByLabelText('Assignment summary');
  expect(within(summary).getByText('2')).toBeInTheDocument();
  expect(within(summary).getByText('2.5h')).toBeInTheDocument();
  expect(within(summary).getByText(/of 7h planned assignment hours/)).toBeInTheDocument();
  expect(within(summary).queryByText('Verified KSBs')).not.toBeInTheDocument();
  expect(within(summary).getByText('0 / 2 completed')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /November 2026/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /No plan month/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /October 2026/ })).toBeInTheDocument();

  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  rerender(<AssessmentMarkingSection {...props} assignments={all} />);
  expect(within(summary).getByText('3')).toBeInTheDocument();
  expect(within(summary).getByText('11.5h')).toBeInTheDocument();
  expect(within(summary).getByText(/of 107h planned assignment hours/)).toBeInTheDocument();
  expect(within(summary).getByText('1 / 3 completed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /November 2026/ })).toBeInTheDocument();
});

it('shows Misc files under one component row in their upload month with View and Mark', () => {
  const additional: AdvancedAdminAuditAssignment = {
    componentId: 77, rowId: 'misc:2026-10:77', name: 'Additional Job Activities',
    type: 'Miscellaneous', month: '2026-10', monthSource: 'upload',
    status: 'PendingAssessment', plannedHours: null, actualHours: 1.5,
    evidence: [
      { id: 202, name: 'Second sample', status: 'PendingAssessment',
        submittedAt: '2026-10-03T10:00:00Z', completedAt: null, feedbacks: [], hasFile: true,
        hasReport: false, note: '', verifiedKsbCodes: ['K99'], reviews: [] },
      { id: 201, name: 'Work sample', status: 'Accepted',
        submittedAt: '2026-10-02T10:00:00Z', completedAt: null, feedbacks: [], hasFile: true,
        hasReport: false, note: '', verifiedKsbCodes: ['S2'], reviews: [] },
    ],
  };
  const onOpenAssignmentDocument = vi.fn();
  const onMarkAssignment = vi.fn().mockResolvedValue(true);
  render(<AssessmentMarkingSection {...props} assignments={[...assignments, additional]}
    onMarkAssignment={onMarkAssignment}
    onOpenAssignmentDocument={onOpenAssignmentDocument} />);
  const summary = screen.getByLabelText('Assignment summary');
  expect(within(summary).getByText('3')).toBeInTheDocument();
  expect(within(summary).getByText('4h')).toBeInTheDocument();
  expect(within(summary).getByText('0 / 3 completed')).toBeInTheDocument();
  const month = screen.getByRole('button', { name: /October 2026/ });
  expect(month).toHaveTextContent('1 KSBs');
  const row = screen.getByRole('row', { name: /Additional Job Activities/ });
  expect(within(row).getByText('Miscellaneous')).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'View' }));
  expect(screen.getByText(/Upload month: October 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Second sample/)).toBeInTheDocument();
  expect(screen.getByText(/Work sample/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'View submitted file' })[1]);
  expect(onOpenAssignmentDocument).toHaveBeenCalledWith(201, 'file');
  fireEvent.click(within(row).getByRole('button', { name: 'Mark' }));
  fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Review this file.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(onMarkAssignment).toHaveBeenCalledWith(202, 'accepted', 'Review this file.');
});

it('shows summed report hours and missing hours for a grouped Misc component', () => {
  const evidence = [301, 302, 303].map((id) => ({
    id, name: `File ${id}`, status: 'Accepted', submittedAt: '2026-10-02T10:00:00Z',
    completedAt: null, feedbacks: [], hasFile: true, hasReport: id !== 303,
    note: '', verifiedKsbCodes: [], reviews: [],
  }));
  const uploaded: AdvancedAdminAuditAssignment = {
    componentId: 90, rowId: 'misc:2026-10:90', name: 'Additional Job Activities',
    type: 'Miscellaneous', month: '2026-10', monthSource: 'upload', status: 'Completed',
    plannedHours: null, actualHours: 3.75, missingReportHours: 1, evidence,
  };
  render(<AssessmentMarkingSection {...props} assignments={[uploaded]} />);
  const summary = screen.getByLabelText('Assignment summary');
  expect(within(summary).getByText('3.75h')).toBeInTheDocument();
  expect(within(summary).getByText('1 accepted file has no verified report hours')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /October 2026/ })).toHaveTextContent('3.75h');
  const row = screen.getByRole('row', { name: /Additional Job Activities/ });
  fireEvent.click(within(row).getByRole('button', { name: 'View' }));
  expect(screen.getAllByRole('button', { name: 'View submitted file' })).toHaveLength(3);
  expect(screen.getByText('1 accepted file has no verified report hours.')).toBeInTheDocument();
});

it('shows imported assignments without a calendar month outside today totals', () => {
  const imported: AdvancedAdminAuditAssignment = {
    componentId: 601, rowId: 'check:601', name: 'Imported project assignment',
    type: 'Assignment', month: null, monthSource: 'audit', status: 'Planned',
    plannedHours: null, actualHours: null, evidence: [], sourceMarkId: 601,
    sourceFiles: [
      { name: 'Submission.docx', url: 'https://onedrive.live.com/example' },
      { name: 'Pending.pdf', url: null },
    ],
  };
  const dated = { ...imported, componentId: 602, rowId: 'check:602',
    name: 'Dated imported assignment', month: '2026-10' };
  render(<AssessmentMarkingSection {...props} assignments={[...assignments, imported, dated]} />);
  const summary = screen.getByLabelText('Assignment summary');
  expect(within(summary).getByText('3')).toBeInTheDocument();
  expect(within(summary).getByText('Some imported assignments have no planned hours recorded.')).toBeInTheDocument();
  expect(screen.getByText('1 record without a calendar month is listed below and excluded from totals.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Month unavailable/ }));
  const row = screen.getByRole('row', { name: /Imported project assignment/ });
  expect(within(row).getByRole('button', { name: 'Mark' })).toBeEnabled();
  fireEvent.click(within(row).getByRole('button', { name: 'View' }));
  expect(screen.getByText(/Imported assignment/)).toBeInTheDocument();
  const sourceFiles = screen.getByLabelText('Imported assignment files');
  expect(within(sourceFiles).getByText('Submission.docx')).toBeInTheDocument();
  expect(within(sourceFiles).getByText('Pending.pdf')).toBeInTheDocument();
  expect(within(sourceFiles).getByRole('link', { name: 'Open source file' })).toHaveAttribute(
    'href', 'https://onedrive.live.com/example');
  expect(within(sourceFiles).getByText('Source link unavailable')).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Mark' }));
  fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Reviewed imported file.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(props.onMarkAssignmentSource).toHaveBeenCalledWith(601, 'accepted', 'Reviewed imported file.');
});
