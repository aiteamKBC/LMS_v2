import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressTab, EvidencePreviewModal } from './ProgressTab';
import type { CoachLearnerCaseFileData } from '../types';
import type { AptemKsbRow } from '../domain/aptemKsbBreakdown';
import { summarizeAptemKsbGroups } from '../domain/aptemKsbBreakdown';
import { useState } from 'react';
import type { EvidencePreviewTarget } from '../domain/ksbSelectors';
import type { DashboardPlanState } from '@/pages/workspace/learner/useDashboardPlan';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/api/learnerRead', () => ({ readLearnerJson: read }));
const rows: AptemKsbRow[] = [
  { code: 'K1', category: 'Knowledge', description: 'Knowledge description', completed: 1, status: 'Achieved', components: [
    { name: 'Completed component', status: 'Completed', achieved: true },
    { name: 'Pending component', status: 'NotStarted', achieved: false },
  ] },
  { code: 'S1', category: 'Skills', description: 'Skill description', completed: 0, status: 'Not Achieved', components: [
    { name: 'Skill component', status: 'InProgress', achieved: false },
  ] },
];
const data = { kind: 'apprenticeship', learnerId: '42', enrolmentId: '125',
  otjhCompleted: 10, otjhTarget: 20, otjhPlanned: 20, ksbTotalCount: 900, ksbEvidencedCount: 800,
  ksbActivityPoints: [], metricsAvailable: false } as unknown as CoachLearnerCaseFileData;
function Harness() {
  const [evidence, setEvidence] = useState<EvidencePreviewTarget | null>(null);
  return <><ProgressTab data={data} onViewEvidence={setEvidence} />
    {evidence && <EvidencePreviewModal evidence={evidence} onClose={() => setEvidence(null)} onOpenAssignment={vi.fn()} />}</>;
}
beforeEach(() => { read.mockReset(); });
describe('Progress KSB detailed breakdown', () => {
  it.each([
    [null, '--', '--'],
    [138.99, '138h 59m', '52%'],
  ] as const)('preserves canonical target %s despite a full monthly plan', async (target, targetLabel, progressLabel) => {
    read.mockResolvedValue({ rows });
    const plan = { data: {
      months: { '2026-08': { label: 'August 2026', topics: [], planned: 850, source: 'ssot' } },
      monthlyLogOtjh: { '2026-08': { target: 850, submitted: 0, completed: 72.0581 } },
      requiredOtjh: 850, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [], reviews: [],
      coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '2026-10-06T00:00:00Z',
    }, otjh: { actual: 72.0581, planned: 850 } } as unknown as DashboardPlanState;
    render(<ProgressTab data={{ ...data, metricsAvailable: true,
      otjhCompleted: 72.0581, otjhTarget: target, otjhPlanned: 850 }} plan={plan} onViewEvidence={vi.fn()} />);
    await screen.findByRole('table');
    expect(screen.getByText('Target Hours').parentElement).toHaveTextContent(targetLabel);
    expect(screen.getByText('Planned').parentElement).toHaveTextContent('850h');
    expect(screen.getByText('OTJH Progress').parentElement).toHaveTextContent(progressLabel);
  });
  it('uses mapped unique codes despite unrelated metric totals; partial component completion achieves the KSB', async () => {
    read.mockResolvedValue({ rows });
    render(<Harness />);
    await screen.findByRole('table');
    expect(read).toHaveBeenCalledWith('/learner_api/metrics/apprenticeship/125/?view=coach-ksb-breakdown', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('1');
    expect(screen.getAllByText('Knowledge')[0].closest('[data-category]')).toHaveTextContent('100%');
    expect(screen.getAllByText('Skills')[0].closest('[data-category]')).toHaveTextContent('0%');
    const row = screen.getByText('K1').closest('tr')!;
    expect(row).toHaveTextContent('Achieved');
    expect(row).toHaveTextContent('2 Activities');
    expect(row).toHaveTextContent('1 completed components');
    fireEvent.click(within(row).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('K1')).toBeInTheDocument();
    expect(within(dialog).getByText('Knowledge description')).toBeInTheDocument();
    expect(within(dialog).getByText('Status: Completed')).toBeInTheDocument();
    expect(within(dialog).getByText('Status: NotStarted')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Achieved this KSB')).toHaveLength(1);
    expect(within(dialog).getByText('Achieved this KSB').parentElement).toHaveClass('bg-emerald-50');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows errors without fabricating zero totals', async () => {
    read.mockRejectedValue(new Error('Component statuses unavailable'));
    render(<Harness />);
    await screen.findByText('Component statuses unavailable');
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('--');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('does not reuse another learner response during a learner switch', async () => {
    read.mockResolvedValueOnce({ rows }).mockReturnValueOnce(new Promise(() => {}));
    const { rerender } = render(<ProgressTab data={data} onViewEvidence={vi.fn()} />);
    await screen.findByRole('table');
    rerender(<ProgressTab data={{ ...data, learnerId: '43', enrolmentId: '126' }} onViewEvidence={vi.fn()} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('K1')).not.toBeInTheDocument();
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('--');
  });
  it('counts each category from achieved KSBs and handles no mapped codes', () => {
    expect(summarizeAptemKsbGroups(rows)).toMatchObject({ total: 2, achieved: 1, remaining: 1, percent: 50 });
    expect(summarizeAptemKsbGroups([])).toMatchObject({ total: 0, achieved: 0, remaining: 0 });
  });
  it('uses actual progress rows for an Aptem learner without historical totals', async () => {
    read.mockResolvedValue({ source: 'progress', rows: rows.map(row => ({ ...row,
      components: row.components.map(component => ({ ...component, source: 'old_lms' })),
    })), totalKsbs: 2, achievedKsbs: 1, remainingKsbs: 1 });
    render(<Harness />);
    await screen.findByRole('table');
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('1');
    fireEvent.click(within(screen.getByText('K1').closest('tr')!).getByRole('button', { name: 'View' }));
    expect(within(screen.getByRole('dialog')).getAllByText('Source: old_lms').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('dialog')).queryByText('Source: Aptem')).not.toBeInTheDocument();
  });
  it('uses the dashboard plan for OTJH totals and places the monthly chart below the summary', async () => {
    read.mockResolvedValue({ rows });
    const planData = {
      months: {
        '2000-01': { label: 'January 2000', topics: [], planned: 50, source: 'ssot' },
        '2000-02': { label: 'February 2000', topics: [], planned: 100, source: 'ssot' },
      },
      monthlyLogOtjh: {
        '2000-01': { target: 50, submitted: 2, completed: 7.3 },
        '2000-02': { target: 100, submitted: 3, completed: 10 },
      },
      requiredOtjh: 500,
      actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [], reviews: [],
      coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '2000-02-29T00:00:00Z',
    } as TrainingPlanDashboard;
    const plan = { data: planData, otjh: { actual: 17.3, planned: 500 } } as unknown as DashboardPlanState;

    render(<ProgressTab data={{ ...data, otjhCompleted: 5.65, otjhTarget: null, otjhPlanned: null }} plan={plan} onViewEvidence={vi.fn()} />);

    expect(screen.getByText('Actual').parentElement).toHaveTextContent('17h 18m');
    expect(screen.getByText('Target Hours').parentElement).toHaveTextContent('--');
    expect(screen.getByText('Planned').parentElement).toHaveTextContent('500h');
    expect(screen.getByText('Hours Remaining').parentElement).toHaveTextContent('--');
    const summary = screen.getByRole('heading', { name: 'Off-the-Job Hours (OTJH)' }).closest('section')!;
    const chart = screen.getByRole('region', { name: 'Off-the-job hours by month' });
    expect(summary.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(chart).getByRole('button', { name: /January 2000: target 50 hours/ })).toBeVisible();
  });
  it('keeps the OTJH card aligned with the selected caseload row snapshot', () => {
    read.mockResolvedValue({ rows });

    render(<ProgressTab
      data={{ ...data, otjhCompleted: 5.65, otjhTarget: 169, otjhPlanned: 850 }}
      otjhSnapshot={{ completed: 104.71, target: 140.6, planned: 850, percent: 74 }}
      onViewEvidence={vi.fn()}
    />);

    expect(screen.getByText('Actual').parentElement).toHaveTextContent('104h 43m');
    expect(screen.getByText('Target Hours').parentElement).toHaveTextContent('140h 36m');
    expect(screen.getByText('Planned').parentElement).toHaveTextContent('850h');
    expect(screen.getByText('Hours Remaining').parentElement).toHaveTextContent('35h 53m');
    expect(screen.getByText('OTJH Progress').parentElement).toHaveTextContent('74%');
  });
  it('recalculates the caseload target after a direct load or refresh loses navigation state', () => {
    read.mockResolvedValue({ rows });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const planData = {
      months: { '2026-08': { label: 'August 2026', topics: [], planned: 850, source: 'ssot' } },
      monthlyLogOtjh: { '2026-08': { target: 850, submitted: 0, completed: 104.71 } }, requiredOtjh: 850,
      programmeStartDate: '2026-08-22', programmeEndDate: '2027-05-15',
      actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [], reviews: [],
      coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '2026-10-05T00:00:00Z',
    } as TrainingPlanDashboard;
    const plan = {
      data: planData,
      otjh: { actual: 104.71, planned: 850 },
      plannedEndDate: '2027-05-15',
    } as unknown as DashboardPlanState;

    try {
      render(<ProgressTab
        data={{ ...data, startDate: '22 Aug 2026', plannedEndDate: '15 May 2027', otjhCompleted: 104.71, otjhTarget: 850, otjhPlanned: 850 }}
        plan={plan}
        onViewEvidence={vi.fn()}
      />);

      expect(screen.getByText('Actual').parentElement).toHaveTextContent('104h 43m');
      expect(screen.getByText('Target Hours').parentElement).toHaveTextContent('140h 36m');
      expect(screen.getByText('Planned').parentElement).toHaveTextContent('850h');
      expect(screen.getByText('Hours Remaining').parentElement).toHaveTextContent('35h 53m');
      expect(screen.getByText('OTJH Progress').parentElement).toHaveTextContent('74%');
      const chart = within(screen.getByRole('region', { name: 'Off-the-job hours by month' }));
      expect(chart.getByRole('progressbar', { name: 'Overall off-the-job hours progress' })).toHaveAttribute('aria-valuenow', '74');
      expect(chart.getByText('-26% (-35.9h)')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
  it('shows linked progress codes and highlights only completed accepted rows', async () => {
    const newRows: AptemKsbRow[] = [
      { ...rows[0], components: [
        { name: 'Accepted component', status: 'completed', achieved: true },
        { name: 'Rejected component', status: 'completed', achieved: false },
      ] },
      { ...rows[1], components: [] },
      { code: 'B1', category: 'Behaviours', description: 'No progress yet', components: [], completed: 0, status: 'Not Achieved' },
    ];
    read.mockResolvedValue({ source: 'progress', rows: newRows, totalKsbs: 3, achievedKsbs: 1, remainingKsbs: 2 });
    render(<Harness />);
    await screen.findByRole('table');
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('2');
    expect(screen.getByText('B1').closest('tr')).toHaveTextContent('Not Achieved');
    fireEvent.click(within(screen.getByText('K1').closest('tr')!).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Source: Progress').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('Source: Aptem')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('Achieved this KSB')).toHaveLength(1);
    expect(within(dialog).getByText('Rejected component').closest('.rounded-xl')).not.toHaveClass('bg-emerald-50');
  });
  it('shows zero totals when no linked non-deleted progress exists', async () => {
    read.mockResolvedValue({ source: 'progress', rows: [], totalKsbs: 0, achievedKsbs: 0, remainingKsbs: 0 });
    render(<Harness />);
    await screen.findByText('No KSB components matched the current filter.');
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('0');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
