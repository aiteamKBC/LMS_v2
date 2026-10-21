import * as XLSX from 'xlsx';
import type { FeedbackQuestion, FeedbackSection } from '@/api/feedback';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;
const HEADERS = ['Category', 'Question', 'Questions per lecture', 'Type'] as const;

export const POST_LECTURE_BANK_TEMPLATE = [
  HEADERS.join(','),
  'Teaching,How clear was the tutor\'s explanation?,1,stars',
  'Teaching,How useful were the examples?,1,stars',
  'Teaching,How well was the session paced?,1,stars',
  'Learning resources,How useful were the materials?,2,stars',
  'Learning resources,How easy was it to follow the activities?,2,stars',
  'Learning resources,How helpful were the practice tasks?,2,stars',
  ',What did you find most useful and what could we improve?,,text',
].join('\r\n');

export interface ParsedPostLectureBank {
  sections: FeedbackSection[];
  ratingCount: number;
  closingQuestion: string;
}

function headerName(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ');
}

function cell(row: unknown[], index: number) {
  return String(row[index] ?? '').trim();
}

function starQuestion(text: string): FeedbackQuestion {
  return {
    type: 'rating', text, required: true, helpText: '',
    config: { min: 1, max: 5, display: 'stars', labels: ['', '', '', '', ''] },
  };
}

export async function parsePostLectureQuestionBank(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<ParsedPostLectureBank> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('Upload an Excel .xlsx or CSV file.');
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error('The spreadsheet must be between 1 byte and 2 MB.');

  let workbook: XLSX.WorkBook;
  try {
    const bytes = await file.arrayBuffer();
    workbook = extension === 'csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string' })
      : XLSX.read(bytes, { type: 'array' });
  } catch {
    throw new Error('The spreadsheet could not be read.');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The spreadsheet is empty.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
  if (!rows.length) throw new Error('The spreadsheet is empty.');
  if (rows.length - 1 > MAX_ROWS) throw new Error(`The spreadsheet can contain at most ${MAX_ROWS} question rows.`);
  const headers = rows[0].map(headerName);
  const columns = HEADERS.map(header => {
    const matches = headers.flatMap((value, index) => value === headerName(header) ? [index] : []);
    if (matches.length !== 1) throw new Error(`The spreadsheet needs exactly one "${header}" column.`);
    return matches[0];
  });
  const [categoryColumn, questionColumn, countColumn, typeColumn] = columns;
  const categories = new Map<string, FeedbackSection>();
  const seenQuestions = new Set<string>();
  let closingQuestion = '';
  let ratingCount = 0;

  rows.slice(1).forEach((row, index) => {
    const category = cell(row, categoryColumn);
    const text = cell(row, questionColumn);
    const countValue = cell(row, countColumn);
    const type = cell(row, typeColumn).toLowerCase();
    if (!category && !text && !countValue && !type) return;
    const rowNumber = index + 2;
    if (!text || text.length > 2000) throw new Error(`Row ${rowNumber}: question must contain 1–2000 characters.`);
    const questionKey = text.toLowerCase();
    if (seenQuestions.has(questionKey)) throw new Error(`Row ${rowNumber}: duplicate question.`);
    seenQuestions.add(questionKey);
    if (type === 'text') {
      if (category || countValue) throw new Error(`Row ${rowNumber}: the closing text question must have an empty category and draw count.`);
      if (closingQuestion) throw new Error(`Row ${rowNumber}: include only one closing text question.`);
      closingQuestion = text;
      return;
    }
    if (type !== 'stars') throw new Error(`Row ${rowNumber}: type must be "stars" or "text".`);
    if (!category || category.length > 255) throw new Error(`Row ${rowNumber}: category must contain 1–255 characters.`);
    if (countValue !== '1' && countValue !== '2') throw new Error(`Row ${rowNumber}: questions per lecture must be 1 or 2.`);
    const key = category.toLowerCase();
    const existing = categories.get(key);
    if (existing && existing.questionsPerDelivery !== Number(countValue)) {
      throw new Error(`Row ${rowNumber}: every question in "${existing.title}" must have the same draw count.`);
    }
    const section: FeedbackSection = existing || {
      title: category, icon: 'ri-star-line', description: '',
      questionsPerDelivery: Number(countValue), questions: [],
    };
    section.questions.push(starQuestion(text));
    categories.set(key, section);
    ratingCount += 1;
  });

  if (categories.size < 2) throw new Error('Include at least two star-question categories.');
  for (const section of categories.values()) {
    if (section.questions.length <= (section.questionsPerDelivery || 0)) {
      throw new Error(`"${section.title}" needs more questions than its draw count so the weekly selection can vary.`);
    }
  }
  if (!closingQuestion) throw new Error('Include one closing text question with an empty category and draw count.');

  return {
    sections: [
      ...categories.values(),
      {
        title: 'General comments', icon: 'ri-chat-3-line', description: '',
        questionsPerDelivery: null,
        questions: [{ type: 'long_text', text: closingQuestion, required: false, helpText: '', config: {} }],
      },
    ],
    ratingCount,
    closingQuestion,
  };
}
