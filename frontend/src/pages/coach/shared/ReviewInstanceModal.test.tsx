import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewInstanceModal } from './ReviewInstanceModal';
import { progressExample, skillsExample } from '@/pages/learner/reviews/imported/presentationFixtures';
import { calculateMigratedReviewProgress } from '@/api/reviewInstances';
import { bookMigratedReview, calculateReviewInstanceProgress, completeMigratedReview, completeReviewInstance, downloadReviewInstancePdf, fetchPreviousReviewSession, fetchReviewInstanceForm, generateMigratedReviewPdf, generateReviewMeetingSummary, initializeMigratedReview, reopenReviewInstance, saveReviewInstanceAnswers, signMigratedReviewAsCoach, signReviewInstance, startMigratedReview, submitMigratedReview, type ReviewInstanceFormDefinition, type ReviewProgressSnapshot } from '@/api/reviewInstances';

const account = vi.hoisted(() => ({ name: 'Sam Coach' }));
const coachMode = vi.hoisted(() => ({ email: 'coach@example.invalid', isInitialized: true, isViewingAsCoach: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { user: { fullName: account.name } } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => coachMode }));
vi.mock('@/api/reviewInstances', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/reviewInstances')>(),
  fetchReviewInstanceForm: vi.fn(), saveReviewInstanceAnswers: vi.fn(), completeReviewInstance: vi.fn(), reopenReviewInstance: vi.fn(), signReviewInstance: vi.fn(),
  downloadReviewInstancePdf: vi.fn(), calculateReviewInstanceProgress: vi.fn(), generateReviewMeetingSummary: vi.fn(), fetchPreviousReviewSession: vi.fn(),
  initializeMigratedReview: vi.fn(), startMigratedReview: vi.fn(), bookMigratedReview: vi.fn(),
  calculateMigratedReviewProgress: vi.fn(),
  submitMigratedReview: vi.fn(), signMigratedReviewAsCoach: vi.fn(), completeMigratedReview: vi.fn(), generateMigratedReviewPdf: vi.fn(),
}));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ signatoryName, onCommit }: { signatoryName: string; onCommit: (signature: string) => void }) => <div>
    <p>Signing as {signatoryName}</p><button type="button" onClick={() => onCommit('data:image/png;base64,c2ln')}>Confirm coach signature</button>
  </div>,
}));

function definition(status = 'in-progress'): ReviewInstanceFormDefinition {
  return {
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1', occurrenceNumber: 1,
      targetDate: '2026-09-14', status, startedAt: '2026-09-14T09:00:00', completedAt: null },
    template: { id: 'template-1', name: 'Monthly coaching', signatures: { advisor: true, participant: true, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: false, referrer: false }, recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [{ id: 'section-1', title: 'Next steps', estimatedMinutes: 5, displayOrder: 1, enabled: true,
      fields: [{ id: 'field-1', title: 'Agreed action', fieldType: 'text', required: true, displayOrder: 1, configuration: {}, answer: 'Review the next module' }] }],
    signatures: { advisor: { required: true, signed: false }, participant: { required: true, signed: false }, employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
    manualOverride: null,
  };
}

/** Same shape, but classified as the canonical Monthly Coaching Meeting
 *  review type via the stable `reviewTypeCode` -- never by name/title. */
function mcmDefinition(status = 'awaiting-signature'): ReviewInstanceFormDefinition {
  const base = definition(status);
  return {
    ...base,
    template: { ...base.template, reviewTypeCode: 'mcm' },
    sections: [...base.sections, { id: 'summary-section', title: 'Meeting Summary', estimatedMinutes: 0, displayOrder: 2, enabled: true,
      fields: [{ id: 'summary-field', title: 'Summary', fieldType: 'text_multiline', required: true, displayOrder: 1,
        configuration: { semanticKey: 'meeting_summary' }, answer: null }] }],
    meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'AI generated coaching summary.' },
    pdf: { available: false, reason: 'The PDF is available after the learner and all required parties have signed.' },
  };
}

function migratedDefinition(status = 'in-progress'): ReviewInstanceFormDefinition {
  const base = definition(status);
  return {
    ...base, source: 'aptem', migratedForm: true, formAvailable: true, summaryOnly: false,
    readOnly: status !== 'in-progress', localStatus: status, sourceStatus: 'Scheduled',
    instance: { ...base.instance, id: 'imported-review:synthetic', reviewTemplateId: '', occurrenceNumber: null },
    pdf: { available: status === 'completed', reason: '', source: 'lms-migrated' },
  };
}

function migratedPrDefinition(status: string, family: 'PR' | 'PR_SKILLS_RADAR'): ReviewInstanceFormDefinition {
  const base = migratedDefinition(status);
  const type = family === 'PR_SKILLS_RADAR' ? 'Progress Review (+ Skills Radar)' : 'Progress Review';
  const result = {
    ...base,
    template: { ...base.template, name: type, reviewTypeCode: 'aptem_progress_review',
      signatures: { ...base.template.signatures, employer: true } },
    signatures: { ...base.signatures, employer: { required: true, signed: false } },
    historicalReview: { type },
    migratedTemplateResolution: { review_family: family, resolved_scope: 'GLOBAL',
      resolved_template_id: family === 'PR_SKILLS_RADAR' ? 22 : 21, uses_snapshot: true },
  };
  return result;
}

function mount(instanceId = 'instance-1') {
  const onStatusChange = vi.fn();
  const onClose = vi.fn();
  const props = {
    event: { learner: 'Ayman Learner', programme: 'Marketing' },
    instanceId,
    onClose,
    onCompleted: vi.fn(),
    onStatusChanged: onStatusChange,
  };
  const view = render(
    <ReviewInstanceModal
      {...props}
    />,
  );
  return { onStatusChange, onClose, rerender: () => view.rerender(<ReviewInstanceModal {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  account.name = 'Sam Coach';
  coachMode.email = 'coach@example.invalid';
  coachMode.isInitialized = true;
  coachMode.isViewingAsCoach = false;
  vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition());
  vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(definition());
  vi.mocked(completeReviewInstance).mockResolvedValue(definition('awaiting-signature'));
  vi.mocked(reopenReviewInstance).mockResolvedValue(definition('in-progress'));
  vi.mocked(fetchPreviousReviewSession).mockResolvedValue({
    available: false,
    reason: 'There is no previous occurrence for this Review.',
    instance: null,
    review: null,
    summaryText: '',
    transcriptText: '',
    transcriptAvailable: false,
    transcriptTruncated: false,
  });
});

describe('imported Coach content presentation', () => {
  const importedField = (id: string, title: string, answer: unknown, displayOrder = 0) => ({
    id, title, answer, displayOrder, fieldType: 'text_multiline' as const, required: false, configuration: { imported: true },
  });
  function historical(type = 'Progress Review') {
    const base = definition('completed');
    return {
      ...base, source: 'aptem', readOnly: true, migratedForm: false, formAvailable: true,
      learnerName: 'Alex Example', programme: 'Example programme', sourceStatus: 'Completed',
      instance: { ...base.instance, id: 'imported-review:example-42', occurrenceNumber: null },
      historicalReview: { id: '901', aptemReviewId: 'example-42', type },
      template: { ...base.template, name: type, reviewTypeCode: type === 'Monthly Coaching Meeting' ? 'aptem_mcm' : 'aptem_progress_review' },
      signatures: { advisor: { required: false, signed: false }, participant: { required: false, signed: false }, employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
      sections: [{ id: 'progress', title: 'Learning progress', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
        importedField('helper', 'hasPrevProgress', 'No'),
        importedField('progress-data', 'progress', JSON.stringify(progressExample), 1),
        importedField('event', 'eventKey', 'imported-review:example-42', 2),
      ] }],
    };
  }
  function open(data: ReviewInstanceFormDefinition) {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(data);
    return render(<ReviewInstanceModal instanceId={data.instance.id} presentation="page" onClose={vi.fn()} />);
  }

  it.each(['Progress Review', 'Progress Review (+ Skills Radar)'])('renders semantic progress inside the existing %s step', async (type) => {
    const data = historical(type);
    const before = JSON.stringify(data);
    open(data);
    const step = (await screen.findByRole('heading', { name: 'Learning progress' })).closest('section')!;
    expect(within(step).getByRole('img', { name: '107 completed of 169 activities' })).toBeVisible();
    [/Learning plan activities/i, /Standard \/ Programme Progress/i, /Programme timeline/i, /Off-the-job hours/i].forEach(name => {
      expect(within(step).getByRole('heading', { name })).toBeVisible();
    });
    ['62', '117', 'Behind', '110%', '837h', '867h', '957h', '1,302h', '17/04/2028'].forEach(value => {
      expect(within(step).getByText(value)).toBeVisible();
    });
    expect(step.textContent).not.toMatch(/hasPrevProgress|completedCount|progressType|eventKey|imported-review:|T00:00/);
    expect(within(step).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Step 1 of 1')).toBeVisible();
    expect(screen.getByRole('button', { name: /Learning progress/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Review completed')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(fetchReviewInstanceForm).toHaveBeenCalledWith('imported-review:example-42', expect.any(AbortSignal));
    expect(JSON.stringify(data)).toBe(before);
    expect(data.historicalReview).toEqual({ id: '901', aptemReviewId: 'example-42', type });
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('uses the existing sanitizer for historical MCM HTML and readable Q&A', async () => {
    const data = historical('Monthly Coaching Meeting');
    data.sections[0].title = 'Meeting Summary';
    data.sections[0].fields = [
      importedField('summary', 'Summary', '<h3>Review discussion</h3><p>Evidence <strong>reviewed</strong></p><ul><li>Portfolio update</li></ul><ol><li>Agree next actions</li></ol><script>alert(1)</script><iframe src="https://example.invalid"></iframe><a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>'),
      importedField('question', 'WORKPLACE_TRAINING_COMPLETED', 'Yes', 1),
      importedField('notes', 'Coach comments', 'Confident application of learning.', 2),
    ];
    open(data);
    const step = await screen.findByRole('region', { name: 'Meeting Summary' });
    expect(within(step).getByRole('heading', { name: 'Review discussion' })).toBeVisible();
    expect(step.querySelector('p strong')).toHaveTextContent('reviewed');
    expect(step.querySelector('ul li')).toHaveTextContent('Portfolio update');
    expect(step.querySelector('ol li')).toHaveTextContent('Agree next actions');
    expect(step.querySelector('script,iframe,[onclick],[href^="javascript:"]')).toBeNull();
    expect(within(step).getByText('Workplace training completed')).toBeVisible();
    expect(within(step).getByText('Yes')).toBeVisible();
    expect(within(step).getByText('Confident application of learning.')).toBeVisible();
    expect(step.textContent).not.toMatch(/<p>|<li>|alert\(1\)|WORKPLACE_TRAINING/);
    expect(within(step).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('retains competency levels, notes, actions and expandable source scales', async () => {
    const data = historical('Progress Review (+ Skills Radar)');
    data.sections[0].title = 'Skills Radar';
    data.sections[0].fields = [importedField('skills', 'Professional skills', JSON.stringify(skillsExample))];
    open(data);
    const step = await screen.findByRole('region', { name: 'Skills Radar' });
    ['Plan and communicate work', 'Level 3', 'Clear progress this term.', 'Practise presenting', 'Not assessed'].forEach(value => expect(within(step).getByText(value)).toBeVisible());
    fireEvent.click(within(step).getByText('Assessment scale'));
    expect(within(step).getByText('Beginning')).toBeVisible();
    expect(step.textContent).not.toMatch(/characteristicsLevelId|competenceId|assessedLevel|\{"/);
  });

  it('preserves step order, previous/next navigation and the current-step marker', async () => {
    const data = historical();
    data.sections.push({ ...data.sections[0], id: 'questions', title: 'Progress Checks', displayOrder: 1,
      fields: [importedField('attendance', 'Any attendance concerns?', 'No')] });
    open(data);
    const nav = await screen.findByRole('navigation', { name: 'Review steps' });
    expect(within(nav).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(within(nav).getByRole('button', { name: /Progress Checks/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Any attendance concerns?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    within(nav).getByRole('button', { name: /Progress Checks/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Final form step')).toBeVisible();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('keeps local continuation inputs, summary actions, validation and versioned save payloads', async () => {
    const data = migratedDefinition();
    data.answerVersion = 'version-example';
    data.summaryBinding = { fieldKey: 'summary' };
    data.sections[0].fields.push(
      { ...importedField('evidence', 'Historical evidence', null), fieldType: 'title_description', configuration: { imported: true, description: '<p>Original evidence</p>' } },
      { ...importedField('summary', 'Meeting Summary', 'Local draft', 2), configuration: { migrated: true, semanticKey: 'meeting_summary' } },
      { ...importedField('action', 'Existing action', null, 3), fieldType: 'action_button', configuration: {} },
    );
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(data);
    open(data);
    const step = await screen.findByRole('region', { name: 'Next steps' });
    expect(within(step).getByText('Original evidence')).toBeVisible();
    expect(within(step).getAllByRole('textbox')).toHaveLength(2);
    expect(within(step).getByRole('button', { name: 'Existing action' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Generate from Teams' })).toBeVisible();
    const input = within(step).getByDisplayValue('Review the next module');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please complete every required field');
    expect(submitMigratedReview).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Updated coach action' } });
    fireEvent.change(within(step).getByRole('textbox', { name: 'Meeting Summary' }), { target: { value: 'Updated summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(data.instance.id,
      { 'field-1': 'Updated coach action', summary: 'Updated summary' },
      { answerVersion: 'version-example', editedFields: ['field-1', 'summary'] }));
    expect(bookMigratedReview).not.toHaveBeenCalled();
  });

  it('retains editable imported questions when the existing API permits editing', async () => {
    const data = historical('Monthly Coaching Meeting');
    data.readOnly = false;
    data.instance.status = 'in-progress';
    data.sections[0].title = 'Reflection';
    data.sections[0].fields = [importedField('answer', 'Reflection', 'Existing editable answer')];
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(data);
    open(data);
    const input = await screen.findByRole('textbox');
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: 'Updated answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(data.instance.id, { answer: 'Updated answer' }));
  });

  it.each(['awaiting-signature', 'completed'])('keeps locked local continuation controls and signatures at %s', async status => {
    const data = migratedDefinition(status);
    open(data);
    const input = await screen.findByRole('textbox');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Review the next module');
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm coach signature' })).toBeVisible();
  });

  it('leaves Native content and controls on their original renderer path', async () => {
    const data = historical();
    data.source = 'curriculum';
    data.template.reviewTypeCode = 'progress_review';
    open(data);
    const step = (await screen.findByRole('heading', { name: 'Learning progress' })).closest('section')!;
    expect(within(step).getAllByRole('textbox')).toHaveLength(3);
    expect(within(step).getByDisplayValue(JSON.stringify(progressExample))).toBeDisabled();
    expect(within(step).queryByRole('img', { name: /activities/ })).not.toBeInTheDocument();
  });
});

describe('review workspace identity', () => {
  function importedIdentity(id: string, learnerName: string, status = 'in-progress'): ReviewInstanceFormDefinition {
    const base = definition(status);
    return {
      ...base,
      source: 'aptem', migratedForm: status !== 'completed', formAvailable: true, summaryOnly: false,
      learnerName, learnerEmail: 'synthetic@example.invalid',
      programme: 'Associate Project Manager Level 4', programmeId: 'P-42',
      localStatus: status === 'completed' ? null : status, sourceStatus: status === 'completed' ? 'Completed' : 'Not Scheduled',
      readOnly: status === 'completed',
      instance: { ...base.instance, id, occurrenceNumber: null, reviewTemplateId: '' },
      template: { ...base.template, name: id.includes('MCM') ? 'Phase B.5 validation MCM' : 'Phase B.5 validation PR' },
    };
  }

  it('prefers backend identity over stale navigation labels', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(importedIdentity('imported-review:C5-TEST-MCM-20261002-001', 'C5 Test Learner MCM'));
    render(<ReviewInstanceModal event={{ learner: 'Old name', programme: 'Old programme' }} instanceId="imported-review:C5-TEST-MCM-20261002-001" onClose={vi.fn()} />);
    expect(await screen.findByText('C5 Test Learner MCM')).toBeVisible();
    expect(screen.getByText('Associate Project Manager Level 4')).toBeVisible();
    expect(screen.queryByText('Old name')).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it.each([
    ['MCM', 'C5 Test Learner MCM'],
    ['PR', 'C5 Test Learner PR'],
  ])('opens the synthetic %s form directly without route state', async (family, learnerName) => {
    const id = `imported-review:C5-TEST-${family}-20261002-001`;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(importedIdentity(id, learnerName));
    render(<ReviewInstanceModal instanceId={id} onClose={vi.fn()} />);
    expect(await screen.findByText(learnerName)).toBeVisible();
    expect(screen.getByText('Associate Project Manager Level 4')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeVisible();
    expect(screen.queryByText('Unknown learner')).not.toBeInTheDocument();
    expect(bookMigratedReview).not.toHaveBeenCalled();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('resolves the same identity again after a refresh-style remount', async () => {
    const id = 'imported-review:C5-TEST-PR-20261002-001';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(importedIdentity(id, 'C5 Test Learner PR'));
    const first = render(<ReviewInstanceModal instanceId={id} onClose={vi.fn()} />);
    expect(await screen.findByText('C5 Test Learner PR')).toBeVisible();
    first.unmount();
    render(<ReviewInstanceModal instanceId={id} onClose={vi.fn()} />);
    expect(await screen.findByText('C5 Test Learner PR')).toBeVisible();
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(2);
  });

  it('shows backend identity for a historical Completed import without initializing', async () => {
    const historical = importedIdentity('imported-review:historical', 'Historical learner', 'completed');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({ ...historical, migratedForm: false, sections: [] });
    render(<ReviewInstanceModal instanceId="imported-review:historical" onClose={vi.fn()} />);
    expect(await screen.findByText('Historical learner')).toBeVisible();
    expect(screen.getByText('Associate Project Manager Level 4')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('keeps native reviews on their existing form path with backend identity', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({
      ...definition(), source: 'curriculum', learnerName: 'Native learner', programme: 'Native programme',
    });
    render(<ReviewInstanceModal event={{ learner: 'Stale learner', programme: 'Stale programme' }} instanceId="native-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Native learner')).toBeVisible();
    expect(screen.getByText('Native programme')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('shows unavailable labels when the backend cannot resolve identity', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({ ...definition(), learnerName: '', programme: '' });
    render(<ReviewInstanceModal event={{ learner: 'Stale learner', programme: 'Stale programme' }} instanceId="native-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Learner unavailable')).toBeVisible();
    expect(screen.getByText('Programme unavailable')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeVisible();
  });

  it('retains navigation labels for older native detail responses without identity fields', async () => {
    render(<ReviewInstanceModal event={{ learner: 'Native learner', programme: 'Native programme' }} instanceId="native-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Native learner')).toBeVisible();
    expect(screen.getByText('Native programme')).toBeVisible();
  });
});

describe('review reopen flow', () => {
  it('shows the approved template as an empty read-only preview in admin view-as without initializing', async () => {
    coachMode.isViewingAsCoach = true;
    const pending: ReviewInstanceFormDefinition = {
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: false,
      previewOnly: true, canInitialize: false, formAvailable: true, sourceStatus: 'Scheduled', localStatus: null,
      instance: { ...definition('scheduled').instance, id: 'imported-review:view-as', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [{ ...definition().sections[0], title: 'Approved migrated section',
        fields: [{ ...definition().sections[0].fields[0], answer: null }] }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    mount('imported-review:view-as');
    expect(await screen.findByRole('status')).toHaveTextContent('Read-only preview. The approved migrated form is shown for reference.');
    expect(screen.getByText('Approved migrated section')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByText('Not initialized')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry form initialization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start migrated review' })).not.toBeInTheDocument();
  });

  it('shows a clear state when no approved migrated template exists', async () => {
    coachMode.isViewingAsCoach = true;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      previewOnly: false, noApprovedMigratedTemplate: true, canInitialize: false, formAvailable: false,
      instance: { ...definition('scheduled').instance, id: 'imported-review:no-template', occurrenceNumber: null },
      sections: [],
    });
    mount('imported-review:no-template');
    expect(await screen.findByRole('status')).toHaveTextContent('No approved migrated form configured');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('waits for coach identity before deciding whether an import may initialize', async () => {
    coachMode.isInitialized = false;
    const pending: ReviewInstanceFormDefinition = {
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, formAvailable: false, sourceStatus: 'Scheduled',
      instance: { ...definition('scheduled').instance, id: 'imported-review:identity', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    const { rerender } = mount('imported-review:identity');
    expect(fetchReviewInstanceForm).not.toHaveBeenCalled();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    coachMode.isViewingAsCoach = true;
    coachMode.isInitialized = true;
    rerender();
    expect(await screen.findByRole('status')).toHaveTextContent('admin view-as mode is read-only');
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('opening an eligible import does not silently initialize its continuation', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, formAvailable: false, sourceStatus: 'Scheduled',
      instance: { ...definition('scheduled').instance, id: 'imported-review:explicit', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    });
    mount('imported-review:explicit');
    expect(await screen.findByText('Imported Aptem review')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Initialize approved migrated form' })).toBeVisible();
  });

  it('explicitly initializes an approved imported form and shows its typed fields', async () => {
    const pending: ReviewInstanceFormDefinition = {
      ...definition('not-scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, formAvailable: false, sourceStatus: 'Not Scheduled',
      instance: { ...definition('not-scheduled').instance, id: 'imported-review:future', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    };
    const initialized: ReviewInstanceFormDefinition = {
      ...pending, readOnly: false, summaryOnly: false, canInitialize: false,
      migratedForm: true, formAvailable: true, localStatus: 'not-scheduled',
      fieldWarnings: [{ fieldKey: 'unknown', aptemType: 99 }],
      sections: [{ id: 'migrated-section', title: 'Migrated questions', displayOrder: 0, enabled: true, estimatedMinutes: 0,
        fields: [{ id: 'outcome', title: 'Outcome', fieldType: 'list_item', required: true, displayOrder: 0,
          configuration: { options: ['Good', 'Needs work'] } }],
      }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(initialized);
    vi.mocked(initializeMigratedReview).mockResolvedValue(initialized);
    const { rerender } = mount('imported-review:future');
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize approved migrated form' }));
    await waitFor(() => expect(initializeMigratedReview).toHaveBeenCalledTimes(1));
    expect(initializeMigratedReview).toHaveBeenCalledWith('imported-review:future');
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(3);
    expect(fetchReviewInstanceForm).toHaveBeenLastCalledWith('imported-review:future', expect.any(AbortSignal));
    expect(screen.queryByText('This review has a summary only; no section details were imported.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Initialize approved migrated form' })).not.toBeInTheDocument();
    expect(await screen.findByText('Migrated questions')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Good' })).toBeVisible();
    expect(screen.getByText(/Aptem field type\(s\) are unverified/)).toBeVisible();
    expect(screen.getByText(/Aptem source:/)).toHaveTextContent('Not Scheduled');
    expect(screen.getByText(/LMS continuation:/)).toHaveTextContent('not scheduled');
    expect(screen.queryByText('Complete the Curriculum-defined review before closing it.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete review' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeVisible();
    rerender();
    expect(initializeMigratedReview).toHaveBeenCalledTimes(1);
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(3);
  });

  it('shows an initialization failure once and retries only when selected', async () => {
    const pending: ReviewInstanceFormDefinition = {
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, formAvailable: false, sourceStatus: 'Scheduled',
      instance: { ...definition('scheduled').instance, id: 'imported-review:retry', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    };
    const initialized: ReviewInstanceFormDefinition = {
      ...pending, readOnly: false, summaryOnly: false, canInitialize: false,
      migratedForm: true, formAvailable: true, localStatus: 'scheduled',
      sections: [{ id: 'migrated-section', title: 'Recovered form', displayOrder: 0, enabled: true, estimatedMinutes: 0, fields: [] }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(initialized);
    vi.mocked(initializeMigratedReview).mockRejectedValueOnce(new Error('Template unavailable')).mockResolvedValueOnce(initialized);
    const { rerender } = mount('imported-review:retry');
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize approved migrated form' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to initialize this migrated review: Template unavailable');
    expect(initializeMigratedReview).toHaveBeenCalledTimes(1);
    rerender();
    expect(initializeMigratedReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry form initialization' }));
    expect(await screen.findByText('Recovered form')).toBeVisible();
    expect(initializeMigratedReview).toHaveBeenCalledTimes(2);
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('button', { name: 'Retry form initialization' })).not.toBeInTheDocument();
  });

  it('refetches on retry without repeating a successful initialization POST', async () => {
    const pending: ReviewInstanceFormDefinition = {
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, formAvailable: false, sourceStatus: 'Scheduled',
      instance: { ...definition('scheduled').instance, id: 'imported-review:partial', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    };
    const initialized: ReviewInstanceFormDefinition = {
      ...pending, readOnly: false, summaryOnly: false, canInitialize: false,
      migratedForm: true, formAvailable: true, localStatus: 'scheduled',
      sections: [{ id: 'migrated-section', title: 'Recovered after refetch', displayOrder: 0, enabled: true, estimatedMinutes: 0, fields: [] }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending)
      .mockRejectedValueOnce(new Error('Temporary read failure'))
      .mockResolvedValueOnce(initialized);
    vi.mocked(initializeMigratedReview).mockResolvedValue(initialized);
    mount('imported-review:partial');
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize approved migrated form' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary read failure');
    expect(initializeMigratedReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry form initialization' }));
    expect(await screen.findByText('Recovered after refetch')).toBeVisible();
    expect(initializeMigratedReview).toHaveBeenCalledTimes(1);
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(4);
  });

  it('initializes only once under StrictMode effect replay', async () => {
    const pending: ReviewInstanceFormDefinition = {
      ...definition('scheduled'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, formAvailable: false, sourceStatus: 'Scheduled',
      instance: { ...definition('scheduled').instance, id: 'imported-review:strict', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    };
    const initialized: ReviewInstanceFormDefinition = {
      ...pending, readOnly: false, summaryOnly: false, canInitialize: false,
      migratedForm: true, formAvailable: true, localStatus: 'scheduled',
      sections: [{ id: 'strict-section', title: 'StrictMode form', displayOrder: 0, enabled: true, estimatedMinutes: 0, fields: [] }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(initialized);
    vi.mocked(initializeMigratedReview).mockResolvedValue(initialized);
    render(<StrictMode><ReviewInstanceModal event={{ learner: 'Test learner', programme: 'Test programme' }} instanceId="imported-review:strict" onClose={vi.fn()} /></StrictMode>);
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize approved migrated form' }));
    expect(await screen.findByText('StrictMode form')).toBeVisible();
    expect(initializeMigratedReview).toHaveBeenCalledTimes(1);
  });

  it('does not initialize a historical Completed import even if a stale flag says it can', async () => {
    const historical: ReviewInstanceFormDefinition = {
      ...definition('completed'), source: 'aptem', readOnly: true, summaryOnly: true,
      canInitialize: true, sourceStatus: 'Completed',
      instance: { ...definition('completed').instance, id: 'imported-review:historical', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(historical);
    mount('imported-review:historical');
    expect(await screen.findByText('This review has a summary only; no section details were imported.')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('does not initialize a native review', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({ ...definition(), canInitialize: true });
    mount();
    expect(await screen.findByText('Next steps')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('does not initialize an existing migrated overlay', async () => {
    const initialized: ReviewInstanceFormDefinition = {
      ...definition('scheduled'), source: 'aptem', migratedForm: true, formAvailable: true,
      summaryOnly: false, canInitialize: true, localStatus: 'scheduled', sourceStatus: 'Scheduled',
      instance: { ...definition('scheduled').instance, id: 'imported-review:existing', occurrenceNumber: null, reviewTemplateId: '' },
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initialized);
    mount('imported-review:existing');
    expect(await screen.findByText('Next steps')).toBeVisible();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('shows an existing migrated form read-only in admin view-as with no write actions', async () => {
    coachMode.isViewingAsCoach = true;
    const existing: ReviewInstanceFormDefinition = {
      ...definition('in-progress'), source: 'aptem', migratedForm: true, formAvailable: true,
      readOnly: false, summaryOnly: false, canInitialize: false,
      sourceStatus: 'Scheduled', localStatus: 'in-progress',
      booking: { booked: true, conflict: false, canBook: false, eventKey: 'imported-review:existing', scheduledDate: '2026-10-30', scheduledTime: '10:00', durationMinutes: 60, meetingLink: 'https://example.invalid/teams', syncState: 'synced' },
      instance: { ...definition('in-progress').instance, id: 'imported-review:existing', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [{ ...definition().sections[0], fields: [{ ...definition().sections[0].fields[0], answer: 'Stored continuation answer' }] }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount('imported-review:existing');
    expect(await screen.findByText('Next steps')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Stored continuation answer');
    expect(screen.getByRole('status')).toHaveTextContent('Admin view-as mode is read-only.');
    expect(screen.getByText('Meeting booked in LMS')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Book Meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start migrated review' })).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(completeReviewInstance).not.toHaveBeenCalled();
    expect(startMigratedReview).not.toHaveBeenCalled();
    expect(bookMigratedReview).not.toHaveBeenCalled();
  });

  it('keeps native review controls read-only in admin view-as', async () => {
    coachMode.isViewingAsCoach = true;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('in-progress'));
    mount();
    expect(await screen.findByText('Next steps')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for signatures' })).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(completeReviewInstance).not.toHaveBeenCalled();
  });

  it.each(['PR', 'PR_SKILLS_RADAR'] as const)('starts scheduled migrated %s without touching native review flow', async (family) => {
    const scheduled: ReviewInstanceFormDefinition = {
      ...migratedPrDefinition('scheduled', family),
      localStatus: 'scheduled', readOnly: false,
      booking: { booked: true, conflict: false, canBook: false, eventKey: 'imported-review:scheduled', scheduledDate: '2026-10-30', scheduledTime: '10:00', durationMinutes: 60, meetingLink: 'https://example.invalid/teams', syncState: 'synced' },
      instance: { ...definition('scheduled').instance, id: 'imported-review:scheduled', occurrenceNumber: null, reviewTemplateId: '' },
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(scheduled);
    vi.mocked(startMigratedReview).mockResolvedValue({ ...scheduled, localStatus: 'in-progress', instance: { ...scheduled.instance, status: 'in-progress' } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Start migrated review' }));
    await waitFor(() => expect(startMigratedReview).toHaveBeenCalledWith('imported-review:scheduled'));
    expect(await screen.findByRole('button', { name: 'Submit Review' })).toBeVisible();
  });

  it.each(['PR', 'PR_SKILLS_RADAR'] as const)('books migrated %s explicitly and then shows meeting actions', async (family) => {
    const pending: ReviewInstanceFormDefinition = {
      ...migratedPrDefinition('not-scheduled', family),
      localStatus: 'not-scheduled', readOnly: false,
      booking: { booked: false, conflict: false, canBook: true, eventKey: null, scheduledDate: null, scheduledTime: null, durationMinutes: null, meetingLink: null, syncState: null },
      instance: { ...definition().instance, id: 'imported-review:pending', targetDate: '2026-10-30', occurrenceNumber: null, reviewTemplateId: '' },
    };
    const booked: ReviewInstanceFormDefinition = {
      ...pending, localStatus: 'scheduled',
      booking: { booked: true, conflict: false, canBook: false, eventKey: 'imported-review:pending', scheduledDate: '2026-10-30', scheduledTime: '10:00', durationMinutes: 60, meetingLink: 'https://example.invalid/teams', syncState: 'synced' },
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    vi.mocked(bookMigratedReview).mockResolvedValue(booked);
    mount('imported-review:pending');
    fireEvent.click(await screen.findByRole('button', { name: 'Book Meeting' }));
    fireEvent.change(screen.getByLabelText('Meeting time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(bookMigratedReview).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('link', { name: 'Join Teams' })).toHaveAttribute('href', 'https://example.invalid/teams');
    expect(screen.getByRole('region', { name: 'Migrated review meeting' })).toHaveTextContent('10:00');
    expect(screen.getByRole('button', { name: 'Start migrated review' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Book Meeting' })).not.toBeInTheDocument();
  });

  it('does not send a second booking during a double click', async () => {
    const pending: ReviewInstanceFormDefinition = {
      ...definition('not-scheduled'), source: 'aptem', migratedForm: true, formAvailable: true,
      localStatus: 'not-scheduled', readOnly: false,
      booking: { booked: false, conflict: false, canBook: true, eventKey: null, scheduledDate: null, scheduledTime: null, durationMinutes: null, meetingLink: null, syncState: null },
      instance: { ...definition().instance, id: 'imported-review:double-click', targetDate: '2026-10-30', occurrenceNumber: null, reviewTemplateId: '' },
    };
    let finishBooking!: (value: ReviewInstanceFormDefinition) => void;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    vi.mocked(bookMigratedReview).mockImplementation(() => new Promise<ReviewInstanceFormDefinition>((resolve) => { finishBooking = resolve; }));
    mount('imported-review:double-click');
    fireEvent.click(await screen.findByRole('button', { name: 'Book Meeting' }));
    const confirm = screen.getByRole('button', { name: 'Confirm booking' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(bookMigratedReview).toHaveBeenCalledTimes(1);
    await act(async () => { finishBooking({ ...pending, localStatus: 'scheduled', booking: { ...pending.booking!, booked: true, canBook: false } }); });
  });

  it('keeps an unbooked source Scheduled review on the explicit booking path', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue({
      ...definition('scheduled'), source: 'aptem', migratedForm: true, formAvailable: true,
      localStatus: 'scheduled', readOnly: false,
      booking: { booked: false, conflict: false, canBook: true, eventKey: null, scheduledDate: null, scheduledTime: null, durationMinutes: null, meetingLink: null, syncState: null },
      instance: { ...definition().instance, id: 'imported-review:source-scheduled', occurrenceNumber: null, reviewTemplateId: '' },
    });
    mount('imported-review:source-scheduled');
    expect(await screen.findByRole('button', { name: 'Book Meeting' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start migrated review' })).not.toBeInTheDocument();
    expect(bookMigratedReview).not.toHaveBeenCalled();
  });

  it.each(['PR', 'PR_SKILLS_RADAR'] as const)('reuses a verified existing %s meeting without opening the date picker', async (family) => {
    const existing: ReviewInstanceFormDefinition = {
      ...migratedPrDefinition('not-scheduled', family),
      localStatus: 'not-scheduled', readOnly: false,
      booking: { booked: true, conflict: false, canBook: false, canAttach: true,
        eventKey: 'imported-review:existing-meeting', scheduledDate: '2026-10-30', scheduledTime: '10:00',
        durationMinutes: 60, meetingLink: 'https://example.invalid/teams', syncState: 'synced' },
      instance: { ...definition().instance, id: 'imported-review:existing-meeting', occurrenceNumber: null, reviewTemplateId: '' },
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(bookMigratedReview).mockResolvedValue({ ...existing, localStatus: 'scheduled', booking: { ...existing.booking!, canAttach: false } });
    mount('imported-review:existing-meeting');
    fireEvent.click(await screen.findByRole('button', { name: 'Use existing meeting' }));
    await waitFor(() => expect(bookMigratedReview).toHaveBeenCalledWith('imported-review:existing-meeting', expect.objectContaining({ scheduledDate: '2026-10-30', scheduledTime: '10:00', durationMinutes: 60 })));
    expect(screen.queryByRole('button', { name: 'Use existing meeting' })).not.toBeInTheDocument();
  });

  it('clears migrated conditional answers when the coach changes branches', async () => {
    const migrated: ReviewInstanceFormDefinition = {
      ...definition(), source: 'aptem', migratedForm: true, localStatus: 'in-progress', readOnly: false,
      instance: { ...definition().instance, id: 'imported-review:conditional', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [{ id: 'conditional-section', title: 'Conditional questions', estimatedMinutes: 0, displayOrder: 0, enabled: true,
        fields: [{ id: 'check', title: 'Any concern?', fieldType: 'boolean_case_block', required: true, displayOrder: 0,
          configuration: {}, answer: 'yes', yesFields: [{ id: 'detail', title: 'Details', fieldType: 'text', required: true,
            displayOrder: 0, configuration: {}, answer: 'Earlier concern' }], noFields: [] }],
      }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(migrated);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^no$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'imported-review:conditional', { check: 'no' },
    ));
  });

  it('shows separate statuses at the migrated signature boundary without native controls', async () => {
    const pending: ReviewInstanceFormDefinition = {
      ...definition('awaiting-signature'), source: 'aptem', migratedForm: true,
      sourceStatus: 'Scheduled', localStatus: 'awaiting-signature', readOnly: true,
      instance: { ...definition('awaiting-signature').instance, id: 'imported-review:pending', occurrenceNumber: null, reviewTemplateId: '' },
      template: { ...definition().template, reviewTypeCode: 'aptem_mcm' },
      signatures: {
        advisor: { required: false, signed: false }, participant: { required: false, signed: false },
        employer: { required: false, signed: false }, referrer: { required: false, signed: false },
      },
      pdf: { available: false, reason: 'LMS-generated migrated PDFs are not available yet.' },
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    mount();
    expect(await screen.findByText(/Aptem source:/)).toHaveTextContent('Scheduled');
    expect(screen.getByText(/LMS continuation:/)).toHaveTextContent('awaiting signature');
    expect(screen.getByText(/Submitted answers are locked while the required parties sign/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Download.*PDF$/ })).not.toBeInTheDocument();
  });

  it('keeps migrated required-field feedback before submission', async () => {
    const migrated: ReviewInstanceFormDefinition = {
      ...definition('in-progress'), source: 'aptem', migratedForm: true,
      sourceStatus: 'Scheduled', localStatus: 'in-progress', readOnly: false,
      instance: { ...definition().instance, id: 'imported-review:required', occurrenceNumber: null, reviewTemplateId: '' },
      sections: [{ id: 'migrated-section', title: 'Migrated questions', estimatedMinutes: 0, displayOrder: 0, enabled: true,
        fields: [{ id: 'required-answer', title: 'Required answer', fieldType: 'text_multiline', required: true,
          displayOrder: 0, configuration: {}, answer: null }],
      }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(migrated);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Review' }));
    expect(screen.getByText('Please complete every required field before finishing the review.')).toBeVisible();
    expect(submitMigratedReview).not.toHaveBeenCalled();
  });

  it('renders an imported Aptem table as accessible columns and rows', async () => {
    const importedDefinition: ReviewInstanceFormDefinition = {
      ...definition('in-progress'),
      source: 'aptem',
      instance: { ...definition('in-progress').instance, id: 'imported-review:TABLE', reviewTemplateId: '' },
      sections: [{ id: 'actions', title: 'Actions', estimatedMinutes: 0, displayOrder: 1, enabled: true,
        fields: [{ id: 'aptem-table:actions:0', title: 'Imported table', fieldType: 'title_description', required: false,
          displayOrder: 0, configuration: { imported: true, importedTable: [
            ['Action', 'Responsible', 'Deadline'],
            ['Submit outstanding assignments', 'Laura Baxter', '9 October 2026'],
          ] } }],
      }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(importedDefinition);

    mount();

    const table = await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    expect(table).toHaveTextContent('Submit outstanding assignments');
    expect(table).toHaveTextContent('Laura Baxter');
  });

  it('edits and saves an imported Aptem definition in the same workspace', async () => {
    const importedDefinition = {
      ...definition('in-progress'),
      readOnly: false,
      source: 'aptem',
      formAvailable: true,
      summaryOnly: false,
      instance: { ...definition('in-progress').instance, id: 'imported-review:A-1', reviewTemplateId: '' },
      template: { ...definition('in-progress').template, id: '', name: 'Imported progress review', reviewTypeCode: 'aptem_progress_review' },
      signatures: {
        advisor: { required: false, signed: false },
        participant: { required: false, signed: false },
        manager: { required: false, signed: false },
        employer: { required: false, signed: false },
        referrer: { required: false, signed: false },
      },
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(importedDefinition);
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(importedDefinition);
    mount();
    expect(await screen.findByText('Imported Aptem review')).toBeVisible();
    expect(screen.getByDisplayValue('Review the next module')).toBeEnabled();
    expect(screen.getByText(/The original Aptem import remains unchanged\./)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'imported-review:A-1',
      expect.objectContaining({ 'field-1': 'Review the next module' }),
    ));
    expect(screen.getByRole('button', { name: 'Complete review' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('renders canonical Learning Progress for an imported Aptem progress review without duplicating its raw section', async () => {
    const importedDefinition: ReviewInstanceFormDefinition = {
      ...definition('in-progress'),
      source: 'aptem',
      progressSnapshot: snapshotFixture(),
      instance: { ...definition('in-progress').instance, id: 'imported-review:A-2', reviewTemplateId: '' },
      template: { ...definition('in-progress').template, id: '', reviewTypeCode: 'aptem_progress_review' },
      sections: [{
        id: 'aptem-section:progress', title: 'Learning Progress', estimatedMinutes: 0, displayOrder: 1, enabled: true,
        fields: [{ id: 'aptem-text:progress', title: 'Imported text', fieldType: 'title_description', required: false, displayOrder: 0, configuration: { imported: true, description: 'Legacy progress text' } }],
      }],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(importedDefinition);

    mount();

    expect(await screen.findByRole('img', { name: /Learning Plan Progress/i })).toBeVisible();
    expect(screen.queryByText('Imported text')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalculate|Calculate/i })).not.toBeInTheDocument();
  });

  it('shows an owned summary-only import without edit or completion actions', async () => {
    const summaryOnlyDefinition: ReviewInstanceFormDefinition = {
      ...definition('not-scheduled'),
      readOnly: true,
      source: 'aptem',
      formAvailable: false,
      summaryOnly: true,
      instance: {
        ...definition('not-scheduled').instance,
        id: 'imported-review:14010',
        reviewTemplateId: '',
      },
      template: {
        ...definition('not-scheduled').template,
        id: '',
        name: 'Imported monthly coaching review',
        reviewTypeCode: 'aptem_mcm',
      },
      sections: [],
    };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(summaryOnlyDefinition);

    mount();

    expect(await screen.findByText('This review has a summary only; no section details were imported.')).toBeVisible();
    expect(screen.getByText(/there is no form to edit or complete/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete review' })).not.toBeInTheDocument();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(completeReviewInstance).not.toHaveBeenCalled();
  });

  it('reopens a completed review with a reason and returns it to editing', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('completed'));
    const { onStatusChange } = mount();
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/Everyone must sign this Review again/);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(reopenReviewInstance).toHaveBeenCalledWith('instance-1', {
      reasonCode: 'correction-required',
      note: 'Reopened for correction; all required signatures must be collected again.',
    }));
    expect(onStatusChange).toHaveBeenCalledWith('in-progress');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeVisible();
  });
});
afterEach(cleanup);

describe('coach review page presentation', () => {
  it('loads the immediately previous occurrence for the same review', async () => {
    const current = definition();
    current.instance.occurrenceNumber = 3;
    current.template.reviewTypeCode = 'mcm';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(current);
    vi.mocked(fetchPreviousReviewSession).mockResolvedValue({
      available: true,
      instance: {
        id: 'instance-2',
        occurrenceNumber: 2,
        targetDate: '2026-08-14',
        completedAt: '2026-08-15T10:00:00Z',
        status: 'completed',
      },
      review: { name: 'Monthly coaching', reviewTypeCode: 'mcm', reviewTemplateId: 'template-1' },
      summaryText: 'Prior coaching summary.',
      transcriptText: 'Coach: Let us review the agreed action.\nLearner: It is complete.',
      transcriptAvailable: true,
      transcriptTruncated: false,
    });

    mount();
    expect(await screen.findByRole('button', { name: 'View previous session' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View previous session' }));

    await waitFor(() => expect(fetchPreviousReviewSession).toHaveBeenCalledWith('instance-1'));
    expect(await screen.findByText('Prior coaching summary.')).toBeVisible();
    expect(screen.getByLabelText('Previous session transcript')).toHaveTextContent('Coach: Let us review the agreed action.');
  });

  it('starts Curriculum sections at step 1 without modal chrome', async () => {
    const pageDefinition = definition();
    pageDefinition.template.reviewTypeCode = 'mcm';
    pageDefinition.sections.push({
      id: 'section-2',
      title: 'Final reflection',
      estimatedMinutes: 3,
      displayOrder: 2,
      enabled: true,
      fields: [{ id: 'field-2', title: 'Reflection', fieldType: 'text_multiline', required: false, displayOrder: 1, configuration: {} }],
    });
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pageDefinition);
    const onClose = vi.fn();
    render(
      <ReviewInstanceModal
        presentation="page"
        event={{ learner: 'Ayman Learner', programme: 'Marketing' }}
        instanceId="instance-1"
        onClose={onClose}
      />,
    );

    expect(await screen.findByRole('navigation', { name: 'Review steps' })).toBeVisible();
    expect(screen.queryByText('Review selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Details confirmed')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting #1' })).toBeVisible();
    expect(screen.getByText('Step 1')).toBeVisible();
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Final reflection' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('heading', { name: 'Final reflection' })).toBeVisible();
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close form' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to reviews' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('labels the shared page UI as Progress Review for PR instances', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    render(
      <ReviewInstanceModal
        presentation="page"
        event={{ learner: 'Ayman Learner', programme: 'Marketing' }}
        instanceId="instance-1"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Progress Review #1' })).toBeVisible();
  });
});

describe('coach review signature workflow', () => {
  it('blocks editing with a clear template conflict while keeping saved answers visible', async () => {
    const review = migratedDefinition();
    review.templateSync = { status: 'conflict', upToDate: false, message: 'An answered field changed type. Ask a template administrator to correct it.' };
    review.readOnly = true;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
    mount(review.instance.id);
    expect(await screen.findByText(review.templateSync.message!)).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('Review the next module');
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit Review' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Submitted answers are locked/)).not.toBeInTheDocument();
    expect(submitMigratedReview).not.toHaveBeenCalled();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('preserves unsaved text when final template synchronization returns a conflict', async () => {
    const review = migratedDefinition();
    review.answerVersion = 'working-version';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
    vi.mocked(submitMigratedReview).mockRejectedValueOnce(new Error('The review template changed. Reopen the review and check its latest questions before submitting.'));
    mount(review.instance.id);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Unsaved coach wording' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }));
    expect(await screen.findByText(/The review template changed/)).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('Unsaved coach wording');
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(submitMigratedReview).toHaveBeenCalledWith(review.instance.id, { 'field-1': 'Unsaved coach wording' }, { answerVersion: 'working-version', editedFields: ['field-1'] });
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(1);
  });

  it('renders a newly synchronized required question blank and sends the current version', async () => {
    const review = migratedDefinition();
    review.answerVersion = 'synchronized-version';
    review.templateSync = { status: 'working', upToDate: true, fingerprint: 'current-fingerprint' };
    review.sections[0].fields.push({ id: 'new-field', title: 'New required question', fieldType: 'text', required: true, displayOrder: 2, configuration: {}, answer: null });
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
    vi.mocked(submitMigratedReview).mockResolvedValue(migratedDefinition('awaiting-signature'));
    mount(review.instance.id);
    const inputs = await screen.findAllByRole('textbox');
    expect(inputs[0]).toHaveValue('Review the next module');
    expect(inputs[1]).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }));
    expect(submitMigratedReview).not.toHaveBeenCalled();
    fireEvent.change(inputs[1], { target: { value: 'New answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }));
    await waitFor(() => expect(submitMigratedReview).toHaveBeenCalledWith(review.instance.id, { 'field-1': 'Review the next module', 'new-field': 'New answer' }, { answerVersion: 'synchronized-version', editedFields: ['new-field'] }));
  });

  it('submits migrated answers and shows the frozen signature progress', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(migratedDefinition());
    vi.mocked(submitMigratedReview).mockResolvedValue(migratedDefinition('awaiting-signature'));
    mount('imported-review:synthetic');
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Review' }));
    expect(submitMigratedReview).toHaveBeenCalledWith('imported-review:synthetic', { 'field-1': 'Review the next module' });
    expect(completeReviewInstance).not.toHaveBeenCalled();
    expect(await screen.findByText('0 of 2 required signatures saved')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('signs as the coach, completes after all signatures, and shows the LMS PDF action', async () => {
    const pending = migratedDefinition('awaiting-signature');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    const signed = structuredClone(pending);
    signed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach' };
    signed.signatures.participant = { required: true, signed: true, signedName: 'Test learner' };
    vi.mocked(signMigratedReviewAsCoach).mockResolvedValue(signed);
    vi.mocked(completeMigratedReview).mockResolvedValue(migratedDefinition('completed'));
    mount('imported-review:synthetic');
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm coach signature' }));
    expect(signMigratedReviewAsCoach).toHaveBeenCalledWith('imported-review:synthetic', 'data:image/png;base64,c2ln');
    fireEvent.click(await screen.findByRole('button', { name: 'Complete review' }));
    expect(completeMigratedReview).toHaveBeenCalledWith('imported-review:synthetic');
    expect(await screen.findByRole('button', { name: 'Download signed PDF' })).toBeVisible();
  });

  it('keeps migrated writes hidden in admin view-as mode', async () => {
    coachMode.isViewingAsCoach = true;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(migratedDefinition('awaiting-signature'));
    mount('imported-review:synthetic');
    expect(await screen.findByText('0 of 2 required signatures saved')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete review' })).not.toBeInTheDocument();
    expect(signMigratedReviewAsCoach).not.toHaveBeenCalled();
  });

  it('keeps the submitted review open and focuses the coach signature without requiring a second visit', async () => {
    const { onStatusChange, onClose } = mount();
    await screen.findByDisplayValue('Review the next module');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send for signatures' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send for signatures' }));
    expect(await screen.findByRole('heading', { name: 'Your coach signature is required' })).toBeVisible();
    expect(completeReviewInstance).toHaveBeenCalledWith('instance-1', { 'field-1': 'Review the next module' });
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('awaiting-signature');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send for signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('saves the final required signature and updates the completed state without closing', async () => {
    const pending = definition('awaiting-signature');
    pending.signatures.participant = { required: true, signed: true, signedName: 'Ayman Learner', signedAt: '2026-09-14T09:30:00Z' };
    const completed = structuredClone(pending);
    completed.instance.status = 'completed';
    completed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach', signedAt: '2026-09-14T10:00:00Z' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(pending);
    vi.mocked(signReviewInstance).mockResolvedValue(completed);
    const { onClose, onStatusChange } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm coach signature' }));
    expect(await screen.findByText('Review completed')).toBeVisible();
    expect(signReviewInstance).toHaveBeenCalledWith('instance-1', 'advisor', 'Sam Coach', 'data:image/png;base64,c2ln');
    expect(onStatusChange).toHaveBeenCalledWith('completed');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(screen.getByText('Your coach signature has been saved.')).toBeVisible();
  });

  it('prevents duplicate signing and leaves a failed signature available for retry', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('awaiting-signature'));
    let rejectSignature!: (reason: Error) => void;
    vi.mocked(signReviewInstance).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSignature = reject; }));
    const { onStatusChange } = mount();
    const sign = await screen.findByRole('button', { name: 'Confirm coach signature' });
    fireEvent.click(sign);
    expect(sign).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close form' })).toBeDisabled();
    fireEvent.click(sign);
    expect(signReviewInstance).toHaveBeenCalledTimes(1);
    await act(async () => rejectSignature(new Error('Connection lost')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(sign).toBeEnabled();
    expect(onStatusChange).not.toHaveBeenCalled();
    const signed = definition('awaiting-signature');
    signed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach' };
    vi.mocked(signReviewInstance).mockResolvedValueOnce(signed);
    fireEvent.click(sign);
    expect(await screen.findByText('Your coach signature has been saved.')).toBeVisible();
    expect(onStatusChange).toHaveBeenCalledWith('awaiting-signature');
  });

  it('does not produce a coach signature from the learner name when the account name is missing', async () => {
    account.name = '';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(definition('awaiting-signature'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account has no name on record');
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(signReviewInstance).not.toHaveBeenCalled();
  });

  it('keeps required field validation before the signature step', async () => {
    const draft = definition();
    draft.sections[0].fields[0].answer = '';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(draft);
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send for signatures' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send for signatures' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please complete every required field');
    expect(completeReviewInstance).not.toHaveBeenCalled();
    expect(signReviewInstance).not.toHaveBeenCalled();
  });

  it('does not ask a signed coach to sign again while the learner signature is pending', async () => {
    const signed = definition('awaiting-signature');
    signed.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(signed);
    mount();
    expect(await screen.findByText('Your part is complete. The review is waiting for the remaining required signatures.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for signatures' })).not.toBeInTheDocument();
  });

  it('shows direct completion for templates with no required signatures', async () => {
    const draft = definition();
    for (const role of ['advisor', 'participant'] as const) {
      draft.signatures[role].required = false;
      draft.template.signatures[role] = false;
    }
    const completed = structuredClone(draft);
    completed.instance.status = 'completed';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(draft);
    vi.mocked(completeReviewInstance).mockResolvedValue(completed);
    const { onStatusChange, onClose } = mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    expect(await screen.findByText('Review completed')).toBeVisible();
    expect(onStatusChange).toHaveBeenCalledWith('completed');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm coach signature' })).not.toBeInTheDocument();
  });
});

describe('Review Meeting Summary integration', () => {
  it('exposes the transcript summary controls for a Progress Review', async () => {
    const existing = mcmDefinition('in-progress');
    existing.template.reviewTypeCode = 'progress_review';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(await screen.findByText('AI Meeting Summary')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    expect(screen.getByText('Progress Review')).toBeVisible();
  });

  it('uses the semantic marker for the report editor while regular text fields keep the compact control', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();

    const regularEditor = await screen.findByDisplayValue('Review the next module');
    expect(regularEditor).toHaveAttribute('rows', '3');
    expect(regularEditor.className).not.toContain('h-[360px]');

    fireEvent.click(screen.getByRole('button', { name: /Meeting Summary/ }));
    const summaryEditor = screen.getByRole('textbox', { name: 'Meeting Summary' });
    expect(summaryEditor.className).toContain('h-[360px]');
    expect(summaryEditor).not.toHaveAttribute('rows');
    expect(screen.getByText('Review and finalise the meeting summary before sending the Review for signatures.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeVisible();
  });

  it('loads a stored AI suggestion into an empty mapped editor without saving it', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(await screen.findByDisplayValue('AI generated coaching summary.')).toBeVisible();
    expect(screen.getByText(/not saved automatically/i)).toBeVisible();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    expect(generateReviewMeetingSummary).not.toHaveBeenCalled();
  });

  it('keeps the existing formal answer authoritative over the AI suggestion', async () => {
    const existing = mcmDefinition('in-progress');
    existing.sections[1].fields[0].answer = 'Coach-approved draft wording.';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(await screen.findByDisplayValue('Coach-approved draft wording.')).toBeVisible();
    expect(screen.queryByDisplayValue('AI generated coaching summary.')).not.toBeInTheDocument();
  });

  it('does not replace a deliberately saved blank formal answer on open', async () => {
    const existing = mcmDefinition('in-progress');
    existing.sections[1].fields[0].answer = '';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    await screen.findByText('AI Meeting Summary');
    expect(screen.getAllByRole('textbox').at(-1)).toHaveValue('');
    expect(screen.queryByDisplayValue('AI generated coaching summary.')).not.toBeInTheDocument();
  });

  it('requires confirmation before generated text replaces editor content', async () => {
    const existing = mcmDefinition('in-progress');
    existing.sections[1].fields[0].answer = 'Keep this coach wording.';
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'New generated wording.' },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
    expect(await screen.findByRole('button', { name: 'Replace with generated summary' })).toBeVisible();
    expect(screen.getByDisplayValue('Keep this coach wording.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Replace with generated summary' }));
    expect(screen.getByDisplayValue('New generated wording.')).toBeVisible();
  });

  it('uploads a .vtt fallback and loads its AI result without saving automatically', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'Summary from uploaded transcript.' },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(screen.getByRole('button', { name: 'Upload .vtt & Generate' })).toBeVisible();

    const transcript = new File(
      ['WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nUploaded meeting notes.'],
      'meeting.vtt',
      { type: 'text/vtt' },
    );
    fireEvent.change(screen.getByLabelText('Select .vtt transcript'), { target: { files: [transcript] } });

    await waitFor(() => expect(generateReviewMeetingSummary).toHaveBeenCalledWith('instance-1', transcript));
    expect(await screen.findByDisplayValue('Summary from uploaded transcript.')).toBeVisible();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('keeps a truncated-transcript caveat visible after the generated text is applied', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: {
        fieldId: 'summary-field',
        status: 'ready',
        summaryText: 'Summary from the earlier part.',
        message: 'The uploaded transcript was longer than this summary can cover, so only its earlier part was used.',
      },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));

    const transcript = new File(
      ['WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nA very long meeting.'],
      'meeting.vtt',
      { type: 'text/vtt' },
    );
    fireEvent.change(screen.getByLabelText('Select .vtt transcript'), { target: { files: [transcript] } });

    // The step instruction must not displace the caveat: a recap built from
    // part of the meeting cannot be handed over looking complete.
    expect(await screen.findByText(/only its earlier part was used/)).toBeVisible();
    expect(screen.getByText(/Save the draft when you are satisfied with it/)).toBeVisible();
  });

  it('saves an uploaded AI summary with the other Review answers when Save draft is selected', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(generateReviewMeetingSummary).mockResolvedValue({
      meetingSummarySource: { fieldId: 'summary-field', status: 'ready', summaryText: 'Summary from uploaded transcript.' },
    });
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));

    const transcript = new File(
      ['WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nUploaded meeting notes.'],
      'meeting.vtt',
      { type: 'text/vtt' },
    );
    fireEvent.change(screen.getByLabelText('Select .vtt transcript'), { target: { files: [transcript] } });

    expect(await screen.findByDisplayValue('Summary from uploaded transcript.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'instance-1',
      expect.objectContaining({
        'field-1': 'Review the next module',
        'summary-field': 'Summary from uploaded transcript.',
      }),
    ));
  });

  it('supports a manually entered summary when no AI artifact is available', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'unavailable', summaryText: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const summaryEditor = screen.getAllByRole('textbox').at(-1)!;
    fireEvent.change(summaryEditor, { target: { value: 'Coach-written summary without AI.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'instance-1',
      expect.objectContaining({ 'summary-field': 'Coach-written summary without AI.' }),
    ));
    expect(generateReviewMeetingSummary).not.toHaveBeenCalled();
  });

  it('keeps the mapped summary editable beyond the unrelated 4,000 character field limit', async () => {
    const existing = mcmDefinition('in-progress');
    existing.meetingSummarySource = { fieldId: 'summary-field', status: 'ready', summaryText: 'S'.repeat(4500) };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const editor = await screen.findByDisplayValue('S'.repeat(4500));
    expect(editor).not.toHaveAttribute('maxLength');
  });

  it('preserves long multiline text across inline and expanded editing without saving automatically', async () => {
    const existing = mcmDefinition('in-progress');
    const longSummary = 'Overview\nLearner is progressing well.\n\nKey discussion points\n• Portfolio evidence\n• Functional skills\n\nNext steps\n1. Upload evidence';
    existing.sections[1].fields[0].answer = longSummary;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const inlineEditor = screen.getByRole('textbox', { name: 'Meeting Summary' });
    expect(inlineEditor).toHaveValue(longSummary);
    fireEvent.change(inlineEditor, { target: { value: `${longSummary}\n2. Confirm next meeting` } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));

    expect(screen.getByRole('region', { name: 'Edit Meeting Summary' }).className).toContain('h-[90vh]');
    const expandedEditor = screen.getByRole('textbox', { name: 'Expanded Meeting Summary' });
    expect(expandedEditor).toHaveFocus();
    expect(expandedEditor).toHaveValue(`${longSummary}\n2. Confirm next meeting`);
    fireEvent.change(expandedEditor, { target: { value: `${longSummary}\n2. Confirm next meeting\n3. Share resources` } });
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));

    expect(screen.getByRole('textbox', { name: 'Meeting Summary' })).toHaveValue(`${longSummary}\n2. Confirm next meeting\n3. Share resources`);
    expect(screen.getByRole('button', { name: 'Expand editor' })).toHaveFocus();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('closes expanded editing with Escape, keeps the typed value, and restores focus', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    const expandedEditor = screen.getByRole('textbox', { name: 'Expanded Meeting Summary' });
    const doneEditing = screen.getByRole('button', { name: 'Done editing' });
    expect(expandedEditor).toHaveFocus();
    fireEvent.keyDown(expandedEditor, { key: 'Tab' });
    expect(doneEditing).toHaveFocus();
    fireEvent.keyDown(doneEditing, { key: 'Tab', shiftKey: true });
    expect(expandedEditor).toHaveFocus();
    fireEvent.change(expandedEditor, { target: { value: 'Edited with the expanded surface.' } });
    fireEvent.keyDown(expandedEditor, { key: 'Escape' });

    expect(screen.queryByRole('heading', { name: 'Edit Meeting Summary' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Meeting Summary' })).toHaveValue('Edited with the expanded surface.');
    expect(screen.getByRole('button', { name: 'Expand editor' })).toHaveFocus();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
  });

  it('only reports a saved draft after the existing save request succeeds and clears it on a later edit', async () => {
    const existing = mcmDefinition('in-progress');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing);
    vi.mocked(saveReviewInstanceAnswers).mockResolvedValue(existing);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    const editor = screen.getByRole('textbox', { name: 'Meeting Summary' });
    fireEvent.change(editor, { target: { value: 'Coach-approved meeting report.' } });
    expect(screen.queryByText('Draft saved.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved.')).toBeVisible();
    expect(saveReviewInstanceAnswers).toHaveBeenCalledWith(
      'instance-1',
      expect.objectContaining({ 'summary-field': 'Coach-approved meeting report.' }),
    );

    fireEvent.change(editor, { target: { value: 'Coach-approved meeting report, amended.' } });
    expect(screen.queryByText('Draft saved.')).not.toBeInTheDocument();
  });

  it('keeps the semantic editor read-only at the signature stage, including when expanded', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('awaiting-signature'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Meeting Summary/ }));
    expect(screen.getByRole('textbox', { name: 'Meeting Summary' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Generate from Teams' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }));
    expect(screen.getByRole('textbox', { name: 'Expanded Meeting Summary' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});

describe('migrated signed PDF lifecycle', () => {
  function reviewFor(family: 'MCM' | 'PR' | 'PR_SKILLS_RADAR', status: string) {
    const review = family === 'MCM' ? migratedDefinition(status) : migratedPrDefinition(status, family);
    if (family === 'MCM') review.template.reviewTypeCode = 'aptem_mcm';
    if (status === 'completed') {
      for (const signature of Object.values(review.signatures)) signature.signed = signature.required;
    }
    return review;
  }

  it.each(['uninitialized', 'awaiting-signature'])('hides the premature signed PDF action for %s admin reviews', async state => {
    coachMode.isViewingAsCoach = true;
    const review = migratedPrDefinition(state === 'uninitialized' ? 'scheduled' : state, 'PR_SKILLS_RADAR');
    if (state === 'uninitialized') {
      review.migratedForm = false;
      review.previewOnly = true;
      review.localStatus = null;
      // The existing historical availability contract is also returned for previews.
      review.pdf = { available: true, reason: '', source: 'aptem' };
    }
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
    mount(review.instance.id);
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('button', { name: /^Download.*PDF$/ })).not.toBeInTheDocument();
    expect(downloadReviewInstancePdf).not.toHaveBeenCalled();
    expect(generateMigratedReviewPdf).not.toHaveBeenCalled();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  describe.each(['MCM', 'PR', 'PR_SKILLS_RADAR'] as const)('%s', family => {
    it.each([
      ['not-scheduled', false], ['scheduled', false], ['in-progress', false],
      ['awaiting-signature', false], ['awaiting-signature', true],
    ] as const)('hides downloads at %s with all signatures=%s even if availability is stale', async (status, signed) => {
      const review = reviewFor(family, status);
      for (const signature of Object.values(review.signatures)) signature.signed = signed && signature.required;
      review.pdf = { available: true, reason: '', source: 'lms-migrated' };
      vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
      mount(review.instance.id);
      await screen.findByDisplayValue('Review the next module');
      expect(screen.queryByRole('button', { name: /^Download.*PDF$/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Generate LMS review PDF' })).not.toBeInTheDocument();
      if (status === 'awaiting-signature') {
        expect(screen.getByRole('region', { name: 'Review signatures' })).toBeVisible();
        expect(Boolean(screen.queryByRole('button', { name: 'Complete review' }))).toBe(signed);
      }
      expect(downloadReviewInstancePdf).not.toHaveBeenCalled();
      expect(generateMigratedReviewPdf).not.toHaveBeenCalled();
    });

    it.each([false, true])('downloads completed stored PDFs without generation with admin=%s', async viewAs => {
      coachMode.isViewingAsCoach = viewAs;
      const review = reviewFor(family, 'completed');
      vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
      vi.mocked(downloadReviewInstancePdf).mockResolvedValue(undefined);
      mount(review.instance.id);
      const download = await screen.findByRole('button', { name: 'Download signed PDF' });
      expect(download).toBeEnabled();
      fireEvent.click(download);
      await waitFor(() => expect(downloadReviewInstancePdf).toHaveBeenCalledWith(review.instance.id));
      expect(generateMigratedReviewPdf).not.toHaveBeenCalled();
      expect(completeMigratedReview).not.toHaveBeenCalled();
    });

    it.each([false, true])('downloads missing completed PDFs without a separate generation action with admin=%s', async viewAs => {
      coachMode.isViewingAsCoach = viewAs;
      const review = reviewFor(family, 'completed');
      review.pdf = { available: false, reason: 'Generate the LMS review PDF after completion.' };
      vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
      let finish!: () => void;
      vi.mocked(downloadReviewInstancePdf).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
      mount(review.instance.id);
      const download = await screen.findByRole('button', { name: 'Download signed PDF' });
      expect(download).toBeEnabled();
      fireEvent.click(download);
      expect(screen.getByRole('button', { name: 'Preparing PDF...' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Preparing PDF...' }));
      expect(downloadReviewInstancePdf).toHaveBeenCalledExactlyOnceWith(review.instance.id);
      finish();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled());
      expect(generateMigratedReviewPdf).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Generate LMS review PDF' })).not.toBeInTheDocument();
      expect(completeMigratedReview).not.toHaveBeenCalled();
    });
  });

  it('keeps completion intact after PDF preparation fails and permits another download', async () => {
    const missing = reviewFor('PR', 'completed');
    delete missing.pdf;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(missing);
    vi.mocked(downloadReviewInstancePdf).mockRejectedValueOnce(new Error('Unable to prepare the signed PDF. Please try again.'))
      .mockResolvedValueOnce(undefined);
    mount(missing.instance.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Download signed PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to prepare the signed PDF. Please try again.');
    expect(screen.getByText('Review completed')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Download signed PDF' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled());
    expect(downloadReviewInstancePdf).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(generateMigratedReviewPdf).not.toHaveBeenCalled();
    expect(completeMigratedReview).not.toHaveBeenCalled();
  });
});

describe('Monthly Coaching Meeting signature summary + signed PDF', () => {
  it('does not offer migrated generation when a historical original PDF is unavailable', async () => {
    const imported = mcmDefinition('completed');
    imported.source = 'aptem';
    imported.migratedForm = false;
    imported.instance = { ...imported.instance, id: 'imported-review:historical', reviewTemplateId: '' };
    imported.template = { ...imported.template, reviewTypeCode: 'aptem_mcm' };
    imported.pdf = { available: false, reason: 'The original Aptem PDF is unavailable.' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(imported);
    mount(imported.instance.id);
    await screen.findByDisplayValue('Review the next module');
    const download = screen.getByRole('button', { name: 'Download signed PDF' });
    expect(download).toBeDisabled();
    fireEvent.click(download);
    expect(screen.queryByRole('button', { name: 'Generate LMS review PDF' })).not.toBeInTheDocument();
    expect(downloadReviewInstancePdf).not.toHaveBeenCalled();
    expect(generateMigratedReviewPdf).not.toHaveBeenCalled();
  });

  it('shows the same PDF download for a completed imported Aptem MCM', async () => {
    const imported = mcmDefinition('completed');
    imported.source = 'aptem';
    imported.instance = { ...imported.instance, id: 'imported-review:A-13276', reviewTemplateId: '' };
    imported.template = { ...imported.template, id: '', reviewTypeCode: 'aptem_mcm' };
    imported.signatures.advisor = { required: false, signed: false };
    imported.signatures.participant = { required: false, signed: false };
    imported.pdf = { available: true, reason: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(imported);
    vi.mocked(downloadReviewInstancePdf).mockResolvedValue(undefined);

    mount();

    const download = await screen.findByRole('button', { name: 'Download signed PDF' });
    expect(download).toBeEnabled();
    fireEvent.click(download);
    await waitFor(() => expect(downloadReviewInstancePdf).toHaveBeenCalledWith('imported-review:A-13276'));
  });

  it('shows the full signature summary and a disabled PDF button once at the signature stage, for the mcm review type only', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('awaiting-signature'));
    mount();
    expect(await screen.findByRole('region', { name: 'Review signatures' })).toBeVisible();
    expect(screen.getByText('0 of 2 required signatures saved')).toBeVisible();
    const download = screen.getByRole('button', { name: 'Download signed PDF' });
    expect(download).toBeDisabled();
    expect(screen.getByText('The PDF is available after the learner and all required parties have signed.')).toBeVisible();
  });

  it('does not show the signature summary or PDF button for a non-mcm review type at the same lifecycle stage', async () => {
    const nonMcm = definition('awaiting-signature');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(nonMcm);
    mount();
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Review signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download signed PDF' })).not.toBeInTheDocument();
  });

  it('does not show the signature summary or PDF button before the review reaches the signature stage', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Review signatures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download signed PDF' })).not.toBeInTheDocument();
  });

  it('downloads the same review instance the coach has open once the PDF is available', async () => {
    const ready = mcmDefinition('completed');
    ready.signatures.advisor = { required: true, signed: true, signedName: 'Sam Coach', signedAt: '2026-09-14T10:00:00Z' };
    ready.signatures.participant = { required: true, signed: true, signedName: 'Ayman Learner', signedAt: '2026-09-14T09:30:00Z' };
    ready.pdf = { available: true, reason: '' };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(ready);
    vi.mocked(downloadReviewInstancePdf).mockResolvedValue(undefined);
    mount();
    const download = await screen.findByRole('button', { name: 'Download signed PDF' });
    expect(download).toBeEnabled();
    fireEvent.click(download);
    await waitFor(() => expect(downloadReviewInstancePdf).toHaveBeenCalledWith('instance-1'));
  });
});

/** Classified as the canonical Progress Review type via the stable
 *  `reviewTypeCode` -- never by name/title. */
function progressReviewDefinition(status = 'in-progress', snapshot: ReviewProgressSnapshot | null = null): ReviewInstanceFormDefinition {
  const base = definition(status);
  return {
    ...base,
    template: { ...base.template, name: 'Progress Review', reviewTypeCode: 'progress_review' },
    progressSnapshot: snapshot,
    ragHistory: [],
  };
}

function snapshotFixture(overrides: Partial<ReviewProgressSnapshot> = {}): ReviewProgressSnapshot {
  return {
    calculationMethod: 'planned_hours',
    calculatedFrom: '2024-10-18',
    calculatedAt: '2026-09-16T14:35:00',
    calculatedBy: 'coach@example.com',
    weeksElapsed: 100,
    ksbProgress: { available: true, title: 'Project controls professional Apprenticeship Standard (v1.0) (Level 6)', actualPercent: 73, expectedPercent: 100, variancePercent: -27, varianceDirection: 'below' },
    programmeProgress: { actual: 28, expected: 30, planned: 100, actualPercent: 28, expectedPercent: 30, variancePercent: -2, varianceDirection: 'below' },
    offTheJobHours: { actual: 64, expected: 52, planned: 100, actualPercent: 64, expectedPercent: 52, variancePercent: 12, varianceDirection: 'above' },
    ...overrides,
  };
}

describe('Progress Review learning progress snapshot', () => {
  it.each([false, true])('keeps Native admin calculation hidden with snapshot=%s', async hasSnapshot => {
    coachMode.isViewingAsCoach = true;
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition('in-progress', hasSnapshot ? snapshotFixture() : null));
    mount();
    await screen.findByRole('region', { name: 'Learning progress' });
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
  });

  it('offers Calculate only on a Progress Review, and never calculates on its own when the form opens', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    mount();
    expect(await screen.findByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Calculate' })).toBeEnabled();
    // Opening the review must never trigger a calculation by itself.
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
  });

  it('does not offer the Learning Progress area on another review type', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(mcmDefinition('in-progress'));
    mount();
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Learning progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument();
  });

  it('renders the saved snapshot returned by the backend and then offers Recalculate', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    vi.mocked(calculateReviewInstanceProgress).mockResolvedValue(
      progressReviewDefinition('in-progress', snapshotFixture()),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }));
    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeEnabled();
    expect(calculateReviewInstanceProgress).toHaveBeenCalledWith('instance-1');
    // The learner's own start date, and the backend's own calculation time.
    expect(screen.getByText(/Calculated from 18 Oct 2024/)).toBeVisible();
    // Month abbreviations vary by ICU version ("Sep" / "Sept"), so match the
    // parts that carry the meaning: the backend's own calculation date.
    expect(screen.getByText(/Calculated at 16 Sept? 2026/)).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.getByText('12% Above')).toBeVisible();
    expect(screen.getByText('2% Below')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Learning Plan Progress: 28%' })).toBeVisible();
    expect(screen.getByText('27% Below')).toBeVisible();
  });

  it('disables repeated clicks while a calculation is in flight', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    let resolveCalculation!: (value: ReviewInstanceFormDefinition) => void;
    vi.mocked(calculateReviewInstanceProgress).mockImplementationOnce(
      () => new Promise((resolve) => { resolveCalculation = resolve; }),
    );
    mount();
    const calculate = await screen.findByRole('button', { name: 'Calculate' });
    fireEvent.click(calculate);
    const calculating = await screen.findByRole('button', { name: 'Calculating...' });
    expect(calculating).toBeDisabled();
    fireEvent.click(calculating);
    expect(calculateReviewInstanceProgress).toHaveBeenCalledTimes(1);
    await act(async () => resolveCalculation(progressReviewDefinition('in-progress', snapshotFixture())));
    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeEnabled();
  });

  it('locks the saved snapshot once the review reaches the signature step', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(
      progressReviewDefinition('awaiting-signature', snapshotFixture()),
    );
    mount();
    expect(await screen.findByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
  });

  it('keeps a completed review showing its own saved figures and its own RAG history', async () => {
    const completed = progressReviewDefinition('completed', snapshotFixture());
    completed.ragHistory = [
      { reviewInstanceId: 'instance-1', reviewName: 'Progress Review', occurrenceNumber: 2, targetDate: '2026-01-03', completedAt: '2026-01-14T10:00:00', rag: 'Green' },
      { reviewInstanceId: 'instance-0', reviewName: 'Progress Review', occurrenceNumber: 1, targetDate: '2025-04-16', completedAt: '2025-04-16T10:00:00', rag: '' },
    ];
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(completed);
    mount();
    expect(await screen.findByText('Review completed')).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.getAllByText('28%')).toHaveLength(2);
    expect(screen.getByText('Green')).toBeVisible();
    // A past review that captured no RAG still appears, as "None".
    expect(screen.getByText('None')).toBeVisible();
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
  });

  it('reports a backend refusal instead of showing an invented figure', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(progressReviewDefinition());
    vi.mocked(calculateReviewInstanceProgress).mockRejectedValue(
      new Error('This learner has no individual programme start date, so progress cannot be calculated.'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no individual programme start date');
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
  });
});

describe('migrated progress snapshot', () => {
  function migratedProgress(family: 'PR' | 'PR_SKILLS_RADAR', status = 'in-progress', snapshot: ReviewProgressSnapshot | null = null) {
    return { ...migratedPrDefinition(status, family), progressSnapshot: snapshot, progressVersion: 'v1',
      canCalculateProgress: ['not-scheduled', 'scheduled', 'in-progress'].includes(status) };
  }

  function migratedPreview(family: 'PR' | 'PR_SKILLS_RADAR', status = 'scheduled'): ReviewInstanceFormDefinition {
    const preview = { ...migratedPrDefinition(status, family), migratedForm: false, previewOnly: true,
      readOnly: true, canInitialize: false, localStatus: null, progressSnapshot: null,
      migratedTemplateResolution: { review_family: family, resolved_scope: 'GLOBAL',
        resolved_template_id: 21, uses_snapshot: false } };
    return preview;
  }

  it.each(['PR', 'PR_SKILLS_RADAR'] as const)('shows disabled Calculate in an uninitialized admin %s preview without requests', async family => {
    const user = userEvent.setup();
    coachMode.isViewingAsCoach = true;
    const initial = migratedPreview(family, family === 'PR' ? 'scheduled' : 'not-scheduled');
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    expect(await screen.findByRole('region', { name: 'Learning progress' })).toBeVisible();
    expect(screen.getByText('No progress snapshot calculated yet.')).toBeVisible();
    const button = screen.getByRole('button', { name: 'Calculate' });
    expect(button).toBeVisible();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('disabled');
    expect(button).toHaveAccessibleDescription('Available to the assigned Coach only.');
    expect(screen.queryByText('No progress was calculated for this review.')).not.toBeInTheDocument();
    const readsBefore = vi.mocked(fetchReviewInstanceForm).mock.calls.length;
    await user.click(button);
    button.focus();
    expect(button).not.toHaveFocus();
    await user.keyboard('{Enter} ');
    fireEvent.click(button);
    expect(fetchReviewInstanceForm).toHaveBeenCalledTimes(readsBefore);
    for (const action of [initializeMigratedReview, calculateMigratedReviewProgress, calculateReviewInstanceProgress,
      saveReviewInstanceAnswers, startMigratedReview, bookMigratedReview, submitMigratedReview,
      signMigratedReviewAsCoach, completeMigratedReview, generateMigratedReviewPdf,
      completeReviewInstance, reopenReviewInstance, signReviewInstance, generateReviewMeetingSummary]) {
      expect(action).not.toHaveBeenCalled();
    }
  });

  it.each(['PR', 'PR_SKILLS_RADAR'] as const)('keeps uninitialized %s calculation unavailable to the assigned coach', async family => {
    const initial = { ...migratedPreview(family), previewOnly: false, canInitialize: true };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    await screen.findByRole('region', { name: 'Learning progress' });
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(calculateMigratedReviewProgress).not.toHaveBeenCalled();
  });

  it.each([
    ['PR', 'awaiting-signature'], ['PR', 'completed'],
    ['PR_SKILLS_RADAR', 'awaiting-signature'], ['PR_SKILLS_RADAR', 'completed'],
  ] as const)('keeps terminal admin %s %s preview actions hidden', async (family, status) => {
    coachMode.isViewingAsCoach = true;
    const initial = migratedPreview(family, status);
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    await screen.findByRole('region', { name: 'Learning progress' });
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(calculateMigratedReviewProgress).not.toHaveBeenCalled();
  });

  it('keeps Calculate out of an uninitialized admin MCM preview', async () => {
    coachMode.isViewingAsCoach = true;
    const initial = migratedPreview('PR');
    initial.template.reviewTypeCode = 'aptem_mcm';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Learning progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
    expect(calculateMigratedReviewProgress).not.toHaveBeenCalled();
  });

  it('keeps synchronized questions visible when their section is renamed Learning Progress', async () => {
    const review = migratedProgress('PR', 'in-progress', snapshotFixture());
    review.sections[0].title = 'Learning Progress';
    review.sections[0].fields[0].title = 'New required progress reflection';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(review);
    mount(review.instance.id);
    expect(await screen.findByText('New required progress reflection')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('Review the next module');
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(calculateMigratedReviewProgress).not.toHaveBeenCalled();
  });

  it.each(['PR', 'PR_SKILLS_RADAR'] as const)('calculates %s explicitly and preserves unsaved answers', async (family) => {
    const initial = migratedProgress(family);
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    vi.mocked(calculateMigratedReviewProgress).mockResolvedValue({ ...initial, progressSnapshot: snapshotFixture(), progressVersion: 'v2' });
    mount(initial.instance.id);
    const button = await screen.findByRole('button', { name: 'Calculate' });
    expect(calculateMigratedReviewProgress).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved local answer' } });
    fireEvent.click(button);
    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeEnabled();
    expect(screen.getByDisplayValue('Unsaved local answer')).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(calculateMigratedReviewProgress).toHaveBeenCalledWith(initial.instance.id, 'v1');
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    await waitFor(() => expect(calculateMigratedReviewProgress).toHaveBeenLastCalledWith(initial.instance.id, 'v2'));
  });

  it.each(['not-scheduled', 'scheduled'])('allows initialized %s progress without starting or booking', async (status) => {
    const initial = migratedProgress('PR', status);
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    expect(await screen.findByRole('button', { name: 'Calculate' })).toBeEnabled();
    expect(startMigratedReview).not.toHaveBeenCalled();
    expect(bookMigratedReview).not.toHaveBeenCalled();
  });

  it.each(['awaiting-signature', 'completed'])('shows stored progress without actions when %s', async (status) => {
    const initial = migratedProgress('PR_SKILLS_RADAR', status, snapshotFixture());
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    expect(await screen.findByText('64%')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
  });

  it.each([
    ['PR', false], ['PR', true], ['PR_SKILLS_RADAR', false], ['PR_SKILLS_RADAR', true],
  ] as const)('shows inert admin %s calculation with snapshot=%s', async (family, hasSnapshot) => {
    const user = userEvent.setup();
    coachMode.isViewingAsCoach = true;
    const initial = { ...migratedProgress(family, 'in-progress', hasSnapshot ? snapshotFixture() : null),
      readOnly: true, canCalculateProgress: false };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    const button = await screen.findByRole('button', { name: hasSnapshot ? 'Recalculate' : 'Calculate' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Available to the assigned Coach only.');
    await user.click(button);
    button.focus();
    expect(button).not.toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(calculateMigratedReviewProgress).not.toHaveBeenCalled();
    expect(calculateReviewInstanceProgress).not.toHaveBeenCalled();
    expect(saveReviewInstanceAnswers).not.toHaveBeenCalled();
    if (hasSnapshot) expect(screen.getByText('64%')).toBeVisible();
  });

  it.each(['not-scheduled', 'scheduled'])('shows disabled admin calculation on an initialized %s review', async status => {
    coachMode.isViewingAsCoach = true;
    const initial = { ...migratedProgress('PR', status), canCalculateProgress: false };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    expect(await screen.findByRole('button', { name: 'Calculate' })).toBeDisabled();
    expect(startMigratedReview).not.toHaveBeenCalled();
    expect(bookMigratedReview).not.toHaveBeenCalled();
  });

  it.each(['awaiting-signature', 'completed'])('keeps terminal admin %s progress visible without actions', async status => {
    coachMode.isViewingAsCoach = true;
    const initial = migratedProgress('PR_SKILLS_RADAR', status, snapshotFixture());
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    expect(await screen.findByText('64%')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
  });

  it.each([false, true])('keeps calculation out of migrated MCM with admin=%s', async viewAs => {
    coachMode.isViewingAsCoach = viewAs;
    const initial = migratedDefinition();
    initial.template.reviewTypeCode = 'aptem_mcm';
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    await screen.findByDisplayValue('Review the next module');
    expect(screen.queryByRole('region', { name: 'Learning progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Calculate|Recalculate)$/ })).not.toBeInTheDocument();
  });

  it.each([false, true])('hides calculation for uninitialized source-only forms with admin=%s', async viewAs => {
    coachMode.isViewingAsCoach = viewAs;
    const initial = { ...migratedProgress('PR'), migratedForm: false, canCalculateProgress: false, readOnly: true };
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    mount(initial.instance.id);
    await screen.findByRole('region', { name: 'Learning progress' });
    expect(screen.queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument();
    expect(initializeMigratedReview).not.toHaveBeenCalled();
  });

  it('keeps the prior snapshot and unsaved text after a conflict and prevents duplicate clicks', async () => {
    const initial = migratedProgress('PR', 'in-progress', snapshotFixture());
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(initial);
    let rejectCalculation!: (error: Error) => void;
    vi.mocked(calculateMigratedReviewProgress).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCalculation = reject; }));
    mount(initial.instance.id);
    const button = await screen.findByRole('button', { name: 'Recalculate' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep local text' } });
    fireEvent.click(button);
    const pending = screen.getByRole('button', { name: 'Calculating...' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(calculateMigratedReviewProgress).toHaveBeenCalledTimes(1);
    await act(async () => rejectCalculation(new Error('This review changed. Reopen it.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('This review changed');
    expect(screen.getByDisplayValue('Keep local text')).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeEnabled();
  });
});
