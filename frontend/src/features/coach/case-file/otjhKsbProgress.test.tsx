import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { CaseFileSessionProvider } from './hooks/CaseFileSession';
import { caseFileSectionRead } from './api/caseFileApi';
import { ProgressTab, EvidencePreviewModal } from '@/pages/coach/learner-case-file/tabs/ProgressTab';
import type { CoachLearnerCaseFileData } from '@/pages/coach/learner-case-file/types';
import type { EvidencePreviewTarget } from '@/pages/coach/learner-case-file/domain/ksbSelectors';
import type { CaseFileOtjhKsb } from './api/contracts';
import type { DashboardPlanState } from '@/pages/workspace/learner/useDashboardPlan';

const transport = vi.hoisted(() => vi.fn());
const legacyRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));
vi.mock('@/api/learnerRead', async importOriginal => ({ ...await importOriginal<typeof import('@/api/learnerRead')>(), readLearnerJson: legacyRead }));
const compact: CaseFileOtjhKsb = {
  otjh: { actualHours: 174.2478, targetToDateHours: 406.87, plannedHours: 576,
    remainingHours: 232.6222, progressPercent: 42.83,
    months: [{ month: '2025-10', targetHours: 12, submittedHours: .33, completedHours: 5.36 }] },
  ksb: { summary: { total: 43, achieved: 40, remaining: 3 }, categories: [
    { category: 'Knowledge', achieved: 14, total: 14, percent: 100 },
    { category: 'Skills', achieved: 18, total: 19, percent: 94.74 },
    { category: 'Behaviours', achieved: 8, total: 10, percent: 80 },
  ], rows: [{ code: 'K6', description: 'Synthetic knowledge', category: 'Knowledge', status: 'Achieved', evidenceCount: 87, completed: 80, pointsAchieved: 82, totalPoints: 87, progressPercent: 94.25 }] },
};
const data = { kind: 'apprenticeship', learnerId: '101', enrolmentId: '201',
  otjhCompleted: 999, otjhTarget: 999, otjhPlanned: 999 } as CoachLearnerCaseFileData;

function Harness({ coach = 'coach@example.test', learnerId = '101', snapshot }: {
  coach?: string; learnerId?: string; snapshot?: { completed: number; target: number; planned: number; percent: number };
}) {
  const [shown, setShown] = useState(true);
  const [evidence, setEvidence] = useState<EvidencePreviewTarget | null>(null);
  return <CaseFileSessionProvider coach={coach} learnerId={learnerId}>
    <button onClick={() => setShown(value => !value)}>Toggle tab</button>
    {shown && <ProgressTab data={data} onViewEvidence={setEvidence} otjhSnapshot={snapshot} />}
    {evidence && <EvidencePreviewModal evidence={evidence} onClose={() => setEvidence(null)} onOpenAssignment={vi.fn()} />}
  </CaseFileSessionProvider>;
}
beforeEach(() => {
  clearAllCachedResources();
  transport.mockReset();
  legacyRead.mockReset();
  transport.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/ksbs/')
    ? { source: 'progress', rows: [{ code: 'K6', description: 'Synthetic knowledge', category: 'Knowledge', completed: 1,
      status: 'Achieved', components: [{ name: 'Selected evidence', status: 'submitted', achieved: false, accepted: false, type: 'Reading', module: 'Synthetic module', date: '2026-10-02' }] }] }
    : url.includes('/ksb-search') ? { codes: ['K6'] } : compact), { status: 200 }));
});
afterEach(() => vi.restoreAllMocks());

it('uses one first-open request, zero fresh-revisit requests, then one code-scoped evidence request', async () => {
  render(<StrictMode><Harness /></StrictMode>);
  await screen.findByRole('table');
  expect(transport.mock.calls.map(call => call[0])).toEqual(['/coach_api/coach/case-file/101/otjh-ksb']);
  expect(screen.queryByText('Selected evidence')).not.toBeInTheDocument();
  expect(screen.getByText('K6').closest('tr')).toHaveTextContent('82');
  expect(screen.getByText('K6').closest('tr')).toHaveTextContent('94.25%');
  fireEvent.click(screen.getByText('Toggle tab'));
  fireEvent.click(screen.getByText('Toggle tab'));
  await screen.findByRole('table');
  expect(transport).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByRole('dialog');
  expect(transport.mock.calls.at(-1)?.[0]).toBe('/coach_api/coach/case-file/101/ksbs/K6');
  expect(transport).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Selected evidence')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent('82 / 87 points');
  expect(screen.getByRole('dialog')).toHaveTextContent('94.25%');
  expect(screen.getByRole('dialog')).toHaveTextContent('Date: 2026-10-02');
  expect(screen.getByRole('dialog')).toHaveTextContent('Module: Synthetic module');
  expect(screen.getByRole('dialog')).toHaveTextContent('Not accepted');
  expect(window.location.pathname).toBe('/');
  fireEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByRole('dialog');
  expect(transport).toHaveBeenCalledTimes(2);
});

it('renders canonical card/category values and compact monthly points without using page metrics or aggregating rows', async () => {
  render(<Harness />);
  await screen.findByRole('table');
  for (const [label, value] of [['Actual','174h 15m'], ['Target Hours','406h 52m'], ['Planned','576h'], ['Hours Remaining','232h 37m'],
    ['OTJH Progress','43%'], ['Total KSBs','43'], ['Achieved KSBs','40'], ['Remaining KSBs','3']]) {
    expect(screen.getByText(label).parentElement).toHaveTextContent(value);
  }
  const section = screen.getByRole('heading', { name: 'KSB Detailed Breakdown' }).closest('section')!;
  for (const [category, count, percent] of [['Knowledge','14 / 14','100%'], ['Skills','18 / 19','95%'], ['Behaviours','8 / 10','80%']]) {
    const card = within(section as HTMLElement).getByText(category).closest('[data-category]')!;
    expect(card).toHaveTextContent(count);
    expect(card).toHaveTextContent(percent);
  }
  const chart = screen.getByRole('region', { name: 'Off-the-job hours by month' });
  expect(within(chart).getByRole('button', { name: 'October 2025: target 12 hours, submitted 0.3 hours, completed 5.4 hours' })).toBeVisible();
  expect(within(chart).getAllByRole('button')).toHaveLength(1);
});

it('honors final backend remaining/percentage/category fields rather than recomputing them', async () => {
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...compact,
    otjh: { ...compact.otjh, remainingHours: 7, progressPercent: 31 },
    ksb: { ...compact.ksb, categories: [{ category: 'Knowledge', total: 14, achieved: 14, percent: 37 }] },
  })));
  render(<Harness />);
  await screen.findByRole('table');
  expect(screen.getByText('Hours Remaining').parentElement).toHaveTextContent('7h');
  expect(screen.getByText('OTJH Progress').parentElement).toHaveTextContent('31%');
  const section = screen.getByRole('heading', { name: 'KSB Detailed Breakdown' }).closest('section')!;
  expect(within(section as HTMLElement).getByText('Knowledge').closest('[data-category]')).toHaveTextContent('37%');
});

it('shows the same canonical Planned for direct and Coach-table opens even when the navigation snapshot disagrees', async () => {
  const direct = render(<Harness />);
  await screen.findByRole('table');
  const directPlanned = screen.getByText('Planned').parentElement!.textContent;
  expect(directPlanned).toContain('576h');
  direct.unmount();
  render(<Harness snapshot={{ completed: 999, target: 888, planned: 850, percent: 99 }} />);
  await screen.findByRole('table');
  expect(screen.getByText('Planned').parentElement!.textContent).toBe(directPlanned);
  expect(screen.getByText('Actual').parentElement).toHaveTextContent('174h 15m');
  expect(screen.getByText('Target Hours').parentElement).toHaveTextContent('406h 52m');
  expect(transport).toHaveBeenCalledTimes(1);
});

it('preserves every visible card, category count/percentage, and chart point from the old UI on a synthetic fixture', async () => {
  const rows = compact.ksb.categories.flatMap(category => Array.from({ length: category.total }, (_, index) => ({
    code: `${category.category[0]}${index + 1}`, category: category.category, description: 'Synthetic framework code',
    completed: index < category.achieved ? 80 : 0, status: index < category.achieved ? 'Achieved' : 'Not Achieved',
    activityNames: Array.from({ length: 87 }, (_, evidence) => `Synthetic evidence ${evidence + 1}`), components: [],
  })));
  legacyRead.mockResolvedValue({ source: 'progress', rows, achievedKsbs: 40 });
  const oldData = { ...data, metricsAvailable: true, otjhCompleted: 174.2478, otjhTarget: 406.87,
    otjhPlanned: 576, totalExpectedOtjh: 576 };
  const plan = { data: { months: { '2025-10': { planned: 12 } }, monthlyLogOtjh: { '2025-10': { target: 12, submitted: .33, completed: 5.36 } },
    actual: [], actualAvailable: true, requiredOtjh: 576 } } as unknown as DashboardPlanState;
  const snapshot = () => {
    const section = screen.getByRole('heading', { name: 'KSB Detailed Breakdown' }).closest('section')!;
    return {
      cards: ['Actual','Target Hours','Planned','Hours Remaining','OTJH Progress','Total KSBs','Achieved KSBs','Remaining KSBs']
        .map(label => screen.getByText(label).parentElement!.textContent),
      categories: ['Knowledge','Skills','Behaviours'].map(category => within(section as HTMLElement).getByText(category).closest('[data-category]')!.textContent),
      points: within(screen.getByRole('region', { name: 'Off-the-job hours by month' })).getAllByRole('button').map(point => point.getAttribute('aria-label')),
    };
  };
  const legacy = render(<ProgressTab data={oldData} plan={plan} onViewEvidence={vi.fn()} />);
  await screen.findByRole('table');
  const before = snapshot();
  legacy.unmount();
  render(<Harness />);
  await screen.findByRole('table');
  expect(snapshot()).toEqual(before);
});

it('revalidates after 60 seconds and isolates coach, learner, and evidence-code cache keys', async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  await caseFileSectionRead('coach-a', '101', 'otjh-ksb');
  clock.mockReturnValue(now + 59_999);
  await caseFileSectionRead('coach-a', '101', 'otjh-ksb');
  expect(transport).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(now + 60_000);
  await caseFileSectionRead('coach-a', '101', 'otjh-ksb');
  await caseFileSectionRead('coach-b', '101', 'otjh-ksb');
  await caseFileSectionRead('coach-a', '102', 'otjh-ksb');
  await caseFileSectionRead('coach-a', '101', 'ksb-detail', { code: 'K6' });
  await caseFileSectionRead('coach-a', '101', 'ksb-detail', { code: 'S1' });
  expect(transport).toHaveBeenCalledTimes(6);
});

it('searches only code/description locally and preserves category and status filters', async () => {
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...compact, ksb: { ...compact.ksb, rows: [
    ...compact.ksb.rows,
    { code: 'B4', description: 'Leadership', category: 'Behaviours', status: 'Not Achieved', evidenceCount: 62,
      completed: 0, pointsAchieved: 0, totalPoints: 62, progressPercent: 0 },
  ] } })));
  render(<Harness />);
  await screen.findByRole('table');
  for (const column of ['KSB Code', 'Points Achieved', 'Total Points', 'Progress', 'View']) {
    expect(screen.getByRole('columnheader', { name: new RegExp(column) })).toBeVisible();
  }
  expect(screen.queryByRole('columnheader', { name: 'Category' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(2);
  const search = screen.getByPlaceholderText('Search KSBs by code or description...');
  fireEvent.change(search, { target: { value: 'Leadership' } });
  expect(screen.getByRole('table')).toHaveTextContent('B4');
  expect(screen.getByRole('table')).not.toHaveTextContent('K6');
  fireEvent.change(search, { target: { value: 'k6' } });
  expect(screen.getByRole('table')).toHaveTextContent('K6');
  fireEvent.change(search, { target: { value: 'Selected evidence' } });
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(transport).toHaveBeenCalledTimes(1);
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: /^Behaviours \(/ }));
  expect(screen.getByRole('table')).toHaveTextContent('B4');
  expect(screen.getByRole('table')).not.toHaveTextContent('K6');
  fireEvent.click(screen.getByRole('button', { name: /^All \(/ }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Filter KSB status' }));
  fireEvent.click(screen.getByRole('option', { name: /^Achieved$/ }));
  expect(screen.getByRole('table')).toHaveTextContent('K6');
  expect(screen.getByRole('table')).not.toHaveTextContent('B4');
  expect(transport).toHaveBeenCalledTimes(1);
});

it('shows evidence failures and keeps the list usable for a retry', async () => {
  render(<Harness />);
  await screen.findByRole('table');
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Evidence unavailable' }), { status: 503 }));
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Evidence unavailable');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByRole('dialog');
  expect(transport).toHaveBeenCalledTimes(3);
});

it('card populations and category filters summarize the same distinct code rows', async () => {
  const rows = [
    { code: 'K1', category: 'Knowledge', pointsAchieved: 1 },
    { code: 'S1', category: 'Skills', pointsAchieved: 0 },
    { code: 'S2', category: 'Skills', pointsAchieved: 1 },
    { code: 'B1', category: 'Behaviours', pointsAchieved: 1 },
    { code: 'B2', category: 'Behaviours', pointsAchieved: 0 },
    { code: 'B3', category: 'Behaviours', pointsAchieved: 0 },
  ].map(row => ({ ...row, description: row.code, status: row.pointsAchieved ? 'Achieved' : 'Not Achieved', totalPoints: 2, progressPercent: row.pointsAchieved * 50, completed: 0, evidenceCount: 2 }));
  const categories = [
    { category: 'Knowledge', total: 1, achieved: 1, percent: 100 },
    { category: 'Skills', total: 2, achieved: 1, percent: 50 },
    { category: 'Behaviours', total: 3, achieved: 1, percent: 33.33 },
  ];
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...compact, ksb: { rows, categories, summary: { total: 6, achieved: 3, remaining: 3 } } })));
  render(<Harness />);
  await screen.findByRole('table');
  expect(categories.reduce((sum, category) => sum + category.total, 0)).toBe(6);
  for (const [label, count] of [['Total KSBs', 6], ['Achieved KSBs', 3], ['Remaining KSBs', 3]]) {
    expect(screen.getByText(label).parentElement).toHaveTextContent(String(count));
  }
  const section = screen.getByRole('heading', { name: 'KSB Detailed Breakdown' }).closest('section')!;
  for (const category of categories) {
    expect(within(section as HTMLElement).getByText(category.category).closest('[data-category]')).toHaveTextContent(`${category.achieved} / ${category.total}`);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${category.category} \\(`) }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(category.total + 1);
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(category.total);
  }
  fireEvent.click(screen.getByRole('button', { name: /^All \(/ }));
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7);
  expect(transport).toHaveBeenCalledTimes(1);
});
