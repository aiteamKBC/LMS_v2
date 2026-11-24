import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackFinding } from '@/api/qaFindings';
import QAFindingsPage from './page';

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), response: vi.fn() }));
vi.mock('@/api/qaFindings', () => ({ qaFindingsApi: { list: mocks.list, update: mocks.update } }));
vi.mock('@/api/feedback', () => ({ feedbackApi: { response: mocks.response } }));
vi.mock('@/features/feedback/FormRenderer', () => ({ FormRenderer: () => <div>Saved original answers</div> }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/feature/WorkspaceHeroBanner', () => ({ WorkspaceHeroBanner: ({ title }: { title: string }) => <h1>{title}</h1> }));

const negative: FeedbackFinding = {
  id: 11, formId: 4, formTitle: 'Synthetic form', formType: 'post_lecture', title: 'Synthetic session',
  category: 'Synthetic form', severity: 'Critical', classification: 'negative', status: 'Open',
  raisedBy: 'Feedback response', respondent: 'Synthetic learner', groupName: 'Group A',
  submittedAt: '2026-10-20T10:00:00Z', score: 25, version: 0, actionPlan: '', owner: '',
  dueDate: null, updatedBy: '', updatedAt: null,
};
const neutral: FeedbackFinding = { ...negative, id: 12, title: 'Second session', severity: 'Major', classification: 'neutral', score: 60 };

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ findings: [negative, neutral] });
  mocks.update.mockReset().mockImplementation(async (_id: number, patch: Record<string, unknown>) => ({
    ...negative, ...patch, version: 1,
  }));
  mocks.response.mockReset().mockResolvedValue({ response: { id: 11, sections: [] } });
});
afterEach(cleanup);

describe('QA feedback findings', () => {
  it('shows live Neutral and Negative findings and filters by severity and status', async () => {
    const user = userEvent.setup();
    render(<QAFindingsPage />);
    expect(await screen.findByText('Synthetic session')).toBeInTheDocument();
    expect(screen.getByText('Second session')).toBeInTheDocument();
    expect(screen.queryByText('Inconsistent KSB Assessment Criteria')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Critical' }));
    expect(screen.getByText('Synthetic session')).toBeInTheDocument();
    expect(screen.queryByText('Second session')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByText('No findings match these filters.')).toBeInTheDocument();
  });

  it('saves action progress and details, and opens original answers', async () => {
    const user = userEvent.setup();
    render(<QAFindingsPage />);
    await screen.findByText('Synthetic session');
    await user.click(screen.getAllByRole('button', { name: 'Start Action' })[0]);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(11, { expectedVersion: 0, status: 'In Progress' }));
    expect(await screen.findByRole('button', { name: 'Mark Resolved' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'View Details' })[0]);
    expect(await screen.findByText('Saved original answers')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Action Plan'), 'Follow up with learner');
    await user.type(screen.getByLabelText('Owner'), 'QA staff');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith(11, {
      expectedVersion: 1, actionPlan: 'Follow up with learner', owner: 'QA staff', dueDate: null,
    }));
  });

  it('shows API failure without sample findings', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Finding service unavailable'));
    render(<QAFindingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Finding service unavailable');
    expect(screen.queryByText('Synthetic session')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Synthetic session')).toBeInTheDocument();
  });
});
