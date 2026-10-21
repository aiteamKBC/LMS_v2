import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { lecturePresentationSections } from './lecturePresentation';
import { parsePostLectureQuestionBank, POST_LECTURE_BANK_TEMPLATE } from './postLectureQuestionBank';

const headings = ['Category', 'Question', 'Questions per lecture', 'Type'];
const validRows: unknown[][] = [
  headings,
  ['Teaching', 'Was the explanation clear?', 1, 'stars'],
  ['Teaching', 'Were the examples helpful?', 1, 'stars'],
  ['Resources', 'Were the materials useful?', 2, 'stars'],
  ['Resources', 'Were the activities useful?', 2, 'stars'],
  ['Resources', 'Were the tasks helpful?', 2, 'stars'],
  ['', 'What could we improve?', '', 'text'],
];

function spreadsheet(rows: unknown[][], name = 'bank.xlsx') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Questions');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes };
}

describe('post-lecture question bank import', () => {
  it('creates grouped five-star banks and a fixed final text question', async () => {
    const parsed = await parsePostLectureQuestionBank(spreadsheet(validRows));
    expect(parsed.ratingCount).toBe(5);
    expect(parsed.sections.map(section => [section.title, section.questionsPerDelivery, section.questions.length])).toEqual([
      ['Teaching', 1, 2], ['Resources', 2, 3], ['General comments', null, 1],
    ]);
    expect(parsed.sections[0].questions[0]).toMatchObject({ type: 'rating', required: true, config: { min: 1, max: 5, display: 'stars' } });
    expect(parsed.sections[2].questions[0]).toMatchObject({ type: 'long_text', text: 'What could we improve?' });
    const presentation = lecturePresentationSections('post_lecture', parsed.sections);
    expect(presentation).toHaveLength(1);
    expect(presentation[0].questions.at(-1)?.type).toBe('long_text');
    expect(lecturePresentationSections('general', parsed.sections)).toHaveLength(3);
  });

  it('reads the downloadable CSV template', async () => {
    const bytes = new TextEncoder().encode(`\uFEFF${POST_LECTURE_BANK_TEMPLATE}`);
    const parsed = await parsePostLectureQuestionBank({ name: 'template.csv', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer });
    expect(parsed.sections.map(section => section.questionsPerDelivery)).toEqual([1, 2, null]);
  });

  it.each([
    ['missing header', [['Category', 'Question', 'Type'], ...validRows.slice(1)], /Questions per lecture/],
    ['different draw counts within a category', [headings, ['Teaching', 'First?', 1, 'stars'], ['Teaching', 'Second?', 2, 'stars'], ...validRows.slice(3)], /same draw count/],
    ['not enough questions to vary', [headings, validRows[1], ...validRows.slice(3)], /needs more questions/],
    ['duplicate question', [headings, ...validRows.slice(1, 3), ['Resources', 'Was the explanation clear?', 2, 'stars'], ...validRows.slice(4)], /duplicate question/],
    ['missing final text', validRows.slice(0, -1), /closing text question/],
    ['extra final text', [...validRows, ['', 'Other thoughts?', '', 'text']], /only one closing/],
  ])('rejects %s', async (_label, rows, expected) => {
    await expect(parsePostLectureQuestionBank(spreadsheet(rows as unknown[][]))).rejects.toThrow(expected as RegExp);
  });
});
