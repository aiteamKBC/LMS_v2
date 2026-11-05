import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/progressTransfer';
import ProgressTransfersPage, { TransferRequests } from './page';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: { account: auth } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/api/progressTransfer', () => ({ getTransferRequests: vi.fn(), getTransferReview: vi.fn(), approveTransferRequest: vi.fn() }));
const request: api.AdminTransfer = { requestId: 'R1', learnerId: '7', learnerKind: 'commercial', learnerName: 'Synthetic learner', programme: 'Programme',
  status: 'pending', requestedAt: '2026-10-19T09:00:00Z', approvedAt: null,
  modules: [{ courseRef: 'legacy:50', moduleId: 'M1', oldTitle: 'Original module', newTitle: 'New module', percent: 40, hours: 2 }] };
afterEach(() => { vi.resetAllMocks(); auth.role = 'admin'; });
beforeEach(() => { vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [] }); });

function openChoices(choices: ReturnType<typeof within>) {
  const trigger = choices.getByRole('button', { name: 'Choose component' });
  if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger);
}

describe('admin progress transfers', () => {
  it('shows different-type recommendations without selecting or counting them until the admin chooses', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module', completedTargetIds: ['NATIVE'],
      sources: [{ sourceActivityRef: 'material:7', title: 'Narrated walkthrough', type: 'video', week: 'Week 1', automaticTargetId: null, recommendedTargetId: 'REC' }],
      targets: [
        { componentId: 'REC', title: 'W00 - Narrated walkthrough', type: 'reading', week: 'Week 2', plannedHours: 1 },
        { componentId: 'NATIVE', title: 'Existing reading', type: 'reading', week: 'Week 2', plannedHours: 1 },
      ],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const choices = within(await screen.findByRole('group', { name: 'Match Narrated walkthrough (material:7) in New module' }));
    expect(screen.getByText('Recommended: W00 - Narrated walkthrough')).toBeVisible();
    expect(screen.getByText(/Old LMS: video; new LMS: reading/)).toBeVisible();
    const counts = within(screen.getByRole('region', { name: 'Component counts for New module' }));
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('0');
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('1');
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    openChoices(choices);
    fireEvent.click(choices.getByRole('button', { name: /^Week 2/ }));
    expect(choices.getByText('Recommended')).toBeVisible();
    const option = choices.getByRole('radio', { name: /W00 - Narrated walkthrough/ });
    expect(option).not.toBeChecked();
    expect(choices.queryByRole('radio', { name: /Existing reading/ })).not.toBeInTheDocument();
    fireEvent.click(option);
    expect(confirm).toBeEnabled();
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Manual selection')).toBeInTheDocument();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    fireEvent.click(choices.getByRole('button', { name: 'Clear match' }));
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload component matches' }));
    await waitFor(() => expect(api.getTransferReview).toHaveBeenCalledTimes(2));
    expect(confirm).toBeDisabled();
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('0');
  });
  it('restores request-local matches as editable selections without approving or awarding progress', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module', completedTargetIds: ['NATIVE'],
      sources: [{ sourceActivityRef: 'material:7', title: 'Old video title', type: 'video', week: 'Week 1', automaticTargetId: null, savedTargetId: 'SAVED' }],
      targets: [
        { componentId: 'SAVED', title: 'P1-VID', type: 'video', week: 'Week 2', plannedHours: 1 },
        { componentId: 'NATIVE', title: 'Already completed video', type: 'video', week: 'Week 2', plannedHours: 1 },
      ],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const choices = within(await screen.findByRole('group', { name: 'Match Old video title (material:7) in New module' }));
    expect(choices.getByRole('button', { name: 'Choose component' })).toHaveTextContent('P1-VID');
    expect(screen.getByText('Saved match — review', { selector: 'span' })).toBeVisible();
    const counts = within(screen.getByRole('region', { name: 'Component counts for New module' }));
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('2');
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeEnabled();
    fireEvent.click(choices.getByRole('button', { name: 'Clear match' }));
    expect(confirm).toBeDisabled();
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Reload component matches' }));
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });
  it('shows one old week at a time, supports keyboard and mobile selection, and keeps modules independent', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: ['Week 10', '', 'Week 2', 'Week 1'].map((week, index) => ({
        sourceActivityRef: `material:${index}`, title: `Original ${week || 'unassigned'}`, type: 'reading', week, automaticTargetId: null,
      })),
      targets: [{ componentId: 'DEST', title: 'Destination reading', type: 'reading', week: 'Destination week', plannedHours: 1 }],
    }, {
      moduleId: 'M2', courseRef: 'legacy:51', title: 'Second module',
      sources: [{ sourceActivityRef: 'material:7', title: 'Second module reading', type: 'reading', week: 'Week 1', automaticTargetId: 'AUTO' }],
      targets: [{ componentId: 'AUTO', title: 'Second module reading', type: 'reading', week: 'Week 1', plannedHours: 1 }],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const weeks = within(await screen.findByRole('tablist', { name: 'Old LMS weeks in New module' }));
    const tabs = weeks.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    [/^Week 1 /, /^Week 2 /, /^Week 10 /, /^No week specified /].forEach((name, index) => {
      expect(tabs[index]).toHaveAccessibleName(name);
      expect(tabs[index]).toHaveTextContent('0/1 matched');
    });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('group', { name: /Match Original Week 2 / })).not.toBeInTheDocument();
    const first = within(screen.getByRole('group', { name: /Match Original Week 1 / }));
    openChoices(first);
    fireEvent.click(first.getByRole('button', { name: /^Destination week/ }));
    fireEvent.click(first.getByRole('radio', { name: /Destination reading/ }));
    openChoices(first);
    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Match Original Week 1 / })).not.toBeInTheDocument();
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(screen.getByRole('tabpanel', { name: 'New module: No week specified' })).toBeVisible();
    fireEvent.keyDown(tabs[3], { key: 'Home' });
    expect(within(screen.getByRole('group', { name: /Match Original Week 1 / })).getByRole('button', { name: 'Choose component' })).toHaveTextContent('Destination reading');
    fireEvent.change(screen.getByRole('combobox', { name: 'Week in New module' }), { target: { value: '2' } });
    expect(screen.getByRole('tabpanel', { name: 'New module: Week 10' })).toBeVisible();
    const selected = within(screen.getByRole('tabpanel', { name: 'New module: Week 10' }));
    fireEvent.click(selected.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('tabpanel', { name: 'New module: No week specified' })).toHaveFocus();
    expect(within(screen.getByRole('tabpanel', { name: 'New module: No week specified' })).getByRole('button', { name: 'Next week' })).toBeDisabled();
    const other = within(screen.getByRole('tablist', { name: 'Old LMS weeks in Second module' }));
    expect(other.getByRole('tab')).toHaveAttribute('aria-selected', 'true');
    expect(other.getByRole('tab')).toHaveTextContent('1/1 matched');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('keeps many weeks inside a closed selector, dismisses the picker before the modal and preserves the match', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [
        { sourceActivityRef: 'material:7', title: 'Module overview', type: 'reading', week: 'Week 1', automaticTargetId: null },
        { sourceActivityRef: 'material:8', title: 'Unrelated legacy exercise', type: 'reading', week: 'Week 1', automaticTargetId: null },
      ],
      targets: Array.from({ length: 30 }, (_, i) => ({ componentId: `T${i}`, title: i === 29 ? 'Module overview' : `Topic ${i + 1}`,
        type: 'reading', week: `Week ${i + 1}`, plannedHours: 1 })),
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const first = within(await screen.findByRole('group', { name: 'Match Module overview (material:7) in New module' }));
    const second = within(screen.getByRole('group', { name: 'Match Unrelated legacy exercise (material:8) in New module' }));
    expect(screen.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Choose component' })).toHaveAccessibleDescription('Module overview Week 30');
    openChoices(first);
    expect(first.getAllByRole('button', { expanded: false })).toHaveLength(29);
    expect(first.getByRole('radio', { name: /Module overview/ })).toBeChecked();
    expect(first.getByRole('radio', { name: /Module overview/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Choose component' })).toHaveFocus();
    openChoices(first);
    openChoices(second);
    expect(first.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Components by week' })).toHaveLength(1);
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Component matching' }));
    expect(screen.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    vi.spyOn(screen.getByRole('dialog'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 800));
    const triggerBounds = vi.spyOn(first.getByRole('button', { name: 'Choose component' }), 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 200, 300, 60));
    openChoices(first);
    expect(first.getByRole('radio', { name: /Module overview/ })).toBeChecked();
    triggerBounds.mockReturnValue(new DOMRect(100, 180, 300, 60));
    fireEvent.scroll(screen.getByRole('dialog'));
    expect(first.getByRole('region', { name: 'Components by week' })).toBeVisible();
    expect(first.getByRole('radio', { name: /Module overview/ })).toBeChecked();
    triggerBounds.mockReturnValue(new DOMRect(100, -100, 300, 60));
    fireEvent.scroll(screen.getByRole('dialog'));
    expect(screen.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('preselects names, lets each week expand independently without losing matches, and submits only after confirmation', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockResolvedValue({ ...request, status: 'approved' });
    const title = 'P2-PPT-Project Fundamentals and Value Delivery';
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module', completedTargetIds: ['MATCH', 'ONE'],
      sources: [{ sourceActivityRef: 'material:7', title, type: 'reading', week: 'Week 2', automaticTargetId: null }],
      targets: [
        { componentId: 'TEN', title: 'Budget planning', type: 'reading', week: 'Week 10', plannedHours: 2 },
        { componentId: 'MATCH', title: 'Project fundamentals & value delivery', type: 'reading', week: 'Week 2', plannedHours: 1.5 },
        { componentId: 'ONE', title: 'Introduction', type: 'reading', week: 'Week 1', plannedHours: 1 },
        { componentId: 'NONE', title: 'Extra reading', type: 'reading', week: '', plannedHours: null },
      ],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const choices = within(await screen.findByRole('group', { name: `Match ${title} (material:7) in New module` }));
    expect(choices.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    expect(choices.getByRole('button', { name: 'Choose component' })).toHaveTextContent('Project fundamentals & value delivery');
    openChoices(choices);
    expect(choices.getByRole('radio', { name: /Project fundamentals/ })).toBeChecked();
    const closedWeeks = choices.getAllByRole('button', { expanded: false });
    expect(closedWeeks).toHaveLength(3);
    expect(closedWeeks[0]).toHaveAccessibleName('Week 1 1 component');
    expect(closedWeeks[1]).toHaveAccessibleName('Week 10 1 component');
    expect(closedWeeks[2]).toHaveAccessibleName('No week specified 1 component');
    const weekTwo = choices.getByRole('button', { name: /^Week 2 / });
    const weekTen = choices.getByRole('button', { name: /^Week 10 / });
    expect(weekTwo).toHaveAttribute('aria-expanded', 'true');
    expect(choices.queryByRole('radio', { name: /Budget planning/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel', { name: 'New module: Week 2' })).getByRole('heading', { name: 'Week 2' })).toBeVisible();
    expect(screen.getByText(/^Matched components — quick review/).closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/^Matched components — quick review/));
    const matched = within(screen.getByRole('table', { name: 'Matched components review' }));
    expect(matched.getByText(title)).toBeVisible();
    expect(matched.getByText('Project fundamentals & value delivery')).toBeVisible();
    expect(matched.getByText('Matched by name — review')).toBeVisible();
    expect(screen.getByText(/Saved matches and name matches are already selected for transfer/)).toBeVisible();
    const counts = within(screen.getByRole('region', { name: 'Component counts for New module' }));
    expect(counts.getByText('Total components').parentElement).toHaveTextContent('4');
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('2');
    expect(counts.getByText('Remaining components').parentElement).toHaveTextContent('2');
    expect(counts.getByText('Progress after merge (preview): 50%')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Old LMS progress' })).toBeVisible();
    expect(screen.getByText(/their group membership does not change/)).toBeVisible();
    expect(screen.getByText('Old LMS course: 50')).toBeVisible();
    expect(screen.getByText('New LMS module: M1')).toBeVisible();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeEnabled();
    fireEvent.click(weekTen);
    expect(choices.getByRole('radio', { name: /Budget planning/ })).toBeVisible();
    expect(weekTwo).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(weekTwo);
    expect(weekTwo).toHaveAttribute('aria-expanded', 'false');
    expect(choices.queryByRole('radio', { name: /Project fundamentals/ })).not.toBeInTheDocument();
    expect(choices.getByText('Project fundamentals & value delivery')).toBeVisible();
    expect(confirm).toBeEnabled();
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('1');
    fireEvent.click(choices.getByRole('button', { name: 'Clear match' }));
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole('table', { name: 'Matched components review' })).not.toBeInTheDocument();
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('0');
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('2');
    openChoices(choices);
    fireEvent.click(choices.getByRole('button', { name: /^Week 10 / }));
    fireEvent.click(choices.getByRole('radio', { name: /Budget planning/ }));
    expect(choices.queryByRole('region', { name: 'Components by week' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Matched components — quick review/));
    expect(screen.getByText('Manual selection')).toBeVisible();
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('3');
    expect(counts.getByText('Remaining components').parentElement).toHaveTextContent('1');
    openChoices(choices);
    fireEvent.click(choices.getByRole('button', { name: /^Week 2 / }));
    fireEvent.click(choices.getByRole('radio', { name: /Project fundamentals/ }));
    openChoices(choices);
    fireEvent.click(choices.getByRole('button', { name: /^Week 10 / }));
    expect(choices.getByRole('radio', { name: /Budget planning/ })).not.toBeChecked();
    fireEvent.click(choices.getByRole('button', { name: /^No week specified/ }));
    expect(choices.getByRole('radio', { name: /Extra reading/ })).toBeVisible();
    expect(choices.getByRole('radio', { name: /Project fundamentals/ })).toBeChecked();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf', {
      reviewToken: 'review', mappings: [{ moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'MATCH' }],
    }));
    expect(await screen.findByText(/Progress merged successfully/)).toBeVisible();
    await waitFor(() => expect(api.getTransferRequests).toHaveBeenCalledTimes(2));
  });

  it('shows saved counts for approved transfers and leaves older unknown counts explicit', async () => {
    const approved: api.AdminTransfer = { ...request, status: 'approved', approvedAt: '2026-10-27T10:00:00Z', modules: [
      { ...request.modules[0], mergedPercent: 41.67, componentCounts: { total: 12, matched: 3, completed: 5, remaining: 7 } },
      { ...request.modules[0], moduleId: 'M2', courseRef: 'legacy:51', newTitle: 'Earlier module' },
    ] };
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [approved], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    const counts = within(screen.getByRole('region', { name: 'Component counts for New module' }));
    expect(counts.getByText('Total components').parentElement).toHaveTextContent('12');
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('3');
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('5');
    expect(counts.getByText('Remaining components').parentElement).toHaveTextContent('7');
    expect(counts.getByText('Progress at merge: 41.67%')).toBeVisible();
    expect(counts.getByText(/Recorded when this transfer was approved/)).toBeVisible();
    expect(screen.getByText('Component counts were not recorded for this earlier transfer.')).toBeVisible();
    expect(api.getTransferReview).not.toHaveBeenCalled();
  });

  it('offers name matching without requiring source or target content', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [{ sourceActivityRef: 'material:7', title: 'Old quiz', type: 'quiz', week: '', automaticTargetId: null,
        contentAvailable: false, contentScores: [{ componentId: 'A', score: null, contentAvailable: true }, { componentId: 'B', score: null, contentAvailable: false }] }],
      targets: ['A', 'B'].map(componentId => ({ componentId, title: `Quiz ${componentId}`, type: 'quiz', week: '', plannedHours: null })),
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const choices = within(await screen.findByRole('group', { name: 'Match Old quiz (material:7) in New module' }));
    openChoices(choices);
    fireEvent.click(choices.getByRole('button', { name: /^No week specified/ }));
    expect(screen.getByText(/Similar names are suggested for your review/)).toBeVisible();
    expect(choices.getByRole('radio', { name: /Quiz A/ })).toBeEnabled();
    expect(choices.getByRole('radio', { name: /Quiz B/ })).toBeEnabled();
    expect(choices.queryByText(/unavailable/)).not.toBeInTheDocument();
    expect(choices.queryByText('Recommended')).not.toBeInTheDocument();
  });

  it('leaves competing sources unselected, scopes suggestions to the module and updates reserved options', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    const title = 'Project Fundamentals and Value Delivery';
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [7, 8].map(id => ({ sourceActivityRef: `material:${id}`, title, type: 'quiz', week: '', automaticTargetId: null, contentAvailable: true, contentScores: [{ componentId: 'A', score: 0.95 }, { componentId: 'B', score: 0.1 }] })),
      targets: [
        { componentId: 'B', title: 'Programme overview', type: 'quiz', week: '', plannedHours: null },
        { componentId: 'A', title, type: 'quiz', week: '', plannedHours: null },
        { componentId: 'WRONG', title, type: 'reading', week: '', plannedHours: null },
      ],
    }, {
      moduleId: 'M2', courseRef: 'legacy:51', title: 'Other module', sources: [],
      targets: [{ componentId: 'OTHER', title, type: 'quiz', week: '', plannedHours: null }],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const first = within(await screen.findByRole('group', { name: `Match ${title} (material:7) in New module` }));
    const second = within(screen.getByRole('group', { name: `Match ${title} (material:8) in New module` }));
    openChoices(first);
    fireEvent.click(first.getByRole('button', { name: /^No week specified/ }));
    expect(second.getByRole('button', { name: 'Choose component' })).toHaveAttribute('aria-expanded', 'false');
    expect(first.getAllByRole('radio').map(option => (option as HTMLInputElement).value)).toEqual(['A', 'B']);
    expect(first.getByRole('radio', { name: /Recommended/ })).toHaveAttribute('value', 'A');
    expect(first.getByRole('radio', { name: /Recommended/ })).not.toBeChecked();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    fireEvent.click(first.getByRole('radio', { name: /quiz · A/ }));
    expect(first.getByRole('button', { name: 'Choose component' })).toHaveTextContent(title);
    openChoices(second);
    fireEvent.click(second.getByRole('button', { name: /^No week specified/ }));
    expect(second.getByRole('radio', { name: /quiz · A/ })).not.toBeChecked();
    expect(second.queryByText('Recommended')).not.toBeInTheDocument();
    expect(second.getByRole('radio', { name: /quiz · A/ })).toBeDisabled();
    fireEvent.click(second.getByRole('radio', { name: /quiz · B/ }));
    fireEvent.click(first.getByRole('button', { name: 'Clear match' }));
    openChoices(second);
    expect(second.getByRole('radio', { name: /Recommended/ })).toHaveAttribute('value', 'A');
    expect(second.getByRole('radio', { name: /quiz · B/ })).toBeChecked();
  });

  it('requires review then Confirm, and reloads only after success', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce({ requests: [request], nextOffset: null, csrfToken: 'csrf' })
      .mockResolvedValue({ requests: [{ ...request, status: 'approved', approvedAt: '2026-10-19T10:00:00Z' }], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockResolvedValue({ ...request, status: 'approved' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByText('Synthetic learner')).toBeVisible();
    const pending = within(screen.getByRole('table', { name: 'Pending requests' }));
    expect(pending.getByText('Synthetic learner')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Original module')).toBeVisible();
    expect(dialog.getByText('New module')).toBeVisible();
    expect(dialog.getByText('40%')).toBeVisible();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Progress merged successfully/)).toBeVisible();
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Approved requests' })).getByText('Synthetic learner')).toBeVisible());
    expect(pending.queryByText('Synthetic learner')).not.toBeInTheDocument();
    expect(screen.getByText('No pending requests')).toBeVisible();
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf', { reviewToken: 'review', mappings: [] });
  });

  it('does not announce a merge while approval is pending or returns an unapproved request', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    let finish!: (value: api.ProgressTransferRequest) => void;
    vi.mocked(api.approveTransferRequest).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.queryByText(/Progress merged successfully/)).not.toBeInTheDocument();
    finish(request);
    expect(await screen.findByRole('alert')).toHaveTextContent('The merge was not confirmed');
    expect(screen.queryByText(/Progress merged successfully/)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('keeps the request pending on approval failure', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Mapping changed.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeEnabled());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mapping changed.');
    expect(screen.getByText('Pending approval')).toBeVisible();
    expect(screen.queryByText(/Progress merged successfully/)).not.toBeInTheDocument();
  });

  it('separates pending and approved requests and opens approved details without a Confirm action', async () => {
    const approved: api.AdminTransfer = {
      ...request, requestId: 'R2', learnerName: 'Approved learner', status: 'approved', approvedAt: '2026-10-20T10:00:00Z',
      modules: [...request.modules, { ...request.modules[0], courseRef: 'legacy:51', oldTitle: 'Second original', newTitle: 'Second current', demoProgress: true }],
    };
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [approved, request], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    const pendingTable = within(await screen.findByRole('table', { name: 'Pending requests' }));
    const approvedTable = within(screen.getByRole('table', { name: 'Approved requests' }));
    expect(pendingTable.getByText('Synthetic learner')).toBeVisible();
    expect(pendingTable.queryByText('Approved learner')).not.toBeInTheDocument();
    expect(approvedTable.getByText('Approved learner')).toBeVisible();
    expect(approvedTable.queryByText('Synthetic learner')).not.toBeInTheDocument();
    expect(approvedTable.getByText('2 modules')).toBeVisible();
    expect(approvedTable.getByText('Demo progress')).toBeVisible();
    expect(approvedTable.queryByRole('button', { name: 'Review transfer' })).not.toBeInTheDocument();
    fireEvent.click(approvedTable.getByRole('button', { name: 'View details' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Second original')).toBeVisible();
    expect(within(dialog.getByRole('table', { name: 'Module transfer details' })).getByText('Second current')).toBeVisible();
    expect(dialog.getByText(/old LMS percentage and hours saved before the merge/)).toBeVisible();
    expect(dialog.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByText('Close', { selector: 'button' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('keeps both table headings and useful empty states when there are no requests', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByRole('table', { name: 'Pending requests' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Approved requests' })).toBeVisible();
    expect(screen.getByText('No pending requests')).toBeVisible();
    expect(screen.getByText('No approved requests yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review transfer' })).not.toBeInTheDocument();
  });

  it('groups later pages without losing or duplicating loaded requests', async () => {
    const approved = { ...request, requestId: 'R2', learnerName: 'Approved learner', status: 'approved' as const, approvedAt: '2026-10-20T10:00:00Z' };
    vi.mocked(api.getTransferRequests)
      .mockResolvedValueOnce({ requests: [request], nextOffset: 20, csrfToken: 'csrf' })
      .mockResolvedValueOnce({ requests: [request, approved], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Approved learner')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Pending requests' })).getAllByText('Synthetic learner')).toHaveLength(1);
    expect(within(screen.getByRole('table', { name: 'Approved requests' })).getAllByText('Approved learner')).toHaveLength(1);
    expect(api.getTransferRequests).toHaveBeenLastCalledWith(20);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows a failed initial load without suggesting there are no requests', async () => {
    vi.mocked(api.getTransferRequests).mockRejectedValue(new Error('Requests unavailable.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Requests unavailable.');
    expect(screen.queryByText('No pending requests')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it.each(['learner', 'staff', 'employer'])('does not load admin data for %s', role => {
    auth.role = role;
    render(<MemoryRouter><ProgressTransfersPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Only administrators');
    expect(api.getTransferRequests).not.toHaveBeenCalled();
    expect(api.getTransferReview).not.toHaveBeenCalled();
  });

  it('requires every manual match, prevents duplicate destinations and shows planned hours without changing actual credit', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'scoped-review', csrfToken: 'review-csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [
        { sourceActivityRef: 'material:7', title: 'Original reading', type: 'reading', week: 'Week 1', automaticTargetId: null },
        { sourceActivityRef: 'material:8', title: 'Another reading', type: 'reading', week: 'Week 2', automaticTargetId: null },
        { sourceActivityRef: 'material:9', title: 'Automatic reading', type: 'reading', week: 'Week 3', automaticTargetId: 'AUTO' },
      ], targets: ['A', 'B', 'AUTO'].map(componentId => ({ componentId, title: `New reading ${componentId}`, type: 'reading', week: 'Week 1', plannedHours: 1.5 })),
    }] });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Component matches changed.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByText(/2 completed old components need a match/)).toBeVisible();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    const first = within(screen.getByRole('group', { name: 'Match Original reading (material:7) in New module' }));
    expect(screen.queryByRole('group', { name: 'Match Another reading (material:8) in New module' })).not.toBeInTheDocument();
    const weeks = within(screen.getByRole('tablist', { name: 'Old LMS weeks in New module' }));
    expect(weeks.getByRole('tab', { name: /^Week 3 / })).toHaveTextContent('1/1 matched');
    openChoices(first);
    fireEvent.click(first.getByRole('button', { name: /^Week 1/ }));
    expect(first.getByRole('radio', { name: /New reading AUTO/ })).toBeDisabled();
    fireEvent.click(first.getByRole('radio', { name: /reading · A(?: |$)/ }));
    expect(screen.getByText(/New component planned hours: 1h 30m/)).toHaveTextContent('Actual transferred hours are unchanged.');
    expect(weeks.getByRole('tab', { name: /^Week 1 / })).toHaveTextContent('1/1 matched');
    expect(confirm).toBeDisabled(); // An unvisited week still requires its match.
    fireEvent.click(screen.getByRole('button', { name: 'Next unmatched week' }));
    expect(screen.getByRole('tabpanel', { name: 'New module: Week 2' })).toHaveFocus();
    const second = within(screen.getByRole('group', { name: 'Match Another reading (material:8) in New module' }));
    openChoices(second);
    fireEvent.click(second.getByRole('button', { name: /^Week 1/ }));
    expect(second.getByRole('radio', { name: /reading · A(?: |$)/ })).toBeDisabled();
    expect(confirm).toBeDisabled();
    fireEvent.click(second.getByRole('radio', { name: /reading · B/ }));
    expect(weeks.getByRole('tab', { name: /^Week 2 / })).toHaveTextContent('1/1 matched');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('Component matches changed.');
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    const restored = within(screen.getByRole('group', { name: 'Match Original reading (material:7) in New module' }));
    expect(restored.getByRole('button', { name: 'Choose component' })).toHaveTextContent('New reading A');
    expect(api.approveTransferRequest).toHaveBeenCalledWith('R1', 'review-csrf', { reviewToken: 'scoped-review', mappings: [
      { moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'A' },
      { moduleId: 'M1', sourceActivityRef: 'material:8', targetComponentId: 'B' },
    ] });
  });

  it('keeps matches and weeks locked during approval and restores them after a failed save', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [{ sourceActivityRef: 'material:7', title: 'Cost planning', type: 'reading', week: 'Week 1', automaticTargetId: null }],
      targets: [{ componentId: 'COST', title: 'Cost planning', type: 'reading', week: 'Week 2', plannedHours: 1 }],
    }] });
    let rejectSave!: (reason: Error) => void;
    vi.mocked(api.approveTransferRequest).mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const choices = within(await screen.findByRole('group', { name: 'Match Cost planning (material:7) in New module' }));
    openChoices(choices);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(choices.getByRole('button', { name: /^Week 2/ })).toBeDisabled();
    expect(choices.getByRole('button', { name: 'Clear match' })).toBeDisabled();
    expect(choices.getByRole('button', { name: 'Choose component' })).toBeDisabled();
    expect(choices.getByRole('radio')).toBeDisabled();
    expect(screen.getByRole('tab', { name: /^Week 1 / })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Week in New module' })).toBeDisabled();
    rejectSave(new Error('Please review this request again.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please review this request again.');
    expect(choices.getByRole('radio')).toBeEnabled();
    expect(screen.getByRole('tab', { name: /^Week 1 / })).toBeEnabled();
    expect(choices.getByRole('radio')).toBeChecked();
    expect(choices.getByRole('button', { name: /^Week 2/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('explains missing compatible components and keeps approval blocked', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [{ sourceActivityRef: 'material:7', title: 'Budget activity', type: 'quiz', week: '', automaticTargetId: null }],
      targets: [{ componentId: 'WRONG', title: 'Budget activity', type: 'reading', week: 'Week 1', plannedHours: 1 }],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByText(/No compatible component is available/)).toBeVisible();
    const choices = within(screen.getByRole('group', { name: 'Match Budget activity (material:7) in New module' }));
    expect(choices.queryByRole('button', { name: /^Week 1/ })).not.toBeInTheDocument();
    expect(choices.queryByRole('radio')).not.toBeInTheDocument();
    expect(choices.getByRole('button', { name: 'Clear match' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('keeps confirmation disabled if matching cannot load and permits a retry', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockRejectedValueOnce(new Error('Matching unavailable.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Matching unavailable.');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry matching' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeEnabled());
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });
});
