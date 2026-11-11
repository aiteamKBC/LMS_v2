import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReflectionWindow } from '../ReflectionWindow';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), upload: vi.fn() }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: mocks.load, saveLearningReflectionSubmission: mocks.save }));
vi.mock('@/api/reflectionVoice', () => ({ proofreadLearningReflection: vi.fn(), transcribeVoiceReflection: vi.fn() }));
vi.mock('@/api/evidence', () => ({ uploadEvidence: mocks.upload }));

const props = {
  learnerKsbs: [], autoKsbs: [], elapsedSeconds: 60, selectedTimeSeconds: 60, plannedTimeLabel: '30m',
  learnerKind: 'apprenticeship' as const, learnerId: 'synthetic-1', evidenceSectionRef: 'reading-1', noun: 'reading',
  submitting: false, submitError: null, onSubmit: vi.fn(),
};
const draftKey = 'reflection-draft:apprenticeship:synthetic-1:reading:reading-1';
const answer = () => screen.getByPlaceholderText('Type or use the microphone...');
const changeAnswer = (value: string) => fireEvent.change(answer(), { target: { value } });
const settle = async () => { await act(async () => {}); };
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(950); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('AppIcon', () => <i />);
  mocks.load.mockResolvedValue(null);
  mocks.save.mockResolvedValue({ status: 'draft' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

it.each(['commercial', 'apprenticeship'] as const)('restores %s KSB choices without inventing a missing confidence rating', async learnerKind => {
  mocks.load.mockResolvedValue({ status: 'draft', ksbCodes: ['K1'], ksbExplanations: { K1: 'Applied the learning.' },
    confidenceBefore: {}, confidenceAfter: { K1: 3 }, learningReflection: 'Saved reflection', actualTimeHours: '0.5' });
  render(<ReflectionWindow {...props} learnerKind={learnerKind}
    learnerKsbs={[{ code: 'K1', type: 'K', number: '1', description: 'Programme knowledge' }]} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'KSBs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose KSBs' }));
  expect(screen.getByRole('checkbox', { name: /K1/ })).toBeChecked();
  expect(screen.getByRole('slider', { name: 'K1: Confidence before' })).toHaveAttribute('aria-valuetext', 'Not rated');
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ confidenceBefore: {}, confidenceAfter: { K1: 3 } }));
  fireEvent.click(screen.getByRole('button', { name: 'K1: set confidence before to 1 out of 5' }));
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ ksbCodes: ['K1'],
    ksbExplanations: { K1: 'Applied the learning.' }, confidenceBefore: { K1: 1 }, confidenceAfter: { K1: 3 },
    learningReflection: 'Saved reflection' }));
});

it.each(['commercial', 'apprenticeship'] as const)('saves and reopens %s programme choices beyond activity mappings without adding weight', async learnerKind => {
  const ksbs = [
    { code: 'K1', type: 'K', number: '1', description: 'Programme knowledge' },
    { code: 'S2', type: 'S', number: '2', description: 'Programme skill' },
  ];
  const activityKsbs = [{ code: 'K1', description: null, weight: 20, classification: 'main' }];
  const renderWindow = () => render(<ReflectionWindow {...props} learnerKind={learnerKind} learnerKsbs={ksbs} autoKsbs={activityKsbs} />);
  const first = renderWindow();
  await settle();
  changeAnswer('My saved learning');
  fireEvent.click(screen.getByRole('button', { name: 'KSBs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose KSBs' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /K1/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /S2/ }));
  fireEvent.change(screen.getByPlaceholderText(/Why is S2 relevant/), { target: { value: 'My own evidence for this skill.' } });
  fireEvent.change(screen.getByRole('slider', { name: 'S2: Confidence before' }), { target: { value: '2' } });
  fireEvent.change(screen.getByRole('slider', { name: 'S2: Confidence after' }), { target: { value: '4' } });
  await tick();
  const payload = mocks.save.mock.lastCall![0];
  expect(payload).toEqual(expect.objectContaining({ ksbCodes: ['K1', 'S2'], ksbWeights: { K1: 20, S2: 0 },
    learningReflection: 'My saved learning', ksbExplanations: { S2: 'My own evidence for this skill.' },
    confidenceBefore: { S2: 2 }, confidenceAfter: { S2: 4 } }));
  expect(props.onSubmit).not.toHaveBeenCalled();
  first.unmount();
  mocks.load.mockResolvedValue({ ...payload, status: 'draft' });
  renderWindow();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'KSBs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose KSBs' }));
  expect(screen.getByRole('checkbox', { name: /S2/ })).toBeChecked();
  expect(screen.getByPlaceholderText(/Why is S2 relevant/)).toHaveValue('My own evidence for this skill.');
  expect(screen.getByRole('slider', { name: 'S2: Confidence before' })).toHaveAttribute('aria-valuetext', '2 out of 5');
  expect(screen.getByText('20% weight')).toBeInTheDocument();
  expect(screen.queryByText('0% weight')).not.toBeInTheDocument();
});

it('keeps a saved code outside the current programme visible and in the next draft', async () => {
  mocks.load.mockResolvedValue({ status: 'draft', ksbCodes: ['K99'], ksbWeights: { K99: 15 },
    ksbExplanations: { K99: 'Original explanation' }, confidenceBefore: { K99: 2 }, confidenceAfter: { K99: 4 } });
  render(<ReflectionWindow {...props}
    learnerKsbs={[{ code: 'K1', type: 'K', number: '1', description: 'Current knowledge' }]}
    autoKsbs={[{ code: 'K1', description: null, weight: 20, classification: 'main' }]} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'KSBs' }));
  expect(screen.getByText(/This saved KSB is outside the current programme list/)).toBeVisible();
  expect(screen.getByPlaceholderText(/Why is K99 relevant/)).toHaveValue('Original explanation');
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ ksbCodes: ['K99'], ksbWeights: { K99: 15 },
    ksbExplanations: { K99: 'Original explanation' }, confidenceBefore: { K99: 2 }, confidenceAfter: { K99: 4 } }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose KSBs' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /K1/ }));
  expect(screen.queryByText('35%')).not.toBeInTheDocument();
  expect(screen.getAllByText('20%')).toHaveLength(2); // Total and Knowledge: only the current mapping.
  fireEvent.click(screen.getByRole('button', { name: 'Remove K99' }));
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ ksbCodes: ['K1'], ksbWeights: { K1: 20 } }));
});

it('keeps an accepted reflection locked and displays its saved weight rather than a changed mapping', async () => {
  mocks.load.mockResolvedValue({ status: 'accepted', ksbCodes: ['K1'], ksbWeights: { K1: 20 },
    ksbExplanations: { K1: 'Accepted explanation' }, confidenceBefore: { K1: 2 }, confidenceAfter: { K1: 4 } });
  render(<ReflectionWindow {...props}
    learnerKsbs={[{ code: 'K1', type: 'K', number: '1', description: 'Programme knowledge' }]}
    autoKsbs={[{ code: 'K1', description: null, weight: 40, classification: 'main' }]} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'KSBs' }));
  expect(screen.getByText('Programme knowledge')).toBeVisible();
  expect(screen.getByText('20% weight')).toBeVisible();
  expect(screen.queryByText('40% weight')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choose KSBs' })).toBeDisabled();
  expect(screen.getByPlaceholderText(/Why is K1 relevant/)).toBeDisabled();
  await tick();
  expect(mocks.save).not.toHaveBeenCalled();
});

it.each(['commercial', 'apprenticeship'] as const)('automatically saves the latest %s draft without completing the activity', async learnerKind => {
  render(<ReflectionWindow {...props} learnerKind={learnerKind} />);
  await settle();
  changeAnswer('First words');
  changeAnswer('My latest unfinished answer ');
  expect(mocks.save).not.toHaveBeenCalled();
  await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    learnerKind, learnerId: 'synthetic-1', activityId: 'reading-1',
    submissionMode: 'draft', learningReflection: 'My latest unfinished answer ',
  }));
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it('does not overwrite a draft while it is still loading', async () => {
  let resolve!: (value: unknown) => void;
  mocks.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<ReflectionWindow {...props} />);
  await tick();
  expect(answer()).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => resolve({ status: 'draft', learningReflection: 'Existing server answer' }));
  expect(answer()).toHaveValue('Existing server answer');
});

it('keeps edits made during a slow save and does not report the old snapshot as saved', async () => {
  let resolve!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<ReflectionWindow {...props} />);
  await settle();
  changeAnswer('Old answer');
  await tick();
  changeAnswer('Latest answer');
  await act(async () => resolve({ status: 'draft' }));
  expect(screen.getByRole('status')).not.toHaveTextContent('All changes saved');
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ learningReflection: 'Latest answer' }));
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
});

it('shows a failed save and recovers the answer and section after reopening', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Connection unavailable'));
  const first = render(<ReflectionWindow {...props} />);
  await settle();
  changeAnswer('Keep this unfinished answer');
  fireEvent.click(screen.getByRole('button', { name: 'OTJH' }));
  await tick();
  expect(screen.getByText('Connection unavailable')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Draft not saved to server');
  first.unmount();
  render(<ReflectionWindow {...props} />);
  await settle();
  expect(screen.getByLabelText('Date completed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Learning' }));
  expect(answer()).toHaveValue('Keep this unfinished answer');
  await tick();
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
});

it('restores local answers offline but waits to verify the server record before writing', async () => {
  localStorage.setItem(draftKey, JSON.stringify({ learningReflection: 'Offline recovery', tab: 'learning' }));
  mocks.load.mockRejectedValueOnce(new Error('Cannot load the saved reflection'));
  render(<ReflectionWindow {...props} />);
  await settle();
  expect(answer()).toHaveValue('Offline recovery');
  changeAnswer('Edited offline recovery');
  await tick();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading saved reflection' }));
  await settle();
  expect(answer()).toHaveValue('Edited offline recovery');
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ learningReflection: 'Edited offline recovery' }));
});

it.each(['accepted', 'submitted_for_tutor_review'])('does not autosave over a %s submission or resurrect its local draft', async status => {
  localStorage.setItem(draftKey, JSON.stringify({ learningReflection: 'Old local draft' }));
  mocks.load.mockResolvedValue({ status, learningReflection: 'Submitted answer', actualTimeHours: '0.5' });
  render(<ReflectionWindow {...props} />);
  await settle();
  expect(answer()).toHaveValue('Submitted answer');
  await tick();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(localStorage.getItem(draftKey)).toBeNull();
});

it('isolates drafts when the learner or activity changes', async () => {
  const view = render(<ReflectionWindow {...props} />);
  await settle();
  changeAnswer('First learner answer');
  view.rerender(<ReflectionWindow {...props} learnerId="synthetic-2" evidenceSectionRef="reading-2" />);
  await settle();
  expect(answer()).toHaveValue('');
  changeAnswer('Second learner answer');
  await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'synthetic-2', activityId: 'reading-2', learningReflection: 'Second learner answer' }));
  expect(JSON.parse(localStorage.getItem(draftKey)!).learningReflection).toBe('First learner answer');
});

it('prefers a newer server draft over a previously synced browser copy', async () => {
  localStorage.setItem(draftKey, JSON.stringify({ learningReflection: 'Older saved copy', synced: true, tab: 'learning' }));
  mocks.load.mockResolvedValue({ status: 'draft', learningReflection: 'Updated on another device' });
  render(<ReflectionWindow {...props} />);
  await settle();
  expect(answer()).toHaveValue('Updated on another device');
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ learningReflection: 'Updated on another device' }));
});

it('waits for an in-flight autosave before final submission and never sends a draft afterwards', async () => {
  mocks.load.mockResolvedValue({ status: 'draft', learningReflection: 'Learning '.repeat(100),
    applicationType: 'apply_now', applicationText: 'Apply at work', selectedBenefits: ['Improved productivity'],
    benefitExplanation: 'Help the team', actualTimeHours: '0.5', dateCompleted: '2026-10-01',
    completedDuringPaidHours: 'yes', otjhConfirmed: true, signedDeclaration: true });
  let resolve!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const onSubmit = vi.fn();
  render(<ReflectionWindow {...props} onSubmit={onSubmit} />);
  await settle();
  await tick();
  changeAnswer('Updated learning '.repeat(100));
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.save.mockResolvedValue({ status: 'submitted_for_tutor_review' });
  await act(async () => resolve({ status: 'draft' }));
  await tick();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ submissionMode: 'submit', learningReflection: 'Updated learning '.repeat(100).trim() }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(draftKey)).toBeNull();
});

it('orders a reopened reflection submission after the previous window has finished saving', async () => {
  mocks.load.mockResolvedValue({ status: 'draft', learningReflection: 'Learning '.repeat(100),
    applicationType: 'apply_now', applicationText: 'Apply at work', selectedBenefits: ['Improved productivity'],
    benefitExplanation: 'Help the team', dateCompleted: '2026-10-01',
    completedDuringPaidHours: 'yes', otjhConfirmed: true, signedDeclaration: true });
  let resolve!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = render(<ReflectionWindow {...props} />);
  await settle();
  await tick();
  first.unmount();
  render(<ReflectionWindow {...props} />);
  await settle();
  changeAnswer('Latest reflection '.repeat(100));
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  await settle();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.save.mockResolvedValue({ status: 'submitted_for_tutor_review' });
  await act(async () => resolve({ status: 'draft' }));
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ submissionMode: 'submit', learningReflection: 'Latest reflection '.repeat(100).trim() }));
});
