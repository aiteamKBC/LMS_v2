import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lecturePresentationSections } from './lecturePresentation';
import { parsePostLectureQuestionBank, POST_LECTURE_BANK_TEMPLATE, QUESTION_BANK_TYPES, QUESTION_BANK_ANSWER_TYPES } from './postLectureQuestionBank';

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
    expect(parsed.questionCount).toBe(6);
    expect(parsed.categoryCount).toBe(2);
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

  it('reads every builder question type from the downloadable UTF-8 CSV template', async () => {
    const bytes = new TextEncoder().encode(`\uFEFF${POST_LECTURE_BANK_TEMPLATE}`);
    const parsed = await parsePostLectureQuestionBank({ name: 'template.csv', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer });
    expect(parsed.sections.map(section => section.questionsPerDelivery)).toEqual([1, 1, 1, 1, 1, 1]);
    const questions = parsed.sections.flatMap(section => section.questions);
    expect(new Set(questions.map(question => question.type))).toEqual(new Set(QUESTION_BANK_TYPES));
    expect(questions.find(question => question.config.display === 'numbers')?.config).toMatchObject({ min: 1, max: 5 });
    expect(questions.find(question => question.type === 'multiple_choice')).toMatchObject({
      required: true, config: { options: ['Slides', 'Workbook', 'Recording'] },
    });
  });

  it('imports all types from Excel without a draw-count column or a closing question', async () => {
    const rows = [
      ['Category', 'Question', 'Type', 'Options', 'Required', 'Help text'],
      ...QUESTION_BANK_TYPES.map(type => ['Mixed', `Question for ${type}?`, type, 'First | Second', 'no', 'Help']),
    ];
    const parsed = await parsePostLectureQuestionBank(spreadsheet(rows));
    expect(parsed.categoryCount).toBe(1);
    expect(parsed.closingQuestion).toBeNull();
    expect(parsed.sections[0].questionsPerDelivery).toBe(1);
    expect(parsed.sections[0].questions.map(question => question.type)).toEqual(QUESTION_BANK_TYPES);
    expect(parsed.sections[0].questions.every(question => !question.required && question.helpText === 'Help')).toBe(true);
  });

  it('accepts all friendly answer names and separate option columns in numeric order', async () => {
    const parsed = await parsePostLectureQuestionBank(spreadsheet([
      ['Category', 'Question', 'Answer type', 'Option 2', 'Option 1', 'Option 10'],
      ...QUESTION_BANK_ANSWER_TYPES.map(type => ['Mixed', `Question for ${type.label}?`, type.label, 'Second', 'First', 'Tenth']),
    ]));
    const questions = parsed.sections[0].questions;
    expect(new Set(questions.map(question => question.type))).toEqual(new Set(QUESTION_BANK_TYPES));
    expect(questions[0]).toMatchObject({ type: 'rating', config: { display: 'stars', max: 5 } });
    expect(questions.find(question => question.type === 'single_choice')?.config.options).toEqual(['First', 'Second', 'Tenth']);
    expect(questions.find(question => question.type === 'long_text')?.required).toBe(false);
  });

  it('keeps punctuation inside separate choices instead of treating it as a delimiter', async () => {
    const parsed = await parsePostLectureQuestionBank(spreadsheet([
      ['Category', 'Question', 'Answer type', 'Option 1', 'Option 2'],
      ['Teaching', 'Choose one?', 'Choose one', 'Discussion | Practice', 'A, B and C'],
    ]));
    expect(parsed.sections[0].questions[0].config.options).toEqual(['Discussion | Practice', 'A, B and C']);
  });

  it('imports the actual downloadable Excel template and verifies its dropdown and freeze panes', async () => {
    const bytes = await readFile(resolve('public/templates/post-lecture-question-bank.xlsx'));
    const array = Uint8Array.from(bytes);
    const parsed = await parsePostLectureQuestionBank({ name: 'template.xlsx', size: array.byteLength, arrayBuffer: async () => array.buffer });
    expect(parsed.sections.map(section => [section.title, section.questionsPerDelivery, section.questions.length])).toEqual([
      ['Teaching', 1, 3], ['Resources', 1, 3], ['General', 1, 1],
    ]);
    expect(parsed.sections[1].questions[2]).toMatchObject({ type: 'single_choice', config: { options: ['Slides', 'Workbook', 'Practice'] } });
    const archive = await JSZip.loadAsync(array);
    const xml = await archive.file('xl/worksheets/sheet1.xml')!.async('string');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    const validation = document.querySelector('dataValidation');
    expect(validation?.getAttribute('type')).toBe('list');
    expect(validation?.getAttribute('sqref')).toBe('C2:C1001');
    const choices = validation?.querySelector('formula1')?.textContent?.replace(/^"|"$/g, '').split(',');
    expect(choices).toEqual(QUESTION_BANK_ANSWER_TYPES.map(type => type.label));
    expect(choices!.join(',').length).toBeLessThanOrEqual(255);
    expect(document.querySelector('pane')?.getAttribute('xSplit')).toBe('2');
    expect(document.querySelector('pane')?.getAttribute('ySplit')).toBe('1');
  });

  it('accepts a legacy count once per category and permits drawing the entire category', async () => {
    const parsed = await parsePostLectureQuestionBank(spreadsheet([
      headings, ['Teaching', 'First?', 2, 'stars'], ['teaching', 'Second?', '', 'yes_no'],
    ]));
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]).toMatchObject({ title: 'Teaching', questionsPerDelivery: 2 });
    expect(parsed.sections[0].questions).toHaveLength(2);
    expect(lecturePresentationSections('post_lecture', parsed.sections)).toHaveLength(1);
  });

  it('preserves star descriptions, numeric labels, required flags and a fixed closing question', async () => {
    const parsed = await parsePostLectureQuestionBank(spreadsheet([
      ['Category', 'Question', 'Type', 'Required', 'Scale labels', 'Scale max', 'Scale display', 'Min label', 'Max label'],
      ['', 'Any comments?', 'long_text', 'yes'],
      ['Experience', 'Star score?', 'rating', 'true', 'Low | Basic | Moderate | Good | Great', 5, 'stars'],
      ['Experience', 'Numeric score?', 'rating', '0', '', 10, 'numbers', 'Poor', 'Excellent'],
    ]));
    expect(parsed.sections[0].questions[0]).toMatchObject({ required: true, config: { display: 'stars', labels: ['Low', 'Basic', 'Moderate', 'Good', 'Great'] } });
    expect(parsed.sections[0].questions[1]).toMatchObject({ required: false, config: { display: 'numbers', max: 10, minLabel: 'Poor', maxLabel: 'Excellent' } });
    expect(parsed.sections.at(-1)).toMatchObject({ questionsPerDelivery: null, questions: [{ text: 'Any comments?', required: true }] });
  });

  it('reads Arabic CSV questions and quoted commas without altering their text', async () => {
    const bytes = new TextEncoder().encode('\uFEFFCategory,Question,Type\r\nالتدريس,"كيف كان الشرح, والأمثلة؟",stars');
    const parsed = await parsePostLectureQuestionBank({ name: 'arabic.csv', size: bytes.length, arrayBuffer: async () => bytes.buffer });
    expect(parsed.sections[0].title).toBe('التدريس');
    expect(parsed.sections[0].questions[0].text).toBe('كيف كان الشرح, والأمثلة؟');
  });

  it.each([
    ['missing header', [['Category', 'Question'], ['Teaching', 'First?']], /Type/],
    ['duplicate optional header', [['Category', 'Question', 'Type', 'Options', 'Options']], /exactly one "Options"/],
    ['both type headers', [['Category', 'Question', 'Type', 'Answer type']], /exactly one/],
    ['duplicate option columns', [['Category', 'Question', 'Answer type', 'Option 1', 'Option_1']], /exactly one "Option 1"/],
    ['mixed old and new option formats', [['Category', 'Question', 'Answer type', 'Option 1', 'Option 2', 'Options'], ['Teaching', 'Choose?', 'Choose one', 'A', 'B', 'A | B']], /not both/],
    ['different draw counts within a category', [headings, ['Teaching', 'First?', 1, 'stars'], ['Teaching', 'Second?', 2, 'stars'], ...validRows.slice(3)], /same draw count/],
    ['too many questions requested', [headings, ['Teaching', 'First?', 2, 'stars']], /cannot draw more/],
    ['duplicate question', [headings, ...validRows.slice(1, 3), ['Resources', 'Was the explanation clear?', 2, 'stars'], ...validRows.slice(4)], /duplicate question/],
    ['extra final text', [...validRows, ['', 'Other thoughts?', '', 'text']], /only one closing/],
    ['category missing on a non-closing question', [headings, ['', 'First?', '', 'yes_no']], /only a closing text/],
    ['no categories', [headings, ['', 'Comments?', '', 'text']], /at least one question category/],
    ['invalid draw count', [headings, ['Teaching', 'First?', 1.5, 'stars']], /positive whole number/],
    ['unknown type', [headings, ['Teaching', 'First?', '', 'unknown']], /unsupported Type/],
  ])('rejects %s', async (_label, rows, expected) => {
    await expect(parsePostLectureQuestionBank(spreadsheet(rows as unknown[][]))).rejects.toThrow(expected as RegExp);
  });

  it.each([
    ['choice options missing', 'single_choice', '', '', '', '', /at least two choices/],
    ['one choice option', 'dropdown', 'One', '', '', '', /at least two choices/],
    ['duplicate choice options', 'multiple_choice', 'One | one', '', '', '', /duplicates/],
    ['invalid required flag', 'yes_no', '', 'sometimes', '', '', /Required must/],
    ['invalid scale maximum', 'rating', '', '', 7, '', /Scale max/],
    ['ten-star scale', 'stars', '', '', 10, '', /star ratings use/],
    ['invalid display', 'rating', '', '', 5, 'slider', /Scale display/],
  ])('rejects %s', async (_label, type, options, required, maximum, display, expected) => {
    await expect(parsePostLectureQuestionBank(spreadsheet([
      ['Category', 'Question', 'Type', 'Options', 'Required', 'Scale max', 'Scale display'],
      ['Category', 'Question?', type, options, required, maximum, display],
    ]))).rejects.toThrow(expected as RegExp);
  });

  it('rejects oversized files and unsupported formats before reading them', async () => {
    const arrayBuffer = async () => { throw new Error('Must not read'); };
    await expect(parsePostLectureQuestionBank({ name: 'bank.xlsx', size: 2 * 1024 * 1024 + 1, arrayBuffer })).rejects.toThrow(/2 MB/);
    await expect(parsePostLectureQuestionBank({ name: 'bank.xls', size: 10, arrayBuffer })).rejects.toThrow(/.xlsx or CSV/);
  });
});
