import { inflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildJournalPdf, pdfDuration, type JournalPdfAssets } from './journalPdf';
import type { MonthDetail, Summary } from './api';

const assets: JournalPdfAssets = {
  logo: { format: 'PNG', data: new Uint8Array(readFileSync('public/assets/kbc-logo.png')) },
  signatures: new Map(),
};
const month: MonthDetail = { month: '2026-05', status: 'awaiting_signature', row_count: 2, planned_hours: 10,
  training_plan_target: 1, actual_hours: 1, not_accepted_hours: 1.81, student_signature: null, coach_signature: null,
  pending_revisions: 0, can_complete: false, source_finalization: null, snapshot_digest: 'saved',
  profile: { start_date: '2026-05-20', first_evidence_date: '2026-05-20', planned_end_date: '2027-06-01' },
  rows: [
    { id: 1, source_ref: 'asg:77098:evidence:123456789', category: 'assignment', title: 'Assignment 1 L4 MARKETING EXEC.docx',
      activity_date: '2026-05-20', activity_time: null, timestamp_label: 'input', planned_hours: 10, actual_hours: 1,
      accepted: true, completion_note: null, documents: [], results: [], ksb_codes: ['B2', 'K5', 'S2'] },
    { id: 2, source_ref: 'la:101477:126339', category: 'reading+quiz', title: 'Apprentice Charter Agreement',
      activity_date: '2026-05-20', activity_time: null, timestamp_label: '09:36:41–11:25:34', planned_hours: 0, actual_hours: 1.81,
      accepted: false, completion_note: null, documents: [], results: [], ksb_codes: ['B5', 'B8', 'K1', 'K5', 'S6'] },
  ],
};
const summary: Summary = { is_legacy: true, state: 'in_progress', can_access_lms: false, months: [month],
  learner: { id: 1, aptem_id: 42, name: 'Aaron Chesworth', programme: 'Marketing Executive Level 4 - June 2026', coach_name: 'Med Maher' } };

// Inspect real PDF page streams; image streams are irrelevant to these text
// checks. This verifies the generated document without mocking table drawing.
function pdfText(doc: ReturnType<typeof buildJournalPdf>) {
  const pdf = doc.output();
  return [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try {
      const stream = inflateSync(Buffer.from(match[1], 'binary')).toString('latin1');
      // Join drawn text lines so wrapped KSB cells can be checked in full.
      return [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
        .map(text => text[1].replace(/\\([\\()])/g, '$1')).join(' ');
    } catch { return ''; }
  }).join('\n');
}

describe('learner journal PDF', () => {
  it('exports saved hours, KSBs and acceptance with a separate sign-off page', () => {
    const doc = buildJournalPdf(summary, [month], assets);
    const content = pdfText(doc);
    expect(doc.getNumberOfPages()).toBe(2);
    for (const value of ['Learner Journal', 'Aaron Chesworth', 'Marketing Executive Level 4 - June 2026', 'Med Maher',
      '2026-05-20', 'B2, K5, S2', 'B5, B8, K1, K5, S6', '1h 00m', '1h 49m', '0h 00m', 'Yes', 'No', 'Accepted total', 'Not accepted total',
      'Report sign-off', 'No saved signature', 'Page 1 of 2', 'Page 2 of 2']) expect(content).toContain(value);
    expect(content).not.toContain('10h 00m'); // Plan target is not the activity's planned time.
    expect(content).not.toContain('Learning topic:'); // The source has no report-level topic.
  });
  it('preserves missing targets instead of claiming a zero target or variance', () => {
    const content = pdfText(buildJournalPdf(summary, [{ ...month, training_plan_target: null }], assets));
    expect(content).not.toContain('0h 00m');
    expect(pdfDuration(null)).toBe('-');
    expect(pdfDuration(-1.5)).toBe('-1h 30m');
    expect(pdfDuration('1.999')).toBe('2h 00m');
  });
  it('sorts all months and includes each month and its signatures once', () => {
    const earlier = { ...month, month: '2026-04', student_signature: { url: '/saved.png', signer_name: 'Saved name', signed_at: '2026-05-10' } };
    const doc = buildJournalPdf(summary, [month, earlier], { ...assets, signatures: new Map([['/saved.png', assets.logo]]) });
    const content = pdfText(doc);
    expect(doc.getNumberOfPages()).toBe(4);
    expect(content.indexOf('April 2026')).toBeLessThan(content.indexOf('May 2026'));
    expect(content.match(/Saved name/g)).toHaveLength(1);
    expect(content).toContain('2026-05-10');
    expect(content).toContain('Page 4 of 4');
  });
  it('does not silently omit saved signatures', () => {
    expect(() => buildJournalPdf(summary, [{ ...month, student_signature: { url: '/missing.png', signer_name: 'Saved name', signed_at: '2026-05-10' } }], assets)).toThrow('saved signature is missing');
  });
  it('paginates long activity logs without dropping rows', () => {
    const longMonth = { ...month, rows: Array.from({ length: 70 }, (_, index) => ({ ...month.rows[0], id: index, title: `Evidence entry ${String(index).padStart(3, '0')} with a detailed description that must wrap within its cell` })) };
    const doc = buildJournalPdf(summary, [longMonth], assets);
    const content = pdfText(doc);
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    for (let index = 0; index < 70; index++) expect(content.match(new RegExp(`Evidence entry ${String(index).padStart(3, '0')}`, 'g'))).toHaveLength(1);
    expect(content).toContain('Activity log continued');
    expect(content).toContain(`Page ${doc.getNumberOfPages()} of ${doc.getNumberOfPages()}`);
  });
});
