import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assignmentReport, buildAssignmentReport } from './downloadAssignment';
import { loadLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { fetchEvidence, getEvidenceDownloadUrl } from '@/api/evidence';
import { createAssignmentPdf } from './assignmentPdf';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn(), getEvidenceDownloadUrl: vi.fn() }));
vi.mock('./assignmentPdf', () => ({ createAssignmentPdf: vi.fn() }));
const submission = { activityTitle: 'Assignment 5', assignmentAnswer: 'My answer', status: 'accepted', coachFeedback: '<script>alert(1)</script>\nFull feedback' } as StoredLearningReflectionSubmission;
const attachment = vi.fn();
const finish = vi.fn(() => new Blob(['%PDF'], { type: 'application/pdf' }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(submission);
  vi.mocked(createAssignmentPdf).mockResolvedValue({ attachment, finish });
  vi.mocked(fetchEvidence).mockResolvedValue([{ id: 'f1', filename: 'answer.txt' } as any]);
  vi.mocked(getEvidenceDownloadUrl).mockResolvedValue('/f1');
});
afterEach(() => vi.unstubAllGlobals());
it('includes the requested steps in order and excludes full-month reflection', () => {
  const monthly = { ...emptyMonthlyAssignment([], '2026-09'), understood: 'Understood example', gainedSkills: 'Skills example',
    timeEntries: [{ topic: 'Research', hours: '2', date: '2026-09-15' }],
    claims: [{ code: 'K1', explanation: 'KSB example', evidenceIds: [] }],
    careerImpact: 'Career example', actionPlan: 'Action example', epaPreparedness: 'EPA example',
    lmsReflection: 'EXCLUDED_LMS', extraActivities: 'EXCLUDED_EXTRA', integratedReflection: 'EXCLUDED_INTEGRATED' };
  const html = assignmentReport({ ...submission, monthlyAssignment: monthly });
  for (const value of ['Understood example', 'Skills example', 'Research', 'KSB example', 'Career example', 'Action example', 'EPA example']) expect(html).toContain(value);
  expect(html).not.toContain('EXCLUDED_');
  expect(html).not.toContain('Full-month reflection');
  expect(html).toContain('<table>');
  expect(html.indexOf('1. Assignment answer')).toBeLessThan(html.indexOf('3. KSBs'));
  expect(html.indexOf('5. Action plan')).toBeLessThan(html.indexOf('6. Coach assessment'));
});
it('preserves full answers and escaped feedback', () => {
  expect(assignmentReport(submission)).toContain('My answer');
  expect(assignmentReport(submission)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;\nFull feedback');
});
it('creates a PDF with only this assignment attachments', async () => {
  const bytes = new TextEncoder().encode('Submitted work').buffer;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/plain' }), arrayBuffer: async () => bytes }));
  const result = await buildAssignmentReport('commercial', '12', 'A5', '2026-09');
  expect(result.filename).toBe('Assignment 5 - September 2026.pdf');
  expect(result.blob.type).toBe('application/pdf');
  expect(fetchEvidence).toHaveBeenCalledWith('commercial', '12', { sectionRef: 'A5' });
  expect(attachment).toHaveBeenCalledWith('answer.txt', bytes, 'text/plain');
  expect(createAssignmentPdf).toHaveBeenCalledWith(expect.stringContaining('Full feedback'));
});
it('does not create an incomplete report when a file fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(buildAssignmentReport('commercial', '12', 'A5')).rejects.toThrow('Could not download answer.txt');
  expect(finish).not.toHaveBeenCalled();
});
it('resolves imported documents to their actual file URL', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ ...submission, legacyAssignment: { documents: [{ evidenceId: 42, part: 'report', name: 'Report.pdf' }] } } as StoredLearningReflectionSubmission);
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/original-pdf' }) }).mockResolvedValueOnce({ ok: false });
  vi.stubGlobal('fetch', fetcher);
  await expect(buildAssignmentReport('commercial', '12', 'A5')).rejects.toThrow('Could not download Report.pdf');
  expect(fetcher.mock.calls[1][0]).toBe('/original-pdf');
});
