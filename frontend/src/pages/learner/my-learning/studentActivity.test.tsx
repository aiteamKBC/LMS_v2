import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentActivityResponse, SubjectMaterial, SubjectAttemptResult } from '@/api/studentActivity';
import type { LearnerDetail } from '@/api/learnerDetail';
import * as api from '@/api/studentActivity';
import { ModulesTab, StudentActivityPanel } from './page';
import { StudentMaterial } from './StudentMaterial';

// AppIcon is normally supplied by the app build's auto-import plugin.
vi.stubGlobal('AppIcon', () => <span />);

const data: StudentActivityResponse = {
  learner_name: 'Anna Rundell', count: 2, unique_activity_count: 2,
  module_count: 1, completed_count: 1, actual_total: 0, planned_total: null,
  mapped_count: 1, planned_mapped_count: 0,
  activities: [
    { activity_id: 'la:1:10', source_activity_id: 10, group_id: 1, group_name: 'Leadership',
      date: null, category: 'video', activity: 'Introduction', status: 'completed',
      completed: true, actual: 0, planned: 0, hours_mapped: true, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
    { activity_id: 'la:1:11', source_activity_id: 11, group_id: 1, group_name: 'Leadership',
      date: null, category: 'reading', activity: 'Reflection', status: null,
      completed: false, actual: 0, planned: 0, hours_mapped: false, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
  ],
};

function expandMonthAndWeek(month = 'February 2026') {
  fireEvent.click(screen.getByRole('button', { name: `Expand ${month}` }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Expand ${month}, `) }));
}

describe('learner subject cards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the linked Builder title and image without offering uploads in the learner workspace', async () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({
      covers: { 'legacy:1': image }, can_manage: true, persistence_ready: true,
      builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Updated Leadership' } },
    });
    const { container } = render(<StudentActivityPanel data={{ ...data, can_manage_covers: true }} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    expect(await screen.findByRole('img', { name: 'Updated Leadership cover' })).toHaveAttribute('src', image);
    expect(screen.getByText('1 of 2 completed')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText('Upload image')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Updated Leadership/ }));
    expandMonthAndWeek('Undated activities');
    expect(screen.getByText('Introduction')).toBeVisible();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('clears an old subject image when its Builder cover is removed', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({
      covers: { 'legacy:1': '' },
      builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Updated Leadership' } },
    });
    render(<StudentActivityPanel data={{ ...data, covers: { 'legacy:1': 'https://example.com/old.png' } }} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Updated Leadership' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('loads on opening Modules and ignores an old learner response after navigation', async () => {
    let resolveAnna!: (value: StudentActivityResponse) => void;
    const fetch = vi.spyOn(api, 'fetchStudentActivity')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAnna = resolve; }))
      .mockResolvedValueOnce({ ...data, learner_name: 'Amy-Marie Field' });
    const real = { studentActivityAvailable: true } as LearnerDetail;
    const { rerender } = render(<ModulesTab key="132" real={real} loading={false} loadError={null} kind="commercial" id="132" showReadOnlyNotice={false} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('commercial', '132', expect.any(AbortSignal)));
    rerender(<ModulesTab key="133" real={real} loading={false} loadError={null} kind="commercial" id="133" showReadOnlyNotice={false} />);
    expect(await screen.findByText('Amy-Marie Field')).toBeInTheDocument();
    await act(async () => { resolveAnna(data); });
    expect(screen.queryByText('Anna Rundell')).not.toBeInTheDocument();
    expect(fetch.mock.calls[0][2]?.aborted).toBe(true);
  });
  it('opens a subject card and distinguishes missing OTJH from recorded zero', () => {
    render(<StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Anna Rundell')).toBeInTheDocument();
    expect(within(screen.getByText('Planned OTJH').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(within(screen.getByText('Recorded OTJH').parentElement!).queryByText('Unavailable')).not.toBeInTheDocument();
    const module = screen.getByRole('button', { name: /Leadership/ });
    fireEvent.click(module);
    expandMonthAndWeek('Undated activities');
    expect(screen.getByRole('button', { name: 'All subjects' })).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Not complete')).toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
    expect(screen.getByText(/OTJH: Unavailable/)).toBeInTheDocument();
  });

  it('filters activities without changing the full module completion or hours summary', () => {
    render(<StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Reflection' } });
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expandMonthAndWeek('Undated activities');
    expect(screen.getByText('1 of 2 completed')).toBeInTheDocument();
    expect(screen.queryByText('Introduction')).not.toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
  });

  it('offers retry on a failed fetch', () => {
    const retry = vi.fn();
    render(<StudentActivityPanel data={null} loading={false} error="Database unavailable" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

const scheduledData: StudentActivityResponse = {
  ...data, count: 3, unique_activity_count: 3,
  activities: [
    { ...data.activities[0], date: '2026-02-05', month: '2026-02', week_start: '2026-02-02', week_end: '2026-02-08' },
    { ...data.activities[1], date: '2026-02-06', month: '2026-02', week_start: '2026-02-02', week_end: '2026-02-08' },
    { ...data.activities[1], activity_id: 'la:1:12', source_activity_id: 12, activity: 'March lesson', date: '2026-03-02', month: '2026-03', week_start: '2026-03-02', week_end: '2026-03-08' },
  ],
};

const activityMaterial: SubjectMaterial = {
  title: 'Reflection', reading_html: '', media: [{ kind: 'embed', url: 'https://example.org/lesson', title: 'Reflection frame' }],
  quiz: null, has_reading: true, available: true, source_live: true, completed: false,
  persistence_ready: true, can_attempt: true, csrf_token: 'csrf-value', history: [],
  historical: { score: null, maximum_score: null, passed: null, attempt_number: null, status: null, answers: [] },
};
const completeResult: SubjectAttemptResult = { score_percent: null, passed: null, completed: true };

function mockMaterialRequests(material = activityMaterial, save: () => Promise<SubjectAttemptResult> = async () => completeResult) {
  return vi.spyOn(api, 'subjectRequest').mockImplementation(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    if (url.includes('/subject-covers/')) return { covers: {} } as T;
    if (options?.method !== 'POST') return material as T;
    if (url.endsWith('/attempts/')) return { attempt_id: 'attempt-1', definition: { quiz: material.quiz } } as T;
    return await save() as T;
  });
}

describe('subject months, weeks and completion', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts with months and weeks closed and reveals activities only after both are opened', async () => {
    mockMaterialRequests();
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expect(screen.getByRole('button', { name: 'Expand February 2026' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Expand March 2026' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Week 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reflection' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Reflection frame')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand February 2026' }));
    const week = screen.getByRole('button', { name: /^Expand February 2026, Week 1/ });
    expect(week).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Reflection' })).not.toBeInTheDocument();
    fireEvent.click(week);
    expect(screen.getByRole('button', { name: 'Reflection' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'March lesson' })).not.toBeInTheDocument();
    fireEvent.click(week);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse February 2026' }));
    expect(screen.queryByRole('button', { name: /^Expand February 2026, Week 1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand February 2026' }));
    expect(week).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(week);
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    expect(await screen.findByTitle('Reflection frame')).toHaveAttribute('src', 'https://example.org/lesson');
    expect(screen.getByRole('button', { name: 'Reflection' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    expect(screen.queryByTitle('Reflection frame')).not.toBeInTheDocument();
    expandMonthAndWeek('March 2026');
    expect(screen.getByRole('button', { name: 'March lesson' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expect(screen.getByRole('button', { name: 'Expand February 2026' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Week 1/ })).not.toBeInTheDocument();
  });

  it('keeps course, month and week progress based on all activities while searching', () => {
    render(<StudentActivityPanel data={scheduledData} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Reflection' } });
    expandMonthAndWeek();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
    expect(screen.getByRole('progressbar', { name: 'February 2026 progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('progressbar', { name: /^February 2026, Week 1/ })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/1 ÷ 3 × 100 = 33.33%/)).toBeInTheDocument();
  });

  it('shows the parent lecture and keeps date confirmation visible when a month is folded', () => {
    const activities = scheduledData.activities.map((item) => item.source_activity_id === 12
      ? { ...item, section_title: 'Course templates', date_source: 'original_created_at', date_needs_review: true }
      : { ...item, section_title: 'Lecture 1 - 06/02/2026', date_source: 'section_title', date_needs_review: false });
    render(<StudentActivityPanel data={{ ...scheduledData, activities }} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expandMonthAndWeek();
    expandMonthAndWeek('March 2026');
    expect(screen.getAllByText('Lecture: Lecture 1 - 06/02/2026')).toHaveLength(2);
    expect(screen.getByText('Date awaiting confirmation (original record).')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse March 2026' }));
    const month = screen.getByRole('region', { name: 'March 2026' });
    expect(within(month).getAllByText('1 activity date needs confirmation.')[0]).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
  });

  it('updates all progress after Submit succeeds, preserves it on refresh failure and never counts reopening twice', async () => {
    let finish!: (result: SubjectAttemptResult) => void;
    const pending = new Promise<SubjectAttemptResult>((resolve) => { finish = resolve; });
    const requests = mockMaterialRequests(activityMaterial, () => pending);
    vi.spyOn(api, 'fetchStudentActivity').mockResolvedValueOnce(scheduledData).mockRejectedValueOnce(new Error('Refresh unavailable'));
    render(<ModulesTab real={{ studentActivityAvailable: true } as LearnerDetail} loading={false} loadError={null} kind="commercial" id="132" showReadOnlyNotice={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    expandMonthAndWeek();
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    const submit = await screen.findByRole('button', { name: 'Submit & complete' });
    const frame = screen.getByTitle('Reflection frame');
    expect(submit.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Activity completion' })).getByText('Not complete')).toBeVisible();
    fireEvent.click(submit);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
    await waitFor(() => expect(requests.mock.calls.some(([url]) => url.endsWith('/attempt-1/'))).toBe(true));
    await act(async () => { finish(completeResult); });
    expect(await screen.findByText('Activity completed.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Activity completion' })).getByText('Complete')).toBeVisible();
    expect(await screen.findByText(/Refresh unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '66.67');
    expect(screen.getByRole('progressbar', { name: 'February 2026 progress' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: /^February 2026, Week 1/ })).toHaveAttribute('aria-valuenow', '100');
    const submitted = requests.mock.calls.find(([url]) => url.endsWith('/attempt-1/'))![1]!;
    expect(JSON.parse(submitted.body as string)).toEqual({ answers: {}, reading_confirmed: true });
    expect(submitted.headers).toMatchObject({ 'X-CSRFToken': 'csrf-value' });
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    expect(within(screen.getByRole('group', { name: 'Reflection activity' })).getByText('Complete')).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Reflection activity' })).queryByText('Not complete')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    await screen.findByTitle('Reflection frame');
    expect(screen.queryByRole('button', { name: 'Submit & complete' })).not.toBeInTheDocument();
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    expect(screen.getByText('2 of 3 completed')).toBeInTheDocument();
  });

  it('keeps progress unchanged on a failed submit and retries the same attempt', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Could not save')).mockResolvedValueOnce(completeResult);
    const requests = mockMaterialRequests(activityMaterial, save);
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expandMonthAndWeek();
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit & complete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
    fireEvent.click(screen.getByRole('button', { name: 'Submit & complete' }));
    await screen.findByText('Activity completed.');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '66.67');
    expect(requests.mock.calls.filter(([url, options]) => url.endsWith('/attempts/') && options?.method === 'POST')).toHaveLength(1);
  });

  it('explains the disabled Submit button to staff and removes it for a completed activity', async () => {
    const requests = mockMaterialRequests({ ...activityMaterial, can_attempt: false });
    const { unmount } = render(<StudentMaterial kind="commercial" learnerId="132" groupId={1} activityId={11} />);
    await screen.findByTitle('Reflection frame');
    const submit = screen.getByRole('button', { name: 'Submit & complete' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/Viewing read-only\. Only the learner can submit/);
    fireEvent.click(submit);
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    unmount();
    requests.mockRestore();
    mockMaterialRequests({ ...activityMaterial, completed: true });
    render(<StudentMaterial kind="commercial" learnerId="132" groupId={1} activityId={11} />);
    await screen.findByText('This activity is complete and included in your progress.');
    expect(screen.queryByRole('button', { name: 'Submit & complete' })).not.toBeInTheDocument();
  });

  it('keeps the completion button visible with a reason when saving is unavailable', async () => {
    const requests = mockMaterialRequests({ ...activityMaterial, persistence_ready: false, can_attempt: false });
    render(<StudentMaterial kind="commercial" learnerId="132" groupId={1} activityId={11} />);
    const submit = await screen.findByRole('button', { name: 'Submit & complete' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/Saving progress is temporarily unavailable/);
    expect(screen.queryByText(/Viewing read-only/)).not.toBeInTheDocument();
    fireEvent.click(submit);
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });

  it('requires quiz answers and reading confirmation before saving Complete and updating progress', async () => {
    const quiz: SubjectMaterial = { ...activityMaterial, quiz: {
      id: 'q', body: '', ready: true, message: '', passing_percent: 70,
      questions: [{ id: '1', type: 'single_choice', text: 'Pick an answer', options: [{ id: 'a', text: 'Choice A' }] }],
    } };
    const requests = mockMaterialRequests(quiz, async () => ({ score_percent: 80, passed: true, completed: true }));
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expandMonthAndWeek();
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }));
    const submit = await screen.findByRole('button', { name: 'Submit answers' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Choice A'));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have completed the reading material.'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await screen.findByText(/Attempt saved: 80%/);
    expect(within(screen.getByRole('region', { name: 'Activity completion' })).getByText('Complete')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '66.67');
    const submitted = requests.mock.calls.find(([url]) => url.endsWith('/attempt-1/'))![1]!;
    expect(JSON.parse(submitted.body as string)).toEqual({ answers: { '1': ['a'] }, reading_confirmed: true });
  });

  it('does not increase completion when a quiz attempt fails', async () => {
    const quiz: SubjectMaterial = { ...activityMaterial, has_reading: false, quiz: {
      id: 'q', body: '', ready: true, message: '', passing_percent: 70,
      questions: [{ id: '1', type: 'single_choice', text: 'Pick an answer', options: [{ id: 'a', text: 'Choice A' }] }],
    } };
    mockMaterialRequests(quiz, async () => ({ score_percent: 0, passed: false, completed: false }));
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expandMonthAndWeek();
    fireEvent.click(screen.getByRole('button', { name: 'Reflection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await waitFor(() => expect(screen.getByLabelText('Choice A')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Choice A'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    await screen.findByText(/Attempt saved: 0%/);
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
  });
});
