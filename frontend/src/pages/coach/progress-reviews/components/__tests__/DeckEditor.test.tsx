import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeckEditableFields } from '@/api/progressReviews';

const fetchDeckEditableFields = vi.fn();
const saveDeckEdits = vi.fn();

vi.mock('@/api/progressReviews', async () => {
  const actual = await vi.importActual<typeof import('@/api/progressReviews')>('@/api/progressReviews');
  return {
    ...actual,
    fetchDeckEditableFields: (...args: unknown[]) => fetchDeckEditableFields(...args),
    saveDeckEdits: (...args: unknown[]) => saveDeckEdits(...args),
  };
});

const { default: DeckEditor } = await import('../DeckEditor');

const FIELDS: DeckEditableFields = {
  kind: 'mcm',
  revisionSource: 'generated',
  learner: { full_name: 'Aya Aya Test', programme: 'Final Test', employer: 'Old Co', manager_name: null, coach: 'Coach' },
  attendance: { attendance_percentage: 22, engagement_notes: null },
  progress: { current_programme_progress_percentage: 8, target_progress_percentage: 12, next_module: null },
  otj: { completed_otj_hours: 74.7, required_otj_hours_to_date: 297.8, risk_status: 'At risk' },
  evidence_photo_slots: 4,
  evidence: [{ ref: 'assignments:0', evidence_title: 'Plan', evidence_summary: null, evidence_date: '2026-09-10', ksb_mappings: ['K1'], image_ref: null }],
  priority_ksbs: [],
  actions: [],
};

beforeEach(() => {
  fetchDeckEditableFields.mockReset();
  saveDeckEdits.mockReset();
});

describe('DeckEditor', () => {
  it('saves the corrected fields as a new version and hands back its id', async () => {
    fetchDeckEditableFields.mockResolvedValue(FIELDS);
    saveDeckEdits.mockResolvedValue({ reviewId: 'run-2' });
    const onSaved = vi.fn();
    render(<DeckEditor reviewId="run-1" title="Edit" onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(await screen.findByDisplayValue('Old Co'), { target: { value: 'New Co' } });
    fireEvent.click(screen.getByRole('button', { name: /Save and regenerate/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('run-2'));
    const [reviewId, edits] = saveDeckEdits.mock.calls[0];
    expect(reviewId).toBe('run-1');
    expect(edits.learner.employer).toBe('New Co');
    expect(edits).not.toHaveProperty('kind');
    expect(edits).not.toHaveProperty('revisionSource');
    expect(edits).not.toHaveProperty('evidence_photo_slots');
  });

  it('warns that a form save replaces changes made in PowerPoint', async () => {
    fetchDeckEditableFields.mockResolvedValue({ ...FIELDS, revisionSource: 'uploaded' });
    render(<DeckEditor reviewId="run-1" title="Edit" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText(/uploaded from PowerPoint/)).toBeVisible();
  });

  it('shows the server reason when an edit is refused', async () => {
    fetchDeckEditableFields.mockResolvedValue(FIELDS);
    saveDeckEdits.mockRejectedValue(new Error('Attendance % must be between 0 and 100.'));
    render(<DeckEditor reviewId="run-1" title="Edit" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Save and regenerate/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance % must be between 0 and 100.');
  });
});
