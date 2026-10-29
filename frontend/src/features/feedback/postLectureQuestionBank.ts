import * as XLSX from 'xlsx';
import type { FeedbackQuestion, FeedbackQuestionAnalyticsSettings, FeedbackQuestionType, FeedbackSection } from '@/api/feedback';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;
const REQUIRED_HEADERS = ['Category', 'Question', 'Type'] as const;
const OPTIONAL_HEADERS = ['Options', 'Required', 'Help text', 'Questions per lecture', 'Scale max', 'Scale display', 'Scale labels', 'Min label', 'Max label', 'Importance', 'Scoring', 'Yes score', 'No score', 'Score min', 'Score max', 'Include in overall score'] as const;
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

const scoringHeaders = ['Importance', 'Scoring', 'Yes score', 'No score', ...Array.from({ length: 6 }, (_, index) => `Option ${index + 1} score`), 'Score min', 'Score max', 'Include in overall score', 'Required', 'Help text', 'Scale max', 'Scale display', 'Scale labels', 'Min label', 'Max label'];
export const POST_LECTURE_BANK_TEMPLATE = templateRows.map((row, index) => {
  if (!index) return [...row, ...scoringHeaders];
  const type = row[2];
  const choice = ['Choose one', 'Choose several', 'Dropdown list', 'Agreement scale'].includes(type);
  const options = row.slice(3);
  const scores = Array.from({ length: 6 }, (_, position) => !options[position] ? ''
    : type === 'Agreement scale' ? position / (options.length - 1) * 100 : 100);
  return [...row, ...Array(9 - row.length).fill(''), 'Medium',
    type === 'Yes / No' || choice ? 'Per answer' : ['5 Stars', 'Number rating', 'Number'].includes(type) ? 'Higher is better' : '',
    ...(type === 'Yes / No' ? [100, 0] : ['', '']), ...scores,
    ...(type === 'Number' ? [0, 10] : ['', '']), 'Yes', type === 'Written answer' ? 'No' : 'Yes', '', '', '', '', '', ''];
}).map(row => row.map(value => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}).join(',')).join('\r\n');

export interface ParsedPostLectureBank {
  sections: FeedbackSection[];
  categoryCount: number;
  questionCount: number;
  closingQuestion: string | null;
}

function headerName(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ');
}

function requiredValue(value: string, defaultValue: boolean, rowNumber: number, label = 'Required') {
  if (!value) return defaultValue;
  if (['yes', 'true', '1'].includes(value.toLowerCase())) return true;
  if (['no', 'false', '0'].includes(value.toLowerCase())) return false;
  throw new Error(`Row ${rowNumber}: ${label} must be yes or no.`);
}

function analyticsConfig(question: FeedbackQuestion, read: (header: string) => string,
  number: (header: string, percentage?: boolean) => number | undefined, scoreHeaders: string[], rowNumber: number): FeedbackQuestionAnalyticsSettings | undefined {
  const analytics: FeedbackQuestionAnalyticsSettings = {};
  const importance = read('Importance').toLowerCase();
  if (importance) {
    if (!['critical', 'high', 'medium', 'low'].includes(importance)) throw new Error(`Row ${rowNumber}: Importance must be Critical, High, Medium or Low.`);
    analytics.importance = importance as FeedbackQuestionAnalyticsSettings['importance'];
  }
  const rawScoring = read('Scoring').toLowerCase();
  const methods: Record<string, FeedbackQuestionAnalyticsSettings['scoring']> = {
    'higher is better': 'higher', higher: 'higher', 'lower is better': 'lower', lower: 'lower',
    'per answer': 'options', options: 'options', 'set a score for each answer': 'options',
    none: 'none', 'not scored': 'none',
  };
  const choice = CHOICE_TYPES.has(question.type) || question.type === 'yes_no';
  const scorable = choice || question.type === 'rating' || question.type === 'number';
  if (rawScoring) {
    const method = methods[rawScoring];
    if (!method || (scorable && (choice ? method !== 'options' : !['higher', 'lower'].includes(method))) || (!scorable && method !== 'none')) {
      throw new Error(`Row ${rowNumber}: ${scorable ? choice ? 'use Per answer scoring.' : 'use Higher is better or Lower is better.' : 'this answer type has no automatic score.'}`);
    }
    analytics.scoring = method;
  }
  const optionScores: Record<string, number> = {};
  for (const header of scoreHeaders) {
    const score = number(header, true);
    if (score === undefined) continue;
    const index = Number(header.match(/\d+/)![0]);
    const option = read(`Option ${index}`) || (read('Options') ? question.config.options?.[index - 1] : undefined);
    if (!CHOICE_TYPES.has(question.type) || !option) throw new Error(`Row ${rowNumber}: ${header} needs a matching choice in Option ${index}.`);
    optionScores[option] = score;
  }
  for (const option of ['yes', 'no'] as const) {
    const score = number(`${option === 'yes' ? 'Yes' : 'No'} score`, true);
    if (score === undefined) continue;
    if (question.type !== 'yes_no') throw new Error(`Row ${rowNumber}: Yes score and No score apply only to Yes / No questions.`);
    optionScores[option] = score;
  }
  if (Object.keys(optionScores).length) { analytics.optionScores = optionScores; analytics.scoring = 'options'; }
  const min = number('Score min'), max = number('Score max');
  if (min !== undefined || max !== undefined) {
    if (question.type !== 'number') throw new Error(`Row ${rowNumber}: Score min and Score max apply only to Number questions.`);
    if (min !== undefined && max !== undefined && max <= min) throw new Error(`Row ${rowNumber}: Score max must be greater than Score min.`);
    if (min !== undefined) analytics.scoreMin = min;
    if (max !== undefined) analytics.scoreMax = max;
    analytics.scoring ??= 'higher';
  }
  if (read('Include in overall score')) analytics.includeInOverall = requiredValue(read('Include in overall score'), true, rowNumber, 'Include in overall score');
  return Object.keys(analytics).length ? analytics : undefined;
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

export async function parsePostLectureQuestionBank(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>, { fixedQuestions = false }: { fixedQuestions?: boolean } = {}): Promise<ParsedPostLectureBank> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('Upload an Excel .xlsx or CSV file.');
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error('The spreadsheet must be between 1 byte and 2 MB.');

  let workbook: XLSX.WorkBook;
  try {
    const bytes = await file.arrayBuffer();
    workbook = extension === 'csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string', cellNF: true })
      : XLSX.read(bytes, { type: 'array', cellNF: true });
  } catch {
    throw new Error('The spreadsheet could not be read.');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The spreadsheet is empty.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: '' });
  if (!rows.length) throw new Error('The spreadsheet is empty.');
  if (rows.slice(1).filter(row => row.some(value => String(value ?? '').trim())).length > MAX_ROWS) throw new Error(`The spreadsheet can contain at most ${MAX_ROWS} question rows.`);
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
  const scoreHeaders: string[] = [];
  for (const [index, header] of headers.entries()) {
    const score = /^option\s*([1-9]\d*)\s+score$/.exec(header);
    if (score) {
      const key = `Option ${Number(score[1])} score`;
      if (columns.has(key)) throw new Error(`The spreadsheet needs exactly one "${key}" column.`);
      columns.set(key, index);
      scoreHeaders.push(key);
      continue;
    }
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
    // Fixed forms can reuse older lecture sheets, but their draw counts do not apply.
    const countValue = fixedQuestions ? '' : read('Questions per lecture');
    const originalType = typeCode(read('Type'));
    if (!row.some(value => String(value ?? '').trim())) continue;
    const rowNumber = index + 2;
    const number = (header: string, percentage = false) => {
      let value = read(header);
      if (!value) return undefined;
      const percentText = value.endsWith('%');
      if (percentText) value = value.slice(0, -1).trim();
      const cell = columns.has(header) ? sheet[XLSX.utils.encode_cell({ r: index + 1, c: columns.get(header)! })] : undefined;
      let result = Number(value);
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(result) || (!percentage && percentText)) {
        throw new Error(`Row ${rowNumber}: ${header} must be a finite number${percentage ? ' from 0 to 100' : ''}.`);
      }
      if (percentage && !percentText && cell?.t === 'n' && /(?:^|[^\\])%/.test(cell.z || '')) result *= 100;
      if (percentage && (result < 0 || result > 100)) throw new Error(`Row ${rowNumber}: ${header} must be from 0 to 100.`);
      return result;
    };
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
    const analytics = analyticsConfig(question, read, number, scoreHeaders, rowNumber);
    if (analytics) question.config.analytics = analytics;
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
      title: category, icon: 'ri-file-list-3-line', description: '', questionsPerDelivery: fixedQuestions ? null : 1, questions: [],
    };
    section.questions.push(question);
    categories.set(key, section);
  }

  if (!categories.size) throw new Error('Include at least one question category.');
  for (const [key, section] of categories) {
    section.questionsPerDelivery = fixedQuestions ? null : legacyDrawCounts.get(key) ?? 1;
    if (section.questionsPerDelivery !== null && section.questionsPerDelivery > section.questions.length) throw new Error(`"${section.title}" cannot draw more questions than its bank contains.`);
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
