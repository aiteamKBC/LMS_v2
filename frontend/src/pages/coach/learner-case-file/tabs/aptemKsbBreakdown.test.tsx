import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressTab, EvidencePreviewModal } from './ProgressTab';
import type { CoachLearnerCaseFileData } from '../types';
import type { AptemKsbRow } from '../domain/aptemKsbBreakdown';
import { summarizeAptemKsbGroups } from '../domain/aptemKsbBreakdown';
import { useState } from 'react';
import type { EvidencePreviewTarget } from '../domain/ksbSelectors';

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
