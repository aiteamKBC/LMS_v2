import * as XLSX from 'xlsx';
import type { FeedbackQuestion, FeedbackQuestionType, FeedbackSection } from '@/api/feedback';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;
const REQUIRED_HEADERS = ['Category', 'Question', 'Type'] as const;
const OPTIONAL_HEADERS = ['Options', 'Required', 'Help text', 'Questions per lecture', 'Scale max', 'Scale display', 'Scale labels', 'Min label', 'Max label', 'Importance'] as const;
const CHOICE_TYPES = new Set<FeedbackQuestionType>(['single_choice', 'multiple_choice', 'dropdown', 'likert']);
export const QUESTION_BANK_TYPES: readonly FeedbackQuestionType[] = [
  'short_text', 'long_text', 'yes_no', 'single_choice', 'multiple_choice',
  'dropdown', 'rating', 'likert', 'number', 'date', 'name', 'email', 'photo_upload',
];
export const QUESTION_BANK_ANSWER_TYPES = [
  { value: 'stars', label: '5 Stars' }, { value: 'long_text', label: 'Written answer' },
  { value: 'short_text', label: 'Short answer' }, { value: 'yes_no', label: 'Yes / No' },
  { value: 'single_choice', label: 'Choose one' }, { value: 'multiple_choice', label: 'Choose several' },
  { value: 'dropdown', label: 'Dropdown list' }, { value: 'rating', label: 'Number rating' },
  { value: 'likert', label: 'Agreement scale' }, { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' }, { value: 'name', label: 'Full name' },
  { value: 'email', label: 'Email address' }, { value: 'photo_upload', label: 'Photo upload' },
] as const;

export function questionBankAnswerLabel(question: FeedbackQuestion) {
  const value = question.type === 'rating' && question.config.display === 'stars' ? 'stars' : question.type;
  return QUESTION_BANK_ANSWER_TYPES.find(type => type.value === value)?.label || question.type;
}

function typeCode(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const friendly = QUESTION_BANK_ANSWER_TYPES.find(type => type.label.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
  const aliases: Record<string, string> = { longanswer: 'long_text', chooseoneanswer: 'single_choice', chooseseveralanswers: 'multiple_choice' };
  return friendly?.value || aliases[normalized] || value.toLowerCase().replace(/[ -]+/g, '_');
}

const templateRows = [
  ['Category', 'Question', 'Answer type', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Option 6'],
  ['Teaching', 'How clear was the tutor\'s explanation?', '5 Stars'],
  ['Teaching', 'Were the learning objectives clear?', 'Yes / No'],
  ['Experience', 'How would you rate the session overall?', 'Number rating'],
  ['Experience', 'Which topic helped you most?', 'Short answer'],
  ['Experience', 'How will you apply this learning?', 'Written answer'],
  ['Activities', 'Which activity helped most?', 'Choose one', 'Discussion', 'Practice', 'Demonstration'],
  ['Activities', 'Which resources did you use?', 'Choose several', 'Slides', 'Workbook', 'Recording'],
  ['Activities', 'Which activity would you like next?', 'Dropdown list', 'Case study', 'Group work', 'Quiz'],
  ['Activities', 'I feel ready to apply this learning.', 'Agreement scale', 'Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  ['Details', 'How many practice tasks did you complete?', 'Number'],
  ['Details', 'When do you plan to use this learning?', 'Date'],
  ['Details', 'Your name', 'Full name'],
  ['Details', 'Contact email', 'Email address'],
  ['Evidence', 'Add a photo of your practice work.', 'Photo upload'],
  ['General', 'What did you find most useful and what could we improve?', 'Written answer'],
];

export const POST_LECTURE_BANK_TEMPLATE = templateRows.map((row, index) => [...row, ...Array(9 - row.length).fill(''), index ? 'Medium' : 'Importance'].map(value =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
).join(',')).join('\r\n');

export interface ParsedPostLectureBank {
  sections: FeedbackSection[];
  categoryCount: number;
  questionCount: number;
  closingQuestion: string | null;
}

function headerName(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ');
}

function requiredValue(value: string, defaultValue: boolean, rowNumber: number) {
  if (!value) return defaultValue;
  if (['yes', 'true', '1'].includes(value.toLowerCase())) return true;
  if (['no', 'false', '0'].includes(value.toLowerCase())) return false;
  throw new Error(`Row ${rowNumber}: Required must be yes or no.`);
}

function questionConfig(type: FeedbackQuestionType, originalType: string, read: (header: string) => string, rowNumber: number, optionHeaders: string[]): FeedbackQuestion['config'] {
  if (CHOICE_TYPES.has(type)) {
    const separateOptions = optionHeaders.map(read).filter(Boolean);
    const packedOptions = read('Options');
    if (separateOptions.length && packedOptions) throw new Error(`Row ${rowNumber}: use separate Option columns or the old Options column, not both.`);
    const options = separateOptions.length ? separateOptions : packedOptions.split('|').map(option => option.trim()).filter(Boolean);
    if (options.length < 2) throw new Error(`Row ${rowNumber}: add at least two choices in Option 1 and Option 2.`);
    if (new Set(options.map(option => option.toLowerCase())).size !== options.length) {
      throw new Error(`Row ${rowNumber}: Options must not contain duplicates.`);
    }
    return { options };
  }
  if (type !== 'rating') return {};
  const display = read('Scale display').toLowerCase() || (originalType === 'stars' ? 'stars' : 'numbers');
  const maximum = read('Scale max') || '5';
  if (display !== 'stars' && display !== 'numbers') throw new Error(`Row ${rowNumber}: Scale display must be stars or numbers.`);
  if (maximum !== '5' && maximum !== '10') throw new Error(`Row ${rowNumber}: Scale max must be 5 or 10.`);
  if (display === 'stars' && maximum !== '5') throw new Error(`Row ${rowNumber}: star ratings use a 1–5 scale.`);
  const labels = read('Scale labels');
  if (labels && display !== 'stars') throw new Error(`Row ${rowNumber}: Scale labels apply only to stars; use Min label and Max label for numbers.`);
  const starLabels = labels ? labels.split('|').map(label => label.trim()) : ['', '', '', '', ''];
  if (display === 'stars' && starLabels.length !== 5) throw new Error(`Row ${rowNumber}: provide five Scale labels separated by |.`);
  return display === 'stars'
    ? { min: 1, max: 5, display, labels: starLabels }
    : { min: 1, max: Number(maximum), display, minLabel: read('Min label'), maxLabel: read('Max label') };
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
  const columns = new Map<string, number>();
  for (const header of [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]) {
    const matches = headers.flatMap((value, index) => value === headerName(header) || (header === 'Type' && value === 'answer type') ? [index] : []);
    if (matches.length > 1 || (!matches.length && (REQUIRED_HEADERS as readonly string[]).includes(header))) {
      throw new Error(`The spreadsheet needs exactly one "${header === 'Type' ? 'Answer type (or Type)' : header}" column.`);
    }
    if (matches.length) columns.set(header, matches[0]);
  }
  const optionHeaders: string[] = [];
  for (const [index, header] of headers.entries()) {
    const match = /^option\s*([1-9]\d*)$/.exec(header);
    if (!match) continue;
    const key = `Option ${Number(match[1])}`;
    if (columns.has(key)) throw new Error(`The spreadsheet needs exactly one "${key}" column.`);
    columns.set(key, index);
    optionHeaders.push(key);
  }
  optionHeaders.sort((left, right) => Number(left.slice(7)) - Number(right.slice(7)));
  const categories = new Map<string, FeedbackSection>();
  const legacyDrawCounts = new Map<string, number>();
  const seenQuestions = new Set<string>();
  let closing: FeedbackQuestion | null = null;

  for (const [index, row] of rows.slice(1).entries()) {
    const read = (header: string) => String(row[columns.get(header) ?? -1] ?? '').trim();
    const category = read('Category');
    const text = read('Question');
    const countValue = read('Questions per lecture');
    const originalType = typeCode(read('Type'));
    if (!row.some(value => String(value ?? '').trim())) continue;
    const rowNumber = index + 2;
    if (!text || text.length > 2000) throw new Error(`Row ${rowNumber}: question must contain 1–2000 characters.`);
    const type = originalType === 'stars' ? 'rating' : originalType === 'text' ? 'long_text' : originalType;
    if (!QUESTION_BANK_TYPES.includes(type as FeedbackQuestionType)) throw new Error(`Row ${rowNumber}: unsupported Type "${read('Type')}". Use a type from the template.`);
    const questionKey = text.toLowerCase();
    if (seenQuestions.has(questionKey)) throw new Error(`Row ${rowNumber}: duplicate question.`);
    seenQuestions.add(questionKey);
    const question: FeedbackQuestion = {
      type: type as FeedbackQuestionType, text,
      required: requiredValue(read('Required'), Boolean(category) && type !== 'long_text', rowNumber),
      helpText: read('Help text'),
      config: questionConfig(type as FeedbackQuestionType, originalType, read, rowNumber, optionHeaders),
    };
    const importance = read('Importance').toLowerCase();
    if (importance) {
      if (!['critical', 'high', 'medium', 'low'].includes(importance)) throw new Error(`Row ${rowNumber}: Importance must be Critical, High, Medium or Low.`);
      question.config.analytics = { importance: importance as 'critical' | 'high' | 'medium' | 'low' };
    }
    if (!category) {
      if (type !== 'long_text' || countValue) throw new Error(`Row ${rowNumber}: only a closing text question may have an empty category; leave its draw count empty.`);
      if (closing) throw new Error(`Row ${rowNumber}: include only one closing text question.`);
      closing = question;
      continue;
    }
    if (category.length > 255) throw new Error(`Row ${rowNumber}: category must contain 1–255 characters.`);
    const key = category.toLowerCase();
    if (countValue) {
      if (!/^[1-9]\d*$/.test(countValue)) throw new Error(`Row ${rowNumber}: questions per lecture must be a positive whole number.`);
      const count = Number(countValue);
      if (legacyDrawCounts.has(key) && legacyDrawCounts.get(key) !== count) {
        throw new Error(`Row ${rowNumber}: every question in "${category}" must have the same draw count, or remove the draw-count column and set it in the preview.`);
      }
      legacyDrawCounts.set(key, count);
    }
    const section: FeedbackSection = categories.get(key) || {
      title: category, icon: 'ri-file-list-3-line', description: '', questionsPerDelivery: 1, questions: [],
    };
    section.questions.push(question);
    categories.set(key, section);
  }

  if (!categories.size) throw new Error('Include at least one question category.');
  for (const [key, section] of categories) {
    section.questionsPerDelivery = legacyDrawCounts.get(key) ?? 1;
    if (section.questionsPerDelivery > section.questions.length) throw new Error(`"${section.title}" cannot draw more questions than its bank contains.`);
  }
  const sections = [...categories.values()];
  if (closing) sections.push({
    title: 'General comments', icon: 'ri-chat-3-line', description: '', questionsPerDelivery: null,
    questions: [closing],
  });
  return {
    sections, categoryCount: categories.size,
    questionCount: sections.reduce((count, section) => count + section.questions.length, 0),
    closingQuestion: closing?.text ?? null,
  };
}
