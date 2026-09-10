import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchClassifiedLearners = vi.fn();
const fetchLearnerAssignments = vi.fn();
const setAssignmentSelection = vi.fn();
const updateAssignmentKsbCodes = vi.fn();
vi.mock('@/api/adminEvidence', () => ({
  fetchClassifiedLearners: (...args: unknown[]) => fetchClassifiedLearners(...args),
  fetchLearnerAssignments: (...args: unknown[]) => fetchLearnerAssignments(...args),
  setAssignmentSelection: (...args: unknown[]) => setAssignmentSelection(...args),
  updateAssignmentKsbCodes: (...args: unknown[]) => updateAssignmentKsbCodes(...args),
}));
vi.mock('../_shared/AdminPage', () => ({
  AdminPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  DataPanel: ({ loading, error, empty, emptyMessage, children }: { loading: boolean; error: string | null; empty?: boolean; emptyMessage?: string; children: React.ReactNode }) =>
    loading ? <p>Loading evidence</p> : error ? <p>{error}</p> : empty ? <p>{emptyMessage}</p> : <>{children}</>,
  Pager: () => null,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

const EvidencePage = (await import('./page')).default;

beforeEach(() => {
  vi.stubGlobal('AppIcon', ({ className }: { className?: string }) => <i className={className} />);
  fetchClassifiedLearners.mockReset();
  fetchLearnerAssignments.mockReset();
  setAssignmentSelection.mockReset();
  updateAssignmentKsbCodes.mockReset();
});

describe('Super Admin Evidence page', () => {
  it('opens the selected learner summary from its icon and restores focus on close', async () => {
    const summary = 'Three workplace assignments selected.\nThe full portfolio summary remains readable without truncation.';
    const learners = [
      { learnerId: 42, fullName: 'Alex', programme: 'Marketing', portfolioSummary: summary },
      { learnerId: 43, fullName: 'Sam', programme: 'Project Controls', portfolioSummary: 'Sam has a different summary.' },
    ].map(learner => ({ ...learner, assignmentsFound: 3, uniqueAssignmentsEvaluated: 3, assignmentsSelected: 2, portfolioReadiness: 'ready' }));
    fetchClassifiedLearners.mockResolvedValue({ count: 2, page: 1, pageSize: 25, results: learners, programmes: [] });
    render(<MemoryRouter><EvidencePage /></MemoryRouter>);
    const trigger = await screen.findByRole('button', { name: 'View portfolio summary for Alex' });
    expect(screen.queryByText(/Three workplace assignments/)).not.toBeInTheDocument();
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Portfolio summary' });
    expect(within(dialog).getByRole('heading', { name: 'Alex' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Three workplace assignments/).textContent).toBe(summary);
    expect(within(dialog).queryByText('Sam has a different summary.')).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'View portfolio summary for Sam' }));
    expect(within(screen.getByRole('dialog')).getByText('Sam has a different summary.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchLearnerAssignments).not.toHaveBeenCalled();
  });

  it('disables the summary icon when no summary is available', async () => {
    fetchClassifiedLearners.mockResolvedValue({ count: 1, page: 1, pageSize: 25, programmes: [], results: [{
      learnerId: 42, fullName: 'Alex', programme: 'Marketing', portfolioSummary: '   ',
      assignmentsFound: 0, uniqueAssignmentsEvaluated: 0, assignmentsSelected: 0, portfolioReadiness: 'not_ready',
    }] });
    render(<MemoryRouter><EvidencePage /></MemoryRouter>);
    const trigger = await screen.findByRole('button', { name: 'No portfolio summary available for Alex' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['mouse', 'keyboard'])('suggests matching learners while typing and selects with %s', async method => {
    const learner = {
      learnerId: 42, fullName: 'Aaron Chesworth', programme: 'Marketing',
      assignmentsFound: 7, uniqueAssignmentsEvaluated: 3, assignmentsSelected: 0,
      portfolioReadiness: 'not_ready', portfolioSummary: '',
    };
    fetchClassifiedLearners.mockImplementation(async ({ q }: { q?: string }) => ({
      count: q ? 1 : 0, page: 1, pageSize: 25, results: q ? [learner] : [], programmes: ['Marketing'],
    }));
    render(<MemoryRouter><EvidencePage /></MemoryRouter>);
    const input = screen.getByRole('combobox', { name: 'Learner' });
    fireEvent.change(input, { target: { value: 'ar' } });
    expect(screen.getByText('Searching learners...')).toBeInTheDocument();
    const option = await screen.findByRole('option', { name: /Aaron Chesworth/ });
    if (method === 'mouse') fireEvent.click(option);
    else {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', option.id);
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(input).toHaveValue('Aaron Chesworth');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(fetchClassifiedLearners).toHaveBeenLastCalledWith({ q: 'Aaron Chesworth', page: 1, pageSize: 25 }));
  });

  it('closes suggestions with Escape and hides stale names during a new search', async () => {
    fetchClassifiedLearners.mockResolvedValue({ count: 0, page: 1, pageSize: 25, results: [], programmes: [] });
    render(<MemoryRouter><EvidencePage /></MemoryRouter>);
    const input = screen.getByRole('combobox', { name: 'Learner' });
    fireEvent.change(input, { target: { value: 'unknown' } });
    expect(await screen.findByText('No matching learners.')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Suggested learners' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'new name' } });
    expect(screen.getByText('Searching learners...')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('applies all visible column filters except summary and clears them', async () => {
    fetchClassifiedLearners.mockResolvedValue({ count: 0, page: 1, pageSize: 25, results: [], programmes: ['Marketing', 'Project Controls'] });
    render(<MemoryRouter><EvidencePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Learner'), { target: { value: 'Alex' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Programme' })).toBeEnabled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Programme' }));
    expect(await screen.findByRole('option', { name: 'Project Controls' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search programmes...'), { target: { value: 'Marketing' } });
    expect(screen.queryByRole('option', { name: 'Project Controls' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Marketing' }));
    expect(screen.queryByLabelText('Found')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Evaluated')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Selected')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Readiness' }));
    fireEvent.click(screen.getByRole('option', { name: 'Not ready' }));
    expect(screen.queryByRole('button', { name: 'Apply filters' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchClassifiedLearners).toHaveBeenLastCalledWith({
      q: 'Alex', programme: 'Marketing',
      portfolioReadiness: 'not_ready', page: 1, pageSize: 25,
    }));
    expect(screen.queryByLabelText('Portfolio summary')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(fetchClassifiedLearners).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 }));
    expect(screen.getByLabelText('Learner')).toHaveValue('');
  });
  function assignmentPage(selected = false) {
    return {
      learner: { learnerId: 42, fullName: 'Alex', programme: 'Marketing', runId: 9, portfolioReadiness: 'not_ready' },
      count: 1, page: 1, pageSize: 20,
      results: [{
        evidenceId: 100, componentId: 200, evidenceName: 'Assignment.docx', componentName: 'Marketing',
        assignmentDate: null, rank: selected ? 1 : null, finalScore: 39, selected, manuallySelected: selected,
        classification: 'unsuitable', auditReadiness: 'ready_with_check', verifiedKsbCodes: [],
        keyStrengths: [], weaknesses: [], risks: [], filePreviewPath: null, reportPreviewPath: null,
      }],
    };
  }

  function renderDetail() {
    render(<MemoryRouter initialEntries={['/admin/evidence/42']}><Routes><Route path="/admin/evidence/:learnerId" element={<EvidencePage />} /></Routes></MemoryRouter>);
  }

  it('renders readable strengths lists, separate KSB chips and green scores from 80', async () => {
    const payload = assignmentPage(true);
    fetchLearnerAssignments.mockResolvedValue({
      ...payload,
      learner: { ...payload.learner, portfolioSummary: 'A clear portfolio overview.' },
      results: [{ ...payload.results[0], finalScore: 80, verifiedKsbCodes: ['K1', 'S2'], keyStrengths: ['Clear workplace example', 'Strong feedback'] }],
    });
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Portfolio overview' })).toBeInTheDocument();
    expect(screen.getByText('Clear workplace example').tagName).toBe('LI');
    expect(screen.getByText('Strong feedback').tagName).toBe('LI');
    expect(screen.getByText('K1')).toBeInTheDocument();
    expect(screen.getByText('S2')).toBeInTheDocument();
    expect(screen.getByText('80%')).toHaveClass('text-green-600');
  });

  it('edits and saves the verified KSB codes', async () => {
    const payload = assignmentPage(true);
    fetchLearnerAssignments.mockResolvedValue({
      ...payload,
      results: [{ ...payload.results[0], verifiedKsbCodes: ['K1', 'S2'] }],
    });
    updateAssignmentKsbCodes.mockResolvedValue({ verifiedKsbCodes: ['K1', 'S3', 'B2'] });
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Quality Marking' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Verified KSB codes'), { target: { value: 'K1, s3 B2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAssignmentKsbCodes).toHaveBeenCalledWith(
      42, 100, 9, 200, ['K1', 'S3', 'B2'],
    ));
    expect(await screen.findByText('S3')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
  });

  it('selects an assignment, reloads persisted state and supports undo', async () => {
    fetchLearnerAssignments.mockResolvedValueOnce(assignmentPage()).mockResolvedValue(assignmentPage(true));
    setAssignmentSelection.mockResolvedValue({ selected: true });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Select assignment' }));
    await waitFor(() => expect(setAssignmentSelection).toHaveBeenCalledWith(42, 100, 9, 200, true));
    expect(await screen.findByText('Manually selected')).toBeInTheDocument();
    expect(screen.getByText('39%')).toBeInTheDocument();
    fetchLearnerAssignments.mockResolvedValue(assignmentPage());
    fireEvent.click(screen.getByRole('button', { name: 'Unselect' }));
    await waitFor(() => expect(setAssignmentSelection).toHaveBeenLastCalledWith(42, 100, 9, 200, false));
    expect(await screen.findByRole('button', { name: 'Select assignment' })).toBeInTheDocument();
  });

  it('shows save failures without falsely marking the assignment as selected', async () => {
    fetchLearnerAssignments.mockResolvedValue(assignmentPage());
    setAssignmentSelection.mockRejectedValue(new Error('This portfolio already has 10 selected assignments.'));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Select assignment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already has 10');
    expect(screen.getByText('Not selected')).toBeInTheDocument();
    expect(screen.queryByText('Manually selected')).not.toBeInTheDocument();
  });

  it('unselects a system recommendation and removes it from Recommended', async () => {
    const payload = assignmentPage(true);
    fetchLearnerAssignments.mockResolvedValueOnce({ ...payload, results: [{ ...payload.results[0], manuallySelected: false }] })
      .mockResolvedValue({ ...payload, count: 0, results: [] });
    setAssignmentSelection.mockResolvedValue({ selected: false });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Unselect' }));
    await waitFor(() => expect(setAssignmentSelection).toHaveBeenCalledWith(42, 100, 9, 200, false));
    expect(await screen.findByText('No assignments are currently selected.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unselect' })).not.toBeInTheDocument();
  });

  it('keeps an active learner visible when no completed run exists', async () => {
    fetchClassifiedLearners.mockResolvedValue({
      count: 1, page: 1, pageSize: 25,
      results: [{
        learnerId: 15997, fullName: 'Betty Heaton', programme: 'Marketing Executive L4',
        runId: null, assignmentsFound: 0, uniqueAssignmentsEvaluated: 0,
        assignmentsSelected: 0, portfolioReadiness: 'not_classified',
        selectionStatus: 'not_classified', portfolioSummary: '', humanChecksRequired: 0,
        completedAt: null, hasCompletedRun: false,
      }],
    });
    render(<MemoryRouter initialEntries={['/admin/evidence']}><EvidencePage /></MemoryRouter>);
    expect(await screen.findByText('Betty Heaton')).toBeInTheDocument();
    expect(screen.getAllByText('Not Classified').length).toBeGreaterThan(0);
  });

  it('shows the required empty state for zero recommended assignments', async () => {
    fetchLearnerAssignments.mockResolvedValue({
      learner: {
        learnerId: 42, fullName: 'Alex Learner', programme: 'Marketing L4', runId: 9,
        portfolioReadiness: 'not_ready', selectionStatus: 'fewer_than_10_available',
        portfolioSummary: 'No assignments selected', completedAt: '2026-08-01T00:00:00Z',
      },
      view: 'recommended', sort: 'rank', count: 0, page: 1, pageSize: 20, results: [],
    });
    render(
      <MemoryRouter initialEntries={['/admin/evidence/42']}>
        <Routes><Route path="/admin/evidence/:learnerId" element={<EvidencePage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('No assignments are currently selected.')).toBeInTheDocument();
  });

  it('shows backend failures rather than a blank table', async () => {
    fetchClassifiedLearners.mockRejectedValue(new Error('Could not load assignment classifications.'));
    render(<MemoryRouter initialEntries={['/admin/evidence']}><EvidencePage /></MemoryRouter>);
    expect(await screen.findByText('Could not load assignment classifications.')).toBeInTheDocument();
  });
});
