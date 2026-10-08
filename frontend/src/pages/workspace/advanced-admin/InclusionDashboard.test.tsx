import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { advancedAdminInclusion, type AdvancedAdminLearner } from '@/api/advancedAdmin';
import InclusionDashboard from './InclusionDashboard';

vi.mock('@/api/advancedAdmin', () => ({
  advancedAdminInclusion: vi.fn(),
  advancedAdminInclusionReportPdf: (learnerId: number, reportId: string) =>
    `/login_api/advanced-admin/learners/${learnerId}/inclusion/reports/${reportId}/pdf/`,
}));

const learner: AdvancedAdminLearner = {
  id: 42, name: 'Sample Learner', email: 'sample@example.invalid',
  programme: 'Sample Programme', programmeCode: 'ME', programmeStatus: 'Active',
  cohort: 'October', group: 'G1', coach: 'Sample Coach', lmsLinked: true,
};
const reportId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.mocked(advancedAdminInclusion).mockReset();
  vi.mocked(advancedAdminInclusion).mockResolvedValue({
    reports: [{
      id: reportId, status: 'active', riskLevel: 'Low', progressTier: 1,
      programme: learner.programme, organisation: 'Example Organisation',
      coach: learner.coach, archived: false, createdAt: '2026-10-07T12:00:00Z',
      reportHeader: { contacts: { managerName: 'Sample Manager' }, generatedAt: '2026-10-07T12:00:00Z' },
      overview: { overallScore: 127, overallMaxScore: 600, rawPercentage: 21, completedReportsCount: 6, expectedReportsCount: 6,
        assignmentSupportNeeded: true },
      executiveSummary: 'Saved support summary', keyFindings: [{ area: 'Digital access', riskLevel: 'Low',
        finding: 'Saved finding', recommendedResponse: 'Saved response' }],
      supportPlan: { digitalSupport: ['Provide clear joining guidance'] },
      priorityActions: [{ priority: 'High', action: 'Arrange a check-in', owner: 'Coach', due: 'Within 2 weeks' }],
      riskRoadmap: [{ sectionId: 'technology_anxiety_digital_access', label: 'Technology Anxiety and Digital Access',
        riskLevel: 'Low', score: 23, maxScore: 100, adjustedPercentage: 17 }],
      reviewTimeline: { initialReview: 'Within 2 weeks' },
      managerBrief: { oneLineStatus: 'Saved manager status', recommendedNextStep: 'Schedule support' }, professionalNote: '',
      sections: { Technology: { score: { total: 23, max: 100, adjustedPercentage: 17, riskLevel: 'Low' },
        summaries: { coach: 'Saved section summary' }, findings: { mainIndicators: ['One indicator'] },
        answers: [] } }, notes: [], evidence: [],
    }],
    tickets: [{ id: 'case-1', sourceReportId: reportId, subject: 'Support check-in',
      details: 'Discuss support plan.', status: 'active', riskLevel: 'Low', progressTier: 1,
      archived: false, createdAt: '2026-10-08T12:00:00Z', notes: [], evidence: [] }],
    supportTickets: [],
  });
});

it('shows only the selected learner response and downloads that report from the scoped endpoint', async () => {
  render(<MemoryRouter><InclusionDashboard learnerId={42} learner={learner} /></MemoryRouter>);

  await waitFor(() => expect(advancedAdminInclusion).toHaveBeenCalledWith(42, expect.any(AbortSignal)));
  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  expect(within(table).getByText('Sample Learner')).toBeVisible();
  expect(within(table).getByText('127/600')).toBeVisible();
  expect(within(table).getByText('Not recorded')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Support tickets for selected learner' })).toHaveTextContent('1 ticket linked to this learner');

  const viewButton = within(table).getByRole('button', { name: 'View' });
  fireEvent.click(viewButton);
  const dialog = screen.getByRole('dialog', { name: 'Sample Learner' });
  expect(within(dialog).getByRole('button', { name: 'Close report' })).toHaveFocus();
  expect(within(dialog).getByText('Saved support summary')).toBeVisible();
  expect(within(dialog).getByText('Sample Manager')).toBeVisible();
  expect(within(dialog).getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href',
    `/login_api/advanced-admin/learners/42/inclusion/reports/${reportId}/pdf/`);
  fireEvent.click(within(dialog).getByRole('button', { name: 'View Report' }));
  expect(within(dialog).getByText('Saved section summary')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Back to Overview' }));
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Findings (1)' }));
  expect(within(dialog).getByText('Saved response')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Support Plan' }));
  expect(within(dialog).getByText('Provide clear joining guidance')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Actions (1)' }));
  expect(within(dialog).getByText('Arrange a check-in')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Manager Brief' }));
  expect(within(dialog).getByText('Saved manager status')).toBeVisible();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(viewButton).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: /Closed Tickets/ }));
  expect(within(table).queryByText('Sample Learner')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /All Reports/ }));
  expect(within(table).getByText('Sample Learner')).toBeVisible();
});
