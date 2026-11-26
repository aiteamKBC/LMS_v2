import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';
import { LearnerReviewInstanceForm } from '../LearnerReviewInstanceForm';

vi.mock('@/features/monthly-logs/page', () => ({ LearnerLogs: () => null }));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({ SignaturePad: () => null }));
afterEach(cleanup);

const definition: LearnerReviewDefinition = {
  source: 'aptem', migratedForm: true, readOnly: true, manualOverride: null,
  instance: { id: 'imported-review:synthetic', reviewTemplateId: '', learnerId: 42, programmeId: 'P-42',
    occurrenceNumber: null, targetDate: '2026-10-04', status: 'completed', startedAt: null, completedAt: '2026-10-04' },
  template: { id: '', name: 'Migrated Progress Review', reviewTypeCode: 'aptem_progress_review',
    signatures: { advisor: true, participant: true, employer: true, referrer: false },
    visibleTo: { advisor: true, participant: true, employer: true, referrer: false },
    recurrence: { interval: 0, unit: 'none' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [{ id: 'summary', title: 'Discussion', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
    { id: 'recap', title: 'Meeting Summary', fieldType: 'text_multiline', required: false, displayOrder: 0,
      configuration: { semanticKey: 'meeting_summary' }, answer: 'Saved coach summary' },
  ] }],
  signatures: { advisor: { required: true, signed: true }, participant: { required: true, signed: true },
    employer: { required: true, signed: true }, referrer: { required: false, signed: false } },
  progressSnapshot: { calculatedFrom: '2025-01-02', calculatedAt: '2026-10-04T10:00:00Z', calculatedBy: 'coach@example.invalid',
    calculationMethod: 'planned_hours', weeksElapsed: 10,
    programmeProgress: { actual: 28, expected: 30, planned: 100, actualPercent: 28, expectedPercent: 30, variancePercent: -2, varianceDirection: 'below' },
    offTheJobHours: { actual: 64, expected: 52, planned: 100, actualPercent: 64, expectedPercent: 52, variancePercent: 12, varianceDirection: 'above' },
    ksbProgress: { available: false, reason: 'No assigned standard', title: '', actualPercent: null, expectedPercent: null, variancePercent: null, varianceDirection: null } },
};

describe('migrated progress for review participants', () => {
  function editable(viewerRole: 'participant' | 'employer'): LearnerReviewDefinition {
    return { ...definition, readOnly: false, answerVersion: 'version-1', instance: { ...definition.instance!, status: 'scheduled' },
      sections: [{ ...definition.sections[0], fields: [definition.sections[0].fields[0],
        { id: 'own', title: 'Your reflection', fieldType: 'text_multiline', required: true, displayOrder: 1,
          configuration: { respondentRoles: [viewerRole] }, answer: 'Earlier draft' },
      ] }] };
  }

  it.each(['participant', 'employer'] as const)('lets %s save draft answers twice with the latest version, without editing coach fields', async viewerRole => {
    const source = editable(viewerRole);
    const save = vi.fn().mockImplementation(async (answers: Record<string, unknown>) => ({ ...source, answerVersion: 'version-2',
      sections: [{ ...source.sections[0], fields: source.sections[0].fields.map(field => field.id === 'own' ? { ...field, answer: answers.own } : field) }] }));
    render(<LearnerReviewInstanceForm definition={source} viewerRole={viewerRole} onSaveAnswers={save} />);
    const own = screen.getByDisplayValue('Earlier draft');
    if (viewerRole === 'employer') expect(screen.getByDisplayValue('Saved coach summary')).toBeDisabled();
    else expect(screen.getByText('Saved coach summary')).toBeVisible();
    expect(own).toBeEnabled();
    fireEvent.change(own, { target: { value: 'My draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ own: 'My draft' }, 'version-1'));
    await waitFor(() => expect(screen.getByDisplayValue('My draft')).toBeEnabled());
    fireEvent.change(screen.getByDisplayValue('My draft'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ own: '' }, 'version-2'));
  });

  it('keeps unsaved text visible when a newer server version rejects the save', async () => {
    const save = vi.fn().mockRejectedValue(new Error('This review changed. Reopen it before saving.'));
    render(<LearnerReviewInstanceForm definition={editable('participant')} onSaveAnswers={save} />);
    const own = screen.getByDisplayValue('Earlier draft');
    fireEvent.change(own, { target: { value: 'Keep this unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    expect(await screen.findByText('This review changed. Reopen it before saving.')).toBeVisible();
    expect(screen.getByDisplayValue('Keep this unsaved draft')).toBeEnabled();
  });

  it.each(['awaiting-signature', 'completed', 'read-only'])('disables respondent editing when %s', status => {
    const source = editable('participant');
    render(<LearnerReviewInstanceForm definition={{ ...source, readOnly: status === 'read-only',
      instance: { ...source.instance!, status: status === 'read-only' ? 'scheduled' : status } }} onSaveAnswers={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save my answers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Earlier draft')).toBeVisible();
  });

  it('sends only visible respondent questions and preserves hidden drafts locally', async () => {
    const source = editable('participant');
    source.sections[0].fields.push({ id: 'gate', title: 'Any concerns?', fieldType: 'boolean_case_block', required: false,
      displayOrder: 2, configuration: {}, answer: 'no', yesFields: [{ id: 'hidden', title: 'Concern detail', fieldType: 'text', required: true,
        displayOrder: 0, configuration: { respondentRoles: ['participant'] }, answer: 'Earlier hidden answer' }] });
    const save = vi.fn().mockResolvedValue(source);
    render(<LearnerReviewInstanceForm definition={source} onSaveAnswers={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ own: 'Earlier draft' }, 'version-1'));
  });

  it.each(['participant', 'employer'] as const)('shows the stored snapshot to %s without calculation controls', (viewerRole) => {
    render(<LearnerReviewInstanceForm definition={definition} viewerRole={viewerRole} />);
    expect(screen.getByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Transcript' })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it.each(['participant', 'employer'] as const)('keeps coach actions hidden from %s on editable lifecycle reviews too', viewerRole => {
    render(<LearnerReviewInstanceForm definition={{ ...definition, instance: { ...definition.instance, status: 'in-progress' } }} viewerRole={viewerRole} />);
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate|Generate from Teams|Upload Transcript|Check Session)$/ })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it('keeps an uncalculated continuation visibly uncalculated', () => {
    render(<LearnerReviewInstanceForm definition={{ ...definition, progressSnapshot: null }} />);
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
  });
});

describe.each(['participant', 'employer'] as const)('migrated signed PDF for %s', viewerRole => {
  it('keeps unavailable historical originals disabled without a generated fallback', () => {
    const download = vi.fn();
    render(<LearnerReviewInstanceForm definition={{ ...definition, migratedForm: false,
      pdf: { available: false, reason: 'The original Aptem PDF is unavailable.' },
    }} viewerRole={viewerRole} onDownload={download} />);
    const button = screen.getByRole('button', { name: 'Download signed PDF' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Generate LMS review PDF' })).not.toBeInTheDocument();
  });

  it.each(['not-scheduled', 'scheduled', 'in-progress', 'awaiting-signature'])('hides signed downloads while %s even with stale availability', status => {
    const download = vi.fn();
    render(<LearnerReviewInstanceForm definition={{ ...definition,
      instance: { ...definition.instance!, status }, pdf: { available: true, reason: '' },
    }} viewerRole={viewerRole} onDownload={download} />);
    expect(screen.queryByRole('button', { name: /^Download.*PDF$/ })).not.toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('hides signed downloads for an uninitialized preview with historical availability', () => {
    render(<LearnerReviewInstanceForm definition={{ ...definition, migratedForm: false, previewOnly: true,
      instance: null, pdf: { available: true, reason: '', source: 'aptem' },
    }} viewerRole={viewerRole} onDownload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Download.*PDF$/ })).not.toBeInTheDocument();
  });

  it.each(['aptem_mcm', 'aptem_progress_review'])('downloads the stored completed %s document', async reviewTypeCode => {
    const download = vi.fn().mockResolvedValue(undefined);
    render(<LearnerReviewInstanceForm definition={{ ...definition,
      template: { ...definition.template, reviewTypeCode }, pdf: { available: true, reason: '' },
    }} viewerRole={viewerRole} onDownload={download} />);
    const button = screen.getByRole('button', { name: 'Download signed PDF' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
  });

  it.each([undefined, { available: false, reason: 'Generate the LMS review PDF after completion.' }])('prepares missing completed PDFs on download: %s', async pdf => {
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<LearnerReviewInstanceForm definition={{ ...definition, pdf }} viewerRole={viewerRole} onDownload={download} />);
    const button = screen.getByRole('button', { name: 'Download signed PDF' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Preparing PDF...' })).toBeDisabled();
    expect(download).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled());
  });

  it('shows preparation failure and retries without changing review content', async () => {
    const download = vi.fn().mockRejectedValueOnce(new Error('Unable to prepare the signed PDF. Please try again.'))
      .mockResolvedValueOnce(undefined);
    render(<LearnerReviewInstanceForm definition={definition} viewerRole={viewerRole} onDownload={download} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download signed PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to prepare the signed PDF. Please try again.');
    expect(screen.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Download signed PDF' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();
  });
});
