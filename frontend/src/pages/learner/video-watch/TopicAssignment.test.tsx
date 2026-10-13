import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TopicAssignment } from './TopicAssignment';
import { loadAssignmentTopicStates, selectAssignmentTopic } from '@/api/assignmentTopics';
import { assignmentTopics } from '@/lib/assignmentTopics';

vi.mock('@/api/assignmentTopics', () => ({ loadAssignmentTopicStates: vi.fn(), selectAssignmentTopic: vi.fn() }));
vi.mock('./AssignmentSubmissionWizard', () => ({ AssignmentSubmissionForm: (props: {
  title: string; assignmentTopicId: string; questionText: string; onTopicSubmitted?: () => void;
  onManualDraftSaved?: () => void; onSubmitProgress: (answers: unknown) => Promise<void>;
  instructionsHtml?: string; questionFiles?: { url: string }[];
}) => <div><h3>{props.title}</h3><p>{props.questionText}</p><span>Form topic {props.assignmentTopicId}</span>
  <span data-testid="form-guidance" data-instructions={props.instructionsHtml} data-files={(props.questionFiles || []).map(file => file.url).join(',')} />
  <button onClick={props.onManualDraftSaved}>Save draft</button>
  <button onClick={async () => { await props.onSubmitProgress({ assignmentTopicId: props.assignmentTopicId }); props.onTopicSubmitted?.(); }}>Submit topic</button></div> }));
vi.mock('../monthly-submission/AssignmentAttachment', () => ({ AssignmentAttachment: ({ fileName, url, defaultExpanded, pdfTools }: {
  fileName: string; url: string; defaultExpanded: boolean; pdfTools: boolean;
}) => <span data-testid="instruction-file" data-url={url} data-open={defaultExpanded} data-pdf-tools={pdfTools}>{fileName}</span> }));
const topics = assignmentTopics([1, 2, 3].map(id => ({ id: String(id), name: `Choice ${id}`, question: `Question ${id}`, instructions: `Read topic ${id}`, resources: id === 2 ? [{ fileName: 'guide.mp4', url: '/curriculum_api/curriculum/uploads/guide.mp4', contentType: 'video/mp4', size: 3 }] : [] })));
const props = { topics, kind: 'commercial' as const, learnerId: 'synthetic-1', learnerName: 'Test learner', programmeName: 'Test programme',
  componentId: 'A1', title: 'Monthly assignment', moduleTitle: 'Module', weekTitle: 'Week', initialMonth: '2026-10',
  plannedOtjh: 4, ksbMappings: [], evidenceFiles: [], evidenceDetails: {} as never, timeSeconds: 30, timeControl: null,
  submittingProgress: false, onEvidenceChanged: vi.fn(), onRestoreTime: vi.fn(), onSubmitProgress: vi.fn().mockResolvedValue(undefined) };
beforeEach(() => { localStorage.clear(); vi.mocked(loadAssignmentTopicStates).mockResolvedValue([]); vi.mocked(selectAssignmentTopic).mockResolvedValue(undefined); vi.clearAllMocks(); });
afterEach(cleanup);

it('opens both instruction PDFs with reading tools and keeps files scoped to the selected topic', async () => {
  const files = ['brief', 'guidance'].map(name => ({ url: `/curriculum_api/curriculum/uploads/${name}.pdf`, fileName: `${name}.pdf`, contentType: 'application/pdf', size: 10 }));
  const choices = assignmentTopics([
    { ...topics[0], resources: files, instructions: `<p>Read both PDFs</p><a href="${files[1].url}">Guidance PDF</a>` },
    topics[1],
  ]);
  render(<TopicAssignment {...props} topics={choices} />);
  fireEvent.click(await screen.findByRole('button', { name: /Topic 1.*Choice 1/ }));
  const previews = screen.getAllByTestId('instruction-file');
  expect(previews.map(preview => preview.getAttribute('data-url'))).toEqual(files.map(file => file.url));
  for (const preview of previews) {
    expect(preview).toHaveAttribute('data-open', 'true');
    expect(preview).toHaveAttribute('data-pdf-tools', 'true');
  }
  fireEvent.click(screen.getByRole('button', { name: /Topic 2.*Choice 2/ }));
  expect(screen.queryByTestId('instruction-file')).toBeNull();
  expect(document.querySelector('video')).toHaveAttribute('src', '/curriculum_api/curriculum/uploads/guide.mp4');
  expect(selectAssignmentTopic).not.toHaveBeenCalled();
});

it('records the chosen topic before opening its question and unlocks remaining topics after submit', async () => {
  render(<TopicAssignment {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Topic 2.*Choice 2/ }));
  expect(screen.getByText('Read topic 2')).toBeVisible();
  expect(document.querySelector('video')).toHaveAttribute('src', '/curriculum_api/curriculum/uploads/guide.mp4');
  expect(screen.queryByText('Form topic 2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Form topic 2')).toBeVisible();
  expect(selectAssignmentTopic).toHaveBeenCalledWith(expect.objectContaining({ assignmentTopicId: '2', activityId: 'A1', plannedOtjh: '4', month: '2026-10' }));
  expect(screen.getByText('Question 2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Submit topic' }));
  expect(await screen.findByText(/Assignment submitted/)).toBeVisible();
  expect(screen.getByRole('button', { name: /Topic 2.*Locked/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Topic 1.*Available/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /Topic 3.*Available/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Form topic 3')).toBeVisible();
  expect(selectAssignmentTopic).toHaveBeenLastCalledWith(expect.objectContaining({ assignmentTopicId: '3', plannedOtjh: '4' }));
});

it('resumes only the saved topic and supports saving and pausing without losing the form', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([{ topicId: '1', status: 'draft', elapsedSeconds: 70 }]);
  render(<TopicAssignment {...props} />);
  expect(await screen.findByRole('button', { name: /Topic 2.*Available/ })).toBeDisabled();
  expect(screen.getByRole('timer', { name: 'Time on this activity: 00 hours, 01 minutes, 10 seconds' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(screen.getByText('Form topic 1')).toBeVisible();
  expect(selectAssignmentTopic).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(screen.getByRole('button', { name: 'Submit topic' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(screen.getByRole('button', { name: 'Submit topic' })).toBeEnabled();
});

it('does not open a form or fabricate a saved selection after a failed Next request', async () => {
  vi.mocked(selectAssignmentTopic).mockRejectedValue(new Error('Topic save failed'));
  render(<TopicAssignment {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Topic 1.*Available/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Topic save failed');
  expect(screen.queryByText('Form topic 1')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

it('preserves an existing legacy submission and blocks unknown state until retry succeeds', async () => {
  vi.mocked(loadAssignmentTopicStates).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([{ topicId: '', status: 'accepted', elapsedSeconds: 0 }]);
  render(<TopicAssignment {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Monthly assignment' })).toBeVisible());
});

it('goes straight into a single topic and keeps the imported link list out of its instructions', async () => {
  const imported = '<p><strong>Additional materials</strong></p><ul><li><a href="https://old.example.test/guide.pdf" target="_blank" rel="noreferrer">Guide &amp; template</a></li></ul>';
  const [only] = assignmentTopics([{ id: '1', question: 'Analyse the campaign.', instructions: imported, resources: [] }]);
  render(<TopicAssignment {...props} topics={[only]} />);
  expect(await screen.findByText('Analyse the campaign.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Topic 1/ })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Instructions' })).toBeNull();
  const resources = screen.getByRole('region', { name: 'Resources' });
  expect(within(resources).getByRole('link', { name: /Guide & template/ })).toHaveAttribute('href', 'https://old.example.test/guide.pdf');
  expect(screen.queryByTestId('instruction-file')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Form topic 1')).toBeVisible();
  expect(selectAssignmentTopic).toHaveBeenCalledWith(expect.objectContaining({ assignmentTopicId: '1' }));
  expect(screen.getByTestId('form-guidance')).toHaveAttribute('data-instructions', '');
});

it('shows the question and instructions as separate sections and passes topic files to the form', async () => {
  render(<TopicAssignment {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Topic 2.*Choice 2/ }));
  expect(within(screen.getByRole('region', { name: 'Assignment question' })).getByText('Question 2')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Instructions' })).getByText('Read topic 2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const guidance = await screen.findByTestId('form-guidance');
  expect(guidance).toHaveAttribute('data-instructions', 'Read topic 2');
  expect(guidance).toHaveAttribute('data-files', '/curriculum_api/curriculum/uploads/guide.mp4');
});

it('keeps work saved on a topic the author has since emptied reachable, and its instructions reopenable', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([{ topicId: '3', status: 'draft', elapsedSeconds: 5 }]);
  render(<TopicAssignment {...props} topics={topics.slice(0, 2)} />);
  expect(await screen.findByRole('button', { name: /Topic 3.*Draft saved/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Topic 1.*Available/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(screen.getByText('Form topic 3')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'View instructions' }));
  expect(screen.queryByText('Form topic 3')).toBeNull();
  expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  expect(selectAssignmentTopic).not.toHaveBeenCalled();
});
