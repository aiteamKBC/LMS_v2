import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportedReviewSection as Section } from '@/api/reviewHistory';
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';
import { LearnerReviewInstanceForm } from '../LearnerReviewInstanceForm';
import { ImportedReviewSection, ImportedValue } from './ImportedReviewSection';
import { adaptDefinitionSection, calendarLabel, normalizeImportedProgress } from './presentation';
import { progressExample, skillsExample } from './presentationFixtures';

vi.mock('@/features/monthly-logs/page', () => ({ LearnerLogs: () => null }));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({ SignaturePad: () => null }));
afterEach(cleanup);

const section = (name: string, fields: Section['fields'], rawText = ''): Section => ({ id: 'synthetic-section', name, fields, rawText, order: 0, tables: [] });
const definition = (source = 'aptem'): LearnerReviewDefinition => ({
  source, readOnly: true, manualOverride: null,
  instance: { id: 'imported-review:example-42', reviewTemplateId: '', learnerId: 900, programmeId: 'example', occurrenceNumber: null, targetDate: '2026-10-04', status: 'completed', startedAt: null, completedAt: '2026-10-04' },
  template: { id: 'example-template', name: 'Progress Review (+ Skills Radar)', reviewTypeCode: 'aptem_progress_review',
    signatures: { advisor: true, participant: true, employer: false, referrer: false }, visibleTo: { advisor: true, participant: true, employer: true, referrer: false }, recurrence: { interval: 0, unit: 'none' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [{ id: 'info', title: 'Learner information', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
    { id: 'name', title: 'Name', fieldType: 'text_multiline', required: false, displayOrder: 0, configuration: { imported: true }, answer: 'Alex Example' },
    { id: 'date', title: 'PROGRAMMESTARTDATE', fieldType: 'text_multiline', required: false, displayOrder: 1, configuration: { imported: true }, answer: '2024-10-18T00:00:00' },
  ] }],
  signatures: { advisor: { required: true, signed: true }, participant: { required: true, signed: true }, employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
});

describe('imported learner presentation', () => {
  it('formats learner information, retains labels and avoids duplicate raw export text', () => {
    render(<ImportedReviewSection section={section('Learner information', [{ label: 'Name', value: 'Alex Example' }, { label: 'PROGRAMMESTARTDATE', value: '2024-10-18T00:00:00' }, { label: 'Programme', value: 'Example programme' }], 'Name: Alex Example\nPROGRAMMESTARTDATE: 2024-10-18T00:00:00')} />);
    expect(screen.getByRole('heading', { name: 'Alex Example' })).toBeVisible();
    expect(screen.getByText('Programme Start Date')).toBeVisible();
    expect(screen.getByText('18/10/2024')).toBeVisible();
    expect(screen.queryByText(/T00:00/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Alex Example')).toHaveLength(1);
  });

  it.each([progressExample, JSON.stringify(progressExample), { progress: progressExample }])('renders semantic progress for arrays, JSON and wrapped objects', value => {
    const { container } = render(<ImportedReviewSection section={section('Learning progress', [{ label: 'hasPrevProgress', value: 'Yes' }, { label: 'progress', value }])} />);
    expect(screen.getByRole('img', { name: '107 completed of 169 activities' })).toBeVisible();
    expect(screen.getByText('62')).toBeVisible();
    expect(screen.getByText('117')).toBeVisible();
    expect(screen.getByText('Behind')).toBeVisible();
    expect(screen.getByText('110%')).toBeVisible();
    ['837h', '867h', '957h', '1,302h', '18/10/2024', '17/04/2028'].forEach(v => expect(screen.getByText(v)).toBeVisible());
    expect(container.textContent).not.toMatch(/completedCount|progressType|hasPrevProgress|T00:00/);
  });

  it('does not assume submitted is zero or invent targets/dates', () => {
    const cards = normalizeImportedProgress(progressExample);
    expect(cards[0]).toMatchObject({ submitted: null, completed: 107, total: 169 });
    expect(normalizeImportedProgress({ progressType: 4, current: 0 })[0]).toMatchObject({ current: 0, target: null, status: null });
    expect(normalizeImportedProgress({ progressType: 7 })[0]).toMatchObject({ dates: [] });
    expect(normalizeImportedProgress({ progressType: 2, completedCount: 4, totalCount: 10, submittedCount: 2 })[0]).toMatchObject({ submitted: 2, remaining: 4 });
  });

  it.each([null, undefined, '', '{"broken":', [], {}])('handles missing or malformed progress without raw fallback: %j', value => {
    const { container } = render(<ImportedReviewSection section={section('Learning progress', [{ label: 'progress', value }])} />);
    expect(container.textContent).not.toMatch(/broken|undefined|\{\"/);
  });

  it('renders MCM paragraphs/lists/emphasis and strips executable HTML', () => {
    const { container } = render(<ImportedReviewSection section={section('Meeting Summary', [{ label: 'Summary', value: '<h3>Summary</h3><p>Discussion <strong>complete</strong></p><ul><li>Point one</li></ul><ol><li>Next step</li></ol><script>alert(1)</script><iframe src="https://example.invalid"></iframe><img src=x onerror="alert(1)"><a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a><a href="https://example.invalid/help">Guidance</a>' }])} />);
    expect(container.querySelector('p strong')).toHaveTextContent('complete');
    expect(screen.getByText('Point one').tagName).toBe('LI');
    expect(container.querySelector('script,iframe,img,[onclick],[onerror],[href^="javascript:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/<p>|<li>|alert\(1\)/);
    expect(screen.getByRole('link', { name: 'Guidance' })).toHaveAttribute('href', 'https://example.invalid/help');
  });

  it('renders booleans consistently, preserves numeric answers and omits empty metadata', () => {
    const { container } = render(<ImportedReviewSection section={section('Progress Checks', [{ label: 'Agreed', value: true }, { label: 'Support requested', value: 'FALSE' }, { label: 'Rating', value: 1 }, { label: 'Empty', value: {} }, { label: 'eventKey', value: 'private-key' }])} />);
    expect(screen.getByText('Yes')).toBeVisible(); expect(screen.getByText('No')).toBeVisible(); expect(screen.getByText('1')).toBeVisible();
    expect(container.textContent).not.toMatch(/Empty|private-key|eventKey/);
  });

  it('presents Skills Radar assessed and unassessed characteristics without IDs or invented scores', () => {
    const { container } = render(<ImportedReviewSection section={section('Skill Radar', [{ label: 'Competency 1', value: JSON.stringify(skillsExample) }])} />);
    expect(screen.getByRole('heading', { name: 'Plan and communicate work' })).toBeVisible();
    expect(screen.getByText('Level 3')).toBeVisible(); expect(screen.getByText('Not assessed')).toBeVisible();
    expect(screen.getByText('13/07/2026')).toBeVisible();
    expect(container.textContent).not.toMatch(/characteristicId|characteristicsLevelId|999|123|readOnly/);
    fireEvent.click(screen.getByText('Assessment scale'));
    expect(screen.getByText('Beginning')).toBeVisible();
  });

  it('uses readable lists and objects for unknown structured answers, including nested dates', () => {
    render(<ImportedValue value={JSON.stringify({ futureNotes: ['Keep learning'], reviewedDate: '2026-10-05T00:00:00', sourceKey: 'hidden' })} />);
    expect(screen.getByText('Future Notes')).toBeVisible(); expect(screen.getByText('Keep learning')).toBeVisible(); expect(screen.getByText('05/10/2026')).toBeVisible();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
  });

  it('formats calendar components even with offsets, without machine-timezone shifts', () => {
    expect(calendarLabel('2027-03-29T00:00:00+14:00')).toBe('29/03/2027');
    expect(calendarLabel('2026-10-05T23:15:00Z', true)).toBe('05/10/2026 at 23:15');
    expect(calendarLabel('2026-02-30')).toBeNull();
  });

  it('preserves plain text with brackets and explicitly cleared answers', () => {
    render(<ImportedValue value="[Not applicable]" />);
    expect(screen.getByText('[Not applicable]')).toBeVisible();
    const data = definition();
    expect(adaptDefinitionSection(data.sections[0], { name: null }).fields[0].value).toBeNull();
  });

  it('keeps historical imported identity, original type, readonly form and accordion controls', async () => {
    const data = definition(); const before = JSON.stringify(data);
    render(<LearnerReviewInstanceForm definition={data} />);
    expect(await screen.findByText('18/10/2024')).toBeVisible();
    expect(screen.getByRole('heading', { name: /Progress Review \(\+ Skills Radar\)/ })).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save my answers' })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Learner information' });
    expect(button).toHaveAttribute('aria-expanded', 'true'); fireEvent.click(button); expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.stringify(data)).toBe(before); expect(data.instance?.id).toBe('imported-review:example-42');
  });

  it('retains permitted overlay editing, action fields and saves only learner answers', async () => {
    const data = definition(); data.readOnly = false; data.migratedForm = true; data.instance!.status = 'in_progress';
    data.sections[0].fields.push({ id: 'reflection', title: 'Your reflection', fieldType: 'text', required: true, displayOrder: 2, configuration: { respondentRoles: ['participant'] }, answer: 'Draft reflection' },
      { id: 'action', title: 'Recorded action', fieldType: 'action_button', required: false, displayOrder: 3, configuration: {} });
    const save = vi.fn().mockResolvedValue(data);
    render(<LearnerReviewInstanceForm definition={data} onSaveAnswers={save} />);
    const input = await screen.findByDisplayValue('Draft reflection'); expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Recorded action' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Updated reflection' } }); fireEvent.click(screen.getByRole('button', { name: 'Save my answers' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ reflection: 'Updated reflection' }));
    expect(screen.getByText('18/10/2024')).toBeVisible();
  });

  it('leaves native form fields in their existing renderer', async () => {
    const data = definition('curriculum');
    render(<LearnerReviewInstanceForm definition={data} />);
    const form = await screen.findByTestId('learner-review-instance-form');
    expect(within(form).queryByText('18/10/2024')).not.toBeInTheDocument();
    expect(within(form).getByDisplayValue('2024-10-18T00:00:00')).toBeDisabled();
    expect(within(form).getByDisplayValue('Alex Example')).toBeDisabled();
  });
});
